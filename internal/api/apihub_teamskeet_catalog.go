package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/logger"
)

// Read-only TeamSkeet ("Reptyle" backend) catalog client.
//
// The odd one out among the IPTV providers. Aylo is a REST API and the two Gamma
// sites are an Algolia index; this is a raw Elasticsearch index queried with
// Lucene query strings, behind a Bearer JWT rather than a cookie. Two
// consequences shape everything here.
//
// # It can mint its own access token, safely
//
// Every other provider is forbidden from renewing a credential, because Aylo's
// refresh token is single-use and rotating: a second renewer would race the
// plugin's and both would see a false "session expired". Reptyle is different,
// and it was measured rather than assumed — POST auth.reptyle.com/oauth/refresh
// answers with `{"access_token": …}` and **nothing else**. The 30-day refresh
// token is not consumed and not rotated, so minting a 30-minute access token
// here cannot invalidate the plugin's copy. That is what makes TeamSkeet usable
// at all: its access token lives 30 minutes, so a stored one is essentially
// always expired by the time a channel wants it.
//
// If that response ever starts carrying a refresh token, this logs loudly rather
// than quietly persisting one — writing the plugin's credential from here is
// exactly the cross-process fight the Aylo scheduler exists to prevent.
//
// # Nothing in the catalog says how long a scene is
//
// Confirmed exhaustively, because it is a strange thing to be missing: no
// duration on the movie document, none in /movie/{id}/watch, no movie-detail
// endpoint (every candidate path 404s), and no duration-like field anywhere in
// the index mapping's 57 fields. The only place a runtime exists is inside the
// media itself — the DASH manifest's mediaPresentationDuration.
//
// A schedule cannot be built without durations, so they are measured: two
// requests per scene, once, and then cached forever in a sqlite sidecar because
// a runtime never changes (apihub_teamskeet_durations.go). Discovery is rationed
// by a process-wide budget so a cold start fills the lineup over a couple of
// hours instead of firing ~14,000 requests at once, and a channel that does not
// yet have enough measured programmes reports itself as still warming rather
// than as empty — the difference between being retried shortly and being dropped
// for a day.

const (
	teamSkeetSearchBase = "https://ma-store.reptyle.com"
	teamSkeetAPIBase    = "https://api2.reptyle.com/api/v1"
	teamSkeetIndex      = "ts_index"

	// teamSkeetOAuthRefreshURL is Reptyle's own SPA refresh endpoint. Not behind
	// the Cloudflare challenge that walls members.reptyle.com, so a plain POST
	// works with no browser involved.
	teamSkeetOAuthRefreshURL = "https://auth.reptyle.com/oauth/refresh"

	// teamSkeetAppOrigin is the SPA origin the API expects to be called from.
	teamSkeetAppOrigin = "https://app.reptyle.com"

	// teamSkeetTokensKey is the API Hub plugin setting holding the token set the
	// plugin persists (tokenStorage.ts TEAMSKEET_TOKENS_SETTING_KEY).
	teamSkeetTokensKey = "teamskeetTokens"

	teamSkeetHTTPTimeout = 30 * time.Second

	// teamSkeetFetchConcurrency bounds requests process-wide, for the same reason
	// as the other providers' semaphores: a warm builds several channel schedules
	// at once. Kept lower than the Gamma limit because duration discovery makes
	// two requests per scene and is by far the heaviest thing here.
	teamSkeetFetchConcurrency = 6

	// teamSkeetTierScope is the entitlement filter. `tiers:0 OR tiers:1`, not
	// `tiers:1` alone — a movie with `tiers: [0, 12]` was confirmed to stream, so
	// tier 0 is a real entitlement this account holds and scoping it out silently
	// drops content. Copied deliberately from the plugin's buildClauses, which
	// learned the same thing.
	teamSkeetTierScope = "(tiers:0 OR tiers:1)"

	// teamSkeetResultWindow is Elasticsearch's from+size ceiling (confirmed live:
	// "Result window is too large … must be less than or equal to: [10000]").
	// Series are far smaller than this, so unlike the Algolia providers there is
	// no need to reach the archive by date banding — a whole series fits in one
	// request.
	teamSkeetResultWindow = 10000

	// teamSkeetMovieFields and teamSkeetSeriesFields trim each response to what
	// is actually read. Measured at 69% smaller movie responses, which matters
	// when a warm pulls every movie of 137 series.
	//
	// Two field lists rather than one, because the index is polymorphic — movies,
	// series, models and categories are all documents in it with different
	// shapes. Trimming a series response to the movie fields returns documents
	// with no `name` and no `movieCount`, which does not error: it silently yields
	// a lineup of one channel.
	teamSkeetMovieFields  = "id,title,description,publishedDate,isUpcoming,site.siteName"
	teamSkeetSeriesFields = "id,name,movieCount,tiers"

	// teamSkeetMaxHeight caps the rendition, for the same reason as the Gamma
	// providers: 4k triples the bandwidth of a channel nobody is inspecting frame
	// by frame. In practice the catalog tops out at 1080p anyway.
	teamSkeetMaxHeight = 1080
)

