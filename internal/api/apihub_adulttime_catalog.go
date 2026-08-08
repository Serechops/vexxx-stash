package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/stashapp/stash/pkg/iptv"
)

// Read-only Adult Time catalog client.
//
// Adult Time's catalog is an Algolia index rather than a REST API, which makes
// it cheaper to channelise than Aylo's: one faceted query returns every child
// studio *and* its scene count, and a scene hit already carries its duration,
// release date and rendition list — so a schedule can be built without a single
// per-scene call.
//
// Like the Aylo client, this NEVER mints or renews a credential. It reads the
// member session API Hub already holds (the same cookie the plugin's Connect
// panel stores) and reports errAdultTimeNoSession when there isn't one. The
// Gamma keepalive scheduler owns keeping that cookie warm.
//
// Two things about the member area are not obvious and cost real time to
// rediscover, so they are stated here:
//
//   - Every members.adulttime.com path 302s to /en/interstitial on a first
//     visit, and that page redirects to itself. It is a promotional gate, not
//     an auth wall — EvilAngel's working session does exactly the same — and it
//     is dismissed by handing back the three cookies the redirect itself sets.
//     See adultTimeInterstitialCookies.
//   - The JSON endpoints answer 403 to a plain GET and 200 to the identical
//     request carrying X-Requested-With: XMLHttpRequest.

const (
	adultTimeMemberBase = "https://members.adulttime.com"

	// adultTimeConfigKey is the API Hub plugin setting holding the joined
	// member Cookie header, shared with the Gamma keepalive scheduler.
	adultTimeConfigKey = "adulttimeCookie"

	// adultTimeIndex is the scene index. Only the newest-first ordering exists
	// (there is no ascending twin), which is why reaching the archive is done
	// with a date filter rather than by paging — see adultTimeSampleScenes.
	adultTimeIndex = "all_scenes_latest_desc"

	// adultTimeChannelFacet is the child-studio facet: "Girlsway", "Pure
	// Taboo", "21 Sextury" … 206 of them, and faceting on it returns all of
	// them with their scene counts in a single query.
	adultTimeChannelFacet = "network.lvl0"

	adultTimeHTTPTimeout = 25 * time.Second

	// adultTimeFetchConcurrency bounds catalog reads process-wide, for the same
	// reason as ayloFetchSem: a warm builds several channel schedules at once,
	// so a per-call limit multiplies out into far more concurrent requests than
	// intended. Algolia is comfortable well above this; the limit is really
	// about not looking like a scraper.
	adultTimeFetchConcurrency = 8

	// adultTimeSampleBands is how many date ranges a channel's catalog is split
	// into when drawing its programmes. Algolia caps pagination at an offset of
	// 1000, so a channel with 21,000 scenes cannot be sampled by paging alone —
	// banding by date reaches the whole archive, and has the side benefit that
	// a channel's rotation spans its eras instead of being all recent.
	adultTimeSampleBands = 12

	// adultTimeFirstYear predates the oldest catalogued release. Bands start
	// here; empty ones cost nothing (hitsPerPage 0) and are dropped.
	adultTimeFirstYear = 1995

	// adultTimeBaseFilter excludes VR from every query — around 1,285 of 69,713
	// scenes, and whole studios of them (18VR, Lethal Hardcore VR …).
	//
	// A VR scene is a stereo 180° pair packed side by side in one frame. On a
	// television that is not a lesser experience, it is a broken picture: two
	// squashed half-width copies with barrel distortion. Excluding them at
	// discovery means the VR-only studios never enter the lineup at all rather
	// than appearing and then being dropped as unschedulable.
	//
	// Written as numeric equality on purpose. isVR is a 0/1 number, so the
	// boolean-looking forms silently match everything — `NOT isVR:true` returns
	// the entire catalog, which would look like a working filter in review and
	// do nothing at runtime.
	adultTimeBaseFilter = "isVR=0"
)

var errAdultTimeNoSession = errors.New("no live Adult Time session in API Hub")

// adultTimeInterstitialCookies dismisses the promotional gate described in the
// file header. These are exactly the cookies the interstitial redirect sets on
// the way past, so sending them is what a browser does on its second visit —
// not a bypass of anything protective.
const adultTimeInterstitialCookies = "interstitialPageShown=1; interstitialCountXhours=1; interstitialCountXweek=1"

// ─── session ──────────────────────────────────────────────────────────────────

