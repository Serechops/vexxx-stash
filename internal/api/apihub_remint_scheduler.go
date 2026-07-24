package api

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/logger"
)

// Server-side keepalive for the Aylo session.
//
// Until now the ONLY thing that re-minted Aylo tokens was a setInterval in the
// browser (aylo/auth.ts startAutoRefresh → /apihub-connect/refresh). Close every
// Stash tab overnight and nothing refreshes: the instance token (~43h,
// non-renewable cross-origin) quietly lapses and the next visit needs a manual
// sign-in. This scheduler runs the same silent re-mint on a fixed cadence in the
// backend — independent of any open tab — reusing the persistent, already
// logged-in Chrome profile (no stored credentials, no reCAPTCHA). Each run both
// PERSISTS the fresh tokens to plugin config (so a browser opening later picks
// them up) and logs a one-line verification result, which is what makes "is the
// refresh actually working?" answerable from the server log alone.
const (
	remintPluginID           = "apihub" // canonical plugin id (yml basename, lowercased)
	remintTokensKey          = "tokens"
	remintConnectedTargetKey = "ayloConnectedTarget"
	// The shared account token key the plugin reads on load — AYLO_ACCOUNT_KEY in
	// aylo/brands.ts. Must match exactly or the persisted tokens are never seen.
	remintAccountKey = "aylo:account"

	remintInterval     = 30 * time.Minute
	remintStartupDelay = 60 * time.Second // let config + the app settle before the first run
)

// apihubTokenSet mirrors the plugin's TokenSet JSON shape (aylo/auth.ts). Field
// names and casing must match exactly — the plugin unmarshals this back from
// server config on load, so a casing drift silently yields an unusable session.
type apihubTokenSet struct {
	Access            string `json:"access"`
	Refresh           string `json:"refresh"`
	Instance          string `json:"instance"`
	AccessExpiresAt   int64  `json:"accessExpiresAt"`   // epoch ms
	RefreshExpiresAt  int64  `json:"refreshExpiresAt"`  // epoch ms
	InstanceExpiresAt int64  `json:"instanceExpiresAt"` // epoch ms
}

// startApihubRemintScheduler launches the background re-mint loop. It returns
// immediately; the work runs in its own goroutine for the lifetime of the
// process. Safe to call once at server start.
func startApihubRemintScheduler() {
	go func() {
		time.Sleep(remintStartupDelay)
		runApihubRemintOnce()

		ticker := time.NewTicker(remintInterval)
		defer ticker.Stop()
		for range ticker.C {
			runApihubRemintOnce()
		}
	}()
}

// remintVerifyResult is the structured outcome of a single verify-and-persist
// cycle. The scheduler turns it into a log line; the on-demand /verify route
// hands it back to the caller as JSON so the panel can show the same result
// without waiting for the next tick or grepping the server log.
type remintVerifyResult struct {
	// Status is one of: "ok", "failed", "incomplete", "skipped".
	Status  string `json:"status"`
	Target  string `json:"target,omitempty"`
	Message string `json:"message,omitempty"`
	// Human-readable validity remaining (e.g. "42h0m0s"), populated on "ok".
	Access   string `json:"access,omitempty"`
	Refresh  string `json:"refresh,omitempty"`
	Instance string `json:"instance,omitempty"`
}

// runApihubRemintOnce performs a single verify-and-persist cycle and logs the
// outcome. It is a no-op (quiet, debug-level) when the Aylo account isn't
// connected or the plugin is disabled — only an actual re-mint attempt produces
// an info/warn line, so the log reads as a clean success/failure history of a
// live session.
func runApihubRemintOnce() {
	runApihubRemintLog(performApihubRemint())
}

// runApihubRemintLog emits the one-line audit entry for a re-mint outcome. Both
// the scheduled loop and the on-demand /verify route call it, so a manual check
// lands in the same log history as the timed ones.
func runApihubRemintLog(res remintVerifyResult) {
	switch res.Status {
	case "skipped":
		logger.Debugf("[apihub-remint] %s", res.Message)
	case "failed":
		logger.Warnf("[apihub-remint] verify FAILED for %s: %s — the saved browser session has likely lapsed; sign in again from the APIHub Connect panel", res.Target, res.Message)
	case "incomplete":
		logger.Warnf("[apihub-remint] verify INCOMPLETE for %s: %s", res.Target, res.Message)
	case "ok":
		logger.Infof("[apihub-remint] verify OK for %s — access valid for %s, refresh %s, instance %s (persisted to plugin config)",
			res.Target, res.Access, res.Refresh, res.Instance)
	default:
		// A persist-succeeds-but-unexpected path; surface it rather than swallow.
		logger.Errorf("[apihub-remint] verify for %s: %s", res.Target, res.Message)
	}
}