// errTeamSkeetNoSession means API Hub holds no usable TeamSkeet session — either
// nothing is connected, or the 30-day refresh token has lapsed and only a real
// reconnect can help.
var errTeamSkeetNoSession = errors.New("no live TeamSkeet session in API Hub")

// errTeamSkeetWarming means a channel's programmes are still being measured.
//
// Deliberately an error rather than an empty schedule. An empty schedule is read
// as "this channel has nothing airable" and takes the channel out of the lineup
// for a day; an error is retried on the short backoff, which is exactly the
// behaviour a channel waiting for its durations needs.
var errTeamSkeetWarming = errors.New("TeamSkeet channel is still measuring programme durations")

var teamSkeetHTTPClient = &http.Client{Timeout: teamSkeetHTTPTimeout}

var teamSkeetFetchSem = make(chan struct{}, teamSkeetFetchConcurrency)

func teamSkeetAcquireFetch() { teamSkeetFetchSem <- struct{}{} }
func teamSkeetReleaseFetch() { <-teamSkeetFetchSem }

// ─── session ──────────────────────────────────────────────────────────────────

// teamSkeetTokenSet mirrors the plugin's TSTokenSet JSON shape (teamskeet/
// auth.ts). Field names must match exactly — this only ever reads it, but a
// silent mismatch would look like "not connected".
type teamSkeetTokenSet struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresAt    int64  `json:"expiresAt"` // epoch ms, from the access JWT's own exp
}

func loadTeamSkeetTokens() (teamSkeetTokenSet, bool) {
	pc := config.GetInstance().GetPluginConfiguration(gammaKeepalivePluginID)
	if pc == nil {
		return teamSkeetTokenSet{}, false
	}
	raw, ok := pc[teamSkeetTokensKey].(string)
	if !ok || strings.TrimSpace(raw) == "" {
		return teamSkeetTokenSet{}, false
	}
	var ts teamSkeetTokenSet
	if err := json.Unmarshal([]byte(raw), &ts); err != nil {
		return teamSkeetTokenSet{}, false
	}
	return ts, ts.RefreshToken != ""
}

// teamSkeetJWTExpiry reads a JWT's `exp` claim without verifying the signature —
// which is right, because this is not authenticating anything. It is reading a
// token we already hold to decide whether it is worth sending.
func teamSkeetJWTExpiry(token string) (time.Time, bool) {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return time.Time{}, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return time.Time{}, false
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil || claims.Exp == 0 {
		return time.Time{}, false
	}
	return time.Unix(claims.Exp, 0), true
}

// teamSkeetSessionLive reports whether API Hub holds a session that can still be
// refreshed. It reads config and decodes a claim, so it is cheap enough for a
// cache-hit path.
//
// The check is on the REFRESH token, not the access token: a 30-minute access
// token is expected to be expired, and that is recoverable. A lapsed 30-day
// refresh token is not, and pretending otherwise would mean every channel
// failing slowly instead of the network quietly leaving the lineup.
func teamSkeetSessionLive() bool {
	ts, ok := loadTeamSkeetTokens()
	if !ok {
		return false
	}
	if exp, ok := teamSkeetJWTExpiry(ts.RefreshToken); ok && time.Now().After(exp) {
		return false
	}
	return true
}

