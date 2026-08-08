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
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/stashapp/stash/pkg/iptv"
)

// Read-only catalog client for the Gamma Entertainment platform.
//
// Adult Time and EvilAngel are the same system wearing different names: one
// Algolia index (all_scenes_latest_desc), one hit schema, one media CDN, one
// member-area shape (/media/streamingUrls/{clip}), and one way of publishing
// search credentials (a window.env object rendered into a page). Everything in
// this file is true of both, so a site supplies only what actually differs —
// see gammaSite, and the thin apihub_{adulttime,evilangel}_catalog.go files.
//
// Sharing this rather than copying it is deliberate. The per-site differences
// are small and the traps are not: the two gotchas documented below each cost a
// session to diagnose, and a second copy of this code is a second place for them
// to be reintroduced.
//
// Like the Aylo client, nothing here mints or renews a credential. It reads the
// member session API Hub already holds (the cookie the plugin's Connect panel
// stores) and reports the site's no-session error when there isn't one. The
// Gamma keepalive scheduler owns keeping that cookie warm.
//
// Two things about the member area are not obvious:
//
//   - Every members.adulttime.com path 302s to /en/interstitial on a first
//     visit, and that page redirects to itself. It is a promotional gate, not
//     an auth wall — EvilAngel's working session does exactly the same.
//   - The JSON endpoints answer 403 to a plain GET and 200 to the identical
//     request carrying X-Requested-With: XMLHttpRequest.
//
// Both symptoms look exactly like a dead session and neither is one, which is
// the trap. Measured across the two endpoints, the XHR header alone is
// sufficient for both: it satisfies the JSON endpoints *and* stops the
// interstitial firing. Gate cookies are therefore only used by the sites whose
// window.env page is inside the member area (gammaSite.GateCookies), where the
// request deliberately asks for HTML as a browser would and so meets the gate
// honestly rather than sidestepping it.

const (
	// gammaIndex is the scene index. Only the newest-first ordering exists
	// (there is no ascending twin), which is why reaching the archive is done
	// with a date filter rather than by paging — see gammaSampleScenes.
	gammaIndex = "all_scenes_latest_desc"

	gammaHTTPTimeout = 25 * time.Second

	// gammaFetchConcurrency bounds catalog reads process-wide, for the same
	// reason as ayloFetchSem: a warm builds several channel schedules at once,
	// so a per-call limit multiplies out into far more concurrent requests than
	// intended. Algolia is comfortable well above this; the limit is really
	// about not looking like a scraper.
	gammaFetchConcurrency = 8

	// gammaSampleBands is how many date ranges a channel's catalog is split
	// into when drawing its programmes. Algolia caps pagination at an offset of
	// 1000, so a channel with 21,000 scenes cannot be sampled by paging alone —
	// banding by date reaches the whole archive, and has the side benefit that
	// a channel's rotation spans its eras instead of being all recent.
	gammaSampleBands = 12

	// gammaFirstYear predates the oldest catalogued release on either site.
	// Bands start here; empty ones cost nothing (hitsPerPage 0) and are dropped.
	gammaFirstYear = 1995

	// gammaBaseFilter excludes VR from every query. On Adult Time that is around
	// 1,285 of 69,713 scenes and whole studios of them (18VR, Lethal Hardcore
	// VR …); on EvilAngel it is measured at zero, so the filter costs nothing
	// there and guards against the catalog changing under us.
	//
	// A VR scene is a stereo 180° pair packed side by side in one frame. On a
	// television that is not a lesser experience, it is a broken picture: two
	// squashed half-width copies with barrel distortion. Excluding them at
	// discovery means VR-only studios never enter the lineup at all rather than
	// appearing and then being dropped as unschedulable.
	//
	// Written as numeric equality on purpose. isVR is a 0/1 number, so the
	// boolean-looking forms silently match everything — `NOT isVR:true` returns
	// the entire catalog, which would look like a working filter in review and
	// do nothing at runtime.
	gammaBaseFilter = "isVR=0"
)

// ─── sites ────────────────────────────────────────────────────────────────────

