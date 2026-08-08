package api

import (
	"strconv"
	"strings"
	"testing"
)

func TestChannelKeysAreNamespacedPerProvider(t *testing.T) {
	// All three kinds of channel share one route, so their ids must not be able
	// to collide: a library channel is a bare studio id, and the two networks
	// carry distinct prefixes.
	at := adultTimeChannelKey("Pure Taboo")
	if !strings.HasPrefix(at, iptvAdultTimeKeyPrefix) {
		t.Errorf("%q is not namespaced", at)
	}
	if strings.HasPrefix(at, iptvAyloKeyPrefix) {
		t.Errorf("%q collides with the Aylo namespace", at)
	}
	if _, err := strconv.Atoi(strings.TrimPrefix(at, iptvAdultTimeKeyPrefix)); err == nil {
		t.Errorf("%q could be mistaken for a library studio id", at)
	}
}

func TestSlugIsStableAndURLSafe(t *testing.T) {
	cases := map[string]string{
		"Pure Taboo":           "pure-taboo",
		"Devil's Film":         "devil-s-film",
		"21 Sextury":           "21-sextury",
		"  Girlsway  ":         "girlsway",
		"Adult Time Originals": "adult-time-originals",
	}
	for name, want := range cases {
		if got := adultTimeSlug(name); got != want {
			t.Errorf("slug(%q) = %q, want %q", name, got, want)
		}
	}

	for _, name := range []string{"Pure Taboo", "Devil's Film", "!!!"} {
		got := adultTimeSlug(name)
		if strings.HasPrefix(got, "-") || strings.HasSuffix(got, "-") {
			t.Errorf("slug(%q) = %q has a stray dash", name, got)
		}
		if got != adultTimeSlug(name) {
			t.Errorf("slug(%q) is not stable", name)
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

func TestSlugsCannotProduceTheNetworkWideKey(t *testing.T) {
	// The property the umbrella key relies on: a slug never contains a doubled
	// dash, so reserving one shape with a doubled dash is safe for good.
	for _, name := range []string{"All", "A  ll", "a - b", "!!!a!!!b!!!", "  --  x  --  "} {
		if strings.Contains(adultTimeSlug(name), "--") {
			t.Errorf("slug(%q) = %q contains a doubled dash, which the network-wide key reserves",
				name, adultTimeSlug(name))
		}
	}
}

func TestSpecsCarryProviderIdentityAndAGuideID(t *testing.T) {
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

func TestNetworkChannelsAreRecognisedAsNetworks(t *testing.T) {
	// The predicate that decides programme caps, guide icons and how a
	// programme is resolved. A new provider missed here plays as a library
	// channel and fails obscurely.
	for _, src := range []string{iptvSourceAylo, iptvSourceAdultTime} {
		if !(iptvChannel{Source: src}).isNetwork() {
			t.Errorf("%q is not being treated as a network channel", src)
		}
	}
	if (iptvChannel{Source: iptvSourceLibrary}).isNetwork() {
		t.Error("a library channel must not be treated as a network")
	}
	if (iptvChannel{}).isNetwork() {
		t.Error("an unset source must not be treated as a network")
	}
}

func TestEveryRegisteredProviderIsReachableByItsSource(t *testing.T) {
	nets := newIPTVNetworks()

	for _, src := range []string{iptvSourceAylo, iptvSourceAdultTime} {
		if nets.bySource(src) == nil {
			t.Errorf("no provider registered for %q; its channels would resolve as library files", src)
		}
	}
	if nets.bySource(iptvSourceLibrary) != nil {
		t.Error("library channels must not resolve to a network provider")
	}
	if nets.bySource("nope") != nil {
		t.Error("an unknown source should resolve to no provider")
	}
}

func TestProvidersDoNotShareASourceOrKeyPrefix(t *testing.T) {
	if iptvSourceAylo == iptvSourceAdultTime {
		t.Fatal("providers share a source id")
	}
	if strings.HasPrefix(iptvAdultTimeKeyPrefix, iptvAyloKeyPrefix) ||
		strings.HasPrefix(iptvAyloKeyPrefix, iptvAdultTimeKeyPrefix) {
		t.Errorf("key prefixes %q and %q are ambiguous", iptvAyloKeyPrefix, iptvAdultTimeKeyPrefix)
	}
}

func TestChannelSeedsAreStableAndClearOfStudioIDs(t *testing.T) {
	keys := []string{"at-pure-taboo", "at-all", "aylo-brazzers", "aylo-brazzers-1"}

	seen := map[int]string{}
	for _, k := range keys {
		got := iptvNetChannelSeed(k)
		if got != iptvNetChannelSeed(k) {
			t.Errorf("seed for %q is not stable across calls", k)
		}
		// Library channels seed from a studio id, which is a small positive
		// int. An overlap would give two channels the same rotation.
		if got < 1_000_000 {
			t.Errorf("seed for %q is %d, inside the studio id range", k, got)
		}
		if prev, dup := seen[got]; dup {
			t.Errorf("%q and %q share seed %d", prev, k, got)
		}
		seen[got] = k
	}
}
