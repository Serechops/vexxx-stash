package api

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/stashapp/stash/pkg/iptv"
	"github.com/stashapp/stash/pkg/logger"
)

// Aylo (Brazzers, Bang Bros, Reality Kings) as network channels.
//
// This is one implementation of iptvNetwork; routes_iptv_network.go owns
// everything generic — caching, retry policy, warming, when a channel leaves
// the lineup. What lives here is only what is true of Aylo specifically.
//
// A brand is not one channel but many. Each brand's child studios (Bang Bus,
// Brazzers Exxtra, RK Prime …) become channels in their own right, alongside a
// brand-wide channel — a little over a hundred channels across the three
// brands, covering some 34,000 scenes. That scale is what drives the caching in
// routes_iptv_network.go.
//
// Authentication is entirely API Hub's. Nothing here mints, refreshes or stores
// a credential; it reads the session API Hub already holds and disappears from
// the lineup when there isn't one. See apihub_aylo_catalog.go.

const (
	iptvSourceLibrary = "library"
	iptvSourceAylo    = "aylo"

	// iptvAyloKeyPrefix namespaces network channel ids away from studio ids so
	// the two can share one route. Studio channels keep their bare numeric id,
	// which matters: a client that already has the playlist configured keeps
	// working across this change.
	iptvAyloKeyPrefix = "aylo-"
)

// ayloNetwork implements iptvNetwork.
type ayloNetwork struct{}

func (ayloNetwork) Source() string { return iptvSourceAylo }
func (ayloNetwork) Label() string  { return "Aylo" }

func (ayloNetwork) SessionLive() bool { return ayloSessionLive() }

func (ayloNetwork) IsNoSession(err error) bool { return errors.Is(err, errAyloNoSession) }

// ─── channel keys ─────────────────────────────────────────────────────────────

// ayloBrandChannelKey and ayloCollectionChannelKey derive stable URL ids.
//
// The collection id is used rather than a slug of its name, because a channel
// id appears in playlists a TV has already stored: a studio renamed upstream
// must not silently become a different channel.
func ayloBrandChannelKey(brandSlug string) string {
	return iptvAyloKeyPrefix + brandSlug
}

func ayloCollectionChannelKey(brandSlug string, collectionID int) string {
	return iptvAyloKeyPrefix + brandSlug + "-" + strconv.Itoa(collectionID)
}

// ayloSelectorFor rebuilds the catalog selector a spec names.
func ayloSelectorFor(spec iptvNetChannelSpec) (ayloSelector, bool) {
	brand, ok := ayloBrandBySlug(spec.BrandSlug)
	if !ok {
		return ayloSelector{}, false
	}
	return ayloSelector{brand: brand, collectionID: spec.CollectionID}, true
}

// ─── discovery ────────────────────────────────────────────────────────────────

