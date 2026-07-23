package api

// connectTarget describes one "sign in with browser" destination for the
// APIHub plugin: the real login page to open in a driven Chrome window, and
// the cookie name(s) whose appearance signals that the user finished
// logging in (used only to know when to stop waiting — every cookie seen is
// still returned, not just these).
type connectTarget struct {
	loginURL        string
	doneCookieNames []string
}

// connectTargets is intentionally small and static — new sites are added
// here, not via user-supplied config, since a login URL that's wrong just
// opens the wrong page (harmless, user can cancel) but a scheme that let
// arbitrary URLs be driven would be a server-side request forgery risk.
//
// The Aylo brands log in at their member-area host (site-ma.<brand>.com),
// which is also where the account tokens are issued as cookies. Those tokens
// are ACCOUNT-wide, not brand-scoped: a single membership (e.g. BangBros)
// with other libraries unlocked (Brazzers, Reality Kings) yields one token
// set that serves every unlocked library's groupId — so signing in at any one
// Aylo site connects all of them (see fan-out in the Connect panel).
var connectTargets = map[string]connectTarget{
	"evilangel": {
		loginURL:        "https://www.evilangel.com/en/login",
		doneCookieNames: []string{"autologin_userid", "autologin_hash"},
	},
	// Watch the two tokens that change/appear on authentication: the anonymous
	// access_token_ma is replaced with the user's on login, and refresh_token_ma
	// is issued only on login. instance_token is a long-lived device token
	// present anonymously and unchanged by login, so it's not a useful signal —
	// but it's still captured, since the full cookie jar is returned regardless.
	"aylo:brazzers": {
		loginURL:        "https://site-ma.brazzers.com/login",
		doneCookieNames: []string{"access_token_ma", "refresh_token_ma"},
	},
	"aylo:realitykings": {
		loginURL:        "https://site-ma.realitykings.com/login",
		doneCookieNames: []string{"access_token_ma", "refresh_token_ma"},
	},
	"aylo:bangbros": {
		loginURL:        "https://site-ma.bangbros.com/login",
		doneCookieNames: []string{"access_token_ma", "refresh_token_ma"},
	},
}
