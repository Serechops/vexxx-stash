package api

import (
	"strconv"
	"strings"
	"testing"
)

// What is EvilAngel's own, as opposed to the Gamma-platform mechanics it shares
// with Adult Time — those are tested in apihub_gamma_catalog_test.go.

// ─── the site descriptor ──────────────────────────────────────────────────────

func TestEvilAngelReadsItsSearchKeyFromAPublicPage(t *testing.T) {
	// The difference from Adult Time that the shared code branches on. If this
	// flag were true the scrape would demand a session for something that does
	// not need one; if EnvURL pointed at the member host, a lapsed session would
	// take the catalog down rather than just playback.
	if evilAngelSite.EnvNeedsSession {
		t.Error("EvilAngel's window.env is on its public homepage; the scrape must not require a session")
	}
	if !strings.HasPrefix(evilAngelSite.EnvURL, evilAngelPublicBase) {
		t.Errorf("EnvURL %q is not the public homepage", evilAngelSite.EnvURL)
	}
	if evilAngelSite.GateCookies != "" {
		t.Error("the public homepage has no interstitial, so no gate cookies should be sent")
	}
}

func TestEvilAngelSearchAndStreamOriginsDiffer(t *testing.T) {
	// Measured: the Algolia key is referrer-restricted to www, while the member
	// endpoints check the members referer. Collapsing the two — deriving one from
	// the other — fails whichever end loses, with a 403 that looks like a bad
	// credential rather than a bad header.
	if evilAngelSite.AlgoliaOrigin != evilAngelPublicBase {
		t.Errorf("AlgoliaOrigin = %q, want the public host the key is restricted to", evilAngelSite.AlgoliaOrigin)
	}
	if evilAngelSite.MemberBase != evilAngelMemberBase {
		t.Errorf("MemberBase = %q, want the members host", evilAngelSite.MemberBase)
	}
	if evilAngelSite.AlgoliaOrigin == evilAngelSite.MemberBase {
		t.Error("search and member origins must stay distinct for EvilAngel")
	}
}

func TestEvilAngelStillNeedsASessionToPlay(t *testing.T) {
	// The catalog is public but the streams are not, so the session check has to
	// remain — a channel that can be listed and not played is worse than one
	// that is absent, because a TV shows it, tunes it and errors.
	if evilAngelSite.ConfigKey != evilAngelConfigKey {
		t.Errorf("ConfigKey = %q, want the plugin setting holding the member cookie", evilAngelSite.ConfigKey)
	}
	if evilAngelSite.NoSession == nil {
		t.Error("no sentinel error; a lapsed session would be cached as a broken channel")
	}
}

// ─── the channel axis ─────────────────────────────────────────────────────────

func TestEvilAngelDividesBySeriesNotStudio(t *testing.T) {
	// Not a style choice: studio_name is unusable here, with 19,860 of 20,480
	// scenes sharing the single value "Evil Angel". Switching the facet back
	// would silently reduce the whole site to five channels, four of them tiny.
	if evilAngelChannelFacet != "serie_name" {
		t.Errorf("channel facet is %q; studio_name collapses the site into one channel", evilAngelChannelFacet)
	}
}

// ─── selectors ────────────────────────────────────────────────────────────────

func TestEvilAngelSiteWideSelectorScopesToTheSiteAndExcludesUnreleased(t *testing.T) {
	filters := evilAngelSelector{}.gamma().FacetFilters
	if len(filters) != 2 {
		t.Fatalf("site-wide selector produced %d filter groups, want 2", len(filters))
	}

	flat := strings.Join([]string{filters[0][0], filters[1][0]}, " ")
	if !strings.Contains(flat, "sitename:"+evilAngelSitename) {
		t.Errorf("query is not scoped to this site: %v", filters)
	}
	if !strings.Contains(flat, "upcoming:0") {
		t.Errorf("unreleased scenes are not being excluded: %v", filters)
	}
}

func TestEvilAngelSeriesSelectorAddsExactlyOneGroup(t *testing.T) {
	filters := evilAngelSelector{series: "Euro Angels"}.gamma().FacetFilters
	if len(filters) != 3 {
		t.Fatalf("got %d filter groups, want 3", len(filters))
	}
	// Nested arrays are an AND of ORs; a group holding more than one term would
	// turn the conditions into alternatives.
	for i, group := range filters {
		if len(group) != 1 {
			t.Errorf("filter group %d holds %d terms, want 1: %v", i, len(group), group)
		}
	}
	if got, want := filters[2][0], evilAngelChannelFacet+":Euro Angels"; got != want {
		t.Errorf("series filter = %q, want %q", got, want)
	}
}

func TestEvilAngelSelectorRoundTripsThroughASpec(t *testing.T) {
	spec := evilAngelSpec(iptvNetChannelSpec{Key: "ea-euro-angels", Name: "Euro Angels", Collection: "Euro Angels"})

	sel, err := evilAngelSelectorFor(spec)
	if err != nil {
		t.Fatalf("selector: %v", err)
	}
	if sel.series != "Euro Angels" {
		t.Errorf("selector series = %q, want the facet value", sel.series)
	}
}

// ─── channel identity ─────────────────────────────────────────────────────────

func TestEvilAngelChannelKeysAreNamespaced(t *testing.T) {
	key := evilAngelChannelKey("Euro Angels")
	if !strings.HasPrefix(key, iptvEvilAngelKeyPrefix) {
		t.Errorf("%q is not namespaced", key)
	}
	if _, err := strconv.Atoi(strings.TrimPrefix(key, iptvEvilAngelKeyPrefix)); err == nil {
		t.Errorf("%q could be mistaken for a library studio id", key)
	}
}

func TestDistinctSeriesGetDistinctChannels(t *testing.T) {
	seen := map[string]string{}
	for _, name := range []string{
		"Euro Angels", "Euro Angels Hardball", "Evil Anal", "Evil Angel Archive",
		"Hookup Hotshot", "PansexualX", "Buttman Focused", "Trans-Active",
	} {
		key := evilAngelChannelKey(name)
		if prev, dup := seen[key]; dup {
			t.Errorf("%q and %q collapse to the same channel %q", prev, name, key)
		}
		seen[key] = name
	}
}

func TestEvilAngelSpecsCarryProviderIdentityAndAGuideID(t *testing.T) {
	spec := evilAngelSpec(iptvNetChannelSpec{Key: "ea-euro-angels", Name: "Euro Angels"})

	if spec.Source != iptvSourceEvilAngel {
		t.Errorf("Source = %q", spec.Source)
	}
	if spec.BrandLabel != evilAngelBrandLabel {
		t.Errorf("BrandLabel = %q; channels would not group on the TV", spec.BrandLabel)
	}
	if !strings.Contains(spec.TvgID, spec.Key) {
		t.Errorf("tvg id %q is not derived from the key %q", spec.TvgID, spec.Key)
	}
}