// ListChannels discovers the lineup: every entitled brand, plus every child
// collection big enough to be worth a channel.
func (ayloNetwork) ListChannels(ctx context.Context, minScenes int) ([]iptvNetChannelSpec, error) {
	brands := ayloEntitledBrands()
	if len(brands) == 0 {
		return nil, nil
	}

	type brandResult struct {
		collections []ayloCollection
		total       int
		err         error
	}
	results := make([]brandResult, len(brands))

	var wg sync.WaitGroup
	for i, b := range brands {
		wg.Add(1)
		go func(i int, b ayloBrand) {
			defer wg.Done()
			cols, err := ayloListCollections(ctx, b)
			if err != nil {
				results[i].err = err
				return
			}
			total, err := ayloCountReleases(ctx, ayloSelector{brand: b})
			results[i] = brandResult{collections: cols, total: total, err: err}
		}(i, b)
	}
	wg.Wait()

	// Sizing every collection is the bulk of the work — one small request each,
	// bounded so a hundred-odd of them do not arrive as a burst.
	type sized struct {
		brand ayloBrand
		col   ayloCollection
		count int
	}
	var (
		jobs []sized
		mu   sync.Mutex
	)
	for i, b := range brands {
		if results[i].err != nil {
			logger.Warnf("[iptv] API Hub: could not list %s studios: %v", b.Label, results[i].err)
			continue
		}
		for _, col := range results[i].collections {
			wg.Add(1)
			go func(b ayloBrand, col ayloCollection) {
				defer wg.Done()
				ayloAcquireFetch()
				defer ayloReleaseFetch()

				n, err := ayloCountReleases(ctx, ayloSelector{brand: b, collectionID: col.ID})
				if err != nil {
					// Transient at this concurrency in practice; the studio is
					// simply left out until the next refresh.
					logger.Debugf("[iptv] API Hub: sizing %s / %s failed: %v", b.Label, col.Name, err)
					return
				}
				mu.Lock()
				jobs = append(jobs, sized{brand: b, col: col, count: n})
				mu.Unlock()
			}(b, col)
		}
	}
	wg.Wait()

	specs := make([]iptvNetChannelSpec, 0, len(jobs)+len(brands))
	for i, b := range brands {
		if results[i].err != nil || results[i].total < minScenes {
			continue
		}
		specs = append(specs, ayloSpec(iptvNetChannelSpec{
			Key:        ayloBrandChannelKey(b.Slug),
			BrandSlug:  b.Slug,
			BrandLabel: b.Label,
			// The brand-wide channel is explicitly labelled so it does not read
			// as just another studio in a list of its own children.
			Name:       b.Label + " (All)",
			SceneCount: results[i].total,
		}))
	}
	for _, j := range jobs {
		if j.count < minScenes {
			continue
		}
		specs = append(specs, ayloSpec(iptvNetChannelSpec{
			Key:          ayloCollectionChannelKey(j.brand.Slug, j.col.ID),
			BrandSlug:    j.brand.Slug,
			BrandLabel:   j.brand.Label,
			Name:         j.col.Name,
			CollectionID: j.col.ID,
			SceneCount:   j.count,
		}))
	}

	// Ordered by brand, then the brand-wide channel, then studios by name, so
	// channel numbers are stable across refreshes and read sensibly on a TV.
	sort.SliceStable(specs, func(i, j int) bool {
		a, b := specs[i], specs[j]
		if a.BrandSlug != b.BrandSlug {
			return a.BrandSlug < b.BrandSlug
		}
		if (a.CollectionID == 0) != (b.CollectionID == 0) {
			return a.CollectionID == 0
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})

	return specs, nil
}

// ayloSpec stamps the fields every Aylo spec shares. The tvg id keeps its
// historical shape (the key without the source prefix) — a TV binds its guide
// to that string, so it must not drift.
func ayloSpec(spec iptvNetChannelSpec) iptvNetChannelSpec {
	spec.Source = iptvSourceAylo
	spec.TvgID = "vexxx-apihub-" + strings.TrimPrefix(spec.Key, iptvAyloKeyPrefix)
	return spec
}

// ─── programmes ───────────────────────────────────────────────────────────────

// Programs samples one channel's schedulable releases.
//
// The order is shuffled with the same stable per-channel seed library channels
// use, so a network channel is a rotation rather than a run through the catalog
// in date order — and the same one after a restart.
func (ayloNetwork) Programs(ctx context.Context, spec iptvNetChannelSpec, want int, seed uint64) ([]iptv.SceneEntry, error) {
	sel, ok := ayloSelectorFor(spec)
	if !ok {
		return nil, fmt.Errorf("unknown API Hub brand %q", spec.BrandSlug)
	}

	releases, _, err := ayloSampleReleases(ctx, sel, want, seed, ayloUsable)
	if err != nil {
		return nil, err
	}

	entries := make([]iptv.SceneEntry, 0, len(releases))
	for i := range releases {
		r := &releases[i]
		if !ayloUsable(r) {
			continue
		}
		entries = append(entries, iptv.SceneEntry{
			SceneID:  r.ID,
			Title:    r.Title,
			Details:  r.Description,
			Date:     r.ReleaseDate(),
			Duration: r.DurationSeconds(),
		})
	}

	iptv.StableShuffle(entries, iptv.ShuffleSeed(int(seed)))
	return entries, nil
}

// ayloUsable reports whether a release can air. A missing duration makes it
// unschedulable, and a rendition ffmpeg would have to re-encode is rejected
// outright rather than aired expensively — for a remote source that would mean
// downloading the whole stream *and* paying for an encode, per viewer.
//
// Releases whose listing carries no renditions at all are kept: list responses
// do not always populate `videos.full.files`, and the per-programme fetch will
// resolve (or reject) it properly at play time.
func ayloUsable(r *ayloRelease) bool {
	if r.DurationSeconds() < float64(iptv.SegmentSeconds) {
		return false
	}
	if len(r.Videos.Full.files()) == 0 {
		return true
	}
	stream, ok := ayloPickStream(r)
	return ok && ayloCopyable(stream.Codec)
}

// ayloCopyable reports whether a codec can be remuxed into MPEG-TS as-is.
func ayloCopyable(codec string) bool {
	return iptv.ChooseMode(codec, "") == iptv.ModeCopy
}

// ─── playback ─────────────────────────────────────────────────────────────────

// ProgramSource resolves a release to something ffmpeg can open right now.
//
// This is a live API call on every programme boundary, which is the price of a
// signed URL: the one in the cached catalog expired long ago. It is also why a
// network channel can fail where a library channel cannot, and why the caller
// treats a failure as a lost slot rather than a broken channel.
func (ayloNetwork) ProgramSource(ctx context.Context, releaseID int) (programSource, error) {
	release, err := ayloGetRelease(ctx, releaseID)
	if err != nil {
		return programSource{}, err
	}

	stream, ok := ayloPickStream(release)
	if !ok {
		return programSource{}, fmt.Errorf("release %d has no playable rendition (session may have lapsed)", releaseID)
	}
	if !ayloCopyable(stream.Codec) {
		// Filtered at schedule time too, but a rendition set can change between
		// the listing and now — and re-encoding a remote stream is expensive
		// enough to be worth refusing twice.
		return programSource{}, fmt.Errorf("release %d is %s, which would need a re-encode", releaseID, stream.Codec)
	}

	return programSource{
		Path:       stream.URL,
		VideoCodec: stream.Codec,
		// Left empty on purpose: the API does not report an audio codec, and
		// ChooseMode reads empty as "no audio track", which remuxes. Combined
		// with ffmpeg's optional `-map 0:a:0?` that copies the AAC track when
		// there is one and stays silent when there is not — either way no
		// re-encode, which a guessed codec could have triggered.
		AudioCodec: "",
		Height:     stream.Height,
		Remote:     true,
	}, nil
}
