package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/logger"
)

// Read-only Aylo catalog access for server-side consumers that have no browser
// in the loop — currently the IPTV channels (see routes_iptv_apihub.go).
//
// This deliberately does NOT authenticate, mint, refresh or store anything. It
// borrows whatever session API Hub already holds and does nothing else:
//
//   - tokens come from the apihub plugin config via loadAyloAccountTokens()
//   - apihub_aylo_renew_scheduler.go remains their sole owner and only renewer
//   - when there is no live session, callers get errAyloNoSession and are
//     expected to degrade (drop the channels) rather than prompt for anything
//
// That last point is a correctness requirement, not tidiness. The Aylo refresh
// token is single-use and rotating: if this file ever renewed, it and the
// scheduler would both consume the same token and each would invalidate the
// other, surfacing as spurious "session expired" errors. Reading only is what
// makes a second consumer safe.
const (
	ayloAPIBase = "https://site-api.project1service.com"

	// The catalog is only read to build a schedule, so a stale page costs
	// nothing worse than a channel not yet knowing about this morning's
	// release. Kept well above the IPTV cycle TTL so a channel rebuild does not
	// imply a network round-trip.
	//
	// A day, not an hour, because listings cannot be trimmed: v2/releases has no
	// field selection (`fields` answers 500), so every scene costs ~53KB of wire
	// whether or not anything but its id, title and duration is wanted. Across a
	// hundred-odd collection channels that is the difference between a few
	// hundred MB a day and several GB. A 24/7 channel does not need its schedule
	// fresher than daily.
	ayloCatalogTTL = 24 * time.Hour

	ayloHTTPTimeout = 25 * time.Second

	// v2/releases caps a page well below this; requesting more just returns the
	// cap, so this is only a guard against an unbounded loop.
	ayloMaxPageSize = 100

	// ayloSamplePageSize is the page used when drawing a channel's programmes
	// out of a large collection. It matches the site's own paging, and small
	// pages are what make a spread sample affordable — the cost of reaching into
	// four different eras of a catalog is four small reads, not one huge one.
	ayloSamplePageSize = 25

	// ayloFetchConcurrency bounds parallel catalog reads. Measured: at 12 a
	// small fraction of requests fail transiently (3 of 132 in one run, all fine
	// on retry), so this sits below that and callers still tolerate a failure.
	// Measured again at 16 with no throttling and flat latency, so the ceiling is
	// comfort rather than a limit the API imposes.
	ayloFetchConcurrency = 8

	// Plugin-config key holding the JSON array of entitled brand keys, written
	// by the plugin's persistEntitlementsToServer.
	ayloEntitlementsKey = "ayloEntitlements"
)

// errAyloNoSession means API Hub holds no usable Aylo session right now. It is
// an expected state (nobody has connected, or the session lapsed while the
// server was down), not a failure worth logging loudly.
var errAyloNoSession = errors.New("no live Aylo session in API Hub")

// ─── brands ───────────────────────────────────────────────────────────────────

// ayloBrand mirrors the plugin's aylo/brands.ts registry. The API is one JSON
// backend multiplexed across brands by a numeric groupId, so a brand is little
// more than that number plus display text.
type ayloBrand struct {
	Key     string // storage identity, e.g. "aylo:brazzers"
	Slug    string // URL-safe, e.g. "brazzers"
	Label   string
	GroupID int
}

var ayloBrands = []ayloBrand{
	{Key: "aylo:brazzers", Slug: "brazzers", Label: "Brazzers", GroupID: 5},
	{Key: "aylo:realitykings", Slug: "realitykings", Label: "Reality Kings", GroupID: 195},
	{Key: "aylo:bangbros", Slug: "bangbros", Label: "BangBros", GroupID: 10141},
}

func ayloBrandBySlug(slug string) (ayloBrand, bool) {
	for _, b := range ayloBrands {
		if b.Slug == slug {
			return b, true
		}
	}
	return ayloBrand{}, false
}

