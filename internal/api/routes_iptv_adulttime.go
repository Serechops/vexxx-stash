package api

import (
	"context"
	"errors"
	"fmt"

	"github.com/stashapp/stash/pkg/iptv"
)

// Adult Time as network channels.
//
// One implementation of iptvNetwork; routes_iptv_network.go owns everything
// generic. Adult Time is a single catalog with ~206 child studios (Girlsway,
// Pure Taboo, 21 Sextury, Vivid …) rather than Aylo's several brands, so the
// lineup is one network-wide channel plus one per studio big enough to sustain
// a rotation — 194 channels over roughly 70,000 scenes.
//
// It is materially cheaper to run than Aylo, and both differences come from the
// catalog being an Algolia index:
//
//   - Discovery is one request. Faceting on network.lvl0 returns every child
//     studio *and* its scene count together, where Aylo needs a sizing request
//     per collection.
//   - A schedule needs no per-scene calls. A hit already carries its duration,
//     release date and rendition codecs, so playability is decided at schedule
//     time rather than discovered at play time.
//
// Nothing here mints or refreshes a credential — see apihub_gamma_catalog.go.

const (
	iptvSourceAdultTime = "adulttime"

	// iptvAdultTimeKeyPrefix namespaces these channel ids away from studio ids
	// and from the other providers', so they can all share one route.
	iptvAdultTimeKeyPrefix = "at-"

	// adultTimeBrandSlug and adultTimeBrandLabel put every Adult Time channel in
	// one folder on the TV. Adult Time has no brands beneath it the way Aylo
	// does, so this names the network itself.
	adultTimeBrandSlug  = "adulttime"
	adultTimeBrandLabel = "Adult Time"
)

// adultTimeNetwork implements iptvNetwork.
type adultTimeNetwork struct{}

func (adultTimeNetwork) Source() string { return iptvSourceAdultTime }
func (adultTimeNetwork) Label() string  { return adultTimeBrandLabel }

func (adultTimeNetwork) SessionLive() bool { return adultTimeSessionLive() }

func (adultTimeNetwork) IsNoSession(err error) bool { return errors.Is(err, errAdultTimeNoSession) }

// ─── channel keys ─────────────────────────────────────────────────────────────

// adultTimeChannelKey derives a stable URL id for a child studio.
//
// Unlike Aylo, whose collections have numeric ids, a studio here is identified
// only by its facet value — its name. That name is therefore slugged into the
// key, which means a studio renamed upstream does become a new channel. There
// is no id to key on instead, so the alternative would be inventing one and
// storing a mapping; a rename is rare enough not to be worth that.
func adultTimeChannelKey(name string) string {
	return iptvAdultTimeKeyPrefix + gammaSlug(name)
}

// adultTimeNetworkChannelKey names the network-wide channel.
//
// The doubled dash is load-bearing. Aylo can key its brand-wide channel plainly
// because its children are distinguished by a numeric id; here a child is
// identified by its slugged name, so a studio actually called "All" would land
// on the same key as the umbrella channel and silently replace it. A slug never
// contains two dashes in a row (gammaSlug collapses runs), so this is the one
// shape no studio name can ever produce.
func adultTimeNetworkChannelKey() string {
	return iptvAdultTimeKeyPrefix + "-all"
}

// ─── discovery ────────────────────────────────────────────────────────────────

// ListChannels returns the network-wide channel plus every child studio with
// enough scenes to sustain a rotation. One request — see adultTimeListChannels.
func (adultTimeNetwork) ListChannels(ctx context.Context, minScenes int) ([]iptvNetChannelSpec, error) {
	studios, total, err := adultTimeListChannels(ctx)
	if err != nil {
		return nil, err
	}

	specs := make([]iptvNetChannelSpec, 0, len(studios)+1)
	if total >= minScenes {
		specs = append(specs, adultTimeSpec(iptvNetChannelSpec{
			Key: adultTimeNetworkChannelKey(),
			// Labelled like Aylo's brand-wide channel so it does not read as
			// just another studio in a list of its own children.
			Name:       adultTimeBrandLabel + " (All)",
			SceneCount: total,
		}))
	}

	// Studios arrive already sorted by name, and the network-wide channel is
	// prepended, so the order matches Aylo's convention: the umbrella channel
	// first, then its children alphabetically. Stable across refreshes, which
	// is what keeps channel numbers put on a TV.
	for _, st := range studios {
		if st.Count < minScenes {
			continue
		}
		specs = append(specs, adultTimeSpec(iptvNetChannelSpec{
			Key:        adultTimeChannelKey(st.Name),
			Name:       st.Name,
			Collection: st.Name,
			SceneCount: st.Count,
		}))
	}

	return specs, nil
}

// adultTimeSpec stamps the fields every Adult Time spec shares.
func adultTimeSpec(spec iptvNetChannelSpec) iptvNetChannelSpec {
	spec.Source = iptvSourceAdultTime
	spec.BrandSlug = adultTimeBrandSlug
	spec.BrandLabel = adultTimeBrandLabel
	spec.TvgID = "vexxx-apihub-" + spec.Key
	return spec
}

// ─── programmes ───────────────────────────────────────────────────────────────

// Programs samples one channel's schedulable scenes, spread across its whole
// history, then shuffles them with the channel's stable seed so the rotation
// survives a restart.
func (adultTimeNetwork) Programs(ctx context.Context, spec iptvNetChannelSpec, want int, seed uint64) ([]iptv.SceneEntry, error) {
	sel, err := adultTimeSelectorFor(spec)
	if err != nil {
		return nil, err
	}

	hits, err := gammaSampleScenes(ctx, adultTimeSite, sel.gamma(), want, seed)
	if err != nil {
		return nil, err
	}

	entries := gammaEntries(hits)
	iptv.StableShuffle(entries, iptv.ShuffleSeed(int(seed)))
	return entries, nil
}

// ─── playback ─────────────────────────────────────────────────────────────────

// ProgramSource resolves a scene to something ffmpeg can open right now. Live on
// every programme boundary: the signed URL is short-lived, so it is never held
// in a schedule.
func (adultTimeNetwork) ProgramSource(ctx context.Context, clipID int) (programSource, error) {
	return gammaProgramSource(ctx, adultTimeSite, clipID)
}

// adultTimeSelectorFor is the inverse of the spec: which slice of catalog a
// channel airs. Exposed for tests and for symmetry with ayloSelectorFor.
func adultTimeSelectorFor(spec iptvNetChannelSpec) (adultTimeSelector, error) {
	if spec.Source != iptvSourceAdultTime {
		return adultTimeSelector{}, fmt.Errorf("spec %q is not an Adult Time channel", spec.Key)
	}
	return adultTimeSelector{channel: spec.Collection}, nil
}
