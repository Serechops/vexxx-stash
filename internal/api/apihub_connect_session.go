package api

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/storage"
	"github.com/chromedp/chromedp"
	"github.com/google/uuid"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/logger"
)

// cookiePair mirrors the {name, value} shape of a browser cookie-export
// blob — the exact format src/aylo/cookieImport.ts and
// src/evilangel/cookieImport.ts already parse, so the plugin's existing
// paste-a-blob code path can consume a captured session unchanged.
type cookiePair struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type connectStatus string

const (
	connectStatusPending   connectStatus = "pending"
	connectStatusSuccess   connectStatus = "success"
	connectStatusFailed    connectStatus = "failed"
	connectStatusCancelled connectStatus = "cancelled"
)

const (
	connectSessionTimeout = 10 * time.Minute // generous — allows for 2FA
	connectSessionTTL     = 15 * time.Minute // in-memory record GC
	connectPollInterval   = time.Second
	// These sites set anonymous/pre-auth cookies (an anonymous access_token_ma,
	// an instance_token) the moment the login page loads — so presence of a
	// "done" cookie NAME isn't a logged-in signal. Instead we baseline the
	// anonymous cookies during this grace window, then treat login as complete
	// when a watched cookie's VALUE changes (or a login-only cookie appears)
	// versus that baseline.
	connectBaselineGrace = 6 * time.Second
)

type connectSession struct {
	mu        sync.Mutex
	status    connectStatus
	cookies   []cookiePair
	errMsg    string
	cancel    context.CancelFunc
	createdAt time.Time
}

func (s *connectSession) snapshot() (connectStatus, []cookiePair, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status, s.cookies, s.errMsg
}

// setResult is a no-op once the session has already resolved, so a slow
// poll-loop tick racing against an explicit Cancel can't clobber the result.
func (s *connectSession) setResult(status connectStatus, cookies []cookiePair, errMsg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status != connectStatusPending {
		return
	}
	s.status = status
	s.cookies = cookies
	s.errMsg = errMsg
}

var (
	connectSessionsMu     sync.Mutex
	connectSessions       = map[string]*connectSession{}
	connectActiveByTarget = map[string]string{} // targetKey -> in-flight sessionID
)

func isRemoteCDPPath(cdpPath string) bool {
	return strings.HasPrefix(cdpPath, "http://") ||
		strings.HasPrefix(cdpPath, "https://") ||
		strings.HasPrefix(cdpPath, "ws://")
}

// startConnectSession launches a driven, visible Chrome window for the given
// target and returns a session ID immediately; the login itself is captured
// asynchronously and polled via Status.
func startConnectSession(targetKey string) (string, error) {
	target, ok := connectTargets[targetKey]
	if !ok {
		return "", fmt.Errorf("unknown connect target %q", targetKey)
	}

	cdpPath := config.GetInstance().GetScraperCDPPath()
	if isRemoteCDPPath(cdpPath) {
		return "", fmt.Errorf("browser sign-in needs a local Chrome — the configured scraper CDP path (%s) is a remote debugging address, not a local executable", cdpPath)
	}

	connectSessionsMu.Lock()
	if existingID, ok := connectActiveByTarget[targetKey]; ok {
		if existing, ok := connectSessions[existingID]; ok {
			existing.cancel()
		}
	}

	sessionID := uuid.NewString()
	ctx, cancel := context.WithTimeout(context.Background(), connectSessionTimeout)
	sess := &connectSession{
		status:    connectStatusPending,
		cancel:    cancel,
		createdAt: time.Now(),
	}
	connectSessions[sessionID] = sess
	connectActiveByTarget[targetKey] = sessionID
	connectSessionsMu.Unlock()

	go runConnectSession(ctx, sess, target, cdpPath)
	go reapConnectSession(sessionID)

	return sessionID, nil
}

func cancelConnectSession(sessionID string) error {
	connectSessionsMu.Lock()
	sess, ok := connectSessions[sessionID]
	connectSessionsMu.Unlock()
	if !ok {
		return fmt.Errorf("unknown session")
	}
	sess.cancel()
	return nil
}

func reapConnectSession(sessionID string) {
	time.Sleep(connectSessionTTL)
	connectSessionsMu.Lock()
	defer connectSessionsMu.Unlock()
	if sess, ok := connectSessions[sessionID]; ok {
		sess.cancel()
		delete(connectSessions, sessionID)
	}
	for target, id := range connectActiveByTarget {
		if id == sessionID {
			delete(connectActiveByTarget, target)
		}
	}
}

