package api

import (
	"context"
	"errors"
	"fmt"

	"github.com/stashapp/stash/pkg/iptv"
	"github.com/stashapp/stash/pkg/logger"
)

// EvilAngel as network channels.
//
// One implementation of iptvNetwork; routes_iptv_network.go owns everything
// generic, and apihub_gamma_catalog.go the platform mechanics it shares with
// Adult Time. This file is the lineup: one site-wide channel plus one per series
// with enough scenes to sustain a rotation — 518 channels over 20,480 scenes.
//
// That is three times Adult Time's channel count off a third of the catalog, and
// the reason is what a channel means on each site. Adult Time divides into child
// studios; EvilAngel is a single studio whose catalog divides into shows. A show
// is a finer unit, so there are more of them and each is smaller — a 10-scene
// series is about five hours of rotation, which is a thin but real channel.
//
// Series below the floor are not stranded: their scenes still air on the
// site-wide channel, they just do not get a channel of their own.

const (
	iptvSourceEvilAngel = "evilangel"

	// iptvEvilAngelKeyPrefix namespaces these channel ids away from studio ids
	// and from the other providers', so they can all share one route.
	iptvEvilAngelKeyPrefix = "ea-"

	// evilAngelBrandSlug and evilAngelBrandLabel put every EvilAngel channel in
	// one folder on the TV.
	evilAngelBrandSlug  = "evilangel"
	evilAngelBrandLabel = "Evil Angel"
)

// evilAngelNetwork implements iptvNetwork.
type evilAngelNetwork struct{}

func (evilAngelNetwork) Source() string { return iptvSourceEvilAngel }
func (evilAngelNetwork) Label() string  { return evilAngelBrandLabel }

func (evilAngelNetwork) SessionLive() bool { return evilAngelSessionLive() }

func (evilAngelNetwork) IsNoSession(err error) bool { return errors.Is(err, errEvilAngelNoSession) }

// ─── channel keys ─────────────────────────────────────────────────────────────

// evilAngelChannelKey derives a stable URL id for a series.
//
// Same tradeoff as Adult Time: the facet carries only a name, so the name is
// slugged into the key and a series renamed upstream becomes a new channel. The
// alternative would be inventing an id and storing a mapping — the hits do carry
// a numeric `serie_id`, but the facet response does not, so joining the two
// would cost a query per series.
func evilAngelChannelKey(name string) string {
	return iptvEvilAngelKeyPrefix + gammaSlug(name)
}

// evilAngelNetworkChannelKey names the site-wide channel. The doubled dash is
// load-bearing for the same reason as Adult Time's — see
// adultTimeNetworkChannelKey.
func evilAngelNetworkChannelKey() string {
	return iptvEvilAngelKeyPrefix + "-all"
}

// ─── discovery ────────────────────────────────────────────────────────────────

// ListChannels returns the site-wide channel plus every series with enough
// scenes to sustain a rotation. One request — see evilAngelListChannels.
func (evilAngelNetwork) ListChannels(ctx context.Context, minScenes int) ([]iptvNetChannelSpec, error) {
	series, total, err := evilAngelListChannels(ctx)
	if err != nil {
		return nil, err
	}

	// Collisions are filtered before the floor is applied, so which of two
	// colliding names survives does not depend on the setting.
	series, dropped := gammaUniqueBySlug(series)
	for _, d := range dropped {
		logger.Debugf("[iptv] API Hub: EvilAngel series %q shares a channel id with an earlier one; its scenes air on the site-wide channel", d.Name)
	}

	specs := make([]iptvNetChannelSpec, 0, len(series)+1)
	if total >= minScenes {
		specs = append(specs, evilAngelSpec(iptvNetChannelSpec{
			Key: evilAngelNetworkChannelKey(),
			// Labelled like Aylo's brand-wide channel so it does not read as just
			// another series in a list of its own shows.
			Name:       evilAngelBrandLabel + " (All)",
			SceneCount: total,
		}))
	}

	// Series arrive already sorted by name and the site-wide channel is
	// prepended, matching the convention the other providers use: the umbrella
	// channel first, then its children alphabetically. Stable across refreshes,
	// which is what keeps channel numbers put on a TV.
	for _, s := range series {
		if s.Count < minScenes {
			continue
		}
		specs = append(specs, evilAngelSpec(iptvNetChannelSpec{
			Key:        evilAngelChannelKey(s.Name),
			Name:       s.Name,
			Collection: s.Name,
			SceneCount: s.Count,
		}))
	}

	return specs, nil
}

// evilAngelSpec stamps the fields every EvilAngel spec shares.
func evilAngelSpec(spec iptvNetChannelSpec) iptvNetChannelSpec {
	spec.Source = iptvSourceEvilAngel
	spec.BrandSlug = evilAngelBrandSlug
	spec.BrandLabel = evilAngelBrandLabel
	spec.TvgID = "vexxx-apihub-" + spec.Key
	return spec
}

// ─── programmes ───────────────────────────────────────────────────────────────

// Programs samples one channel's schedulable scenes, spread across its whole
// history, then shuffles them with the channel's stable seed so the rotation
// survives a restart.
func (evilAngelNetwork) Programs(ctx context.Context, spec iptvNetChannelSpec, want int, seed uint64) ([]iptv.SceneEntry, error) {
	sel, err := evilAngelSelectorFor(spec)
	if err != nil {
		return nil, err
	}

	hits, err := gammaSampleScenes(ctx, evilAngelSite, sel.gamma(), want, seed)
	if err != nil {
		return nil, err
	}

	entries := gammaEntries(hits)
	iptv.StableShuffle(entries, iptv.ShuffleSeed(int(seed)))
	return entries, nil
}

// ─── playback ─────────────────────────────────────────────────────────────────

// ProgramSource resolves a scene to something ffmpeg can open right now. Live on
// every programme boundary: the signed URL is short-lived, so it is never held in
// a schedule.
func (evilAngelNetwork) ProgramSource(ctx context.Context, clipID int) (programSource, error) {
	return gammaProgramSource(ctx, evilAngelSite, clipID)
}

// evilAngelSelectorFor is the inverse of the spec: which slice of catalog a
// channel airs.
func evilAngelSelectorFor(spec iptvNetChannelSpec) (evilAngelSelector, error) {
	if spec.Source != iptvSourceEvilAngel {
		return evilAngelSelector{}, fmt.Errorf("spec %q is not an EvilAngel channel", spec.Key)
	}
	return evilAngelSelector{series: spec.Collection}, nil
}
