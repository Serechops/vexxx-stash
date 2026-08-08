package api

import (
	"context"
	"errors"
	"sort"
	"strings"
)

// Adult Time's slice of the Gamma platform.
//
// Everything mechanical — the Algolia transport, the window.env scrape, date
// banding, rendition choice, the member-area gotchas — is shared with EvilAngel
// in apihub_gamma_catalog.go. What is left here is only what is genuinely Adult
// Time's: where its search key is published, and how its catalog is divided into
// channels.
//
// It divides by `network.lvl0`, its child-studio facet — Girlsway, Pure Taboo,
// 21 Sextury, Vivid … 206 of them. That is a coarser unit than EvilAngel's
// series and it maps directly onto how the site itself presents its catalog.

const (
	adultTimeMemberBase = "https://members.adulttime.com"

	// adultTimeConfigKey is the API Hub plugin setting holding the joined
	// member Cookie header, shared with the Gamma keepalive scheduler.
	adultTimeConfigKey = "adulttimeCookie"

	// adultTimeChannelFacet is the child-studio facet: "Girlsway", "Pure
	// Taboo", "21 Sextury" … 206 of them, and faceting on it returns all of
	// them with their scene counts in a single query.
	adultTimeChannelFacet = "network.lvl0"

	// adultTimeMaxFacetValues is comfortably above the ~206 that exist, so the
	// studio list is never silently truncated as the catalog grows.
	adultTimeMaxFacetValues = 1000
)

var errAdultTimeNoSession = errors.New("no live Adult Time session in API Hub")

// adultTimeInterstitialCookies dismisses the promotional gate described in the
// Gamma file header. These are exactly the cookies the interstitial redirect sets
// on the way past, so sending them is what a browser does on its second visit —
// not a bypass of anything protective. Adult Time needs them because its
// window.env page is inside the member area; EvilAngel's is public.
const adultTimeInterstitialCookies = "interstitialPageShown=1; interstitialCountXhours=1; interstitialCountXweek=1"

// adultTimeSite is the Gamma descriptor for Adult Time. Its search key is
// rendered into an authenticated members page, so unlike EvilAngel it needs a
// live session merely to read the catalog.
var adultTimeSite = gammaSite{
	Label:           "Adult Time",
	MemberBase:      adultTimeMemberBase,
	ConfigKey:       adultTimeConfigKey,
	EnvURL:          adultTimeMemberBase + "/en",
	EnvNeedsSession: true,
	GateCookies:     adultTimeInterstitialCookies,
	AlgoliaOrigin:   adultTimeMemberBase,
	NoSession:       errAdultTimeNoSession,
}

func adultTimeSessionLive() bool { return gammaSessionLive(adultTimeSite) }

// ─── selectors ────────────────────────────────────────────────────────────────

// adultTimeSelector names a slice of the catalog: the whole network, or one
// child studio inside it.
type adultTimeSelector struct {
	channel string // "" selects the whole network
}

// gamma builds the filter pair every query shares. Nested arrays are an AND of
// ORs, so this reads as "in this channel AND not upcoming".
func (sel adultTimeSelector) gamma() gammaSelector {
	filters := [][]string{{"upcoming:0"}}
	if sel.channel != "" {
		filters = append(filters, []string{adultTimeChannelFacet + ":" + sel.channel})
	}
	return gammaSelector{FacetFilters: filters}
}

// ─── discovery ────────────────────────────────────────────────────────────────

// adultTimeListChannels returns every child studio and its scene count, plus
// the network total, in one query.
func adultTimeListChannels(ctx context.Context) (channels []gammaFacetValue, total int, err error) {
	channels, total, err = gammaListFacet(ctx, adultTimeSite, adultTimeSelector{}.gamma(),
		adultTimeChannelFacet, adultTimeMaxFacetValues)
	if err != nil {
		return nil, 0, err
	}
	sort.Slice(channels, func(i, j int) bool {
		return strings.ToLower(channels[i].Name) < strings.ToLower(channels[j].Name)
	})
	return channels, total, nil
}
