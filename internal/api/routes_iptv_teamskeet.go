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
// until enough of its scenes have been measured. Two things follow.
//
// Prepare sweeps the whole catalog in the background, measuring every scene once
// — that is what actually fills the lineup, and it is done for the provider as a
// whole rather than per channel so that a channel nobody has tuned still gets
// measured. Programs then builds from what the store already knows, measuring a
// bounded few itself only for a channel being built right now.
//
// A channel that still cannot fill a rotation reports errTeamSkeetWarming rather
// than pretending to be empty, which would take it off air for a day; and one
// that can half fill it goes on air at ten programmes and keeps growing.

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
	// for itself in a single pass, so a channel being built cannot monopolise the
	// six request slots this provider gets while the sweep and every other
	// channel wait behind it.
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

// Programs builds one channel's rotation from measured runtimes, measuring a
// bounded few itself for anything still missing.
//
// The sequence matters. Candidates are shuffled with the channel's own stable
// seed *before* anything is measured, so the scenes it spends requests on are
// the ones it would have aired anyway — and so the same channel keeps the same
// rotation across restarts rather than reshuffling into a different set of
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

	// Walk the running order, taking known durations and collecting the rest to
	// measure, until the channel is full or the candidates run out.
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

	// Everything that could be measured was, or the channel is full: a finished
	// answer, cached for the day.
	if len(out) >= want || len(measured) >= len(pending) {
		return out, nil
	}

	// Short, with scenes left unmeasured. Whether that is worth airing depends
	// on how short.
	//
	// Enough for a rotation, so it goes out now and keeps growing — the same
	// threshold that decides whether a collection deserves a channel at all,
	// because it is the same question: is this long enough to feel like a
	// channel rather than a loop. Roughly seven hours of television at ten
	// programmes, which beats an error by a distance.
	if len(out) >= iptvNetMinReleases {
		return out, fmt.Errorf("%w — %d of %d programmes measured so far", errIPTVNetIncomplete, len(out), want)
	}
	// Not enough to air. Reported as warming rather than as an empty schedule,
	// which would read as "nothing to show here" and take the channel off the
	// lineup for a day over what is really a few minutes of arithmetic.
	if len(out) == 0 {
		return nil, errTeamSkeetWarming
	}
	return nil, fmt.Errorf("%w (%d of %d programmes ready)", errTeamSkeetWarming, len(out), want)
}

// ─── preparation, reported ────────────────────────────────────────────────────
//
// TeamSkeet is the only provider that implements iptvNetPreparer, because it is
// the only one with work to do before a channel can exist. See the header.

// IsWarming distinguishes "not ready yet" from "broken", which is the whole
// reason the generic layer cannot make this call itself.
func (teamSkeetNetwork) IsWarming(err error) bool { return errors.Is(err, errTeamSkeetWarming) }

// Prepare starts a sweep of the whole catalog, if one is not already running.
// Returns immediately; the work continues in the background until it is done.
func (teamSkeetNetwork) Prepare(ctx context.Context) {
	if !teamSkeetSweep.begin() {
		return
	}
	go teamSkeetRunSweep(ctx)
}

