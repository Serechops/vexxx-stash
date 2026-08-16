package api

import (
	"context"
	"errors"
	"fmt"

	"github.com/stashapp/stash/pkg/iptv"
	"github.com/stashapp/stash/pkg/logger"
)

// DFXtra as network channels.
//
// One implementation of iptvNetwork, mirroring routes_iptv_evilangel.go —
// same platform, same mechanics (apihub_gamma_catalog.go), same "series is
// the real channel axis" reasoning (apihub_dfxtra_catalog.go). Discovery is
// network-wide, not just DFXtra's own site (~291 scenes) — the segment's
// partner-network channels add ~6,900 scenes across 39 series, several
// substantial (1000+ scenes); thin ones still air on the site-wide channel
// instead of getting one of their own.

const (
	iptvSourceDfxtra = "dfxtra"

	// iptvDfxtraKeyPrefix namespaces these channel ids away from the other
	// providers', so they can all share one route.
	iptvDfxtraKeyPrefix = "dfx-"

	// dfxtraBrandSlug and dfxtraBrandLabel put every DFXtra channel in one
	// folder on the TV.
	dfxtraBrandSlug  = "dfxtra"
	dfxtraBrandLabel = "DFXtra"
)

// dfxtraNetwork implements iptvNetwork.
type dfxtraNetwork struct{}

func (dfxtraNetwork) Source() string { return iptvSourceDfxtra }
func (dfxtraNetwork) Label() string  { return dfxtraBrandLabel }

func (dfxtraNetwork) SessionLive() bool { return dfxtraSessionLive() }

func (dfxtraNetwork) IsNoSession(err error) bool { return errors.Is(err, errDfxtraNoSession) }

// ─── channel keys ─────────────────────────────────────────────────────────────

// dfxtraChannelKey derives a stable URL id for a series. Same slug tradeoff as
// EvilAngel's — see evilAngelChannelKey.
func dfxtraChannelKey(name string) string {
	return iptvDfxtraKeyPrefix + gammaSlug(name)
}

// dfxtraNetworkChannelKey names the site-wide channel. The doubled dash is
// load-bearing for the same reason as the other providers' — see
// adultTimeNetworkChannelKey.
func dfxtraNetworkChannelKey() string {
	return iptvDfxtraKeyPrefix + "-all"
}

// ─── discovery ────────────────────────────────────────────────────────────────

// ListChannels returns the site-wide channel plus every series with enough
// scenes to sustain a rotation. One request — see dfxtraListChannels.
func (dfxtraNetwork) ListChannels(ctx context.Context, minScenes int) ([]iptvNetChannelSpec, error) {
	series, total, err := dfxtraListChannels(ctx)
	if err != nil {
		return nil, err
	}

	series, dropped := gammaUniqueBySlug(series)
	for _, d := range dropped {
		logger.Debugf("[iptv] API Hub: DFXtra series %q shares a channel id with an earlier one; its scenes air on the site-wide channel", d.Name)
	}

	specs := make([]iptvNetChannelSpec, 0, len(series)+1)
	if total >= minScenes {
		specs = append(specs, dfxtraSpec(iptvNetChannelSpec{
			Key:        dfxtraNetworkChannelKey(),
			Name:       dfxtraBrandLabel + " (All)",
			SceneCount: total,
		}))
	}

	for _, s := range series {
		if s.Count < minScenes {
			continue
		}
		specs = append(specs, dfxtraSpec(iptvNetChannelSpec{
			Key:        dfxtraChannelKey(s.Name),
			Name:       s.Name,
			Collection: s.Name,
			SceneCount: s.Count,
		}))
	}

	return specs, nil
}

// dfxtraSpec stamps the fields every DFXtra spec shares.
func dfxtraSpec(spec iptvNetChannelSpec) iptvNetChannelSpec {
	spec.Source = iptvSourceDfxtra
	spec.BrandSlug = dfxtraBrandSlug
	spec.BrandLabel = dfxtraBrandLabel
	spec.TvgID = "vexxx-apihub-" + spec.Key
	return spec
}

// ─── programmes ───────────────────────────────────────────────────────────────

// Programs samples one channel's schedulable scenes, spread across its whole
// history, then shuffles them with the channel's stable seed so the rotation
// survives a restart.
func (dfxtraNetwork) Programs(ctx context.Context, spec iptvNetChannelSpec, want int, seed uint64) ([]iptv.SceneEntry, error) {
	sel, err := dfxtraSelectorFor(spec)
	if err != nil {
		return nil, err
	}

	hits, err := gammaSampleScenes(ctx, dfxtraSite, sel.gamma(), want, seed)
	if err != nil {
		return nil, err
	}

	entries := gammaEntries(hits)
	iptv.StableShuffle(entries, iptv.ShuffleSeed(int(seed)))
	return entries, nil
}

// ─── playback ─────────────────────────────────────────────────────────────────

// ProgramSource resolves a scene to something ffmpeg can open right now.
func (dfxtraNetwork) ProgramSource(ctx context.Context, clipID int) (programSource, error) {
	return gammaProgramSource(ctx, dfxtraSite, clipID)
}

// dfxtraSelectorFor is the inverse of the spec: which slice of catalog a
// channel airs.
func dfxtraSelectorFor(spec iptvNetChannelSpec) (dfxtraSelector, error) {
	if spec.Source != iptvSourceDfxtra {
		return dfxtraSelector{}, fmt.Errorf("spec %q is not a DFXtra channel", spec.Key)
	}
	return dfxtraSelector{series: spec.Collection}, nil
}
