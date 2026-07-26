package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/logger"
)

// Server-side keepalive for the Aylo (Project1 / MindGeek) session.
//
// Aylo's refresh token is short-lived (~30 min) and single-use/rotating — unlike
// TeamSkeet's 30-day token. The browser renews it via
// auth-service/v1/authenticate/renew while a tab is open, but the moment every
// Stash tab is closed nothing rotates it: ~30 min later the session is dead and
// the next visit needs a full reconnect. For Aylo that reconnect means a
// reCAPTCHA / Google-login wall the silent Chrome re-mint can't clear once its
// own SSO session has also lapsed (observed: connect times out with
// _GRECAPTCHA/g_state but no access_token_ma). So the only way to survive being
// away is to never let the 30-min token die: this loop rotates it in the backend
// on a fixed cadence, independent of any open tab, with a plain HTTP call — no
// Chrome (unlike the retired driven-Chrome re-mint scheduler).
//
// It is the PRIMARY renewer. The browser defers to it (aylo/auth.ts
// syncFromServer): a tab adopts the tokens this loop persists instead of renewing
// on its own, so the single-use refresh token is only ever consumed by one party
// — no cross-process rotation race (both sides consuming the same single-use
// token → false "session expired"). If this loop isn't running (older binary /
// plugin disabled), the browser falls back to renewing itself, so nothing breaks
// — it's just back to alive-only-while-a-tab-is-open.
const (
	ayloRenewPluginID   = "apihub"       // canonical plugin id (yml basename, lowercased)
	ayloRenewTokensKey  = "tokens"       // plugin-config setting holding the brand→TokenSet JSON blob
	ayloRenewAccountKey = "aylo:account" // AYLO_ACCOUNT_KEY in aylo/brands.ts — the single account identity
	ayloAuthServiceBase = "https://auth-service.project1service.com"

	// Well inside the ~30-min refresh window so a slow/misfired tick still lands
	// with margin. The token rotates on every call, so this is also how often the
	// stored refresh token is replaced.
	ayloRenewInterval     = 20 * time.Minute
	ayloRenewStartupDelay = 45 * time.Second // let config + the app settle before the first run
	ayloRenewHTTPTimeout  = 20 * time.Second
)

// errAyloReauth marks a renew that was rejected outright (400/401) — the stored
// refresh token is spent/invalid and only a manual reconnect can recover it.
var errAyloReauth = errors.New("Aylo refresh token rejected")

// ayloTokenSet mirrors the plugin's TokenSet JSON shape (aylo/auth.ts). Field
// names and casing must match exactly — the plugin unmarshals this back from
// server config on load, so any drift silently yields an unusable session.
type ayloTokenSet struct {
	Access            string `json:"access"`
	Refresh           string `json:"refresh"`
	Instance          string `json:"instance"`
	AccessExpiresAt   int64  `json:"accessExpiresAt"`   // epoch ms
	RefreshExpiresAt  int64  `json:"refreshExpiresAt"`  // epoch ms
	InstanceExpiresAt int64  `json:"instanceExpiresAt"` // epoch ms
}

// startApihubAyloRenewScheduler launches the background renew loop. It returns
// immediately; the work runs in its own goroutine for the process lifetime. Safe
// to call once at server start.
func startApihubAyloRenewScheduler() {
	go func() {
		time.Sleep(ayloRenewStartupDelay)
		runAyloRenewOnce()

		ticker := time.NewTicker(ayloRenewInterval)
		defer ticker.Stop()
		for range ticker.C {
			runAyloRenewOnce()
		}
	}()
}

// runAyloRenewOnce performs a single renew-and-persist cycle and logs the
// outcome. Quiet (debug) when the account isn't connected or the plugin is
// disabled — only a real attempt produces an info/warn line, so the log reads as
// a clean success/failure history of a live session.
func runAyloRenewOnce() {
	status, msg := performAyloRenew()
	switch status {
	case "skipped":
		logger.Debugf("[apihub-aylo-renew] %s", msg)
	case "reauth":
		logger.Warnf("[apihub-aylo-renew] %s — the saved Aylo session has lapsed; sign in again from the APIHub Connect panel", msg)
	case "error":
		logger.Warnf("[apihub-aylo-renew] %s", msg)
	case "ok":
		logger.Infof("[apihub-aylo-renew] %s", msg)
	}
}

// performAyloRenew runs one renew-and-persist attempt and returns a status
// ("ok"|"skipped"|"reauth"|"error") plus a log message.
func performAyloRenew() (string, string) {
	cfg := config.GetInstance()
	for _, id := range cfg.GetDisabledPlugins() {
		if id == ayloRenewPluginID {
			return "skipped", "plugin disabled; skipping"
		}
	}

	current, ok := loadAyloAccountTokens()
	if !ok {
		return "skipped", "no connected Aylo account; skipping"
	}
	if strings.TrimSpace(current.Refresh) == "" {
		return "skipped", "stored Aylo tokens have no refresh token; skipping"
	}
	// A refresh token already past expiry can't be renewed — don't burn a request
	// on it. Only a reconnect recovers this.
	if current.RefreshExpiresAt > 0 && current.RefreshExpiresAt <= time.Now().UnixMilli() {
		return "reauth", "stored Aylo refresh token has expired"
	}

	next, err := ayloRenewRequest(current)
	if err != nil {
		if errors.Is(err, errAyloReauth) {
			return "reauth", "Aylo refresh was rejected"
		}
		return "error", "Aylo renew request failed: " + err.Error()
	}

	if err := persistAyloAccountTokens(next); err != nil {
		return "error", "renewed OK but could not persist the refreshed tokens: " + err.Error()
	}

	now := time.Now()
	return "ok", fmt.Sprintf(
		"renewed — access valid for %s, refresh %s (persisted to plugin config)",
		humanUntilAylo(next.AccessExpiresAt, now), humanUntilAylo(next.RefreshExpiresAt, now),
	)
}