// ayloEntitledBrands returns the brands the connected account can actually play,
// as detected by the plugin and stored in its config. An absent or unparsable
// list means "unknown", which yields every brand: the catalog call itself will
// return nothing for a library the account cannot see, so guessing wide only
// risks an empty channel, while guessing narrow would hide working ones.
func ayloEntitledBrands() []ayloBrand {
	pc := config.GetInstance().GetPluginConfiguration(ayloRenewPluginID)
	if pc == nil {
		return ayloBrands
	}

	raw, ok := pc[ayloEntitlementsKey].(string)
	if !ok || strings.TrimSpace(raw) == "" {
		return ayloBrands
	}

	var keys []string
	if err := json.Unmarshal([]byte(raw), &keys); err != nil || len(keys) == 0 {
		return ayloBrands
	}

	allowed := make(map[string]bool, len(keys))
	for _, k := range keys {
		allowed[k] = true
	}

	out := make([]ayloBrand, 0, len(ayloBrands))
	for _, b := range ayloBrands {
		if allowed[b.Key] {
			out = append(out, b)
		}
	}
	return out
}

// ─── wire model ───────────────────────────────────────────────────────────────

type ayloVideoFile struct {
	Type   string `json:"type"`  // "hls" | "http"
	Codec  string `json:"codec"` // "h264" | "av1"
	Format string `json:"format"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Label  string `json:"label"`
	URLs   struct {
		View string `json:"view"`
	} `json:"urls"`
}

// ayloVideoTrack carries the scene's duration and its renditions. `files` is an
// array for full scenes but a resolution-keyed object for preview tracks, so it
// is decoded lazily by files().
type ayloVideoTrack struct {
	Length float64         `json:"length"` // seconds
	Files  json.RawMessage `json:"files"`
}

// files normalises the two shapes `files` arrives in. Both are decoded
// best-effort: a rendition list that will not parse yields no playable source,
// which the caller already has to handle.
func (t *ayloVideoTrack) files() []ayloVideoFile {
	if t == nil || len(t.Files) == 0 {
		return nil
	}

	var asArray []ayloVideoFile
	if err := json.Unmarshal(t.Files, &asArray); err == nil {
		return asArray
	}

	var asMap map[string]ayloVideoFile
	if err := json.Unmarshal(t.Files, &asMap); err != nil {
		return nil
	}

	// Map iteration order is random and the ranking below must be a total order
	// for a schedule to be reproducible, so sort by key first.
	keys := make([]string, 0, len(asMap))
	for k := range asMap {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	out := make([]ayloVideoFile, 0, len(asMap))
	for _, k := range keys {
		out = append(out, asMap[k])
	}
	return out
}

type ayloRelease struct {
	ID           int    `json:"id"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	DateReleased string `json:"dateReleased"`
	Videos       struct {
		Full *ayloVideoTrack `json:"full"`
	} `json:"videos"`
	Collections []struct {
		Name string `json:"name"`
	} `json:"collections"`
}

// DurationSeconds is the full track's length, or 0 when the API omits it.
func (r *ayloRelease) DurationSeconds() float64 {
	if r == nil || r.Videos.Full == nil {
		return 0
	}
	return r.Videos.Full.Length
}

// ReleaseDate normalises dateReleased to the YYYY-MM-DD the guide wants. The
// field arrives as a full RFC3339 timestamp; anything unrecognised is dropped
// rather than passed through, since a malformed date breaks XMLTV parsing in
// some clients.
func (r *ayloRelease) ReleaseDate() string {
	if r == nil || r.DateReleased == "" {
		return ""
	}
	if len(r.DateReleased) >= 10 {
		if _, err := time.Parse("2006-01-02", r.DateReleased[:10]); err == nil {
			return r.DateReleased[:10]
		}
	}
	return ""
}

// ─── stream selection ─────────────────────────────────────────────────────────

// ayloStream is a resolved, ready-to-play rendition.
type ayloStream struct {
	URL    string
	Codec  string
	Height int
	IsHLS  bool
}