// adultTimeCookie returns the member Cookie header to send, with the
// interstitial gate pre-dismissed.
func adultTimeCookie() (string, error) {
	stored := strings.TrimSpace(loadGammaCookie(adultTimeConfigKey))
	if stored == "" {
		return "", errAdultTimeNoSession
	}
	return strings.TrimRight(stored, "; ") + "; " + adultTimeInterstitialCookies, nil
}

// adultTimeSessionLive reports whether API Hub holds a session. It only reads
// config, so it is cheap enough for a cache-hit path — it does not prove the
// cookie still works, which only a real request can.
func adultTimeSessionLive() bool {
	_, err := adultTimeCookie()
	return err == nil
}

var adultTimeHTTPClient = &http.Client{Timeout: adultTimeHTTPTimeout}

var adultTimeFetchSem = make(chan struct{}, adultTimeFetchConcurrency)

func adultTimeAcquireFetch() { adultTimeFetchSem <- struct{}{} }
func adultTimeReleaseFetch() { <-adultTimeFetchSem }

// adultTimeMemberGet performs an authenticated member-area GET.
//
// There is no retry-on-403 here, deliberately, for the same reason as ayloGet:
// a rejected session is fixed by reconnecting, not by trying again, and the
// honest answer in the meantime is "no session".
func adultTimeMemberGet(ctx context.Context, path string, out interface{}) error {
	cookie, err := adultTimeCookie()
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, adultTimeMemberBase+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Cookie", cookie)
	req.Header.Set("User-Agent", iptvRemoteUserAgent)
	req.Header.Set("Referer", adultTimeMemberBase+"/")
	// Without this the member JSON endpoints answer 403 — see the file header.
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	req.Header.Set("Accept", "application/json, text/plain, */*")

	res, err := adultTimeHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	switch {
	case res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden:
		return fmt.Errorf("%w: the member area rejected the stored session", errAdultTimeNoSession)
	case res.StatusCode != http.StatusOK:
		return fmt.Errorf("adulttime %s: HTTP %d", path, res.StatusCode)
	}

	return json.NewDecoder(res.Body).Decode(out)
}

// ─── Algolia credentials ──────────────────────────────────────────────────────

// Adult Time's own app reads window.env.api.algolia.{applicationID,apiKey} from
// the rendered members page; the backend mints and signs a session-scoped
// secured key on each render. There is nothing to compute client-side, so this
// scrapes the same object the app does and caches it until the key's own
// embedded validUntil.

type adultTimeAlgoliaCreds struct {
	appID      string
	apiKey     string
	validUntil time.Time
}

var (
	adultTimeCredsMu    sync.Mutex
	adultTimeCredsCache adultTimeAlgoliaCreds
)

var (
	adultTimeWindowEnvRe = regexp.MustCompile(`window\.env\s*=\s*\{`)
	adultTimeValidUntil  = regexp.MustCompile(`validUntil=(\d+)`)
)

// adultTimeAlgoliaConfig returns usable search credentials, scraping the
// members page when the cached key is spent.
func adultTimeAlgoliaConfig(ctx context.Context) (adultTimeAlgoliaCreds, error) {
	adultTimeCredsMu.Lock()
	defer adultTimeCredsMu.Unlock()

	// Refetch a little before expiry so a query cannot land on the edge.
	if adultTimeCredsCache.apiKey != "" && time.Until(adultTimeCredsCache.validUntil) > 5*time.Minute {
		return adultTimeCredsCache, nil
	}

	creds, err := adultTimeScrapeAlgoliaConfig(ctx)
	if err != nil {
		return adultTimeAlgoliaCreds{}, err
	}
	adultTimeCredsCache = creds
	return creds, nil
}