// ayloRenewRequest exchanges the current refresh token for a fresh access+refresh
// pair via auth-service, mirroring the browser's renewAccessRequest
// (aylo/auth.ts): POST {base}/v1/authenticate/renew with a camelCase
// {refreshToken} body; the RESPONSE is the raw Keycloak grant (snake_case
// access_token/refresh_token). The instance token is untouched by renew, so it's
// carried over from the current set.
func ayloRenewRequest(current ayloTokenSet) (ayloTokenSet, error) {
	body, err := json.Marshal(map[string]string{"refreshToken": current.Refresh})
	if err != nil {
		return ayloTokenSet{}, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), ayloRenewHTTPTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		ayloAuthServiceBase+"/v1/authenticate/renew", bytes.NewReader(body))
	if err != nil {
		return ayloTokenSet{}, err
	}
	req.Header.Set("content-type", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return ayloTokenSet{}, err
	}
	defer res.Body.Close()

	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusBadRequest {
		return ayloTokenSet{}, errAyloReauth
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return ayloTokenSet{}, fmt.Errorf("HTTP %d", res.StatusCode)
	}

	var grant struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&grant); err != nil {
		return ayloTokenSet{}, err
	}
	if grant.AccessToken == "" {
		return ayloTokenSet{}, errors.New("renew response had no access_token")
	}

	nextRefresh := grant.RefreshToken
	if nextRefresh == "" {
		nextRefresh = current.Refresh // some grants don't rotate; keep the current one
	}
	return ayloTokenSet{
		Access:            grant.AccessToken,
		Refresh:           nextRefresh,
		Instance:          current.Instance,
		AccessExpiresAt:   jwtExpiryMsAylo(grant.AccessToken, 60*60*1000),
		RefreshExpiresAt:  jwtExpiryMsAylo(nextRefresh, 30*60*1000),
		InstanceExpiresAt: current.InstanceExpiresAt,
	}, nil
}

// loadAyloAccountTokens pulls the aylo:account entry out of the plugin's `tokens`
// blob (a JSON string keyed by brand). ok=false when the plugin has no config, no
// tokens blob, or no aylo:account entry.
func loadAyloAccountTokens() (ayloTokenSet, bool) {
	pc := config.GetInstance().GetPluginConfiguration(ayloRenewPluginID)
	if pc == nil {
		return ayloTokenSet{}, false
	}
	raw, ok := pc[ayloRenewTokensKey].(string)
	if !ok || strings.TrimSpace(raw) == "" {
		return ayloTokenSet{}, false
	}
	var byBrand map[string]ayloTokenSet
	if err := json.Unmarshal([]byte(raw), &byBrand); err != nil {
		return ayloTokenSet{}, false
	}
	ts, ok := byBrand[ayloRenewAccountKey]
	return ts, ok
}

// persistAyloAccountTokens merges the fresh account token set into the plugin's
// `tokens` blob and writes the whole plugin config back. It read-merge-writes so
// it never drops the other plugin settings (evilangelCookie, entitlements,
// downloadDir, …) or another brand's tokens.
func persistAyloAccountTokens(next ayloTokenSet) error {
	cfg := config.GetInstance()

	// GetPluginConfiguration hands back the live viper-backed map, so copy it and
	// hand a whole new map to SetPluginConfiguration (which replaces wholesale).
	full := map[string]interface{}{}
	for k, v := range cfg.GetPluginConfiguration(ayloRenewPluginID) {
		full[k] = v
	}

	byBrand := map[string]json.RawMessage{}
	if raw, ok := full[ayloRenewTokensKey].(string); ok && strings.TrimSpace(raw) != "" {
		// Best-effort: a parse failure just rebuilds the blob from scratch.
		_ = json.Unmarshal([]byte(raw), &byBrand)
	}

	tsJSON, err := json.Marshal(next)
	if err != nil {
		return err
	}
	byBrand[ayloRenewAccountKey] = tsJSON

	merged, err := json.Marshal(byBrand)
	if err != nil {
		return err
	}
	full[ayloRenewTokensKey] = string(merged)

	cfg.SetPluginConfiguration(ayloRenewPluginID, full)
	return cfg.Write()
}

// jwtExpiryMsAylo decodes a JWT's exp claim to epoch ms, mirroring the plugin's
// decodeJwt/expiryMs. Any decode failure falls back to now+fallbackMs so a
// malformed token still gets a sane refresh deadline rather than expiring at 0.
func jwtExpiryMsAylo(token string, fallbackMs int64) int64 {
	parts := strings.Split(token, ".")
	if len(parts) >= 2 {
		payload := strings.TrimRight(parts[1], "=")
		if b, err := base64.RawURLEncoding.DecodeString(payload); err == nil {
			var claims struct {
				Exp float64 `json:"exp"`
			}
			if json.Unmarshal(b, &claims) == nil && claims.Exp > 0 {
				return int64(claims.Exp * 1000)
			}
		}
	}
	return time.Now().UnixMilli() + fallbackMs
}

// humanUntilAylo renders how long until an epoch-ms deadline, rounded to the
// minute, for the log line ("42m0s", "EXPIRED" once past).
func humanUntilAylo(epochMs int64, now time.Time) string {
	d := time.UnixMilli(epochMs).Sub(now)
	if d <= 0 {
		return "EXPIRED"
	}
	return d.Round(time.Minute).String()
}