// ayloPickStream chooses the rendition to air, mirroring the plugin's
// pickPlaybackSource ranking: h264 first, then progressive http over HLS, then
// the tallest.
//
// h264 leads for a reason that matters more here than in the browser. A
// rendition ffmpeg can copy costs a few percent of a core; anything else has to
// be decoded and re-encoded, and for a remote source that means pulling the
// whole stream down *and* paying for an encode. AV1 is therefore rejected
// outright by the caller rather than aired expensively.
//
// http-over-hls is a preference, not a requirement: in practice the `full`
// track is HLS-only (the plugin notes this on mediabookPreviewUrl), and ffmpeg
// remuxes HLS into MPEG-TS just as cheaply. Keeping the preference costs
// nothing and picks the simpler input up whenever one exists.
func ayloPickStream(r *ayloRelease) (ayloStream, bool) {
	if r == nil || r.Videos.Full == nil {
		return ayloStream{}, false
	}

	type ranked struct {
		f    ayloVideoFile
		rank [3]int
	}

	var candidates []ranked
	for _, f := range r.Videos.Full.files() {
		if f.Type != "http" && f.Type != "hls" {
			continue
		}
		if strings.TrimSpace(f.URLs.View) == "" {
			continue
		}
		candidates = append(candidates, ranked{
			f: f,
			rank: [3]int{
				boolRank(strings.EqualFold(f.Codec, "h264")),
				boolRank(f.Type == "http"),
				f.Height,
			},
		})
	}
	if len(candidates) == 0 {
		return ayloStream{}, false
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		a, b := candidates[i].rank, candidates[j].rank
		for k := range a {
			if a[k] != b[k] {
				return a[k] > b[k]
			}
		}
		return false
	})

	best := candidates[0].f
	return ayloStream{
		URL:    best.URLs.View,
		Codec:  strings.ToLower(best.Codec),
		Height: best.Height,
		IsHLS:  best.Type == "hls",
	}, true
}

func boolRank(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ─── authenticated GET ────────────────────────────────────────────────────────

// ayloSession returns the tokens API Hub currently holds, refusing any that have
// already lapsed. It never renews — see the file header.
func ayloSession() (ayloTokenSet, error) {
	ts, ok := loadAyloAccountTokens()
	if !ok || ts.Access == "" || ts.Instance == "" {
		return ayloTokenSet{}, errAyloNoSession
	}

	now := time.Now().UnixMilli()
	if ts.AccessExpiresAt > 0 && ts.AccessExpiresAt <= now {
		return ayloTokenSet{}, fmt.Errorf("%w: access token expired", errAyloNoSession)
	}
	if ts.InstanceExpiresAt > 0 && ts.InstanceExpiresAt <= now {
		return ayloTokenSet{}, fmt.Errorf("%w: instance token expired", errAyloNoSession)
	}

	return ts, nil
}

// ayloSessionLive reports whether API Hub currently holds a usable session. It
// only reads config, so it is cheap enough to call on a cache-hit path.
func ayloSessionLive() bool {
	_, err := ayloSession()
	return err == nil
}

var ayloHTTPClient = &http.Client{Timeout: ayloHTTPTimeout}

// ayloFetchSem bounds catalog reads process-wide rather than per call site.
// A warm builds several channel schedules at once and each of those reads
// several pages, so a per-call limit multiplies out — 8 channels of 8 pages is
// 64 requests in flight, not 8. One shared semaphore makes the real number of
// concurrent requests the number that was actually measured as safe.
var ayloFetchSem = make(chan struct{}, ayloFetchConcurrency)

func ayloAcquireFetch() { ayloFetchSem <- struct{}{} }
func ayloReleaseFetch() { <-ayloFetchSem }

// ayloGet performs an authenticated catalog GET and decodes the JSON body.
//
// There is no retry-on-401 here, deliberately. The browser client retries by
// renewing, which this must not do; a 401 means the scheduler's next tick will
// fix it within its interval, and until then the honest answer is "no session".
func ayloGet(ctx context.Context, path string, q url.Values, out interface{}) error {
	ts, err := ayloSession()
	if err != nil {
		return err
	}

	u := fmt.Sprintf("%s/%s", ayloAPIBase, strings.TrimPrefix(path, "/"))
	if len(q) > 0 {
		u += "?" + q.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", ts.Access)
	req.Header.Set("Instance", ts.Instance)

	res, err := ayloHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	if res.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("%w: catalog rejected the stored access token", errAyloNoSession)
	}
	if res.StatusCode == http.StatusBadRequest {
		// The API answers 400 (not 401) when the instance token has lapsed.
		body, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		if strings.Contains(strings.ToLower(string(body)), "instance token") {
			return fmt.Errorf("%w: instance token no longer valid", errAyloNoSession)
		}
		return fmt.Errorf("aylo %s: HTTP 400: %s", path, strings.TrimSpace(string(body)))
	}
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("aylo %s: HTTP %d", path, res.StatusCode)
	}

	return json.NewDecoder(res.Body).Decode(out)
}

