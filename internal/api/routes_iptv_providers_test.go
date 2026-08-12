package api

import (
	"strings"
	"testing"
)

// Invariants that must hold across every network provider.
//
// These exist because the ways a new provider goes wrong are all quiet. A source
// missing from the registry makes its channels resolve as library files; a key
// prefix that is a prefix of another makes two providers' channels ambiguous on
// the shared route; a source missed by isNetwork plays as a local file and fails
// obscurely. None of those produce a compile error, so they are pinned here — and
// the tables below are deliberately written out rather than derived from
// newIPTVNetworks, so adding a provider without touching this file fails.

// iptvTestProviders is every provider, with the two identifiers a channel route
// depends on.
var iptvTestProviders = []struct {
	source string
	prefix string
	// networkWideKey is the umbrella channel's key, or "" for a provider whose
	// children carry numeric ids and so cannot collide with it (Aylo).
	networkWideKey string
}{
	{iptvSourceAylo, iptvAyloKeyPrefix, ""},
	{iptvSourceAdultTime, iptvAdultTimeKeyPrefix, adultTimeNetworkChannelKey()},
	{iptvSourceEvilAngel, iptvEvilAngelKeyPrefix, evilAngelNetworkChannelKey()},
	{iptvSourceTeamSkeet, iptvTeamSkeetKeyPrefix, teamSkeetNetworkChannelKey()},
	{iptvSourceNewSensations, iptvNSKeyPrefix, nsNetworkChannelKey()},
}

func TestEveryProviderIsRegisteredAndReachableByItsSource(t *testing.T) {
	nets := newIPTVNetworks()

	if len(nets) != len(iptvTestProviders) {
		t.Errorf("%d providers registered but %d expected; the table here and newIPTVNetworks have diverged",
			len(nets), len(iptvTestProviders))
	}

	for _, p := range iptvTestProviders {
		ns := nets.bySource(p.source)
		if ns == nil {
			t.Errorf("no provider registered for %q; its channels would resolve as library files", p.source)
			continue
		}
		if ns.net.Source() != p.source {
			t.Errorf("provider for %q reports source %q", p.source, ns.net.Source())
		}
		if ns.net.Label() == "" {
			t.Errorf("provider %q has no label; log lines would be unattributable", p.source)
		}
	}

	if nets.bySource(iptvSourceLibrary) != nil {
		t.Error("library channels must not resolve to a network provider")
	}
	if nets.bySource("nope") != nil {
		t.Error("an unknown source should resolve to no provider")
	}
}

func TestProviderOrderIsAppendOnly(t *testing.T) {
	// Channel numbers come from lineup order, so a TV with a stored playlist
	// renumbers itself if a provider is inserted rather than appended. The first
	// two positions are what existing installs already have.
	nets := newIPTVNetworks()
	if len(nets) < 2 {
		t.Fatal("expected at least the two original providers")
	}
	if nets[0].net.Source() != iptvSourceAylo {
		t.Errorf("first provider is %q, want %q — every channel number after it shifts",
			nets[0].net.Source(), iptvSourceAylo)
	}
	if nets[1].net.Source() != iptvSourceAdultTime {
		t.Errorf("second provider is %q, want %q", nets[1].net.Source(), iptvSourceAdultTime)
	}
}

func TestProviderSourcesAndKeyPrefixesAreUnambiguous(t *testing.T) {
	for i, a := range iptvTestProviders {
		for j, b := range iptvTestProviders {
			if i == j {
				continue
			}
			if a.source == b.source {
				t.Errorf("providers share the source id %q", a.source)
			}
			// Not just inequality: one prefix being a prefix of another makes the
			// key ambiguous, which is the failure that actually bites.
			if strings.HasPrefix(a.prefix, b.prefix) {
				t.Errorf("key prefix %q starts with %q, so keys are ambiguous", a.prefix, b.prefix)
			}
		}
	}
}