// runConnectSession drives a real, visible Chrome instance to the target's
// login page and polls its cookie jar until one of the target's "done"
// cookies appears (or the session is cancelled/times out/the window is
// closed by the user). Modeled on pkg/scraper/url.go's exec-allocator setup,
// but headed (not headless) and long-lived rather than a single page load.
func runConnectSession(ctx context.Context, sess *connectSession, target connectTarget, cdpPath string) {
	defer sess.cancel()

	dir, err := os.MkdirTemp("", "stash-apihub-connect")
	if err != nil {
		sess.setResult(connectStatusFailed, nil, fmt.Sprintf("could not create browser profile dir: %v", err))
		return
	}
	defer os.RemoveAll(dir)

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("headless", false),
		chromedp.Flag("disable-blink-features", "AutomationControlled"),
		chromedp.UserDataDir(dir),
	)
	if cdpPath != "" {
		opts = append(opts, chromedp.ExecPath(cdpPath))
	}

	allocCtx, allocCancel := chromedp.NewExecAllocator(ctx, opts...)
	defer allocCancel()

	browserCtx, browserCancel := chromedp.NewContext(allocCtx)
	defer browserCancel()

	if err := chromedp.Run(browserCtx, network.Enable(), chromedp.Navigate(target.loginURL)); err != nil {
		if ctx.Err() != nil {
			sess.setResult(connectStatusCancelled, nil, "sign-in was cancelled")
		} else {
			logger.Warnf("[apihub connect] could not open login page for %s: %v", target.loginURL, err)
			sess.setResult(connectStatusFailed, nil, fmt.Sprintf("could not open the login page: %v", err))
		}
		return
	}

	ticker := time.NewTicker(connectPollInterval)
	defer ticker.Stop()

	startedAt := time.Now()
	// baseline maps each watched done-cookie name to its anonymous/pre-auth
	// value, captured during the grace window. Login is detected when a watched
	// cookie's value later differs from its baseline, or a watched cookie that
	// was absent at baseline appears.
	baseline := map[string]string{}
	baselineSet := false

	// Names last seen in the jar, surfaced at info level if the session ends
	// without a capture so a mismatch is diagnosable without debug logging on.
	var lastSeen string

	for {
		select {
		case <-ctx.Done():
			logger.Infof("[apihub connect] timed out waiting for login; last cookies seen: %s", lastSeen)
			sess.setResult(connectStatusCancelled, nil, "sign-in was cancelled or timed out")
			return
		case <-browserCtx.Done():
			// The browser process/target actually went away (window closed,
			// crashed). This is a distinct signal from a single failed
			// command below — don't infer "closed" from a transient error.
			logger.Infof("[apihub connect] browser window closed before capture; last cookies seen: %s", lastSeen)
			sess.setResult(connectStatusCancelled, nil, "the browser window was closed before sign-in was captured")
			return
		case <-ticker.C:
			cookies, err := getCDPCookies(browserCtx)
			if err != nil {
				// Cookie checks can fail transiently (mid-navigation, a
				// one-off protocol hiccup) without the browser having
				// actually closed — log and retry rather than giving up
				// on the whole session over one bad poll.
				logger.Debugf("[apihub connect] cookie check failed, will retry: %v", err)
				continue
			}
			lastSeen = cookieNames(cookies)
			logger.Debugf("[apihub connect] %d cookies in jar: %s", len(cookies), lastSeen)

			// During the grace window, keep (re)recording the anonymous values
			// of the watched cookies as the baseline — don't trigger yet.
			if time.Since(startedAt) < connectBaselineGrace {
				for _, name := range target.doneCookieNames {
					if v, ok := cookieValue(cookies, name); ok {
						baseline[name] = v
					}
				}
				continue
			}
			if !baselineSet {
				baselineSet = true
				logger.Infof("[apihub connect] anonymous baseline established (%d watched cookies present); waiting for login", len(baseline))
			}

			if loggedIn := authChangedFromBaseline(cookies, target.doneCookieNames, baseline); loggedIn {
				logger.Infof("[apihub connect] login detected; captured %d cookies", len(cookies))
				sess.setResult(connectStatusSuccess, cookies, "")
				return
			}
		}
	}
}

// getCDPCookies reads the ENTIRE browser cookie jar (Storage.getCookies), not
// just the current page's cookies (Network.getCookies) — the login flow
// redirects across hosts (site-ma / www / auth), and the account tokens can
// land on a domain that isn't the page currently in the foreground.
func getCDPCookies(ctx context.Context) ([]cookiePair, error) {
	var chromeCookies []*network.Cookie
	err := chromedp.Run(ctx, chromedp.ActionFunc(func(ctx context.Context) error {
		var e error
		chromeCookies, e = storage.GetCookies().Do(ctx)
		return e
	}))
	if err != nil {
		return nil, err
	}
	out := make([]cookiePair, 0, len(chromeCookies))
	for _, c := range chromeCookies {
		out = append(out, cookiePair{Name: c.Name, Value: c.Value})
	}
	return out, nil
}

func cookieNames(cookies []cookiePair) string {
	names := make([]string, 0, len(cookies))
	for _, c := range cookies {
		names = append(names, c.Name)
	}
	return strings.Join(names, ", ")
}

func cookieValue(cookies []cookiePair, name string) (string, bool) {
	for _, c := range cookies {
		if c.Name == name {
			return c.Value, true
		}
	}
	return "", false
}

// authChangedFromBaseline reports whether any watched cookie signals that the
// user has authenticated: it's present now and either was absent at the
// anonymous baseline (a login-only cookie appeared) or its value changed from
// the anonymous one (an anonymous token was replaced with an authenticated
// one).
func authChangedFromBaseline(cookies []cookiePair, watched []string, baseline map[string]string) bool {
	for _, name := range watched {
		cur, ok := cookieValue(cookies, name)
		if !ok || cur == "" {
			continue
		}
		base, existed := baseline[name]
		if !existed || cur != base {
			return true
		}
	}
	return false
}