// ─── selectors ────────────────────────────────────────────────────────────────

// ayloSelector names a slice of catalog: a whole brand, or one collection
// (what the sites call a series, and what reads as a studio — "Bang Bus",
// "Brazzers Exxtra") inside it. Collections partition a brand almost exactly:
// measured across the three brands, the collection totals summed to within 2%
// of the brand totals, so a per-collection channel set covers the same library
// as the brand channel at far finer grain.
type ayloSelector struct {
	brand        ayloBrand
	collectionID int // 0 selects the whole brand
}

func (sel ayloSelector) values(limit, offset int) url.Values {
	q := url.Values{}
	q.Set("type", "scene")
	q.Set("groupId", strconv.Itoa(sel.brand.GroupID))
	q.Set("limit", strconv.Itoa(limit))
	q.Set("offset", strconv.Itoa(offset))
	q.Set("orderBy", "-dateReleased")
	if sel.collectionID > 0 {
		q.Set("collectionId", strconv.Itoa(sel.collectionID))
	}
	return q
}

// ayloCollection is one child studio within a brand.
type ayloCollection struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// ayloListCollections returns a brand's child studios. This is one small
// request per brand — the same facet list the site's own filter sidebar uses.
func ayloListCollections(ctx context.Context, brand ayloBrand) ([]ayloCollection, error) {
	q := url.Values{}
	q.Set("type", "scene")
	q.Set("groupId", strconv.Itoa(brand.GroupID))

	var resp struct {
		AvailableCollections []ayloCollection `json:"availableCollections"`
	}
	if err := ayloGet(ctx, "v2/release-filters", q, &resp); err != nil {
		return nil, err
	}

	out := make([]ayloCollection, 0, len(resp.AvailableCollections))
	for _, c := range resp.AvailableCollections {
		if c.ID > 0 && strings.TrimSpace(c.Name) != "" {
			out = append(out, c)
		}
	}
	return out, nil
}

// ─── paging ───────────────────────────────────────────────────────────────────

// ayloFetchPage reads one page and also reports how many scenes the selector
// matches in total. The total comes back on every list response, which is what
// makes a spread sample possible: the size of the catalog is known before
// deciding where to read from.
func ayloFetchPage(ctx context.Context, sel ayloSelector, limit, offset int) ([]ayloRelease, int, error) {
	if limit > ayloMaxPageSize {
		limit = ayloMaxPageSize
	}

	var resp struct {
		Meta struct {
			Total int `json:"total"`
		} `json:"meta"`
		Result []ayloRelease `json:"result"`
	}
	if err := ayloGet(ctx, "v2/releases", sel.values(limit, offset), &resp); err != nil {
		return nil, 0, err
	}
	return resp.Result, resp.Meta.Total, nil
}

// ayloCountReleases returns only how many scenes a selector matches. It is the
// cheapest read the API offers (~47KB against ~1.3MB for a 25-scene page), and
// it is what sizes a channel before anything decides to list it.
func ayloCountReleases(ctx context.Context, sel ayloSelector) (int, error) {
	_, total, err := ayloFetchPage(ctx, sel, 1, 0)
	return total, err
}

// ─── sampling ─────────────────────────────────────────────────────────────────

