package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/logger"
)

// Server-side keepalive for the Gamma-platform member sessions (EvilAngel and
// Adult Time).
//
// Unlike Aylo (Keycloak refresh token) and TeamSkeet (Reptyle OAuth), these two
// networks have NO token-refresh endpoint. They run on a plain cookie session:
// the persisted Cookie header carries a fixed "remember me" pair
// (autologin_userid/autologin_hash, ~30-day HARD expiry, never rotates) plus a
// sliding session set (SID/activeMemberValidator/identityStatus) that the server
// RE-ISSUES via Set-Cookie on every authenticated response — but only while the
// autologin pair is still being sent.
//
// Two things kept the session from staying warm:
//   - The media proxy injects the stored cookie but discards every upstream
//     Set-Cookie (routes_proxy.go), so even active browsing never captured the
//     reissued sliding cookies — we kept replaying the original frozen jar.
//   - With no tab open, nothing touches the session at all, so the sliding
//     cookies drift toward staleness.
//
// This loop periodically GETs a lightweight authenticated members endpoint with
// the stored cookie, reads the reissued sliding cookies out of the response's
// Set-Cookie headers, and merges them back into the persisted jar. That slides
// the window forward independent of any open tab and keeps the freshest session
// on disk. It cannot exceed the autologin pair's ~30-day hard cap — once that
// lapses only a fresh cookie paste recovers it (there is no refresh for it), and
// the loop surfaces that as a reauth warning.
//
// Cookies are not consumed by being refreshed (no single-use rotation like
// Aylo's token), so unlike the Aylo scheduler this needs no browser-side
// deference — the browser and this loop can both send the same cookie freely.
const (
	gammaKeepalivePluginID    = "apihub"
	gammaKeepaliveInterval    = 6 * time.Hour // sliding window is generous (~30d); 6h keeps it warm without hammering
	gammaKeepaliveStartup     = 60 * time.Second
	gammaKeepaliveHTTPTimeout = 20 * time.Second
)

// gammaKeepaliveNetwork describes one Gamma member session to keep warm.
type gammaKeepaliveNetwork struct {
	label      string   // human name for logs
	configKey  string   // plugin-config setting holding the joined Cookie header
	probeURL   string   // a lightweight authenticated members endpoint that reissues the sliding cookies
	loginHosts []string // redirect Location hosts that mean "logged out" (reauth needed)
}

// gammaKeepaliveNetworks is static — same rationale as connectTargets: adding a
// site is a code change, not user config.
var gammaKeepaliveNetworks = []gammaKeepaliveNetwork{
	{
		label:      "EvilAngel",
		configKey:  "evilangelCookie",
		probeURL:   "https://members.evilangel.com/",
		loginHosts: []string{"www.evilangel.com", "evilangel.com"},
	},
	{
		label:      "Adult Time",
		configKey:  "adulttimeCookie",
		probeURL:   "https://members.adulttime.com/en",
		loginHosts: []string{"freetour.adulttime.com", "www.adulttime.com"},
	},
}

// gammaSessionCookieNames is the exact set the plugin persists
// (evilangel/cookieImport.ts SESSION_COOKIE_NAMES). Only reissues of these names
// are merged back — never arbitrary tracking cookies the response might set.
var gammaSessionCookieNames = map[string]bool{
	"autologin_userid":      true,
	"autologin_hash":        true,
	"SID":                   true,
	"identityStatus":        true,
	"activeMemberValidator": true,
}

// startApihubGammaKeepaliveScheduler launches the background keepalive loop. It
// returns immediately; the work runs in its own goroutine for the process
// lifetime. Safe to call once at server start.
func startApihubGammaKeepaliveScheduler() {
	go func() {
		time.Sleep(gammaKeepaliveStartup)
		runGammaKeepaliveOnce()

		ticker := time.NewTicker(gammaKeepaliveInterval)
		defer ticker.Stop()
		for range ticker.C {
			runGammaKeepaliveOnce()
		}
	}()
}

// runGammaKeepaliveOnce refreshes every connected Gamma session once and logs
// per-network. Quiet (debug) when the plugin is disabled or a network isn't
// connected — only a real attempt produces an info/warn line.
func runGammaKeepaliveOnce() {
	cfg := config.GetInstance()
	for _, id := range cfg.GetDisabledPlugins() {
		if id == gammaKeepalivePluginID {
			logger.Debugf("[apihub-gamma-keepalive] plugin disabled; skipping")
			return
		}
	}

	for _, net := range gammaKeepaliveNetworks {
		status, msg := performGammaKeepalive(net)
		switch status {
		case "skipped":
			logger.Debugf("[apihub-gamma-keepalive] %s: %s", net.label, msg)
		case "reauth":
			logger.Warnf("[apihub-gamma-keepalive] %s: %s — reconnect this network from the APIHub Connect panel", net.label, msg)
		case "error":
			logger.Warnf("[apihub-gamma-keepalive] %s: %s", net.label, msg)
		case "ok":
			logger.Infof("[apihub-gamma-keepalive] %s: %s", net.label, msg)
		}
	}
}