// teamSkeetRunSweep measures every scene in the catalog that has no runtime yet.
//
// The whole catalog in one list rather than channel by channel. Scenes appear in
// several channels — every one of them is also on the network-wide channel — so
// walking channels would measure the same scene repeatedly, and any channel
// nobody had asked for would never be measured at all. This visits each scene
// exactly once, and its results are what let the schedules build.
func teamSkeetRunSweep(ctx context.Context) {
	var err error
	defer func() { teamSkeetSweep.end(err) }()

	ids, total, err := teamSkeetAllMovieIDs(ctx)
	if err != nil {
		// Not worth a warning: no session is the ordinary state for anyone who
		// has not connected TeamSkeet, and the sweep is retried on the next warm.
		logger.Debugf("[iptv] API Hub: could not list TeamSkeet scenes to measure: %v", err)
		return
	}
	if total > len(ids) {
		logger.Warnf("[iptv] API Hub: TeamSkeet reports %d scenes but only %d fit in one query; the remainder will have no runtimes",
			total, len(ids))
	}

	known := teamSkeetDurations.lookup(ids)
	pending := make([]int, 0, len(ids)-len(known))
	for _, id := range ids {
		if _, ok := known[id]; !ok {
			pending = append(pending, id)
		}
	}

	teamSkeetSweep.setTotal(len(pending))
	if len(pending) == 0 {
		return
	}

	logger.Infof("[iptv] API Hub: measuring %d TeamSkeet scene runtimes (%d already known). This is a one-time cost — runtimes never change, so they are kept for good.",
		len(pending), len(known))

	work := make(chan int)
	var wg sync.WaitGroup
	for i := 0; i < teamSkeetSweepWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for id := range work {
				if ctx.Err() != nil {
					return
				}
				_, ok := teamSkeetMeasureOne(ctx, id)
				teamSkeetSweep.record(ok)
			}
		}()
	}
	for _, id := range pending {
		if ctx.Err() != nil {
			break
		}
		work <- id
	}
	close(work)
	wg.Wait()

	_, done, _, failed := teamSkeetSweep.progress()
	logger.Infof("[iptv] API Hub: measured %d TeamSkeet scene runtimes (%d could not be read); %d known in total",
		done, failed, teamSkeetDurations.count())
}

// teamSkeetMeasureOne measures and stores one scene's runtime.
func teamSkeetMeasureOne(ctx context.Context, id int) (float64, bool) {
	seconds, err := teamSkeetMeasureDuration(ctx, id)
	if err != nil {
		// A lapsed session explains every other failure around it and must not be
		// mistaken for this scene being unmeasurable.
		if !errors.Is(err, errTeamSkeetNoSession) {
			teamSkeetDurations.noteFailure(id)
		}
		logger.Debugf("[iptv] API Hub: could not measure TeamSkeet scene %d: %v", id, err)
		return 0, false
	}

	if err := teamSkeetDurations.record(id, seconds); err != nil {
		// Worth a line: without the store this still works but re-measures the
		// same scenes on every sweep, which is the expensive failure.
		logger.Warnf("[iptv] API Hub: could not cache TeamSkeet duration for scene %d: %v", id, err)
	}
	return seconds, true
}

// PrepNote explains what the lineup is waiting on, in one sentence for the panel.
//
// It reports the sweep's own progress rather than the size of the store, because
// a total that only ever creeps up by a fraction of a percent reads as a stall.
// "1,204 of 8,772 scenes" moves visibly and answers the actual question.
func (teamSkeetNetwork) PrepNote() string {
	running, done, total, failed := teamSkeetSweep.progress()

	const why = "TeamSkeet publishes no runtimes, so each is read from the scene's own manifest and kept for good."

	if running && total > 0 {
		note := fmt.Sprintf("Measuring scene runtimes: %d of %d. %s", done, total, why)
		if failed > 0 {
			note += fmt.Sprintf(" %d could not be read and are left out.", failed)
		}
		return note
	}
	if running {
		return "Looking up which TeamSkeet scenes still need a runtime measured. " + why
	}
	// Not sweeping: every runtime is known and the remaining channels are simply
	// waiting their turn to have a schedule built, which is quick.
	return fmt.Sprintf("%d scene runtimes measured. Remaining channels are building their schedules.",
		teamSkeetDurations.count())
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

// teamSkeetMeasureBatch measures the given scenes and returns what it learned,
// recording each result so it is never measured again.
//
// This is the impatient path, for a channel being built right now — the sweep is
// what measures the catalog as a whole. It stops at `need`: a channel asked to
// fill 50 slots that already has 40 should not measure 60 more scenes just
// because they were pending.
func teamSkeetMeasureBatch(ctx context.Context, ids []int, need int) map[int]float64 {
	if need <= 0 || len(ids) == 0 {
		return nil
	}

	// Capped per channel so one long series cannot monopolise the six request
	// slots this provider gets while every other channel waits behind it.
	limit := need
	if limit > teamSkeetPerChannelMeasure {
		limit = teamSkeetPerChannelMeasure
	}
	if limit < len(ids) {
		ids = ids[:limit]
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
			seconds, ok := teamSkeetMeasureOne(ctx, id)
			if !ok {
				return
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
