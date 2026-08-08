package api

import (
	"context"
	"errors"
	"sort"
	"strings"
)

// EvilAngel's slice of the Gamma platform.
//
// The mechanics are shared with Adult Time in apihub_gamma_catalog.go — same
// index, same hit schema, same member endpoints. Two things are EvilAngel's own:
//
//  1. Its search key is published on the PUBLIC homepage, not inside the member
//     area. Browsing the catalog therefore needs no session at all; only playing
//     a scene does. The key still carries its own scope (measured:
//     `segment:evilangel AND (NOT site_id:426)`) and its own short expiry, so it
//     is scraped and cached exactly like Adult Time's.
//
//  2. Its channel axis is `serie_name`, not a studio facet. This is not a style
//     choice — `studio_name` is unusable here, with 19,860 of 20,480 scenes
//     sharing the single value "Evil Angel". The series facet is what actually
//     divides the catalog into things a viewer would recognise as channels:
//     Euro Angels, Evil Anal, Hookup Hotshot, Buttman Focused, PansexualX.
//
// The site is scoped by the `sitename` facet, which is how one Gamma index
// serves every site on the platform. That scoping is also baked into the key, so
// the facet filter is belt-and-braces rather than load-bearing — but it is free
// and it makes the query say what it means.

const (
	evilAngelMemberBase = "https://members.evilangel.com"
	evilAngelPublicBase = "https://www.evilangel.com"

	// evilAngelConfigKey is the API Hub plugin setting holding the joined member
	// Cookie header, shared with the Gamma keepalive scheduler.
	evilAngelConfigKey = "evilangelCookie"

	// evilAngelSitename scopes the shared Gamma index to this one site.
	evilAngelSitename = "evilangel"

	// evilAngelChannelFacet is the series facet — the shows the catalog is
	// actually organised into. See the file header for why not studio_name.
	evilAngelChannelFacet = "serie_name"

	// evilAngelMaxFacetValues is Algolia's own ceiling on facet values in one
	// response. EvilAngel has more series than that (measured: the response comes
	// back full, with a smallest count of 5), so this list IS truncated — which
	// is safe only because Algolia truncates by count descending, so what falls
	// off the end are the smallest series, the ones the minimum-scenes floor
	// discards anyway. Measured at the floor of 10, 517 series clear it, well
	// inside this cap; if that ever approached 1000 the discovery would need to
	// page the facet instead.
	evilAngelMaxFacetValues = 1000
)

var errEvilAngelNoSession = errors.New("no live EvilAngel session in API Hub")

// evilAngelSite is the Gamma descriptor for EvilAngel. EnvNeedsSession is false:
// the homepage is public, so a lapsed session shows up when a stream is
// requested rather than when the catalog is read.
var evilAngelSite = gammaSite{
	Label:           "EvilAngel",
	MemberBase:      evilAngelMemberBase,
	ConfigKey:       evilAngelConfigKey,
	EnvURL:          evilAngelPublicBase,
	EnvNeedsSession: false,
	// No gate cookies: the public homepage has no interstitial in front of it.
	AlgoliaOrigin: evilAngelPublicBase,
	NoSession:     errEvilAngelNoSession,
}

// evilAngelSessionLive reports whether API Hub holds a member cookie.
//
// Checked even though the catalog does not need one, because a channel that can
// be listed but not played is worse than one that is absent: a TV would show it,
// tune it, and get an error.
func evilAngelSessionLive() bool { return gammaSessionLive(evilAngelSite) }

// ─── selectors ────────────────────────────────────────────────────────────────

// evilAngelSelector names a slice of the catalog: the whole site, or one series
// inside it.
type evilAngelSelector struct {
	series string // "" selects the whole site
}

// gamma builds the filter groups every query shares. Nested arrays are an AND of
// ORs, so this reads as "on this site AND released AND in this series".
func (sel evilAngelSelector) gamma() gammaSelector {
	filters := [][]string{
		{"sitename:" + evilAngelSitename},
		{"upcoming:0"},
	}
	if sel.series != "" {
		filters = append(filters, []string{evilAngelChannelFacet + ":" + sel.series})
	}
	return gammaSelector{FacetFilters: filters}
}

// ─── discovery ────────────────────────────────────────────────────────────────

// evilAngelListChannels returns every series and its scene count, plus the site
// total, in one query.
func evilAngelListChannels(ctx context.Context) (series []gammaFacetValue, total int, err error) {
	series, total, err = gammaListFacet(ctx, evilAngelSite, evilAngelSelector{}.gamma(),
		evilAngelChannelFacet, evilAngelMaxFacetValues)
	if err != nil {
		return nil, 0, err
	}
	sort.Slice(series, func(i, j int) bool {
		return strings.ToLower(series[i].Name) < strings.ToLower(series[j].Name)
	})
	return series, total, nil
}