// ayloSampleOffsets picks where to read from so a channel's programmes are drawn
// across a collection's whole history rather than only its newest releases.
//
// The catalog is divided into as many bands as there are pages to fetch, and one
// page is taken from a seeded position inside each band. Bands mean coverage is
// guaranteed — a purely random pick could land three pages in the same month —
// while the seeded position within a band stops every channel from airing the
// same slices of its catalog forever.
//
// Offsets come back ascending and non-overlapping, so the pages they produce
// concatenate into a catalog with no duplicates.
func ayloSampleOffsets(total, pageSize, pages int, seed uint64) []int {
	if pages < 1 || pageSize < 1 || total < 1 {
		return nil
	}

	// Small enough to read in full: take it in order and skip the arithmetic.
	if total <= pages*pageSize {
		var out []int
		for offset := 0; offset < total; offset += pageSize {
			out = append(out, offset)
		}
		return out
	}

	rng := splitmix64(seed)
	band := total / pages

	out := make([]int, 0, pages)
	for i := 0; i < pages; i++ {
		start := i * band
		// Room to slide the page around inside its band without crossing into
		// the next one, or past the end of the catalog.
		slack := band - pageSize
		if last := total - pageSize; start+slack > last {
			slack = last - start
		}
		if slack > 0 {
			start += int(rng() % uint64(slack+1))
		}
		out = append(out, start)
	}
	return out
}

// splitmix64 returns a seeded generator. Hand-written for the same reason
// iptv.StableShuffle has its own: a schedule that must reproduce across restarts
// and versions cannot depend on the standard library's generator internals.
func splitmix64(seed uint64) func() uint64 {
	state := seed
	return func() uint64 {
		state += 0x9e3779b97f4a7c15
		z := state
		z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
		z = (z ^ (z >> 27)) * 0x94d049bb133111eb
		return z ^ (z >> 31)
	}
}

// ayloSampleReleases draws up to `want` usable releases spread across the
// selector's whole catalog, fetching pages concurrently.
//
// `usable` is supplied by the caller because "usable" is a scheduling question,
// not a catalog one — and it is load-bearing here rather than a formality. Deep
// catalog entries are frequently unschedulable: scenes past a certain age come
// back with `length: 0` (verified against the detail endpoint too, so it is the
// data and not the listing), which a linear channel cannot place in a slot even
// though the scene plays fine. Where that boundary falls varies by studio —
// measured, BangBros collections are complete back to 2002, while RK Prime's
// durations run out below about 2017.
//
// So a band that lands in a dead era yields nothing, and the sample tops itself
// up from the shallow end, which is reliably schedulable. A channel therefore
// keeps its full rotation whether or not its catalog has usable depth, and only
// its variety varies.
//
// A failed page costs its share of the schedule and nothing more: partial input
// still makes a channel, and the alternative — failing the whole fetch because
// one of four reads timed out — would drop the channel out of the lineup over a
// blip. Only a total failure is reported as one.
//
// An empty result with a nil error is a real answer, not a silent failure: the
// catalog was read and holds nothing that can fill a slot. The caller depends on
// that distinction, because the two deserve opposite treatment — one is a dead
// channel to drop, the other a moment to retry — and conflating them is what
// previously let a brief session gap take most of the lineup off air for a day.
func ayloSampleReleases(ctx context.Context, sel ayloSelector, want int, seed uint64, usable func(*ayloRelease) bool) ([]ayloRelease, int, error) {
	if want <= 0 {
		return nil, 0, nil
	}

	// The first read doubles as the count: it establishes the catalog size that
	// the remaining offsets are spread across.
	first, total, err := ayloFetchPage(ctx, sel, ayloSamplePageSize, 0)
	if err != nil {
		return nil, 0, err
	}
	if total <= 0 || len(first) == 0 {
		return nil, total, nil
	}

	pages := (want + ayloSamplePageSize - 1) / ayloSamplePageSize
	fetched := map[int][]ayloRelease{0: first}

	plan := ayloSampleOffsets(total, ayloSamplePageSize, pages, seed)
	// Top-up reads walk forward from the newest end, where durations are
	// reliably present. Capped at twice the planned reads so a collection that
	// is mostly dead cannot turn one channel into an unbounded download.
	budget := 2 * pages
	for offset := 0; offset+ayloSamplePageSize <= total && len(plan) < budget; offset += ayloSamplePageSize {
		plan = append(plan, offset)
	}

	var (
		order    []int
		fetchErr error
	)
	for _, offset := range plan {
		if len(order) >= budget {
			break
		}
		order = append(order, offset)

		// Fetch a round, then stop as soon as the rotation is full — the point
		// of rounds is that a top-up only happens when the sample fell short.
		if len(order)%pages != 0 {
			continue
		}
		if err := ayloFetchInto(ctx, sel, order, fetched); err != nil {
			fetchErr = err
		}
		// Nothing later can succeed once the session has gone, so stop rather
		// than spend the rest of the budget proving it.
		if errors.Is(fetchErr, errAyloNoSession) {
			break
		}
		if len(ayloMergeSample(offsetPages(order, fetched), want, usable)) >= want {
			break
		}
	}
	if err := ayloFetchInto(ctx, sel, order, fetched); err != nil {
		fetchErr = err
	}

	out := ayloMergeSample(offsetPages(order, fetched), want, usable)
	if len(out) == 0 && fetchErr != nil {
		// Nothing to show *and* reads failed: report the failure rather than
		// letting a network blip masquerade as an empty catalog.
		return nil, total, fetchErr
	}
	return out, total, nil
}