var (
	teamSkeetTokenMu     sync.Mutex
	teamSkeetCachedToken string
	teamSkeetTokenExpiry time.Time
)

// teamSkeetAccessToken returns a usable Bearer token, refreshing when the one on
// hand is spent. See the file header for why refreshing here is safe.
func teamSkeetAccessToken(ctx context.Context, force bool) (string, error) {
	teamSkeetTokenMu.Lock()
	defer teamSkeetTokenMu.Unlock()

	// Two minutes of margin so a request cannot land on the edge of the window.
	if !force && teamSkeetCachedToken != "" && time.Until(teamSkeetTokenExpiry) > 2*time.Minute {
		return teamSkeetCachedToken, nil
	}

	ts, ok := loadTeamSkeetTokens()
	if !ok {
		return "", errTeamSkeetNoSession
	}
	if exp, ok := teamSkeetJWTExpiry(ts.RefreshToken); ok && time.Now().After(exp) {
		return "", fmt.Errorf("%w: the saved session expired on %s", errTeamSkeetNoSession, exp.Format("2006-01-02"))
	}

	// The stored access token is usable on the rare occasion it is still fresh —
	// worth checking before spending a refresh on it.
	if !force && ts.AccessToken != "" && ts.ExpiresAt > time.Now().Add(2*time.Minute).UnixMilli() {
		teamSkeetCachedToken = ts.AccessToken
		teamSkeetTokenExpiry = time.UnixMilli(ts.ExpiresAt)
		return teamSkeetCachedToken, nil
	}

	access, err := teamSkeetRefreshAccessToken(ctx, ts.RefreshToken)
	if err != nil {
		return "", err
	}

	teamSkeetCachedToken = access
	if exp, ok := teamSkeetJWTExpiry(access); ok {
		teamSkeetTokenExpiry = exp
	} else {
		teamSkeetTokenExpiry = time.Now().Add(25 * time.Minute)
	}
	return access, nil
}

func teamSkeetRefreshAccessToken(ctx context.Context, refreshToken string) (string, error) {
	body, err := json.Marshal(map[string]string{"refresh_token": refreshToken})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, teamSkeetOAuthRefreshURL, strings.NewReader(string(body)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", iptvRemoteUserAgent)
	req.Header.Set("Origin", teamSkeetAppOrigin)
	req.Header.Set("Referer", teamSkeetAppOrigin+"/")

	res, err := teamSkeetHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%w: token refresh returned HTTP %d", errTeamSkeetNoSession, res.StatusCode)
	}

	var out struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("%w: token refresh answered with something other than JSON", errTeamSkeetNoSession)
	}
	if out.AccessToken == "" {
		return "", fmt.Errorf("%w: token refresh returned no access token", errTeamSkeetNoSession)
	}
	if out.RefreshToken != "" && out.RefreshToken != refreshToken {
		// Measured as never happening, and the whole safety argument for
		// refreshing here rests on that. If it starts happening the plugin's
		// stored token is now stale and only it should write the replacement, so
		// say so loudly rather than either ignoring it or racing the plugin.
		logger.Warnf("[iptv] API Hub: TeamSkeet's refresh endpoint rotated the refresh token, which it is not expected to. " +
			"IPTV deliberately does not persist credentials; open the APIHub panel so the plugin can store the new one.")
	}
	return out.AccessToken, nil
}

// ─── search ───────────────────────────────────────────────────────────────────

type teamSkeetSearchResult struct {
	Hits struct {
		Total struct {
			Value int `json:"value"`
		} `json:"total"`
		Hits []struct {
			Source json.RawMessage `json:"_source"`
		} `json:"hits"`
	} `json:"hits"`
	Error json.RawMessage `json:"error"`
}