// gammaSite is everything that differs between one Gamma site and another.
// Deliberately small — if a field here is not genuinely site-specific it belongs
// in the shared code below.
type gammaSite struct {
	Label string

	// MemberBase is the member-area origin. Streams come from here, and its
	// Referer is what the member endpoints check.
	MemberBase string

	// ConfigKey is the API Hub plugin setting holding the joined member Cookie
	// header, shared with the Gamma keepalive scheduler.
	ConfigKey string

	// EnvURL is the page carrying the window.env object with the site's Algolia
	// credentials, and EnvNeedsSession whether reaching it requires the member
	// cookie. Adult Time renders it into an authenticated members page; EvilAngel
	// publishes it on its public homepage, so only one of the two pays for a
	// session to read its search key.
	EnvURL          string
	EnvNeedsSession bool

	// GateCookies dismisses a promotional interstitial in front of EnvURL, for
	// the sites that have one. Empty when EnvURL is public.
	GateCookies string

	// AlgoliaOrigin is the Referer/Origin the site's secured key is restricted
	// to. Not derivable from MemberBase: EvilAngel's key is restricted to its
	// public www host while its streams check the members host.
	AlgoliaOrigin string

	// NoSession is this site's sentinel error, so a provider's IsNoSession can
	// tell its own lapsed session from any other site's.
	NoSession error
}

// ─── session ──────────────────────────────────────────────────────────────────

// gammaCookie returns the member Cookie header to send, with any interstitial
// gate pre-dismissed. The gate cookies are exactly the ones the redirect sets on
// the way past, so sending them is what a browser does on its second visit —
// not a bypass of anything protective.
func gammaCookie(site gammaSite) (string, error) {
	stored := strings.TrimSpace(loadGammaCookie(site.ConfigKey))
	if stored == "" {
		return "", site.NoSession
	}
	cookie := strings.TrimRight(stored, "; ")
	if site.GateCookies != "" {
		cookie += "; " + site.GateCookies
	}
	return cookie, nil
}

// gammaSessionLive reports whether API Hub holds a session. It only reads
// config, so it is cheap enough for a cache-hit path — it does not prove the
// cookie still works, which only a real request can.
func gammaSessionLive(site gammaSite) bool {
	_, err := gammaCookie(site)
	return err == nil
}

var gammaHTTPClient = &http.Client{Timeout: gammaHTTPTimeout}

var gammaFetchSem = make(chan struct{}, gammaFetchConcurrency)

func gammaAcquireFetch() { gammaFetchSem <- struct{}{} }
func gammaReleaseFetch() { <-gammaFetchSem }

// gammaMemberGet performs an authenticated member-area GET and decodes JSON.
//
// There is no retry-on-403 here, deliberately, for the same reason as ayloGet:
// a rejected session is fixed by reconnecting, not by trying again, and the
// honest answer in the meantime is "no session".
//
// The body is read whole before decoding because these endpoints do not always
// answer with JSON — see gammaDecodeMemberBody.
func gammaMemberGet(ctx context.Context, site gammaSite, path string, out interface{}) error {
	body, err := gammaMemberGetRaw(ctx, site, site.MemberBase+path)
	if err != nil {
		return err
	}
	return gammaDecodeMemberBody(ctx, site, body, out)
}

func gammaMemberGetRaw(ctx context.Context, site gammaSite, url string) ([]byte, error) {
	cookie, err := gammaCookie(site)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Cookie", cookie)
	req.Header.Set("User-Agent", iptvRemoteUserAgent)
	req.Header.Set("Referer", site.MemberBase+"/")
	// Without this the member JSON endpoints answer 403 — see the file header.
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	req.Header.Set("Accept", "application/json, text/plain, */*")

	res, err := gammaHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	switch {
	case res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden:
		return nil, fmt.Errorf("%w: the member area rejected the stored session", site.NoSession)
	case res.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("%s %s: HTTP %d", site.Label, url, res.StatusCode)
	}

	return io.ReadAll(io.LimitReader(res.Body, 1<<20))
}

