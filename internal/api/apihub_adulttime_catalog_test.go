package api

import (
	"strings"
	"testing"
)

// What is Adult Time's own, as opposed to the Gamma-platform mechanics it shares
// with EvilAngel — those are tested in apihub_gamma_catalog_test.go.

// ─── the interstitial gate ────────────────────────────────────────────────────

func TestCookieCarriesTheInterstitialDismissal(t *testing.T) {
	// Not a bypass of anything protective: these are the cookies the gate's own
	// redirect sets, and without sending them back every members.adulttime.com
	// path 302s to a page that redirects to itself. This cost a session to
	// diagnose once — the test exists so it cannot be quietly dropped.
	for _, name := range []string{"interstitialPageShown", "interstitialCountXhours", "interstitialCountXweek"} {
		if !strings.Contains(adultTimeInterstitialCookies, name+"=") {
			t.Errorf("gate cookie %q missing; the members area will redirect forever without it", name)
		}
	}
	if adultTimeSite.GateCookies != adultTimeInterstitialCookies {
		t.Error("the site descriptor does not carry the gate cookies, so the scrape will hit the interstitial")
	}
}

func TestAdultTimeNeedsASessionEvenToReadItsCatalog(t *testing.T) {
	// Unlike EvilAngel, whose search key sits on a public page, Adult Time
	// renders its into an authenticated members page. Getting this flag wrong
	// would make the scrape send no cookie and report the resulting redirect as
	// a site outage rather than a lapsed session.
	if !adultTimeSite.EnvNeedsSession {
		t.Error("Adult Time's window.env page is inside the member area; the scrape must send the session cookie")
	}
	if !strings.HasPrefix(adultTimeSite.EnvURL, adultTimeSite.MemberBase) {
		t.Errorf("EnvURL %q is not on the member host", adultTimeSite.EnvURL)
	}
}

// ─── selectors ────────────────────────────────────────────────────────────────

func TestNetworkWideSelectorDoesNotFilterByChannel(t *testing.T) {
	filters := adultTimeSelector{}.gamma().FacetFilters
	if len(filters) != 1 {
		t.Fatalf("network-wide selector produced %d filter groups, want 1", len(filters))
	}
	if filters[0][0] != "upcoming:0" {
		t.Errorf("unreleased scenes are not being excluded: %v", filters)
	}
}

func TestChannelSelectorFiltersOnTheStudioFacet(t *testing.T) {
	filters := adultTimeSelector{channel: "Pure Taboo"}.gamma().FacetFilters
	if len(filters) != 2 {
		t.Fatalf("got %d filter groups, want 2", len(filters))
	}
	// Nested arrays are an AND of ORs; each group must hold exactly one term or
	// the two conditions become alternatives.
	if got, want := filters[1][0], adultTimeChannelFacet+":Pure Taboo"; got != want {
		t.Errorf("channel filter = %q, want %q", got, want)
	}
}