// ayloFetchInto reads any offsets not already present, concurrently. A failed
// page is recorded as an empty one so it is not retried within this sample, and
// the first error is returned so the caller can tell an empty catalog from an
// unreadable one.
func ayloFetchInto(ctx context.Context, sel ayloSelector, offsets []int, into map[int][]ayloRelease) error {
	var (
		mu     sync.Mutex
		wg     sync.WaitGroup
		errOut error
	)

	for _, offset := range offsets {
		mu.Lock()
		_, done := into[offset]
		mu.Unlock()
		if done {
			continue
		}

		wg.Add(1)
		go func(offset int) {
			defer wg.Done()
			ayloAcquireFetch()
			defer ayloReleaseFetch()

			page, _, err := ayloFetchPage(ctx, sel, ayloSamplePageSize, offset)

			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				logger.Debugf("[apihub-aylo] sample page at offset %d failed: %v", offset, err)
				// A lapsed session outranks whatever else went wrong in the
				// batch: it explains every other failure and is the one the
				// caller must not mistake for a property of this collection.
				if errOut == nil || errors.Is(err, errAyloNoSession) {
					errOut = err
				}
				page = nil
			}
			into[offset] = page
		}(offset)
	}
	wg.Wait()

	return errOut
}

// offsetPages lists fetched pages in the order their offsets were planned.
func offsetPages(order []int, fetched map[int][]ayloRelease) [][]ayloRelease {
	out := make([][]ayloRelease, 0, len(order))
	for _, offset := range order {
		out = append(out, fetched[offset])
	}
	return out
}

// ayloMergeSample flattens sampled pages into one catalog: in order, without
// duplicates, and keeping only what can actually be scheduled.
//
// Order is the slice's, never arrival order, so the same sample always produces
// the same schedule. Deduplication matters because a collection that grows
// between two pages being fetched shifts every later offset by one, which shows
// up as the same scene appearing in two bands.
func ayloMergeSample(pages [][]ayloRelease, want int, usable func(*ayloRelease) bool) []ayloRelease {
	seen := make(map[int]bool)
	out := make([]ayloRelease, 0, want)

	for _, page := range pages {
		for i := range page {
			r := &page[i]
			if len(out) >= want {
				return out
			}
			if r.ID <= 0 || seen[r.ID] {
				continue
			}
			if usable != nil && !usable(r) {
				continue
			}
			seen[r.ID] = true
			out = append(out, *r)
		}
	}
	return out
}

// ayloGetRelease fetches one release. Always call this immediately before
// playback rather than reusing a URL from the listing: the `urls.view` a
// release carries is signed and short-lived, so a schedule built an hour ago
// holds nothing playable.
func ayloGetRelease(ctx context.Context, id int) (*ayloRelease, error) {
	var resp struct {
		Result ayloRelease `json:"result"`
	}
	if err := ayloGet(ctx, fmt.Sprintf("v2/releases/%d", id), nil, &resp); err != nil {
		return nil, err
	}
	return &resp.Result, nil
}
