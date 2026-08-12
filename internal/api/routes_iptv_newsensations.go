package api

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/stashapp/stash/pkg/iptv"
	"github.com/stashapp/stash/pkg/logger"
)

// NewSensations as network channels.
//
// One implementation of iptvNetwork; routes_iptv_network.go owns everything
// generic. The lineup is one network-wide channel plus one per series with
// enough scenes to sustain a rotation.
//
// The catalog data lives in a SQLite sidecar (apihub_newsensations_store.go).
// It is populated automatically by a Go-side HTML scraper
// (apihub_newsensations_scraper.go) that runs during the IPTV warm cycle via
// the iptvNetPreparer interface — the same contract TeamSkeet uses. The
// scraper reads the member session cookie from the apihub plugin config
// (key "newsensationsCookie") and scrapes newsensations.com/members/ HTML.
//
// The import endpoint (POST /apihub-newsensations/import) is still available
// as a manual alternative.

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

// nsNetwork implements iptvNetwork and iptvNetPreparer — the catalog is
// scraped from the Go backend during Prepare(), and read from the SQLite
// store for channel discovery and scheduling.
type nsNetwork struct{}

func (nsNetwork) Source() string { return iptvSourceNewSensations }
func (nsNetwork) Label() string  { return nsBrandLabel }

// SessionLive reports whether API Hub holds a NewSensations session cookie.
// This checks cookie presence, not store contents — the store may be empty
// because the scrape has not run yet, which is not the same as "not connected".
func (nsNetwork) SessionLive() bool {
	return nsSessionHasCookie()
}

func (nsNetwork) IsNoSession(err error) bool { return false }

// ─── preparation (iptvNetPreparer) ────────────────────────────────────────────
//
// NewSensations is the second provider (after TeamSkeet) that implements
// iptvNetPreparer. The catalog must be scraped from HTML before channels
// can be built — unlike the Gamma/Aylo providers that have JSON APIs.

// IsWarming reports whether an error means the catalog scrape is still running,
// as opposed to the channel being broken.
func (nsNetwork) IsWarming(err error) bool { return errors.Is(err, errNSWarming) }

// Prepare starts (or continues) the background catalog scrape. Called at the
// top of every warm. Returns immediately; the work runs in its own goroutine.
// Single-flighted: calling it while a scrape is already running is a no-op.
func (nsNetwork) Prepare(ctx context.Context) {
	if nsCatalog.sceneCount() > 0 {
		// SQLite catalog on disk is already populated with series and scenes.
		// Use stored SQLite database as the ground-truth reference without rescraping.
		return
	}
	if !nsSweep.begin() {
		return
	}
	go nsRunSweep(ctx)
}

// PrepNote explains what the scraper is doing, in one sentence for the panel.
func (nsNetwork) PrepNote() string {
	running, phase, seriesDone, seriesTotal, sceneDone, sceneTotal, sceneFailed := nsSweep.progress()

	if running {
		switch phase {
		case "series":
			if seriesTotal > 0 {
				return fmt.Sprintf("Discovering series: %d of %d resolved. NewSensations has no API, so every series is scraped from HTML.", seriesDone, seriesTotal)
			}
			return "Discovering series from the NewSensations catalog. This is a one-time scrape from HTML — no API available."
		case "scenes":
			note := fmt.Sprintf("Scraping scene details: %d of %d.", sceneDone, sceneTotal)
			if sceneFailed > 0 {
				note += fmt.Sprintf(" %d could not be read.", sceneFailed)
			}
			note += " Video URLs and durations are read from each scene page and kept permanently."
			return note
		default:
			return "Starting NewSensations catalog scrape."
		}
	}

	// Not running: report the store's current state.
	seriesCount := nsCatalog.seriesCount()
	sceneCount := nsCatalog.sceneCount()
	if seriesCount > 0 {
		return fmt.Sprintf("%d series, %d scenes in the catalog. Remaining channels are building their schedules.", seriesCount, sceneCount)
	}
	return "Waiting for the catalog scrape to begin."
}