// performGammaKeepalive runs one probe-and-repersist attempt for a single
// network and returns a status ("ok"|"skipped"|"reauth"|"error") plus a message.
func performGammaKeepalive(net gammaKeepaliveNetwork) (string, string) {
	current := loadGammaCookie(net.configKey)
	if strings.TrimSpace(current) == "" {
		return "skipped", "not connected"
	}

	reissued, status, msg := gammaKeepaliveProbe(net, current)
	if status != "ok" {
		return status, msg
	}

	if len(reissued) == 0 {
		// Session is alive (2xx) but the server chose not to reissue anything this
		// hit — nothing to persist, the stored jar is still valid.
		return "ok", "session still valid (no cookie changes)"
	}

	merged := mergeGammaCookies(current, reissued)
	if merged == current {
		return "ok", "session still valid (no cookie changes)"
	}
	if err := persistGammaCookie(net.configKey, merged); err != nil {
		return "error", "refreshed OK but could not persist the cookies: " + err.Error()
	}

	names := make([]string, 0, len(reissued))
	for name := range reissued {
		names = append(names, name)
	}
	return "ok", "session refreshed (reissued: " + strings.Join(names, ", ") + ")"
}

// gammaKeepaliveProbe GETs the network's authenticated probe URL with the stored
// cookie and returns any reissued session cookies (name→value) plus a status.
// Redirects are NOT followed: a 2xx means the session is live; a redirect to a
// login/tour host, or a 401/403, means the autologin pair has lapsed.
func gammaKeepaliveProbe(net gammaKeepaliveNetwork, cookie string) (map[string]string, string, string) {
	ctx, cancel := context.WithTimeout(context.Background(), gammaKeepaliveHTTPTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, net.probeURL, nil)
	if err != nil {
		return nil, "error", "could not build probe request: " + err.Error()
	}
	req.Header.Set("Cookie", cookie)
	// Look like the members-area browser fetch the platform expects.
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	client := &http.Client{
		Timeout: gammaKeepaliveHTTPTimeout,
		// Don't follow redirects — a 3xx to a login host is our reauth signal.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, "error", "probe request failed: " + err.Error()
	}
	defer res.Body.Close()

	switch {
	case res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden:
		return nil, "reauth", "saved session was rejected"
	case res.StatusCode >= 300 && res.StatusCode < 400:
		if loc := res.Header.Get("Location"); loc != "" && gammaLocationIsLogin(loc, net.loginHosts) {
			return nil, "reauth", "saved session redirected to sign-in"
		}
		// A redirect that isn't to a login page (e.g. trailing-slash normalization)
		// still means the session is alive; capture whatever it reissued.
		return gammaReissuedCookies(res), "ok", ""
	case res.StatusCode >= 200 && res.StatusCode < 300:
		return gammaReissuedCookies(res), "ok", ""
	default:
		return nil, "error", "probe returned HTTP " + res.Status
	}
}

// gammaLocationIsLogin reports whether a redirect Location points at a
// logged-out destination (login/tour host, or a path that looks like login).
func gammaLocationIsLogin(location string, loginHosts []string) bool {
	low := strings.ToLower(location)
	for _, h := range loginHosts {
		if strings.Contains(low, h) {
			return true
		}
	}
	return strings.Contains(low, "/login") || strings.Contains(low, "/signin")
}

// gammaReissuedCookies pulls the session-cookie reissues out of a response's
// Set-Cookie headers, restricted to the names the plugin persists.
func gammaReissuedCookies(res *http.Response) map[string]string {
	out := map[string]string{}
	for _, c := range res.Cookies() {
		if gammaSessionCookieNames[c.Name] && c.Value != "" {
			out[c.Name] = c.Value
		}
	}
	return out
}

// mergeGammaCookies overlays reissued name→value pairs onto the stored Cookie
// header string, preserving the order of existing cookies and appending any new
// ones. Returns a joined "name=value; ..." header.
func mergeGammaCookies(stored string, reissued map[string]string) string {
	type kv struct{ name, value string }
	var order []kv
	seen := map[string]bool{}

	for _, part := range strings.Split(stored, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		name := part
		value := ""
		if i := strings.IndexByte(part, '='); i >= 0 {
			name = part[:i]
			value = part[i+1:]
		}
		if nv, ok := reissued[name]; ok {
			value = nv
		}
		order = append(order, kv{name, value})
		seen[name] = true
	}
	// Any reissued cookie not already in the stored jar (e.g. first-time
	// activeMemberValidator) gets appended.
	for name, value := range reissued {
		if !seen[name] {
			order = append(order, kv{name, value})
		}
	}

	pairs := make([]string, 0, len(order))
	for _, e := range order {
		pairs = append(pairs, e.name+"="+e.value)
	}
	return strings.Join(pairs, "; ")
}

// loadGammaCookie reads a single Gamma cookie header out of the plugin config.
func loadGammaCookie(configKey string) string {
	pc := config.GetInstance().GetPluginConfiguration(gammaKeepalivePluginID)
	if pc == nil {
		return ""
	}
	if v, ok := pc[configKey].(string); ok {
		return v
	}
	return ""
}

// persistGammaCookie writes a single Gamma cookie header back into the plugin
// config, read-merge-writing the full blob so it never drops other settings or
// the other network's cookie (configurePlugin/SetPluginConfiguration replaces
// the whole per-plugin map wholesale — same constraint the plugin's tokenStorage
// works around).
func persistGammaCookie(configKey, value string) error {
	cfg := config.GetInstance()

	full := map[string]interface{}{}
	for k, v := range cfg.GetPluginConfiguration(gammaKeepalivePluginID) {
		full[k] = v
	}
	full[configKey] = value

	cfg.SetPluginConfiguration(gammaKeepalivePluginID, full)
	return cfg.Write()
}