// teamSkeetSearch runs one Lucene query against the index.
//
// A rejected session shows up two ways here and both are handled: a 401 with
// `{"error":"Invalid JWT"}`, and — the confusing one the plugin also had to
// learn — a 200 carrying an HTML challenge page. Either gets one forced token
// refresh and a retry before being reported as a dead session, since the usual
// cause is simply that the 30-minute window closed mid-warm.
// The `source` argument names the fields to return — see teamSkeetMovieFields.
func teamSkeetSearch(ctx context.Context, q, source string, size, from int, sort string) (teamSkeetSearchResult, error) {
	res, err := teamSkeetSearchOnce(ctx, q, source, size, from, sort, false)
	if err != nil && errors.Is(err, errTeamSkeetRetryable) {
		return teamSkeetSearchOnce(ctx, q, source, size, from, sort, true)
	}
	return res, err
}

// errTeamSkeetRetryable marks the one internal case worth a forced re-mint. Never
// escapes teamSkeetSearch.
var errTeamSkeetRetryable = errors.New("teamskeet token looked valid but was rejected")

func teamSkeetSearchOnce(ctx context.Context, q, source string, size, from int, sort string, force bool) (teamSkeetSearchResult, error) {
	var out teamSkeetSearchResult

	token, err := teamSkeetAccessToken(ctx, force)
	if err != nil {
		return out, err
	}

	params := url.Values{
		"q":                {q},
		"size":             {strconv.Itoa(size)},
		"from":             {strconv.Itoa(from)},
		"_source_includes": {source},
	}
	if sort != "" {
		params.Set("sort", sort)
	}
	endpoint := fmt.Sprintf("%s/%s/_search/?%s", teamSkeetSearchBase, teamSkeetIndex, params.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return out, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("User-Agent", iptvRemoteUserAgent)
	req.Header.Set("Origin", teamSkeetAppOrigin)
	req.Header.Set("Referer", teamSkeetAppOrigin+"/")
	req.Header.Set("Accept", "application/json")

	teamSkeetAcquireFetch()
	res, err := teamSkeetHTTPClient.Do(req)
	teamSkeetReleaseFetch()
	if err != nil {
		return out, err
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(res.Body, 32<<20))
	if err != nil {
		return out, err
	}

	rejected := res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden
	notJSON := len(strings.TrimSpace(string(raw))) == 0 || strings.TrimSpace(string(raw))[0] != '{'
	if rejected || notJSON {
		if !force {
			return out, errTeamSkeetRetryable
		}
		return out, fmt.Errorf("%w: the catalog rejected a freshly minted token", errTeamSkeetNoSession)
	}
	if res.StatusCode != http.StatusOK {
		return out, fmt.Errorf("teamskeet search: HTTP %d: %s", res.StatusCode, truncateForError(string(raw)))
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, err
	}
	if len(out.Error) > 0 {
		// Elasticsearch reports query errors in the body, sometimes with a 200.
		return out, fmt.Errorf("teamskeet search: %s", truncateForError(string(out.Error)))
	}
	return out, nil
}

func truncateForError(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 300 {
		return s[:300]
	}
	return s
}

// teamSkeetEscapeLucene escapes the query-string metacharacters, so a series name
// carrying one cannot break the clause or inject a sub-query. Mirrors the
// plugin's escapeLucene.
var teamSkeetLuceneSpecial = regexp.MustCompile(`([+\-!(){}\[\]^"~*?:\\/&|])`)

func teamSkeetEscapeLucene(s string) string {
	return teamSkeetLuceneSpecial.ReplaceAllString(s, `\$1`)
}

// ─── documents ────────────────────────────────────────────────────────────────

// teamSkeetSeries is a `type:series` document — a subscribable sub-brand, which
// is what becomes a channel. Unlike the Gamma sites' facet values these carry
// their own scene count, so discovery needs no sizing pass.
type teamSkeetSeries struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	MovieCount int    `json:"movieCount"`
}