func adultTimeScrapeAlgoliaConfig(ctx context.Context) (adultTimeAlgoliaCreds, error) {
	cookie, err := adultTimeCookie()
	if err != nil {
		return adultTimeAlgoliaCreds{}, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, adultTimeMemberBase+"/en", nil)
	if err != nil {
		return adultTimeAlgoliaCreds{}, err
	}
	req.Header.Set("Cookie", cookie)
	req.Header.Set("User-Agent", iptvRemoteUserAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	res, err := adultTimeHTTPClient.Do(req)
	if err != nil {
		return adultTimeAlgoliaCreds{}, err
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		// A redirect that survived the gate cookies means the autologin pair is
		// spent, which reconnecting — not retrying — fixes.
		return adultTimeAlgoliaCreds{}, fmt.Errorf("%w: members page returned HTTP %d", errAdultTimeNoSession, res.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return adultTimeAlgoliaCreds{}, err
	}

	raw, ok := adultTimeExtractWindowEnv(string(body))
	if !ok {
		return adultTimeAlgoliaCreds{}, fmt.Errorf("%w: no window.env on the members page", errAdultTimeNoSession)
	}

	var env struct {
		API struct {
			Algolia struct {
				ApplicationID string `json:"applicationID"`
				APIKey        string `json:"apiKey"`
				APIKeyOpen    string `json:"apiKeyOpen"`
			} `json:"algolia"`
		} `json:"api"`
	}
	if err := json.Unmarshal([]byte(raw), &env); err != nil {
		return adultTimeAlgoliaCreds{}, fmt.Errorf("parsing window.env: %w", err)
	}

	alg := env.API.Algolia
	key := alg.APIKey
	if key == "" {
		// The anonymous browsing key, present alongside the session-scoped one.
		// A connected session should always populate apiKey; this is a fallback
		// rather than an expectation.
		key = alg.APIKeyOpen
	}
	if alg.ApplicationID == "" || key == "" {
		return adultTimeAlgoliaCreds{}, errors.New("window.env carried no Algolia credentials")
	}

	return adultTimeAlgoliaCreds{
		appID:      alg.ApplicationID,
		apiKey:     key,
		validUntil: adultTimeKeyExpiry(key),
	}, nil
}

// adultTimeKeyExpiry reads the expiry Algolia embeds in a secured key. A key we
// cannot read is assumed short-lived rather than long-lived: guessing high
// would mean serving requests with a dead key until they all failed.
func adultTimeKeyExpiry(apiKey string) time.Time {
	decoded, err := base64.StdEncoding.DecodeString(apiKey)
	if err != nil {
		decoded, err = base64.RawStdEncoding.DecodeString(apiKey)
	}
	if err == nil {
		if m := adultTimeValidUntil.FindStringSubmatch(string(decoded)); m != nil {
			if secs, err := strconv.ParseInt(m[1], 10, 64); err == nil {
				return time.Unix(secs, 0)
			}
		}
	}
	return time.Now().Add(10 * time.Minute)
}

// adultTimeExtractWindowEnv pulls the `window.env = {…}` object literal out of
// the page by counting braces (respecting string literals) rather than with a
// regex, which cannot match balanced delimiters. Mirrors the plugin's
// TypeScript extractor deliberately, so the two behave identically.
func adultTimeExtractWindowEnv(html string) (string, bool) {
	loc := adultTimeWindowEnvRe.FindStringIndex(html)
	if loc == nil {
		return "", false
	}
	start := strings.Index(html[loc[0]:], "{")
	if start < 0 {
		return "", false
	}
	start += loc[0]

	var depth int
	var inString, escaped bool
	for i := start; i < len(html); i++ {
		ch := html[i]
		if inString {
			switch {
			case escaped:
				escaped = false
			case ch == '\\':
				escaped = true
			case ch == '"':
				inString = false
			}
			continue
		}
		switch ch {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return html[start : i+1], true
			}
		}
	}
	return "", false // unterminated — malformed page, give up rather than guess
}

// ─── search ───────────────────────────────────────────────────────────────────

// adultTimeQuery is one sub-query of a multi-query request. Batching matters
// here: a channel's whole date-banded sample is a single HTTP request rather
// than one per band.
type adultTimeQuery struct {
	IndexName         string     `json:"indexName"`
	Query             string     `json:"query"`
	HitsPerPage       int        `json:"hitsPerPage"`
	Page              int        `json:"page,omitempty"`
	Filters           string     `json:"filters,omitempty"`
	FacetFilters      [][]string `json:"facetFilters,omitempty"`
	Facets            []string   `json:"facets,omitempty"`
	MaxValuesPerFacet int        `json:"maxValuesPerFacet,omitempty"`
}

type adultTimeResult struct {
	Hits        []adultTimeHit            `json:"hits"`
	NbHits      int                       `json:"nbHits"`
	NbPages     int                       `json:"nbPages"`
	Facets      map[string]map[string]int `json:"facets"`
	FacetsStats map[string]struct {
		Min float64 `json:"min"`
		Max float64 `json:"max"`
	} `json:"facets_stats"`
}

// adultTimeHit is the subset of a scene hit that scheduling needs. The index
// carries far more (actors, categories, ratings); everything unused is left out
// so the decode cost of a 100-hit page stays small.
type adultTimeHit struct {
	ClipID      int    `json:"clip_id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	// Length is the runtime in seconds. Unlike Aylo, which returns a
	// placeholder 0 or 1 for whole archive collections, this has been measured
	// as populated for every sampled scene.
	Length      int    `json:"length"`
	ReleaseDate string `json:"release_date"`
	NetworkName string `json:"network_name"`
	Upcoming    int    `json:"upcoming"`
	// IsVR is 0/1, not a boolean — see adultTimeBaseFilter.
	IsVR int `json:"isVR"`

	// VideoFormats lists the available renditions and their codecs, so a
	// programme's playability is known at schedule time rather than needing a
	// per-scene call. Measured across every era: uniformly h264.
	VideoFormats []struct {
		Codec  string `json:"codec"`
		Format string `json:"format"`
	} `json:"video_formats"`
}

// adultTimeSearch runs a multi-query and returns one result per sub-query.
func adultTimeSearch(ctx context.Context, queries []adultTimeQuery) ([]adultTimeResult, error) {
	creds, err := adultTimeAlgoliaConfig(ctx)
	if err != nil {
		return nil, err
	}

	payload, err := json.Marshal(struct {
		Requests []adultTimeQuery `json:"requests"`
	}{Requests: queries})
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("https://%s-dsn.algolia.net/1/indexes/*/queries", creds.appID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Algolia-Application-Id", creds.appID)
	req.Header.Set("X-Algolia-API-Key", creds.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", iptvRemoteUserAgent)
	// The secured key is referrer-restricted to the members origin; without
	// these the search answers 403 even though the key is valid.
	req.Header.Set("Referer", adultTimeMemberBase+"/")
	req.Header.Set("Origin", adultTimeMemberBase)

	adultTimeAcquireFetch()
	res, err := adultTimeHTTPClient.Do(req)
	adultTimeReleaseFetch()
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	if res.StatusCode == http.StatusForbidden || res.StatusCode == http.StatusUnauthorized {
		// The signed key expired or the session behind it did. Drop the cached
		// key so the next call rescrapes rather than repeating a dead one.
		adultTimeInvalidateCreds()
		return nil, fmt.Errorf("%w: search rejected the scraped key", errAdultTimeNoSession)
	}
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return nil, fmt.Errorf("adulttime search: HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(body)))
	}

	var out struct {
		Results []adultTimeResult `json:"results"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Results, nil
}

func adultTimeInvalidateCreds() {
	adultTimeCredsMu.Lock()
	adultTimeCredsCache = adultTimeAlgoliaCreds{}
	adultTimeCredsMu.Unlock()
}

// ─── selectors ────────────────────────────────────────────────────────────────

// adultTimeSelector names a slice of the catalog: the whole network, or one
// child studio inside it.
type adultTimeSelector struct {
	channel string // "" selects the whole network
}

// facetFilters builds the filter pair every query shares. Nested arrays are an
// AND of ORs, so this reads as "in this channel AND not upcoming".
func (sel adultTimeSelector) facetFilters() [][]string {
	filters := [][]string{{"upcoming:0"}}
	if sel.channel != "" {
		filters = append(filters, []string{adultTimeChannelFacet + ":" + sel.channel})
	}
	return filters
}

// ─── discovery ────────────────────────────────────────────────────────────────

type adultTimeChannel struct {
	Name  string
	Count int
}

// adultTimeListChannels returns every child studio and its scene count, plus
// the network total, in one query. This is the whole reason Adult Time is
// cheaper to channelise than Aylo, which needs a sizing request per collection.
func adultTimeListChannels(ctx context.Context) (channels []adultTimeChannel, total int, err error) {
	results, err := adultTimeSearch(ctx, []adultTimeQuery{{
		IndexName:    adultTimeIndex,
		HitsPerPage:  0,
		Filters:      adultTimeBaseFilter,
		FacetFilters: adultTimeSelector{}.facetFilters(),
		Facets:       []string{adultTimeChannelFacet},
		// Comfortably above the ~206 that exist, so the list is never silently
		// truncated as the catalog grows.
		MaxValuesPerFacet: 1000,
	}})
	if err != nil {
		return nil, 0, err
	}
	if len(results) == 0 {
		return nil, 0, errors.New("adulttime: empty search response")
	}

	res := results[0]
	for name, count := range res.Facets[adultTimeChannelFacet] {
		channels = append(channels, adultTimeChannel{Name: name, Count: count})
	}
	sort.Slice(channels, func(i, j int) bool {
		return strings.ToLower(channels[i].Name) < strings.ToLower(channels[j].Name)
	})
	return channels, res.NbHits, nil
}

// ─── sampling ─────────────────────────────────────────────────────────────────

// adultTimeSampleScenes draws a channel's programmes, spread across its whole
// history.
//
// Two round trips, both batched. The first sizes every date band; the second
// pulls hits from the bands that have any, at a seeded random page within each.
// Paging alone could not do this — Algolia refuses offsets past 1000, which on
// a 21,000-scene channel would confine every rotation to the last few months.
//
// The seed is the channel's own, so a channel's rotation survives a restart.
func adultTimeSampleScenes(ctx context.Context, sel adultTimeSelector, want int, seed uint64) ([]adultTimeHit, error) {
	if want <= 0 {
		return nil, nil
	}

	bands := adultTimeBands(time.Now().Year())

	sizing := make([]adultTimeQuery, 0, len(bands))
	for _, b := range bands {
		sizing = append(sizing, adultTimeQuery{
			IndexName:    adultTimeIndex,
			HitsPerPage:  0,
			Filters:      b.filter(),
			FacetFilters: sel.facetFilters(),
		})
	}

	sizes, err := adultTimeSearch(ctx, sizing)
	if err != nil {
		return nil, err
	}
	if len(sizes) != len(bands) {
		return nil, fmt.Errorf("adulttime: asked for %d band sizes, got %d", len(bands), len(sizes))
	}

	counts := make([]int, len(bands))
	for i, r := range sizes {
		counts[i] = r.NbHits
	}

	quotas := adultTimeAllocate(counts, want)
	rnd := splitmix64(seed)

	fetch := make([]adultTimeQuery, 0, len(bands))
	for i, q := range quotas {
		if q == 0 {
			continue
		}
		// Pick a random page among those the band actually has, staying inside
		// Algolia's 1000-offset ceiling.
		pages := (counts[i] + q - 1) / q
		if max := 1000 / q; pages > max {
			pages = max
		}
		page := 0
		if pages > 1 {
			page = int(rnd() % uint64(pages))
		}
		fetch = append(fetch, adultTimeQuery{
			IndexName:    adultTimeIndex,
			HitsPerPage:  q,
			Page:         page,
			Filters:      bands[i].filter(),
			FacetFilters: sel.facetFilters(),
		})
	}
	if len(fetch) == 0 {
		// Read fine, nothing in it. A real answer, not a failure — the caller
		// drops the channel rather than retrying it.
		return nil, nil
	}

	results, err := adultTimeSearch(ctx, fetch)
	if err != nil {
		return nil, err
	}

	seen := make(map[int]bool, want)
	out := make([]adultTimeHit, 0, want)
	for _, r := range results {
		for _, hit := range r.Hits {
			if seen[hit.ClipID] || !adultTimeUsable(hit) {
				continue
			}
			seen[hit.ClipID] = true
			out = append(out, hit)
		}
	}
	return out, nil
}

// adultTimeBand is one date range, as Algolia numeric-filter bounds.
type adultTimeBand struct{ from, to int64 }

func (b adultTimeBand) filter() string {
	return fmt.Sprintf("%s AND date >= %d AND date < %d", adultTimeBaseFilter, b.from, b.to)
}

// adultTimeBands splits the catalog's lifetime into equal spans of time. Equal
// *time*, not equal scene counts — which is the point: it deliberately gives
// the thin early years the same shot at the rotation as the dense recent ones,
// so an archive channel plays like an archive channel.
func adultTimeBands(nowYear int) []adultTimeBand {
	first := time.Date(adultTimeFirstYear, time.January, 1, 0, 0, 0, 0, time.UTC).Unix()
	// One year past the present, so scenes dated slightly ahead of today (the
	// index carries them) still land in a band.
	last := time.Date(nowYear+1, time.January, 1, 0, 0, 0, 0, time.UTC).Unix()

	span := (last - first) / int64(adultTimeSampleBands)
	bands := make([]adultTimeBand, 0, adultTimeSampleBands)
	for i := 0; i < adultTimeSampleBands; i++ {
		from := first + span*int64(i)
		to := from + span
		if i == adultTimeSampleBands-1 {
			to = last
		}
		bands = append(bands, adultTimeBand{from: from, to: to})
	}
	return bands
}

// adultTimeAllocate spreads `want` across bands, giving every non-empty band an
// equal share and handing whatever a small band cannot supply to the bands that
// can. Without the redistribution a channel whose catalog sits in two eras
// would return a sixth of the programmes asked for.
func adultTimeAllocate(counts []int, want int) []int {
	quotas := make([]int, len(counts))

	live := 0
	for _, c := range counts {
		if c > 0 {
			live++
		}
	}
	if live == 0 {
		return quotas
	}

	remaining := want
	// Repeat until nothing more can be placed: each pass tops up every band
	// that still has headroom, so surplus from an exhausted band flows to the
	// others rather than being lost.
	for remaining > 0 {
		share := remaining / live
		if share == 0 {
			share = 1
		}

		placed := 0
		for i, c := range counts {
			if remaining == 0 {
				break
			}
			headroom := c - quotas[i]
			if headroom <= 0 {
				continue
			}
			add := share
			if add > headroom {
				add = headroom
			}
			if add > remaining {
				add = remaining
			}
			quotas[i] += add
			remaining -= add
			placed += add
		}
		if placed == 0 {
			break // every band is exhausted; the channel simply has fewer scenes
		}
	}
	return quotas
}

// adultTimeUsable reports whether a hit can air: long enough to fill a slot,
// and in a codec that remuxes rather than needing a re-encode.
//
// Hits carrying no rendition list at all are kept, mirroring the Aylo client —
// the per-programme resolve will accept or reject it properly at play time.
func adultTimeUsable(hit adultTimeHit) bool {
	if hit.Upcoming != 0 || hit.IsVR != 0 {
		return false
	}
	if hit.Length < iptv.SegmentSeconds {
		return false
	}
	if len(hit.VideoFormats) == 0 {
		return true
	}
	for _, f := range hit.VideoFormats {
		if ayloCopyable(strings.ToLower(f.Codec)) {
			return true
		}
	}
	return false
}

// ─── playback ─────────────────────────────────────────────────────────────────

// adultTimeStreamPreference is the rendition order to try, best first. Capped
// at 1080p on purpose: 4k triples the bandwidth for a channel nobody is
// watching frame-by-frame, and every client that can show 4k can show 1080p.
var adultTimeStreamPreference = []string{"1080p", "720p", "576p", "540p", "480p", "432p", "360p"}

type adultTimeStreamURL struct {
	Format string `json:"format"`
	URL    string `json:"url"`
}

// adultTimeResolveStream returns a URL ffmpeg can open right now.
//
// The member area also exposes /movieaction/download/{clip}/{format}/mp4, which
// works and is simpler, but it is the account's *download* path — using it as a
// playback source would spend a quota meant for something else. The streaming
// endpoint carries every era (verified back to 2002), so there is no reason to.
func adultTimeResolveStream(ctx context.Context, clipID int) (adultTimeStreamURL, error) {
	var urls []adultTimeStreamURL
	if err := adultTimeMemberGet(ctx, fmt.Sprintf("/media/streamingUrls/%d", clipID), &urls); err != nil {
		return adultTimeStreamURL{}, err
	}

	byFormat := make(map[string]string, len(urls))
	for _, u := range urls {
		if u.URL != "" {
			byFormat[strings.ToLower(u.Format)] = u.URL
		}
	}

	for _, want := range adultTimeStreamPreference {
		if url, ok := byFormat[want]; ok {
			return adultTimeStreamURL{Format: want, URL: url}, nil
		}
	}
	// "auto" is an adaptive HLS manifest, present only on recent releases. It
	// is the fallback rather than the preference because a fixed rendition
	// keeps a channel's bitrate predictable.
	if url, ok := byFormat["auto"]; ok {
		return adultTimeStreamURL{Format: "auto", URL: url}, nil
	}

	return adultTimeStreamURL{}, fmt.Errorf("scene %d has no playable rendition (session may have lapsed)", clipID)
}

// adultTimeHeight turns a rendition name back into a pixel height, for the
// stream profile. Unknown names report 0, which reads as "unspecified".
func adultTimeHeight(format string) int {
	n := strings.TrimSuffix(strings.ToLower(format), "p")
	h, err := strconv.Atoi(n)
	if err != nil {
		return 0
	}
	return h
}
