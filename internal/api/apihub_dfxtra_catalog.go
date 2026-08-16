package api

import (
	"context"
	"errors"
	"sort"
	"strings"
)

// DFXtra's slice of the Gamma platform.
//
// DFXtra is Dogfart Network's 2026 rebrand, but technically it is a third site
// on the same Gamma platform as Adult Time and EvilAngel: its public homepage
// embeds the same app id (TSMKFA364Q) in the same window.env shape, scoped by
// `segment:dfxtra` instead of `segment:evilangel` — confirmed by a live fetch
// of www.dfxtra.com and a query against the shared `all_scenes_latest_desc`
// index. The member API (`/media/streamingUrls/{clip_id}`) was confirmed live
// too: same shape, same *-fame.gammacdn.com CDN, same session cookie names.
//
// Like EvilAngel, its key is published on the PUBLIC homepage (EnvNeedsSession
// false) — browsing needs no session, only playback does. And like EvilAngel,
// its `studio_name` facet is useless for channels (every hit reports
// "DFXtra" — confirmed: 291/291 scenes on the site share it); `serie_name`
// is what actually divides the catalog (DFXtra, DFX Hot Wives, Cheating With
// My Ex, DFX Homewreckers, DFXtra Compilations, Cougar Seductions, …).
//
// DFXtra's OWN site is small (291 scenes at last count) but its segment is
// not: the network includes partner-site channels sharing the same
// membership (Gloryhole Initiations, We Fuck Black Girls, BlacksOnBoys, …),
// ~6,900 scenes across 39 series at last measurement. Channel discovery is
// network-wide for exactly this reason — see dfxtraSelector.gamma().

const (
	dfxtraMemberBase = "https://members.dfxtra.com"
	dfxtraPublicBase = "https://www.dfxtra.com"

	// dfxtraConfigKey is the API Hub plugin setting holding the joined member
	// Cookie header, shared with the Gamma keepalive scheduler.
	dfxtraConfigKey = "dfxtraCookie"

	// dfxtraSitename scopes the shared Gamma index to this one site.
	dfxtraSitename = "dfxtra"

	// dfxtraChannelFacet is the series facet — see file header for why not
	// studio_name.
	dfxtraChannelFacet = "serie_name"

	// dfxtraMaxFacetValues comfortably covers the network-wide series count
	// (39 at last measurement, see dfxtraListChannels), with generous headroom
	// as the network grows.
	dfxtraMaxFacetValues = 1000
)

var errDfxtraNoSession = errors.New("no live DFXtra session in API Hub")

// dfxtraSite is the Gamma descriptor for DFXtra. EnvNeedsSession is false: the
// homepage is public, so a lapsed session shows up when a stream is requested
// rather than when the catalog is read — same as EvilAngel.
var dfxtraSite = gammaSite{
	Label:           "DFXtra",
	MemberBase:      dfxtraMemberBase,
	ConfigKey:       dfxtraConfigKey,
	EnvURL:          dfxtraPublicBase,
	EnvNeedsSession: false,
	AlgoliaOrigin:   dfxtraPublicBase,
	NoSession:       errDfxtraNoSession,
}

// dfxtraSessionLive reports whether API Hub holds a member cookie. Checked
// even though the catalog does not need one — see evilAngelSessionLive's
// rationale, which applies identically here.
func dfxtraSessionLive() bool { return gammaSessionLive(dfxtraSite) }

// ─── selectors ────────────────────────────────────────────────────────────────

// dfxtraSelector names a slice of the catalog: the whole site, or one series
// inside it.
type dfxtraSelector struct {
	series string // "" selects the whole site
}

// gamma builds the filter groups every query shares.
//
// The whole-site selector (series == "") stays scoped to sitename:dfxtra —
// that's the "(All)" channel, meant to be DFXtra's own native catalog, same
// as its Scenes tab on the frontend. A NAMED series is deliberately NOT
// sitename-scoped: DFXtra's segment includes partner-network channels
// (Gloryhole Initiations, We Fuck Black Girls, BlacksOnBoys, …) whose scenes
// carry a different site's own sitename, confirmed live — scoping them to
// "dfxtra" would starve their rotation to near nothing. Same rationale as
// evilangel/client.ts's scopeToSite on the frontend (see that file for the
// fuller writeup); this is its Go-side counterpart for the IPTV lineup.
func (sel dfxtraSelector) gamma() gammaSelector {
	filters := [][]string{{"upcoming:0"}}
	if sel.series == "" {
		filters = append(filters, []string{"sitename:" + dfxtraSitename})
	} else {
		filters = append(filters, []string{dfxtraChannelFacet + ":" + sel.series})
	}
	return gammaSelector{FacetFilters: filters}
}

// ─── discovery ────────────────────────────────────────────────────────────────

// dfxtraListChannels returns every series network-wide (not just DFXtra's own
// site) and its scene count, plus DFXtra's own site total for the "(All)"
// channel — two queries, both cheap facet-only lookups.
//
// Measured live: DFXtra's own sitename-scoped catalog is ~291 scenes across a
// dozen thin series, but the segment as a whole (partner-network channels
// included) is ~6,900 scenes across 39 series, several with 100-2000+ scenes
// each (BlacksOnBlondes: 1942, GloryHole: 1056, CuckoldSessions: 733, …) —
// this is what "expand the amount of DFXtra channels available" unlocks.
func dfxtraListChannels(ctx context.Context) (series []gammaFacetValue, total int, err error) {
	// DFXtra's own site total, for the "(All)" channel's size/eligibility —
	// the facet values themselves are discarded (maxValues:1), only NbHits
	// (unaffected by facet truncation) is used.
	_, total, err = gammaListFacet(ctx, dfxtraSite,
		gammaSelector{FacetFilters: [][]string{{"sitename:" + dfxtraSitename}, {"upcoming:0"}}},
		dfxtraChannelFacet, 1)
	if err != nil {
		return nil, 0, err
	}

	// Network-wide series list — every one becomes its own IPTV channel once
	// it clears minScenes, regardless of which partner site its scenes carry.
	series, _, err = gammaListFacet(ctx, dfxtraSite,
		gammaSelector{FacetFilters: [][]string{{"upcoming:0"}}},
		dfxtraChannelFacet, dfxtraMaxFacetValues)
	if err != nil {
		return nil, 0, err
	}
	sort.Slice(series, func(i, j int) bool {
		return strings.ToLower(series[i].Name) < strings.ToLower(series[j].Name)
	})
	return series, total, nil
}
