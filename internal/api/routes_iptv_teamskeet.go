package api

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"

	"github.com/stashapp/stash/pkg/iptv"
	"github.com/stashapp/stash/pkg/logger"
)

// TeamSkeet as network channels.
//
// One implementation of iptvNetwork; routes_iptv_network.go owns everything
// generic. The lineup is one network-wide channel plus one per series the account
// is entitled to — 138 channels over ~9,900 scenes.
//
// Two things make this provider unlike the other three, both explained at length
// in apihub_teamskeet_catalog.go:
//
//  1. It mints its own access token, because Reptyle's 30-minute tokens are
//     always expired by the time a channel wants one — and it is safe to,
//     because the refresh call was measured not to rotate the refresh token.
//  2. Nothing in the catalog carries a duration, so each scene's runtime is
//     measured from its DASH manifest and cached permanently.
//
// The second one leaks into this file, because a channel cannot be scheduled
// until enough of its scenes have been measured. Rather than pretending an
// unmeasured channel is empty — which would take it off air for a day — Programs
// reports errTeamSkeetWarming, which the generic layer retries on its short
// backoff. The practical effect is a lineup that grows over the first couple of
// hours and is then stable.

const (
	iptvSourceTeamSkeet = "teamskeet"

	// iptvTeamSkeetKeyPrefix namespaces these channel ids away from studio ids
	// and from the other providers', so they can all share one route.
	iptvTeamSkeetKeyPrefix = "ts-"

	// teamSkeetBrandSlug and teamSkeetBrandLabel put every TeamSkeet channel in
	// one folder on the TV.
	teamSkeetBrandSlug  = "teamskeet"
	teamSkeetBrandLabel = "TeamSkeet"

	// teamSkeetCandidateLimit bounds how much of a series is pulled to sample
	// from. The largest series is 589 movies, so this takes the whole history in
	// practice while keeping one pathological series from dominating a warm.
	teamSkeetCandidateLimit = 1000

	// teamSkeetPerChannelMeasure caps how many durations one channel may measure
	// in a single pass, so an early channel cannot swallow the whole budget and
	// starve every later one of any progress at all.
	teamSkeetPerChannelMeasure = 60
)

// teamSkeetNetwork implements iptvNetwork.
type teamSkeetNetwork struct{}

func (teamSkeetNetwork) Source() string { return iptvSourceTeamSkeet }
func (teamSkeetNetwork) Label() string  { return teamSkeetBrandLabel }

func (teamSkeetNetwork) SessionLive() bool { return teamSkeetSessionLive() }

func (teamSkeetNetwork) IsNoSession(err error) bool { return errors.Is(err, errTeamSkeetNoSession) }

// ─── channel keys ─────────────────────────────────────────────────────────────

// teamSkeetChannelKey derives a stable URL id for a series.
//
// A series document does carry a numeric id, but the *movie* side joins on
// `site.siteName` — the name — so the name is the real identity here and the key
// follows it. Slugged, with the same rename caveat as the Gamma providers.
func teamSkeetChannelKey(name string) string {
	return iptvTeamSkeetKeyPrefix + gammaSlug(name)
}

// teamSkeetNetworkChannelKey names the network-wide channel. The doubled dash is
// load-bearing for the same reason as the other providers' — see
// adultTimeNetworkChannelKey.
func teamSkeetNetworkChannelKey() string {
	return iptvTeamSkeetKeyPrefix + "-all"
}

// ─── discovery ────────────────────────────────────────────────────────────────

// ListChannels returns the network-wide channel plus every entitled series big
// enough to sustain a rotation.
//
// Cheap, unlike the schedules: a series document carries its own movieCount, so
// this is two requests for the whole lineup regardless of how many series there
// are.
func (teamSkeetNetwork) ListChannels(ctx context.Context, minScenes int) ([]iptvNetChannelSpec, error) {
	series, total, err := teamSkeetListSeries(ctx)
	if err != nil {
		return nil, err
	}

	values := make([]gammaFacetValue, 0, len(series))
	for _, s := range series {
		values = append(values, gammaFacetValue{Name: s.Name, Count: s.MovieCount})
	}
	// Two series slugging to one key would mean the second's schedule silently
	// overwriting the first's — same hazard, same fix as the Gamma providers.
	values, dropped := gammaUniqueBySlug(values)
	for _, d := range dropped {
		logger.Debugf("[iptv] API Hub: TeamSkeet series %q shares a channel id with an earlier one; its scenes air on the network-wide channel", d.Name)
	}

	specs := make([]iptvNetChannelSpec, 0, len(values)+1)
	if total >= minScenes {
		specs = append(specs, teamSkeetSpec(iptvNetChannelSpec{
			Key:        teamSkeetNetworkChannelKey(),
			Name:       teamSkeetBrandLabel + " (All)",
			SceneCount: total,
		}))
	}
	for _, v := range values {
		if v.Count < minScenes {
			continue
		}
		specs = append(specs, teamSkeetSpec(iptvNetChannelSpec{
			Key:        teamSkeetChannelKey(v.Name),
			Name:       v.Name,
			Collection: v.Name,
			SceneCount: v.Count,
		}))
	}

	return specs, nil
}