// gammaDecodeMemberBody decodes a member response, following the one-shot
// redirect these endpoints sometimes answer with instead of JSON.
//
// Observed once on EvilAngel, on the first authenticated call after a long idle:
// a 200 whose body was not JSON but a bare URL back to the same endpoint
// carrying an `alup=` token, evidently a session upgrade. It did not reproduce
// on any later call. Following it once is a few lines and turns an otherwise
// baffling "invalid character 'h'" decode error — which would silently cost a
// programme its slot — into a normal response.
func gammaDecodeMemberBody(ctx context.Context, site gammaSite, body []byte, out interface{}) error {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) > 0 && (trimmed[0] == '{' || trimmed[0] == '[') {
		return json.Unmarshal(trimmed, out)
	}

	url := string(trimmed)
	if !strings.HasPrefix(url, "http") || len(url) > 2048 {
		return fmt.Errorf("%s: expected JSON, got %d bytes of something else", site.Label, len(trimmed))
	}

	retried, err := gammaMemberGetRaw(ctx, site, url)
	if err != nil {
		return err
	}
	retried = bytes.TrimSpace(retried)
	if len(retried) == 0 || (retried[0] != '{' && retried[0] != '[') {
		return fmt.Errorf("%s: session-upgrade redirect did not lead to JSON", site.Label)
	}
	return json.Unmarshal(retried, out)
}

// ─── Algolia credentials ──────────────────────────────────────────────────────

// Both sites' apps read window.env.api.algolia.{applicationID,apiKey} from a
// rendered page, where the backend has already minted and signed a scoped
// secured key. There is nothing to compute client-side, so this scrapes the same
// object the app does and caches it until the key's own embedded validUntil.

type gammaAlgoliaCreds struct {
	appID      string
	apiKey     string
	validUntil time.Time
}

var (
	gammaCredsMu    sync.Mutex
	gammaCredsCache = map[string]gammaAlgoliaCreds{}
)

var (
	gammaWindowEnvRe = regexp.MustCompile(`window\.env\s*=\s*\{`)
	gammaValidUntil  = regexp.MustCompile(`validUntil=(\d+)`)
)

// gammaAlgoliaConfig returns usable search credentials for a site, rescraping
// when the cached key is spent.
func gammaAlgoliaConfig(ctx context.Context, site gammaSite) (gammaAlgoliaCreds, error) {
	gammaCredsMu.Lock()
	defer gammaCredsMu.Unlock()

	// Refetch a little before expiry so a query cannot land on the edge.
	if cached, ok := gammaCredsCache[site.ConfigKey]; ok &&
		cached.apiKey != "" && time.Until(cached.validUntil) > 5*time.Minute {
		return cached, nil
	}

	creds, err := gammaScrapeAlgoliaConfig(ctx, site)
	if err != nil {
		return gammaAlgoliaCreds{}, err
	}
	gammaCredsCache[site.ConfigKey] = creds
	return creds, nil
}

func gammaInvalidateCreds(site gammaSite) {
	gammaCredsMu.Lock()
	delete(gammaCredsCache, site.ConfigKey)
	gammaCredsMu.Unlock()
}