// teamSkeetMovie is a `type:movies` document, trimmed to what scheduling reads.
// Note the absent duration — see the file header.
type teamSkeetMovie struct {
	ID            int    `json:"id"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	PublishedDate int64  `json:"publishedDate"` // epoch seconds
	IsUpcoming    bool   `json:"isUpcoming"`
	Site          struct {
		SiteName string `json:"siteName"`
	} `json:"site"`
}

// ReleaseDate renders the published date the way a schedule wants it.
func (m teamSkeetMovie) ReleaseDate() string {
	if m.PublishedDate <= 0 {
		return ""
	}
	return time.Unix(m.PublishedDate, 0).UTC().Format("2006-01-02")
}

// ─── discovery ────────────────────────────────────────────────────────────────

// teamSkeetListSeries returns every series the account is entitled to, with its
// movie count, newest-and-largest first. One request.
func teamSkeetListSeries(ctx context.Context) ([]teamSkeetSeries, int, error) {
	res, err := teamSkeetSearch(ctx,
		"type:series AND "+teamSkeetTierScope, teamSkeetSeriesFields,
		200, 0, "movieCount:desc")
	if err != nil {
		return nil, 0, err
	}

	series := make([]teamSkeetSeries, 0, len(res.Hits.Hits))
	for _, h := range res.Hits.Hits {
		var s teamSkeetSeries
		if err := json.Unmarshal(h.Source, &s); err != nil || s.Name == "" {
			continue
		}
		series = append(series, s)
	}
	sort.Slice(series, func(i, j int) bool {
		return strings.ToLower(series[i].Name) < strings.ToLower(series[j].Name)
	})

	total, err := teamSkeetCountMovies(ctx, "")
	if err != nil {
		return nil, 0, err
	}
	return series, total, nil
}

// teamSkeetMovieQuery builds the released-and-entitled clause, optionally scoped
// to one series. A series document's `name` is exactly what a movie carries in
// `site.siteName`, which is what makes this join work without an id lookup.
func teamSkeetMovieQuery(series string) string {
	clauses := []string{"type:movies", "NOT isUpcoming:true", teamSkeetTierScope}
	if series != "" {
		clauses = append(clauses, fmt.Sprintf(`site.siteName:"%s"`, teamSkeetEscapeLucene(series)))
	}
	return strings.Join(clauses, " AND ")
}

// teamSkeetIDFields asks for nothing but the id, for the duration sweep. The
// full movie field list carries a description apiece, which across the whole
// catalog is megabytes of prose to reach ten thousand integers.
const teamSkeetIDFields = "id"

// teamSkeetAllMovieIDs returns every entitled, released scene in the catalog.
//
// One request: the whole catalog is around 9,900 scenes, inside Elasticsearch's
// 10,000 result window, so no paging is needed. Should it ever grow past that
// the window truncates rather than errors, and the sweep simply covers the first
// 10,000 — which is why this reports the true total separately, so the shortfall
// is visible instead of silently becoming "finished".
func teamSkeetAllMovieIDs(ctx context.Context) (ids []int, total int, err error) {
	res, err := teamSkeetSearch(ctx, teamSkeetMovieQuery(""), teamSkeetIDFields, teamSkeetResultWindow, 0, "")
	if err != nil {
		return nil, 0, err
	}

	ids = make([]int, 0, len(res.Hits.Hits))
	for _, h := range res.Hits.Hits {
		var m struct {
			ID int `json:"id"`
		}
		if err := json.Unmarshal(h.Source, &m); err != nil || m.ID == 0 {
			continue
		}
		ids = append(ids, m.ID)
	}
	return ids, res.Hits.Total.Value, nil
}

func teamSkeetCountMovies(ctx context.Context, series string) (int, error) {
	res, err := teamSkeetSearch(ctx, teamSkeetMovieQuery(series), teamSkeetMovieFields, 0, 0, "")
	if err != nil {
		return 0, err
	}
	return res.Hits.Total.Value, nil
}

// teamSkeetListMovies returns a series' whole movie list in one request.
//
// Unlike the Algolia providers this needs no date banding: the largest series is
// a few hundred movies, comfortably inside Elasticsearch's result window, so the
// full history arrives at once and sampling happens locally with no second trip.
func teamSkeetListMovies(ctx context.Context, series string, limit int) ([]teamSkeetMovie, error) {
	if limit <= 0 || limit > teamSkeetResultWindow {
		limit = teamSkeetResultWindow
	}
	res, err := teamSkeetSearch(ctx, teamSkeetMovieQuery(series), teamSkeetMovieFields, limit, 0, "publishedDate:desc")
	if err != nil {
		return nil, err
	}

	movies := make([]teamSkeetMovie, 0, len(res.Hits.Hits))
	for _, h := range res.Hits.Hits {
		var m teamSkeetMovie
		if err := json.Unmarshal(h.Source, &m); err != nil || m.ID == 0 || m.IsUpcoming {
			continue
		}
		movies = append(movies, m)
	}
	return movies, nil
}

// ─── streams and durations ────────────────────────────────────────────────────

// teamSkeetWatch is the part of /movie/{id}/watch that matters here. The AVC
// entry is the only one used: vp9 and av1 would both need a re-encode to reach
// MPEG-TS, which for a remote source costs a download *and* a transcode per
// viewer.
type teamSkeetStream2 struct {
	AVC struct {
		Dash     string `json:"dash"`
		HLS      string `json:"hls"`
		Fallback string `json:"fallback"`
	} `json:"avc"`
}

func (s *teamSkeetStream2) UnmarshalJSON(data []byte) error {
	if len(data) == 0 || string(data) == "[]" || string(data) == "null" {
		return nil
	}
	type Alias teamSkeetStream2
	var aux Alias
	if err := json.Unmarshal(data, &aux); err != nil {
		return nil
	}
	*s = teamSkeetStream2(aux)
	return nil
}

type teamSkeetWatch struct {
	Stream2 teamSkeetStream2 `json:"stream2"`
}

func teamSkeetGetWatch(ctx context.Context, movieID int) (teamSkeetWatch, error) {
	var out teamSkeetWatch

	token, err := teamSkeetAccessToken(ctx, false)
	if err != nil {
		return out, err
	}

	endpoint := fmt.Sprintf("%s/movie/%d/watch", teamSkeetAPIBase, movieID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return out, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("User-Agent", iptvRemoteUserAgent)
	req.Header.Set("Origin", teamSkeetAppOrigin)
	req.Header.Set("Referer", teamSkeetAppOrigin+"/")
	req.Header.Set("Accept", "application/json")

	teamSkeetAcquireFetch()
	res, err := teamSkeetHTTPClient.Do(req)
	teamSkeetReleaseFetch()
	if err != nil {
		return out, err
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return out, err
	}
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return out, fmt.Errorf("%w: the stream endpoint rejected the token", errTeamSkeetNoSession)
	}
	if res.StatusCode != http.StatusOK {
		return out, fmt.Errorf("teamskeet movie %d: HTTP %d", movieID, res.StatusCode)
	}

	var envelope struct {
		Data teamSkeetWatch `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return out, err
	}
	return envelope.Data, nil
}