// teamSkeetSpec stamps the fields every TeamSkeet spec shares.
func teamSkeetSpec(spec iptvNetChannelSpec) iptvNetChannelSpec {
	spec.Source = iptvSourceTeamSkeet
	spec.BrandSlug = teamSkeetBrandSlug
	spec.BrandLabel = teamSkeetBrandLabel
	spec.TvgID = "vexxx-apihub-" + spec.Key
	return spec
}

// ─── programmes ───────────────────────────────────────────────────────────────

// Programs builds one channel's rotation, measuring durations as the budget
// allows.
//
// The sequence matters. Candidates are shuffled with the channel's own stable
// seed *before* anything is measured, so the scenes a channel spends its budget
// on are the ones it would have aired anyway — and so the same channel keeps the
// same rotation across restarts rather than reshuffling into a different set of
// already-measured scenes.
func (teamSkeetNetwork) Programs(ctx context.Context, spec iptvNetChannelSpec, want int, seed uint64) ([]iptv.SceneEntry, error) {
	if spec.Source != iptvSourceTeamSkeet {
		return nil, fmt.Errorf("spec %q is not a TeamSkeet channel", spec.Key)
	}

	candidates, err := teamSkeetListMovies(ctx, spec.Collection, teamSkeetCandidateLimit)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		// A real answer: the series has nothing released and entitled in it, so
		// the channel is dropped rather than retried.
		return nil, nil
	}

	// Shuffle by the same seed the schedule will use, so measuring follows the
	// running order instead of the catalog's.
	entries := make([]iptv.SceneEntry, 0, len(candidates))
	byID := make(map[int]teamSkeetMovie, len(candidates))
	for _, m := range candidates {
		byID[m.ID] = m
		entries = append(entries, iptv.SceneEntry{SceneID: m.ID})
	}
	iptv.StableShuffle(entries, iptv.ShuffleSeed(int(seed)))

	ids := make([]int, 0, len(entries))
	for _, e := range entries {
		ids = append(ids, e.SceneID)
	}
	known := teamSkeetDurations.lookup(ids)

	// Walk the running order, taking known durations and measuring the rest until
	// the channel is full, the candidates run out, or the budget does.
	var (
		out     []iptv.SceneEntry
		pending []int
	)
	for _, id := range ids {
		if len(out) >= want {
			break
		}
		if seconds, ok := known[id]; ok {
			if seconds >= float64(iptv.SegmentSeconds) {
				out = append(out, teamSkeetEntry(byID[id], seconds))
			}
			continue
		}
		if teamSkeetDurations.recentlyFailed(id) {
			continue
		}
		pending = append(pending, id)
	}

	if len(out) >= want || len(pending) == 0 {
		return out, nil
	}

	measured := teamSkeetMeasureBatch(ctx, pending, want-len(out))
	for _, id := range ids {
		if len(out) >= want {
			break
		}
		if _, alreadyUsed := known[id]; alreadyUsed {
			continue
		}
		if seconds, ok := measured[id]; ok && seconds >= float64(iptv.SegmentSeconds) {
			out = append(out, teamSkeetEntry(byID[id], seconds))
		}
	}

	// Still short, with scenes left unmeasured: report warming rather than
	// handing back a thin rotation that would then be cached for a day.
	if len(out) < want && len(measured) < len(pending) {
		if len(out) == 0 {
			return nil, errTeamSkeetWarming
		}
		return nil, fmt.Errorf("%w (%d of %d programmes ready)", errTeamSkeetWarming, len(out), want)
	}
	return out, nil
}