func gammaScrapeAlgoliaConfig(ctx context.Context, site gammaSite) (gammaAlgoliaCreds, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, site.EnvURL, nil)
	if err != nil {
		return gammaAlgoliaCreds{}, err
	}
	if site.EnvNeedsSession {
		cookie, err := gammaCookie(site)
		if err != nil {
			return gammaAlgoliaCreds{}, err
		}
		req.Header.Set("Cookie", cookie)
	}
	req.Header.Set("User-Agent", iptvRemoteUserAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	res, err := gammaHTTPClient.Do(req)
	if err != nil {
		return gammaAlgoliaCreds{}, err
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		if site.EnvNeedsSession {
			// A redirect that survived the gate cookies means the autologin pair is
			// spent, which reconnecting — not retrying — fixes.
			return gammaAlgoliaCreds{}, fmt.Errorf("%w: %s page returned HTTP %d", site.NoSession, site.Label, res.StatusCode)
		}
		// A public page failing is the site being unreachable, not a session
		// problem — reporting it as one would wrongly take the channels off air.
		return gammaAlgoliaCreds{}, fmt.Errorf("%s config page returned HTTP %d", site.Label, res.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return gammaAlgoliaCreds{}, err
	}

	raw, ok := gammaExtractWindowEnv(string(body))
	if !ok {
		return gammaAlgoliaCreds{}, fmt.Errorf("%s: no window.env on %s", site.Label, site.EnvURL)
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
		return gammaAlgoliaCreds{}, fmt.Errorf("parsing window.env: %w", err)
	}

	alg := env.API.Algolia
	key := alg.APIKey
	if key == "" {
		// The anonymous browsing key, present alongside the session-scoped one on
		// some renders. A fallback rather than an expectation.
		key = alg.APIKeyOpen
	}
	if alg.ApplicationID == "" || key == "" {
		return gammaAlgoliaCreds{}, errors.New("window.env carried no Algolia credentials")
	}

	return gammaAlgoliaCreds{
		appID:      alg.ApplicationID,
		apiKey:     key,
		validUntil: gammaKeyExpiry(key),
	}, nil
}

// gammaKeyExpiry reads the expiry Algolia embeds in a secured key. A key we
// cannot read is assumed short-lived rather than long-lived: guessing high
// would mean serving requests with a dead key until they all failed.
func gammaKeyExpiry(apiKey string) time.Time {
	decoded, err := base64.StdEncoding.DecodeString(apiKey)
	if err != nil {
		decoded, err = base64.RawStdEncoding.DecodeString(apiKey)
	}
	if err == nil {
		if m := gammaValidUntil.FindStringSubmatch(string(decoded)); m != nil {
			if secs, err := strconv.ParseInt(m[1], 10, 64); err == nil {
				return time.Unix(secs, 0)
			}
		}
	}
	return time.Now().Add(10 * time.Minute)
}

// gammaExtractWindowEnv pulls the `window.env = {…}` object literal out of the
// page by counting braces (respecting string literals) rather than with a
// regex, which cannot match balanced delimiters. Mirrors the plugin's
// TypeScript extractor deliberately, so the two behave identically.
func gammaExtractWindowEnv(html string) (string, bool) {
	loc := gammaWindowEnvRe.FindStringIndex(html)
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

// gammaQuery is one sub-query of a multi-query request. Batching matters here: a
// channel's whole date-banded sample is a single HTTP request rather than one
// per band.
type gammaQuery struct {
	IndexName         string     `json:"indexName"`
	Query             string     `json:"query"`
	HitsPerPage       int        `json:"hitsPerPage"`
	Page              int        `json:"page,omitempty"`
	Filters           string     `json:"filters,omitempty"`
	FacetFilters      [][]string `json:"facetFilters,omitempty"`
	Facets            []string   `json:"facets,omitempty"`
	MaxValuesPerFacet int        `json:"maxValuesPerFacet,omitempty"`
}

type gammaResult struct {
	Hits    []gammaHit                `json:"hits"`
	NbHits  int                       `json:"nbHits"`
	NbPages int                       `json:"nbPages"`
	Facets  map[string]map[string]int `json:"facets"`
}

// gammaHit is the subset of a scene hit that scheduling needs. The index carries
// far more (actors, categories, ratings); everything unused is left out so the
// decode cost of a 100-hit page stays small.
type gammaHit struct {
	ClipID      int    `json:"clip_id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	// Length is the runtime in seconds. Unlike Aylo, which returns a
	// placeholder 0 or 1 for whole archive collections, this has been measured
	// as populated on both sites for every sampled scene.
	Length      int    `json:"length"`
	ReleaseDate string `json:"release_date"`
	Upcoming    int    `json:"upcoming"`
	// IsVR is 0/1, not a boolean — see gammaBaseFilter.
	IsVR int `json:"isVR"`

	// VideoFormats lists the available renditions and their codecs, so a
	// programme's playability is known at schedule time rather than needing a
	// per-scene call. Measured across every era on both sites: uniformly h264.
	VideoFormats []struct {
		Codec  string `json:"codec"`
		Format string `json:"format"`
	} `json:"video_formats"`
}

// gammaSearch runs a multi-query against a site and returns one result per
// sub-query.
func gammaSearch(ctx context.Context, site gammaSite, queries []gammaQuery) ([]gammaResult, error) {
	creds, err := gammaAlgoliaConfig(ctx, site)
	if err != nil {
		return nil, err
	}

	payload, err := json.Marshal(struct {
		Requests []gammaQuery `json:"requests"`
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
	// The secured key is referrer-restricted; without these the search answers
	// 403 even though the key is valid. The two sites' keys are restricted to
	// different origins, which is why this comes from the site rather than being
	// derived from the member host.
	req.Header.Set("Referer", site.AlgoliaOrigin+"/")
	req.Header.Set("Origin", site.AlgoliaOrigin)

	gammaAcquireFetch()
	res, err := gammaHTTPClient.Do(req)
	gammaReleaseFetch()
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	if res.StatusCode == http.StatusForbidden || res.StatusCode == http.StatusUnauthorized {
		// The signed key expired or the session behind it did. Drop the cached
		// key so the next call rescrapes rather than repeating a dead one.
		gammaInvalidateCreds(site)
		return nil, fmt.Errorf("%w: search rejected the scraped key", site.NoSession)
	}
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return nil, fmt.Errorf("%s search: HTTP %d: %s", site.Label, res.StatusCode, strings.TrimSpace(string(body)))
	}

	var out struct {
		Results []gammaResult `json:"results"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Results, nil
}

// ─── selectors ────────────────────────────────────────────────────────────────

// gammaSelector names a slice of a site's catalog. Its facet filters are
// Algolia's nested-array form — an AND of ORs — so each group must hold exactly
// one term unless the terms are genuinely alternatives.
type gammaSelector struct {
	FacetFilters [][]string
}

// ─── discovery ────────────────────────────────────────────────────────────────

// gammaFacetValue is one channel candidate: a facet value and how many scenes
// carry it.
type gammaFacetValue struct {
	Name  string
	Count int
}

// gammaListFacet returns every value of a channel facet with its scene count,
// plus the total across the selector, in one query.
//
// This is what makes a Gamma site cheap to channelise where Aylo is not: Aylo
// needs a sizing request per collection, while one faceted query here returns
// the whole lineup and its sizes together.
//
// maxValues is passed rather than fixed because Algolia caps a facet response at
// 1000 values and truncates by count descending. That is safe for a lineup with
// a minimum scene count — the values dropped are the smallest, which would have
// been filtered out anyway — but only as long as fewer than maxValues clear the
// floor, so the caller that knows the floor chooses the number.
func gammaListFacet(ctx context.Context, site gammaSite, sel gammaSelector, facet string, maxValues int) (values []gammaFacetValue, total int, err error) {
	results, err := gammaSearch(ctx, site, []gammaQuery{{
		IndexName:         gammaIndex,
		HitsPerPage:       0,
		Filters:           gammaBaseFilter,
		FacetFilters:      sel.FacetFilters,
		Facets:            []string{facet},
		MaxValuesPerFacet: maxValues,
	}})
	if err != nil {
		return nil, 0, err
	}
	if len(results) == 0 {
		return nil, 0, fmt.Errorf("%s: empty search response", site.Label)
	}

	res := results[0]
	for name, count := range res.Facets[facet] {
		values = append(values, gammaFacetValue{Name: name, Count: count})
	}
	return values, res.NbHits, nil
}

// ─── sampling ─────────────────────────────────────────────────────────────────

// gammaSampleScenes draws a channel's programmes, spread across its whole
// history.
//
// Two round trips, both batched. The first sizes every date band; the second
// pulls hits from the bands that have any, at a seeded random page within each.
// Paging alone could not do this — Algolia refuses offsets past 1000, which on
// a 21,000-scene channel would confine every rotation to the last few months.
//
// The seed is the channel's own, so a channel's rotation survives a restart.
func gammaSampleScenes(ctx context.Context, site gammaSite, sel gammaSelector, want int, seed uint64) ([]gammaHit, error) {
	if want <= 0 {
		return nil, nil
	}

	bands := gammaBands(time.Now().Year())

	sizing := make([]gammaQuery, 0, len(bands))
	for _, b := range bands {
		sizing = append(sizing, gammaQuery{
			IndexName:    gammaIndex,
			HitsPerPage:  0,
			Filters:      b.filter(),
			FacetFilters: sel.FacetFilters,
		})
	}

	sizes, err := gammaSearch(ctx, site, sizing)
	if err != nil {
		return nil, err
	}
	if len(sizes) != len(bands) {
		return nil, fmt.Errorf("%s: asked for %d band sizes, got %d", site.Label, len(bands), len(sizes))
	}

	counts := make([]int, len(bands))
	for i, r := range sizes {
		counts[i] = r.NbHits
	}

	quotas := gammaAllocate(counts, want)
	rnd := splitmix64(seed)

	fetch := make([]gammaQuery, 0, len(bands))
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
		fetch = append(fetch, gammaQuery{
			IndexName:    gammaIndex,
			HitsPerPage:  q,
			Page:         page,
			Filters:      bands[i].filter(),
			FacetFilters: sel.FacetFilters,
		})
	}
	if len(fetch) == 0 {
		// Read fine, nothing in it. A real answer, not a failure — the caller
		// drops the channel rather than retrying it.
		return nil, nil
	}

	results, err := gammaSearch(ctx, site, fetch)
	if err != nil {
		return nil, err
	}

	seen := make(map[int]bool, want)
	out := make([]gammaHit, 0, want)
	for _, r := range results {
		for _, hit := range r.Hits {
			if seen[hit.ClipID] || !gammaUsable(hit) {
				continue
			}
			seen[hit.ClipID] = true
			out = append(out, hit)
		}
	}
	return out, nil
}

// gammaBand is one date range, as Algolia numeric-filter bounds.
type gammaBand struct{ from, to int64 }

func (b gammaBand) filter() string {
	return fmt.Sprintf("%s AND date >= %d AND date < %d", gammaBaseFilter, b.from, b.to)
}

// gammaBands splits the catalog's lifetime into equal spans of time. Equal
// *time*, not equal scene counts — which is the point: it deliberately gives
// the thin early years the same shot at the rotation as the dense recent ones,
// so an archive channel plays like an archive channel.
func gammaBands(nowYear int) []gammaBand {
	first := time.Date(gammaFirstYear, time.January, 1, 0, 0, 0, 0, time.UTC).Unix()
	// One year past the present, so scenes dated slightly ahead of today (the
	// index carries them) still land in a band.
	last := time.Date(nowYear+1, time.January, 1, 0, 0, 0, 0, time.UTC).Unix()

	span := (last - first) / int64(gammaSampleBands)
	bands := make([]gammaBand, 0, gammaSampleBands)
	for i := 0; i < gammaSampleBands; i++ {
		from := first + span*int64(i)
		to := from + span
		if i == gammaSampleBands-1 {
			to = last
		}
		bands = append(bands, gammaBand{from: from, to: to})
	}
	return bands
}

// gammaAllocate spreads `want` across bands, giving every non-empty band an
// equal share and handing whatever a small band cannot supply to the bands that
// can. Without the redistribution a channel whose catalog sits in two eras
// would return a sixth of the programmes asked for.
func gammaAllocate(counts []int, want int) []int {
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

// gammaUsable reports whether a hit can air: long enough to fill a slot, and in
// a codec that remuxes rather than needing a re-encode.
//
// Hits carrying no rendition list at all are kept, mirroring the Aylo client —
// the per-programme resolve will accept or reject it properly at play time.
func gammaUsable(hit gammaHit) bool {
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

// gammaEntries turns sampled hits into schedule input.
func gammaEntries(hits []gammaHit) []iptv.SceneEntry {
	entries := make([]iptv.SceneEntry, 0, len(hits))
	for _, hit := range hits {
		entries = append(entries, iptv.SceneEntry{
			SceneID:  hit.ClipID,
			Title:    hit.Title,
			Details:  hit.Description,
			Date:     hit.ReleaseDate,
			Duration: float64(hit.Length),
		})
	}
	return entries
}

// ─── playback ─────────────────────────────────────────────────────────────────

// gammaStreamPreference is the rendition order to try, best first. Capped at
// 1080p on purpose: 4k triples the bandwidth for a channel nobody is watching
// frame-by-frame, and every client that can show 4k can show 1080p. Both sites
// offer 2160p on recent releases, so this is doing real work.
var gammaStreamPreference = []string{"1080p", "720p", "576p", "540p", "480p", "432p", "360p", "288p"}

type gammaStreamURL struct {
	Format string `json:"format"`
	URL    string `json:"url"`
}

// gammaResolveStream returns a URL ffmpeg can open right now.
//
// The member area also exposes /movieaction/download/{clip}/{format}/mp4, which
// works and is simpler, but it is the account's *download* path — using it as a
// playback source would spend a quota meant for something else. The streaming
// endpoint carries every era (verified back to 2002), so there is no reason to.
func gammaResolveStream(ctx context.Context, site gammaSite, clipID int) (gammaStreamURL, error) {
	var urls []gammaStreamURL
	if err := gammaMemberGet(ctx, site, fmt.Sprintf("/media/streamingUrls/%d", clipID), &urls); err != nil {
		return gammaStreamURL{}, err
	}

	byFormat := make(map[string]string, len(urls))
	for _, u := range urls {
		if u.URL != "" {
			byFormat[strings.ToLower(u.Format)] = u.URL
		}
	}

	for _, want := range gammaStreamPreference {
		if url, ok := byFormat[want]; ok {
			return gammaStreamURL{Format: want, URL: url}, nil
		}
	}
	// "auto" is an adaptive HLS manifest, present only on recent releases. It
	// is the fallback rather than the preference because a fixed rendition
	// keeps a channel's bitrate predictable.
	if url, ok := byFormat["auto"]; ok {
		return gammaStreamURL{Format: "auto", URL: url}, nil
	}

	return gammaStreamURL{}, fmt.Errorf("scene %d has no playable rendition (session may have lapsed)", clipID)
}

// gammaProgramSource resolves a scene to something ffmpeg can open right now.
// Live on every programme boundary: the signed URL is short-lived, so it is
// never held in a schedule.
func gammaProgramSource(ctx context.Context, site gammaSite, clipID int) (programSource, error) {
	stream, err := gammaResolveStream(ctx, site, clipID)
	if err != nil {
		return programSource{}, err
	}

	return programSource{
		Path: stream.URL,
		// Measured as h264 across every era sampled on both sites, and the
		// schedule already dropped anything whose rendition list said otherwise.
		// Naming it lets ChooseMode pick a remux without probing the stream first.
		VideoCodec: "h264",
		// Left empty on purpose, as for Aylo: ChooseMode reads empty as "no
		// audio track", which remuxes, and ffmpeg's optional `-map 0:a:0?`
		// copies the AAC track when there is one. Either way no re-encode,
		// which a guessed codec could have triggered.
		AudioCodec: "",
		Height:     gammaHeight(stream.Format),
		Remote:     true,
	}, nil
}

// gammaHeight turns a rendition name back into a pixel height, for the stream
// profile. Unknown names report 0, which reads as "unspecified".
func gammaHeight(format string) int {
	n := strings.TrimSuffix(strings.ToLower(format), "p")
	h, err := strconv.Atoi(n)
	if err != nil {
		return 0
	}
	return h
}

// gammaUniqueBySlug drops facet values whose slug collides with an earlier one,
// keeping the first in the order given and returning the casualties so the
// caller can say what it dropped.
//
// Necessary because a channel key is a slug of a facet *name* — there is no id
// to key on — and slugging is lossy: "Evil Anal" and "Evil-Anal" reduce to the
// same string. Two channels sharing a key is not a cosmetic problem, it is the
// second one's schedule silently overwriting the first's in the catalog map and
// a playlist with a duplicate id in it. The scenes are not lost either way: they
// still air on the network-wide channel.
func gammaUniqueBySlug(values []gammaFacetValue) (kept, dropped []gammaFacetValue) {
	seen := make(map[string]bool, len(values))
	for _, v := range values {
		slug := gammaSlug(v.Name)
		if slug == "" || seen[slug] {
			dropped = append(dropped, v)
			continue
		}
		seen[slug] = true
		kept = append(kept, v)
	}
	return kept, dropped
}

// gammaSlug reduces a facet value to something safe in a URL and stable across
// refreshes. Runs of anything else collapse to a single dash, which is what lets
// a doubled dash be reserved for a network-wide channel key no facet value can
// collide with — see adultTimeNetworkChannelKey.
func gammaSlug(name string) string {
	var b strings.Builder
	lastDash := true // suppresses a leading dash
	for _, r := range strings.ToLower(name) {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			lastDash = false
		case !lastDash:
			b.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(b.String(), "-")
}
