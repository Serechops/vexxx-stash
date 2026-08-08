package api

import (
	"strconv"
	"strings"
	"testing"
)

// Adult Time's own channel identity. Cross-provider invariants — that every
// provider is registered, namespaced and recognised — live in
// routes_iptv_providers_test.go.

func TestAdultTimeChannelKeysAreNamespaced(t *testing.T) {
	at := adultTimeChannelKey("Pure Taboo")
	if !strings.HasPrefix(at, iptvAdultTimeKeyPrefix) {
		t.Errorf("%q is not namespaced", at)
	}
	// A library channel is a bare studio id, so a key that parses as an integer
	// would be ambiguous on the shared route.
	if _, err := strconv.Atoi(strings.TrimPrefix(at, iptvAdultTimeKeyPrefix)); err == nil {
		t.Errorf("%q could be mistaken for a library studio id", at)
	}
}

func TestAdultTimeSlugIsStableAndURLSafe(t *testing.T) {
	cases := map[string]string{
		"Pure Taboo":           "pure-taboo",
		"Devil's Film":         "devil-s-film",
		"21 Sextury":           "21-sextury",
		"  Girlsway  ":         "girlsway",
		"Adult Time Originals": "adult-time-originals",
	}
	for name, want := range cases {
		if got := gammaSlug(name); got != want {
			t.Errorf("slug(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestDistinctStudiosGetDistinctChannels(t *testing.T) {
	seen := map[string]string{}
	for _, name := range []string{
		"Pure Taboo", "Pure Taboo 2", "Devil's Film", "Devils Film X",
		"21 Sextury", "21 Sextreme", "Girlsway", "Girls Way",
	} {
		key := adultTimeChannelKey(name)
		if prev, dup := seen[key]; dup {
			t.Errorf("%q and %q collapse to the same channel %q", prev, name, key)
		}
		seen[key] = name
	}
}

func TestNetworkWideChannelIsDistinctFromEveryStudio(t *testing.T) {
	// A studio really can be called "All", and it must not be able to displace
	// the umbrella channel — which is what happens if the two share a key.
	all := adultTimeNetworkChannelKey()
	for _, name := range []string{"All", "all", "  ALL  ", "-all-", "Pure Taboo"} {
		if adultTimeChannelKey(name) == all {
			t.Errorf("studio %q collides with the network-wide channel %q", name, all)
		}
	}
}

func TestAdultTimeSpecsCarryProviderIdentityAndAGuideID(t *testing.T) {
	spec := adultTimeSpec(iptvNetChannelSpec{Key: "at-pure-taboo", Name: "Pure Taboo"})

	if spec.Source != iptvSourceAdultTime {
		t.Errorf("Source = %q", spec.Source)
	}
	if spec.BrandLabel != adultTimeBrandLabel {
		t.Errorf("BrandLabel = %q; channels would not group on the TV", spec.BrandLabel)
	}
	if spec.TvgID == "" {
		t.Error("no tvg id; the client cannot bind listings to this channel")
	}
	// A tvg id is stored by the client, so it must be derived from the key
	// rather than the name — a renamed studio must not orphan its listings.
	if !strings.Contains(spec.TvgID, spec.Key) {
		t.Errorf("tvg id %q is not derived from the key %q", spec.TvgID, spec.Key)
	}
}

func TestAdultTimeSelectorRoundTripsThroughASpec(t *testing.T) {
	spec := adultTimeSpec(iptvNetChannelSpec{Key: "at-pure-taboo", Name: "Pure Taboo", Collection: "Pure Taboo"})

	sel, err := adultTimeSelectorFor(spec)
	if err != nil {
		t.Fatalf("selector: %v", err)
	}
	if sel.channel != "Pure Taboo" {
		t.Errorf("selector channel = %q, want the studio facet value", sel.channel)
	}

	// A spec from another provider must be refused rather than silently
	// producing a query for the whole of Adult Time.
	if _, err := adultTimeSelectorFor(iptvNetChannelSpec{Source: iptvSourceAylo, Key: "aylo-brazzers"}); err == nil {
		t.Error("an Aylo spec was accepted as an Adult Time channel")
	}
}