// performApihubRemint runs one re-mint attempt and returns its structured
// outcome without logging. Shared by the background scheduler and the on-demand
// /apihub-connect/verify route so both go through identical resolve → re-mint →
// persist logic.
func performApihubRemint() remintVerifyResult {
	cfg := config.GetInstance()

	for _, id := range cfg.GetDisabledPlugins() {
		if id == remintPluginID {
			return remintVerifyResult{Status: "skipped", Message: "plugin disabled; skipping"}
		}
	}

	pc := cfg.GetPluginConfiguration(remintPluginID)
	target := ""
	if pc != nil {
		if t, ok := pc[remintConnectedTargetKey].(string); ok {
			target = strings.TrimSpace(t)
		}
	}
	if target == "" {
		return remintVerifyResult{Status: "skipped", Message: "no connected Aylo target; skipping"}
	}

	cookies, err := remintTokens(target)
	if err != nil {
		return remintVerifyResult{Status: "failed", Target: target, Message: err.Error()}
	}

	ts, ok := buildTokenSetFromCookies(cookies)
	if !ok {
		return remintVerifyResult{Status: "incomplete", Target: target, Message: "re-mint returned cookies but not all of access/refresh/instance were present"}
	}

	if err := persistRemintedTokens(ts); err != nil {
		return remintVerifyResult{Status: "error", Target: target, Message: "verified OK but could not persist the refreshed tokens: " + err.Error()}
	}

	now := time.Now()
	return remintVerifyResult{
		Status:   "ok",
		Target:   target,
		Access:   humanUntil(ts.AccessExpiresAt, now),
		Refresh:  humanUntil(ts.RefreshExpiresAt, now),
		Instance: humanUntil(ts.InstanceExpiresAt, now),
	}
}

// buildTokenSetFromCookies pulls the three tokens out of a re-mint cookie jar and
// derives each expiry from its JWT exp claim (falling back to the same nominal
// lifetimes the plugin uses). Returns ok=false if any token is missing, which
// signals an anonymous/lapsed profile rather than a live session.
func buildTokenSetFromCookies(cookies []cookiePair) (apihubTokenSet, bool) {
	access, _ := cookieValue(cookies, "access_token_ma")
	refresh, _ := cookieValue(cookies, "refresh_token_ma")
	instance, _ := cookieValue(cookies, "instance_token")
	if access == "" || refresh == "" || instance == "" {
		return apihubTokenSet{}, false
	}
	return apihubTokenSet{
		Access:            access,
		Refresh:           refresh,
		Instance:          instance,
		AccessExpiresAt:   jwtExpiryMs(access, 60*60*1000),
		RefreshExpiresAt:  jwtExpiryMs(refresh, 30*60*1000),
		InstanceExpiresAt: jwtExpiryMs(instance, 43*60*60*1000),
	}, true
}

// persistRemintedTokens merges the fresh account token set into the plugin's
// `tokens` blob (a JSON string keyed by brand) and writes the whole plugin config
// back. It read-merge-writes so it never drops the other plugin settings
// (evilangelCookie, entitlements, downloadDir, …) or another brand's tokens.
func persistRemintedTokens(ts apihubTokenSet) error {
	cfg := config.GetInstance()

	// Copy the current plugin blob into a fresh map — GetPluginConfiguration hands
	// back the live viper-backed map, so we mutate a copy and hand a whole new map
	// to SetPluginConfiguration (which replaces the plugin blob wholesale).
	full := map[string]interface{}{}
	for k, v := range cfg.GetPluginConfiguration(remintPluginID) {
		full[k] = v
	}

	tokensMap := map[string]json.RawMessage{}
	if raw, ok := full[remintTokensKey].(string); ok && strings.TrimSpace(raw) != "" {
		// Best-effort: a parse failure just means we rebuild the blob from scratch.
		_ = json.Unmarshal([]byte(raw), &tokensMap)
	}

	tsJSON, err := json.Marshal(ts)
	if err != nil {
		return err
	}
	tokensMap[remintAccountKey] = tsJSON

	merged, err := json.Marshal(tokensMap)
	if err != nil {
		return err
	}
	full[remintTokensKey] = string(merged)

	cfg.SetPluginConfiguration(remintPluginID, full)
	return cfg.Write()
}

// jwtExpiryMs decodes a JWT's exp claim to epoch milliseconds, mirroring the
// plugin's decodeJwt/expiryMs. Any decode failure falls back to now+fallbackMs so
// a malformed token still gets a sane refresh deadline rather than expiring at 0.
func jwtExpiryMs(token string, fallbackMs int64) int64 {
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

// humanUntil renders how long until an epoch-ms deadline, rounded to the minute,
// for the verification log line ("42h0m0s", "-" once expired).
func humanUntil(epochMs int64, now time.Time) string {
	d := time.UnixMilli(epochMs).Sub(now)
	if d <= 0 {
		return "EXPIRED"
	}
	return d.Round(time.Minute).String()
}