// teamSkeetEntry builds one schedule entry. The description is HTML in the
// catalog, and this ends up in an XMLTV <desc>, so the markup is stripped rather
// than escaped into the guide.
func teamSkeetEntry(m teamSkeetMovie, seconds float64) iptv.SceneEntry {
	return iptv.SceneEntry{
		SceneID:  m.ID,
		Title:    m.Title,
		Details:  teamSkeetPlainText(m.Description),
		Date:     m.ReleaseDate(),
		Duration: seconds,
	}
}

var teamSkeetTagRe = regexp.MustCompile(`<[^>]*>`)

var teamSkeetEntities = strings.NewReplacer(
	"&nbsp;", " ", "&amp;", "&", "&lt;", "<", "&gt;", ">",
	"&quot;", `"`, "&#39;", "'", "&rsquo;", "'", "&ldquo;", `"`, "&rdquo;", `"`,
)

func teamSkeetPlainText(html string) string {
	if html == "" {
		return ""
	}
	text := teamSkeetTagRe.ReplaceAllString(html, " ")
	text = teamSkeetEntities.Replace(text)
	return strings.Join(strings.Fields(text), " ")
}

// teamSkeetMeasureBatch measures as many of the given scenes as the budget allows
// and returns what it learned, recording each result so it is never measured
// again.
//
// It stops early once `need` durations are in hand: a channel asked to fill 50
// slots that already has 40 should not measure 60 more scenes just because they
// were pending.
func teamSkeetMeasureBatch(ctx context.Context, ids []int, need int) map[int]float64 {
	if need <= 0 || len(ids) == 0 {
		return nil
	}

	budget := need
	if budget > teamSkeetPerChannelMeasure {
		budget = teamSkeetPerChannelMeasure
	}
	granted := teamSkeetBudget.take(budget)
	if granted == 0 {
		return nil
	}
	if granted < len(ids) {
		ids = ids[:granted]
	}

	var (
		mu  sync.Mutex
		out = make(map[int]float64, len(ids))
		wg  sync.WaitGroup
	)

	// The catalog client's own semaphore bounds the actual request concurrency;
	// this only decides how many are offered to it at once.
	for _, id := range ids {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			if ctx.Err() != nil {
				return
			}

			seconds, err := teamSkeetMeasureDuration(ctx, id)
			if err != nil {
				// A lapsed session explains every other failure in the batch and
				// must not be mistaken for this scene being unmeasurable, so it is
				// not written to the failure cooldown.
				if !errors.Is(err, errTeamSkeetNoSession) {
					teamSkeetDurations.noteFailure(id)
				}
				logger.Debugf("[iptv] API Hub: could not measure TeamSkeet scene %d: %v", id, err)
				return
			}

			if err := teamSkeetDurations.record(id, seconds); err != nil {
				// Worth a line: without the store this works but re-measures the
				// same scenes on every refresh, which is the expensive failure.
				logger.Warnf("[iptv] API Hub: could not cache TeamSkeet duration for scene %d: %v", id, err)
			}

			mu.Lock()
			out[id] = seconds
			mu.Unlock()
		}(id)
	}
	wg.Wait()

	return out
}

// ─── playback ─────────────────────────────────────────────────────────────────

// ProgramSource resolves a scene to something ffmpeg can open right now. Live on
// every programme boundary: the CacheFly URLs are signed with an expiry a few
// hours out, so they are never held in a schedule.
func (teamSkeetNetwork) ProgramSource(ctx context.Context, movieID int) (programSource, error) {
	watch, err := teamSkeetGetWatch(ctx, movieID)
	if err != nil {
		return programSource{}, err
	}

	url, height := teamSkeetProgressiveURL(watch)
	if url == "" {
		// vp9/av1 exist for some scenes but both would need a re-encode to reach
		// MPEG-TS, which for a remote source costs a download *and* a transcode
		// per viewer. Refusing loses the slot; accepting would cost far more.
		return programSource{}, fmt.Errorf("movie %d has no AVC rendition to remux", movieID)
	}

	return programSource{
		Path: url,
		// Both confirmed by ffprobe against the real files, on a modern and an
		// archive release: h264 video, AAC audio. Naming them lets ChooseMode pick
		// a straight remux without probing the stream first.
		VideoCodec: "h264",
		AudioCodec: "aac",
		Height:     height,
		Remote:     true,
	}, nil
}