// ─── channel keys ─────────────────────────────────────────────────────────────

func nsChannelKey(id string) string {
	return iptvNSKeyPrefix + id
}

func nsNetworkChannelKey() string {
	return iptvNSKeyPrefix + "-all"
}

// ─── discovery ────────────────────────────────────────────────────────────────

// ListChannels reads all series from the SQLite store and builds the lineup.
// If the store has no series yet, it runs the fast series index scrape (Phase 1)
// so channel specs are populated immediately on first warm.
func (nsNetwork) ListChannels(ctx context.Context, minScenes int) ([]iptvNetChannelSpec, error) {
	stored := nsCatalog.listSeries()
	if len(stored) == 0 && nsSessionHasCookie() {
		var err error
		stored, err = nsScrapeSeriesIndex(ctx)
		if err != nil {
			logger.Warnf("[iptv] NS scraper: failed to scrape series index in ListChannels: %v", err)
			return nil, nil
		}
	}
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
		dur := s.DurationSeconds
		if dur <= 0 {
			dur = 1800 // 30 minutes fallback if scene duration is unpopulated
		}
		sceneEntries = append(sceneEntries, iptv.SceneEntry{
			SceneID:  s.ID,
			Title:    s.Title,
			Duration: dur,
		})
	}

	if len(sceneEntries) == 0 {
		// If no schedulable scenes are stored yet, but a cookie is connected,
		// return errNSWarming. Returning (nil, nil) causes fetchCatalog to treat
		// the channel as dead and drop it from the lineup! Returning errNSWarming
		// keeps it in the lineup as "warming" while the background scraper populates
		// scene details.
		if nsSessionHasCookie() {
			return nil, errNSWarming
		}
		return nil, nil
	}

	iptv.StableShuffle(sceneEntries, iptv.ShuffleSeed(int(seed)))
	return sceneEntries, nil
}

// ─── playback ─────────────────────────────────────────────────────────────────

func isNSVideoURLExpired(urlStr string) bool {
	if urlStr == "" {
		return true
	}
	u, err := url.Parse(urlStr)
	if err != nil {
		return true
	}
	validTo := u.Query().Get("validto")
	if validTo == "" {
		return false
	}
	exp, err := strconv.ParseInt(validTo, 10, 64)
	if err != nil {
		return false
	}
	// Expired if current time is past validto minus 5 minutes buffer (300 seconds)
	return time.Now().Unix() > (exp - 300)
}

// ProgramSource reads the video URL from the SQLite store. If missing, empty,
// or expired (validto timestamp passed), it performs an on-demand single-page
// fetch (gallery.php, ~200ms) using the connected session cookie to get a
// fresh pre-signed video URL at stream playback time.
func (nsNetwork) ProgramSource(ctx context.Context, programID int) (programSource, error) {
	cached := nsCatalog.lookupScene(programID)

	videoURL := ""
	height := 1080

	if cached != nil && cached.VideoURL != "" && !isNSVideoURLExpired(cached.VideoURL) {
		videoURL = cached.VideoURL
		if cached.VideoHeight > 0 {
			height = cached.VideoHeight
		}
	}

	if videoURL == "" && nsSessionHasCookie() {
		logger.Infof("[iptv] NS: fetching fresh pre-signed video URL for scene %d (expired or uncached)", programID)
		fresh, err := nsFetchSingleSceneVideoURL(ctx, programID)
		if err == nil && fresh.VideoURL != "" {
			videoURL = fresh.VideoURL
			if fresh.VideoHeight > 0 {
				height = fresh.VideoHeight
			}
		} else {
			logger.Warnf("[iptv] NS: on-demand fetch for scene %d failed: %v", programID, err)
		}
	}

	if videoURL == "" {
		return programSource{}, fmt.Errorf("scene %d has no playable video URL", programID)
	}

	if height > nsMaxHeight {
		height = nsMaxHeight
	}

	return programSource{
		Path:       videoURL,
		VideoCodec: "h264",
		AudioCodec: "aac",
		Height:     height,
		Remote:     true,
	}, nil
}
