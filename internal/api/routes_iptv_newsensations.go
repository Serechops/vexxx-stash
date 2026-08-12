package api

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/stashapp/stash/pkg/iptv"
)

// NewSensations as network channels.
//
// One implementation of iptvNetwork; routes_iptv_network.go owns everything
// generic. The lineup is one network-wide channel plus one per series with
// enough scenes to sustain a rotation.
//
// This provider is PUSH-based: an external scraper writes data to the SQLite
// sidecar (apihub_newsensations_store.go), and this provider reads from that
// store exclusively — it never makes live HTTP requests. The import endpoint
// (POST /apihub-newsensations/import) is available for the scraper to push
// data, or the scraper can write to the SQLite file directly.
//
// The store must be populated before this provider produces channels. The
// IPTV panel will show "New Sensations" as absent until data is imported.

const (
	iptvSourceNewSensations = "newsensations"

	// iptvNSKeyPrefix namespaces these channel ids away from studio ids and
	// from the other providers', so they can all share one route.
	iptvNSKeyPrefix = "ns-"

	// nsBrandSlug and nsBrandLabel put every NewSensations channel in one
	// folder on the TV.
	nsBrandSlug  = "newsensations"
	nsBrandLabel = "New Sensations"

	// nsMaxHeight caps the rendition. NewSensations sources top out at 1080p
	// in practice, but cap at 1080 to match the other providers.
	nsMaxHeight = 1080
)

// nsNetwork implements iptvNetwork — read-only from the SQLite store.
type nsNetwork struct{}

func (nsNetwork) Source() string { return iptvSourceNewSensations }
func (nsNetwork) Label() string  { return nsBrandLabel }

// SessionLive reports whether the store has any series data. The store must
// be populated by an external scraper before this provider produces channels.
func (nsNetwork) SessionLive() bool {
	return nsCatalog.seriesCount() > 0
}

func (nsNetwork) IsNoSession(err error) bool { return false }

// ─── channel keys ─────────────────────────────────────────────────────────────

func nsChannelKey(id string) string {
	return iptvNSKeyPrefix + id
}

func nsNetworkChannelKey() string {
	return iptvNSKeyPrefix + "-all"
}

// ─── discovery ────────────────────────────────────────────────────────────────

// ListChannels reads all series from the SQLite store and builds the lineup.
// Returns nil (no channels) when the store is empty — the background sweep
// will populate it.
func (nsNetwork) ListChannels(ctx context.Context, minScenes int) ([]iptvNetChannelSpec, error) {
	stored := nsCatalog.listSeries()
	if len(stored) == 0 {
		return nil, nil
	}
	return nsBuildSpecsFromStore(stored, minScenes), nil
}

func nsBuildSpecsFromStore(series []nsStoredSeries, minScenes int) []iptvNetChannelSpec {
	sort.SliceStable(series, func(i, j int) bool {
		return strings.ToLower(series[i].Name) < strings.ToLower(series[j].Name)
	})

	var totalScenes int
	var seriesSpecs []iptvNetChannelSpec

	for _, s := range series {
		totalScenes += s.SceneCount
		withDurations := nsCatalog.scenesWithDurationForSeries(s.ID)
		if withDurations < minScenes && s.SceneCount < minScenes {
			continue
		}
		seriesSpecs = append(seriesSpecs, nsSpec(iptvNetChannelSpec{
			Key:        nsChannelKey(s.ID),
			BrandSlug:  nsBrandSlug,
			BrandLabel: nsBrandLabel,
			Name:       s.Name,
			Collection: s.ID,
			SceneCount: s.SceneCount,
		}))
	}

	specs := make([]iptvNetChannelSpec, 0, len(seriesSpecs)+1)
	specs = append(specs, nsSpec(iptvNetChannelSpec{
		Key:        nsNetworkChannelKey(),
		BrandSlug:  nsBrandSlug,
		BrandLabel: nsBrandLabel,
		Name:       nsBrandLabel + " (All)",
		SceneCount: totalScenes,
	}))
	specs = append(specs, seriesSpecs...)
	return specs
}

func nsSpec(spec iptvNetChannelSpec) iptvNetChannelSpec {
	spec.Source = iptvSourceNewSensations
	spec.TvgID = "vexxx-apihub-" + strings.TrimPrefix(spec.Key, iptvNSKeyPrefix)
	return spec
}

// ─── programmes ───────────────────────────────────────────────────────────────

// Programs reads schedulable scenes from the SQLite store. Never makes live
// HTTP requests — the background sweep or import endpoint must populate the
// store first.
func (nsNetwork) Programs(ctx context.Context, spec iptvNetChannelSpec, want int, seed uint64) ([]iptv.SceneEntry, error) {
	if spec.Source != iptvSourceNewSensations {
		return nil, fmt.Errorf("not a NewSensations spec")
	}

	var scenes []nsStoredScene
	if spec.Collection != "" {
		scenes = nsCatalog.listScenes(spec.Collection, want)
	} else {
		scenes = nsCatalog.listAllScenes(want)
	}

	sceneEntries := make([]iptv.SceneEntry, 0, len(scenes))
	for _, s := range scenes {
		if s.DurationSeconds <= 0 {
			continue
		}
		sceneEntries = append(sceneEntries, iptv.SceneEntry{
			SceneID:  s.ID,
			Title:    s.Title,
			Duration: s.DurationSeconds,
		})
	}

	iptv.StableShuffle(sceneEntries, iptv.ShuffleSeed(int(seed)))
	return sceneEntries, nil
}

// ─── playback ─────────────────────────────────────────────────────────────────

// ProgramSource reads the video URL from the SQLite store. Never makes live
// HTTP requests — the background sweep or import endpoint must populate the
// store first.
func (nsNetwork) ProgramSource(ctx context.Context, programID int) (programSource, error) {
	cached := nsCatalog.lookupScene(programID)
	if cached == nil || cached.VideoURL == "" {
		return programSource{}, fmt.Errorf("scene %d has no cached video URL; import scene data first", programID)
	}

	h := cached.VideoHeight
	if h > nsMaxHeight {
		h = nsMaxHeight
	}

	return programSource{
		Path:       cached.VideoURL,
		VideoCodec: "h264",
		AudioCodec: "aac",
		Height:     h,
		Remote:     true,
	}, nil
}