// teamSkeetRenditions reads the available heights out of a manifest URL.
//
// The CacheFly path embeds them in plain text — ".../AVC_,1080,720,480,360,240,
// .mp4.urlset/manifest.mpd" — which is the only place the catalog exposes what
// exists. Reading it beats guessing: an older release really does top out at
// 480p, and asking for AVC_1080.mp4 there returns a 404 (verified).
var teamSkeetRenditionsRe = regexp.MustCompile(`AVC_,([\d,]+),\.mp4\.urlset`)

func teamSkeetRenditions(manifestURL string) []int {
	m := teamSkeetRenditionsRe.FindStringSubmatch(manifestURL)
	if m == nil {
		return nil
	}
	var heights []int
	for _, part := range strings.Split(m[1], ",") {
		if h, err := strconv.Atoi(part); err == nil && h > 0 {
			heights = append(heights, h)
		}
	}
	sort.Sort(sort.Reverse(sort.IntSlice(heights)))
	return heights
}

// teamSkeetProgressiveURL rewrites the AVC fallback URL to a chosen height.
//
// The fallback is a progressive mp4 at whatever height the API decided to offer
// (720p on a modern release, 480p on an old one), and its signed token turns out
// to cover the whole directory rather than that one filename — so swapping the
// number in the path yields the other renditions under the same token. Confirmed
// live in both directions: heights present in the manifest list return 200,
// heights absent from it return 404, which is why the list is consulted rather
// than trusted to contain 1080p.
//
// A progressive file is preferred over the HLS master for the same reason as the
// other providers: -ss becomes a range request rather than a manifest walk, and
// the bitrate of a channel stays predictable instead of depending on which
// variant ffmpeg happens to select.
var teamSkeetFallbackRe = regexp.MustCompile(`^(.*/AVC_)(\d+)(\.mp4)$`)