func TestEveryProviderSourceIsRecognisedAsANetwork(t *testing.T) {
	// The predicate that decides programme caps, guide icons and how a programme
	// is resolved.
	for _, p := range iptvTestProviders {
		if !(iptvChannel{Source: p.source}).isNetwork() {
			t.Errorf("%q is not being treated as a network channel", p.source)
		}
	}
	if (iptvChannel{Source: iptvSourceLibrary}).isNetwork() {
		t.Error("a library channel must not be treated as a network")
	}
	if (iptvChannel{}).isNetwork() {
		t.Error("an unset source must not be treated as a network")
	}
}

func TestUmbrellaChannelKeysAreUnreachableBySlugging(t *testing.T) {
	// Every name-keyed provider reserves a doubled-dash shape for its umbrella
	// channel, relying on gammaSlug never producing one. A facet value that could
	// reproduce the key would silently replace the umbrella channel.
	names := []string{"All", "all", "  ALL  ", "-all-", "A  ll", "a - b", "!!!a!!!b!!!", "  --  x  --  "}

	for _, p := range iptvTestProviders {
		if p.networkWideKey == "" {
			continue
		}
		if !strings.Contains(p.networkWideKey, "--") {
			t.Errorf("%q does not use the reserved doubled-dash shape", p.networkWideKey)
		}
		for _, name := range names {
			if p.prefix+gammaSlug(name) == p.networkWideKey {
				t.Errorf("name %q reproduces %s's umbrella key %q", name, p.source, p.networkWideKey)
			}
		}
	}
}

func TestUmbrellaChannelKeysDoNotCollideAcrossProviders(t *testing.T) {
	seen := map[string]string{}
	for _, p := range iptvTestProviders {
		if p.networkWideKey == "" {
			continue
		}
		if prev, dup := seen[p.networkWideKey]; dup {
			t.Errorf("%s and %s share the umbrella key %q", prev, p.source, p.networkWideKey)
		}
		seen[p.networkWideKey] = p.source
	}
}

func TestChannelSeedsAreStableAndClearOfStudioIDs(t *testing.T) {
	keys := []string{
		"at-pure-taboo", adultTimeNetworkChannelKey(),
		"ea-euro-angels", evilAngelNetworkChannelKey(),
		"ts-exxxtra-small", teamSkeetNetworkChannelKey(),
		"aylo-brazzers", "aylo-brazzers-1",
	}

	seen := map[int]string{}
	for _, k := range keys {
		got := iptvNetChannelSeed(k)
		if got != iptvNetChannelSeed(k) {
			t.Errorf("seed for %q is not stable across calls", k)
		}
		// Library channels seed from a studio id, which is a small positive int.
		// An overlap would give two channels the same rotation.
		if got < 1_000_000 {
			t.Errorf("seed for %q is %d, inside the studio id range", k, got)
		}
		if prev, dup := seen[got]; dup {
			t.Errorf("%q and %q share seed %d", prev, k, got)
		}
		seen[got] = k
	}
}

func TestEveryProviderRejectsAnotherProvidersSpec(t *testing.T) {
	// Each provider's selector is handed specs recovered from the lineup, so one
	// that accepted a foreign spec would quietly build a query for its whole
	// catalog instead of the channel that was asked for.
	foreign := iptvNetChannelSpec{Source: "somebody-else", Key: "x-1", Collection: "Whatever"}

	if _, err := adultTimeSelectorFor(foreign); err == nil {
		t.Error("Adult Time accepted a foreign spec")
	}
	if _, err := evilAngelSelectorFor(foreign); err == nil {
		t.Error("EvilAngel accepted a foreign spec")
	}
	if _, err := (teamSkeetNetwork{}).Programs(nil, foreign, 10, 1); err == nil {
		t.Error("TeamSkeet accepted a foreign spec")
	}
	if _, ok := ayloSelectorFor(foreign); ok {
		t.Error("Aylo accepted a foreign spec")
	}
	if _, err := (nsNetwork{}).Programs(nil, foreign, 10, 1); err == nil {
		t.Error("NewSensations accepted a foreign spec")
	}
}