func teamSkeetProgressiveURL(watch teamSkeetWatch) (string, int) {
	avc := watch.Stream2.AVC
	if avc.Fallback == "" {
		return "", 0
	}

	m := teamSkeetFallbackRe.FindStringSubmatch(avc.Fallback)
	if m == nil {
		// An unexpected shape: use it as-is rather than mangling it. Height is
		// then unknown, which only reads as "unspecified" downstream.
		return avc.Fallback, 0
	}
	prefix, native, suffix := m[1], m[2], m[3]

	manifest := avc.Dash
	if manifest == "" {
		manifest = avc.HLS
	}
	for _, h := range teamSkeetRenditions(manifest) {
		if h <= teamSkeetMaxHeight {
			return fmt.Sprintf("%s%d%s", prefix, h, suffix), h
		}
	}

	// No usable list — the fallback's own height is known to exist.
	h, _ := strconv.Atoi(native)
	return avc.Fallback, h
}

// teamSkeetISODuration parses the MPD's mediaPresentationDuration. The observed
// form is a plain seconds value ("PT2466.299S"), but the full
// hours/minutes/seconds form is legal in the same attribute, so all three are
// handled rather than assuming what has been seen so far is all there is.
var teamSkeetISODurationRe = regexp.MustCompile(`mediaPresentationDuration="PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?"`)

func teamSkeetParseMPDDuration(mpd string) (float64, bool) {
	m := teamSkeetISODurationRe.FindStringSubmatch(mpd)
	if m == nil {
		return 0, false
	}
	var total float64
	for i, mult := range []float64{3600, 60, 1} {
		if m[i+1] == "" {
			continue
		}
		v, err := strconv.ParseFloat(m[i+1], 64)
		if err != nil {
			return 0, false
		}
		total += v * mult
	}
	if total <= 0 {
		return 0, false
	}
	return total, true
}

// teamSkeetMeasureDuration finds out how long a scene is, the only way the
// platform allows: ask for its stream, then read the DASH manifest's own
// duration attribute.
//
// Two requests, and the result is cached permanently by the caller because a
// runtime does not change. A scene with no AVC rendition returns not-found
// rather than an error: it is not measurable *and* not airable, so there is
// nothing to retry.
func teamSkeetMeasureDuration(ctx context.Context, movieID int) (float64, error) {
	watch, err := teamSkeetGetWatch(ctx, movieID)
	if err != nil {
		return 0, err
	}

	manifest := watch.Stream2.AVC.Dash
	if manifest == "" {
		return 0, fmt.Errorf("movie %d has no AVC DASH manifest to measure", movieID)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifest, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", iptvRemoteUserAgent)

	teamSkeetAcquireFetch()
	res, err := teamSkeetHTTPClient.Do(req)
	teamSkeetReleaseFetch()
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("movie %d manifest: HTTP %d", movieID, res.StatusCode)
	}
	// The attribute lives on the root element, so the head of the document is
	// enough — no need to pull a manifest listing every segment.
	head, err := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if err != nil {
		return 0, err
	}

	seconds, ok := teamSkeetParseMPDDuration(string(head))
	if !ok {
		return 0, fmt.Errorf("movie %d manifest carried no readable duration", movieID)
	}
	return seconds, nil
}
