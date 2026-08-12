package api

import (
	"context"
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

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/logger"
)

// Server-side HTML scraper for the NewSensations catalog.
//
// NewSensations has no JSON API — everything is server-rendered PHP
// (category.php, gallery.php, sets.php, advancedsearch.php). The TypeScript
// plugin already scrapes these pages through the backend proxy for the browser
// UI, but it never calls POST /apihub-newsensations/import — so the IPTV
// provider's SQLite store stays empty.
//
// This file does the same scraping from Go, running automatically during the
// IPTV warm cycle's Prepare() call. Two phases:
//
//  1. Series enumeration: Fetch the series index page (category.php?id=679),
//     parse the banner tracks, follow each redirect to discover the series id,
//     name, poster URL, and scene count. ~224 fetches at 16-concurrent.
//
//  2. Scene detail: For each series, page through its scene grid and fetch
//     each scene's detail page to get video URLs, durations, posters, and
//     heights. Runs in the background — channels appear as "warming" while
//     this runs, using the same iptvNetPreparer contract as TeamSkeet.
//
// The cookie is read from the apihub plugin config (key "newsensationsCookie"),
// same place the TypeScript plugin persists it via configurePlugin.

const (
	nsPluginID   = "apihub"
	nsConfigKey  = "newsensationsCookie"
	nsMemberBase = "https://newsensations.com/members/"

	nsHTTPTimeout   = 30 * time.Second
	nsBatchSize     = 16
	nsSceneBatch    = 8
	nsScenePageSize = 24

	// nsSweepIdle is how long after a completed sweep before another is
	// worth starting. A finished sweep means the whole catalog is stored;
	// only new releases can change that.
	nsSweepIdle = 6 * time.Hour

	// nsSweepRetry is the wait after a sweep that *failed*, which must not
	// inherit the idle period — a momentary network error should not stop
	// the lineup for six hours.
	nsSweepRetry = 5 * time.Minute
)

var errNSWarming = errors.New("NewSensations catalog is still being scraped")

// ─── session ──────────────────────────────────────────────────────────────────

// nsLoadSessionCookie reads the NewSensations member cookie header from the
// apihub plugin config. Returns "" when nothing is stored.
func nsLoadSessionCookie() string {
	pc := config.GetInstance().GetPluginConfiguration(nsPluginID)
	if pc == nil {
		return ""
	}
	if v, ok := pc[nsConfigKey].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

// nsSessionHasCookie is the fast check for SessionLive(). It does not prove
// the cookie still works — only that the user has pasted one.
func nsSessionHasCookie() bool {
	return nsLoadSessionCookie() != ""
}

// ─── HTTP client ──────────────────────────────────────────────────────────────

var nsHTTPClient = &http.Client{
	Timeout: nsHTTPTimeout,
	// Follow redirects — needed for bannerload.php → category.php resolution.
}

// nsMemberGet performs an authenticated GET to the NewSensations member area.
// Returns the response body as a string and the final URL after redirects.
func nsMemberGet(ctx context.Context, path string) (body string, finalURL string, err error) {
	cookie := nsLoadSessionCookie()
	if cookie == "" {
		return "", "", fmt.Errorf("no NewSensations session cookie stored")
	}

	url := nsMemberBase + path
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Cookie", cookie)
	req.Header.Set("User-Agent", iptvRemoteUserAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

	res, err := nsHTTPClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("NewSensations returned HTTP %d for %s", res.StatusCode, path)
	}

	b, err := io.ReadAll(io.LimitReader(res.Body, 4<<20)) // 4 MB cap
	if err != nil {
		return "", "", err
	}

	final := ""
	if res.Request != nil && res.Request.URL != nil {
		final = res.Request.URL.String()
	}

	return string(b), final, nil
}

// ─── HTML parsers ─────────────────────────────────────────────────────────────
//
// These are Go ports of the TypeScript parsers in parse.ts. They use regex
// rather than a full HTML parser — the markup is well-structured and the
// specific attributes we need are safe to extract this way.

// nsParseSeriesBannerTracks parses the series index page for bannerload.php
// track links. Returns a list of track ids.
//
// Matches: <a href="bannerload.php?track=XXXX">
var nsBannerTrackRe = regexp.MustCompile(`(?i)href\s*=\s*["'](?:[^"']*?)bannerload\.php\?track=(\d+)["']`)

func nsParseSeriesBannerTracks(html string) []string {
	matches := nsBannerTrackRe.FindAllStringSubmatch(html, -1)
	seen := make(map[string]bool, len(matches))
	var tracks []string
	for _, m := range matches {
		id := m[1]
		if seen[id] {
			continue
		}
		seen[id] = true
		tracks = append(tracks, id)
	}
	return tracks
}

// nsParsePagination extracts data-totalitems from the .ex-pagination element.
var nsPaginationTotalRe = regexp.MustCompile(`(?i)class\s*=\s*["'][^"']*ex-pagination[^"']*["'][^>]*data-totalitems\s*=\s*["'](\d+)["']`)
var nsPaginationTotalRe2 = regexp.MustCompile(`(?i)data-totalitems\s*=\s*["'](\d+)["'][^>]*class\s*=\s*["'][^"']*ex-pagination`)

func nsParsePaginationTotal(html string) int {
	if m := nsPaginationTotalRe.FindStringSubmatch(html); m != nil {
		n, _ := strconv.Atoi(m[1])
		return n
	}
	if m := nsPaginationTotalRe2.FindStringSubmatch(html); m != nil {
		n, _ := strconv.Atoi(m[1])
		return n
	}
	return 0
}

// nsParsePageContextLabel extracts the <meta name="keywords"> content, which
// holds the series/category display name.
var nsMetaKeywordsRe = regexp.MustCompile(`(?i)<meta\s+name\s*=\s*["']keywords["']\s+content\s*=\s*["']([^"']+)["']`)

func nsParsePageContextLabel(html string) string {
	m := nsMetaKeywordsRe.FindStringSubmatch(html)
	if m == nil {
		return ""
	}
	return strings.TrimSpace(m[1])
}

// nsParseCategoryBanner extracts the banner image URL from a series page.
var nsCategoryBannerRe = regexp.MustCompile(`(?i)data-max-item-width\s*=\s*["']1920["'][^>]*>.*?<img[^>]+src\s*=\s*["']([^"']+)["']`)

func nsParseCategoryBanner(html string) string {
	m := nsCategoryBannerRe.FindStringSubmatch(html)
	if m == nil {
		return ""
	}
	return m[1]
}

// nsParseIDFromURL extracts ?id=N or &id=N from a URL string.
var nsIDFromURLRe = regexp.MustCompile(`[?&]id=(\d+)`)

func nsParseIDFromURL(u string) string {
	m := nsIDFromURLRe.FindStringSubmatch(u)
	if m == nil {
		return ""
	}
	return m[1]
}

// nsParseMinibiteGrid extracts scene tile IDs from .ex-minibite elements.
// Returns a list of scene IDs found on the page.
var nsMinibiteRe = regexp.MustCompile(`(?i)class\s*=\s*["'][^"']*ex-minibite[^"']*["'][^>]*data-url\s*=\s*["']gallery\.php\?id=(\d+)[^"']*["']`)
var nsMinibiteRe2 = regexp.MustCompile(`(?i)data-url\s*=\s*["']gallery\.php\?id=(\d+)[^"']*["'][^>]*class\s*=\s*["'][^"']*ex-minibite`)

func nsParseSceneIDs(html string) []int {
	seen := make(map[int]bool)
	var ids []int

	for _, re := range []*regexp.Regexp{nsMinibiteRe, nsMinibiteRe2} {
		for _, m := range re.FindAllStringSubmatch(html, -1) {
			id, err := strconv.Atoi(m[1])
			if err != nil || seen[id] {
				continue
			}
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids
}

// nsParseScenePage extracts video source URL, height, codec, title, duration,
// and poster from a scene detail page (gallery.php?id=X&type=vids).
//
// The player's data-sources attribute is a JSON array:
//   [{"label":"1080p","src":"https://...","type":"mp4","height":1080}, ...]
//
// Duration is in the format "N Minutes" in the metadata block.
type nsScrapedScene struct {
	ID              int
	Title           string
	PosterURL       string
	DurationSeconds float64
	VideoURL        string
	VideoCodec      string
	VideoHeight     int
	SeriesID        string
}

var nsPlayerSourcesRe = regexp.MustCompile(`(?i)class\s*=\s*["'][^"']*ex-player[^"']*["'][^>]*data-sources\s*=\s*['"](\[.*?\])['"]`)
var nsPlayerSourcesRe2 = regexp.MustCompile(`(?i)data-sources\s*=\s*['"](\[.*?\])['"]\s*[^>]*class\s*=\s*["'][^"']*ex-player`)

// nsSrcRe parses individual source entries from the data-sources JSON. We use
// regex rather than json.Unmarshal because the attribute value is HTML-entity
// encoded on the wire (&quot; etc) and we're working with raw HTML.
var nsSrcEntryRe = regexp.MustCompile(`"src"\s*:\s*"([^"]+)"`)
var nsHeightEntryRe = regexp.MustCompile(`"height"\s*:\s*(\d+)`)
var nsLabelEntryRe = regexp.MustCompile(`"label"\s*:\s*"([^"]+)"`)
var nsDurationMinutesRe = regexp.MustCompile(`(?i)(\d+)\s*Minutes`)
var nsTitleRe = regexp.MustCompile(`(?i)<h4[^>]*>(.*?)</h4>`)
var nsPosterRe = regexp.MustCompile(`(?i)class\s*=\s*["'][^"']*ex-edge-fade[^"']*["'][^>]*>.*?<img[^>]+src\s*=\s*["']([^"']+)["']`)
var nsSeriesLinkRe = regexp.MustCompile(`(?i)Series:\s*</?\w[^>]*>\s*<a[^>]+href\s*=\s*["'][^"']*category\.php\?id=(\d+)[^"']*["']`)

func nsParseScenePage(html string, id int, fallbackSeriesID string) *nsScrapedScene {
	scene := &nsScrapedScene{ID: id, SeriesID: fallbackSeriesID}

	// Title
	if m := nsTitleRe.FindStringSubmatch(html); m != nil {
		scene.Title = strings.TrimSpace(nsStripTags(m[1]))
	}

	// Poster
	if m := nsPosterRe.FindStringSubmatch(html); m != nil {
		scene.PosterURL = nsHTMLUnescape(m[1])
	}

	// Duration
	if m := nsDurationMinutesRe.FindStringSubmatch(html); m != nil {
		minutes, _ := strconv.Atoi(m[1])
		scene.DurationSeconds = float64(minutes) * 60
	}

	// Series ID from page (only use as fallback if fallbackSeriesID is empty,
	// and filter out generic index/category IDs like "679", "5", "3")
	if scene.SeriesID == "" {
		if m := nsSeriesLinkRe.FindStringSubmatch(html); m != nil {
			id := m[1]
			if id != "679" && id != "5" && id != "3" {
				scene.SeriesID = id
			}
		}
	}

	// Video sources — try to find the data-sources attribute
	var sourcesJSON string
	if m := nsPlayerSourcesRe.FindStringSubmatch(html); m != nil {
		sourcesJSON = m[1]
	} else if m := nsPlayerSourcesRe2.FindStringSubmatch(html); m != nil {
		sourcesJSON = m[1]
	}

	if sourcesJSON != "" {
		// HTML-unescape the JSON
		sourcesJSON = nsHTMLUnescape(sourcesJSON)

		type nsSourceItem struct {
			Label  string      `json:"label"`
			Src    string      `json:"src"`
			Type   string      `json:"type"`
			Height interface{} `json:"height"`
		}

		var items []nsSourceItem
		bestHeight := 0

		if err := json.Unmarshal([]byte(sourcesJSON), &items); err == nil && len(items) > 0 {
			for _, item := range items {
				url := strings.TrimSpace(item.Src)
				url = strings.ReplaceAll(url, "\\/", "/")
				if url == "" {
					continue
				}

				height := 0
				switch h := item.Height.(type) {
				case float64:
					height = int(h)
				case string:
					height, _ = strconv.Atoi(h)
				}
				if height == 0 && item.Label != "" {
					if hm := regexp.MustCompile(`(\d+)`).FindStringSubmatch(item.Label); hm != nil {
						height, _ = strconv.Atoi(hm[1])
					}
				}

				if height > bestHeight || scene.VideoURL == "" {
					bestHeight = height
					scene.VideoURL = url
					scene.VideoHeight = height
					scene.VideoCodec = "h264"
				}
			}
		} else {
			// Fallback regex parser
			entries := strings.Split(sourcesJSON, "},{")
			for _, entry := range entries {
				srcMatch := nsSrcEntryRe.FindStringSubmatch(entry)
				if srcMatch == nil {
					continue
				}
				url := strings.TrimSpace(srcMatch[1])
				url = strings.ReplaceAll(url, "\\/", "/")

				height := 0
				if hm := nsHeightEntryRe.FindStringSubmatch(entry); hm != nil {
					height, _ = strconv.Atoi(hm[1])
				} else if lm := nsLabelEntryRe.FindStringSubmatch(entry); lm != nil {
					if hm2 := regexp.MustCompile(`(\d+)`).FindStringSubmatch(lm[1]); hm2 != nil {
						height, _ = strconv.Atoi(hm2[1])
					}
				}

				if height > bestHeight || scene.VideoURL == "" {
					bestHeight = height
					scene.VideoURL = url
					scene.VideoHeight = height
					scene.VideoCodec = "h264"
				}
			}
		}
	}

	return scene
}

// nsHTMLUnescape decodes the common HTML entities found in attribute values.
var nsHTMLUnescaper = strings.NewReplacer(
	"&quot;", `"`,
	"&amp;", "&",
	"&lt;", "<",
	"&gt;", ">",
	"&#39;", "'",
	"&apos;", "'",
)

func nsHTMLUnescape(s string) string {
	return nsHTMLUnescaper.Replace(s)
}

var nsTagRe = regexp.MustCompile(`<[^>]*>`)

func nsStripTags(s string) string {
	return nsTagRe.ReplaceAllString(s, "")
}

// ─── series enumeration ───────────────────────────────────────────────────────

// nsResolveBannerSeries follows a banner-track redirect and parses the landing
// page for series id, name, poster URL, and scene count.
func nsResolveBannerSeries(ctx context.Context, trackID string) (*nsStoredSeries, error) {
	body, finalURL, err := nsMemberGet(ctx, "bannerload.php?track="+trackID)
	if err != nil {
		return nil, err
	}

	id := nsParseIDFromURL(finalURL)
	if id == "" {
		return nil, fmt.Errorf("banner track %s did not redirect to a category page", trackID)
	}

	name := nsParsePageContextLabel(body)
	if name == "" {
		name = id // fallback
	}

	total := nsParsePaginationTotal(body)

	return &nsStoredSeries{
		ID:         id,
		Name:       name,
		PosterURL:  nsParseCategoryBanner(body),
		SceneCount: total,
	}, nil
}

// nsScrapeSeriesIndex fetches the series index page, resolves all banner tracks,
// and upserts the series into the SQLite store.
func nsScrapeSeriesIndex(ctx context.Context) ([]nsStoredSeries, error) {
	html, _, err := nsMemberGet(ctx, "category.php?id=679")
	if err != nil {
		return nil, fmt.Errorf("could not fetch series index: %w", err)
	}

	tracks := nsParseSeriesBannerTracks(html)
	if len(tracks) == 0 {
		return nil, fmt.Errorf("series index page had no banner tracks")
	}

	logger.Infof("[apihub] NS scraper: found %d banner tracks on series index page", len(tracks))

	var (
		mu     sync.Mutex
		series []nsStoredSeries
	)

	// Resolve in batches of nsBatchSize concurrent requests.
	for i := 0; i < len(tracks); i += nsBatchSize {
		end := i + nsBatchSize
		if end > len(tracks) {
			end = len(tracks)
		}
		batch := tracks[i:end]

		var wg sync.WaitGroup
		for _, trackID := range batch {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			wg.Add(1)
			go func(tid string) {
				defer wg.Done()
				s, err := nsResolveBannerSeries(ctx, tid)
				if err != nil {
					logger.Debugf("[apihub] NS scraper: could not resolve banner track %s: %v", tid, err)
					return
				}
				mu.Lock()
				series = append(series, *s)
				mu.Unlock()
			}(trackID)
		}
		wg.Wait()
	}

	if len(series) == 0 {
		return nil, fmt.Errorf("no series could be resolved from %d banner tracks", len(tracks))
	}

	// Upsert to the SQLite store.
	if err := nsCatalog.upsertSeriesList(series); err != nil {
		return nil, fmt.Errorf("could not persist series: %w", err)
	}

	logger.Infof("[apihub] NS scraper: %d series resolved and stored", len(series))
	return series, nil
}

// ─── scene scraping ───────────────────────────────────────────────────────────

// nsScrapeSeriesScenes pages through a series' scene grid and fetches detail
// pages for each scene to get video URLs and durations.
func nsScrapeSeriesScenes(ctx context.Context, seriesID string, maxScenes int) (int, error) {
	var allSceneIDs []int

	// Page through the series grid to collect scene IDs.
	totalPages := 1
	for page := 1; page <= totalPages; page++ {
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}

		path := fmt.Sprintf("category.php?id=%s&numpage=%d&page=%d&sort=date", seriesID, nsScenePageSize, page)
		html, _, err := nsMemberGet(ctx, path)
		if err != nil {
			logger.Debugf("[apihub] NS scraper: could not fetch series %s page %d: %v", seriesID, page, err)
			break
		}

		sceneIDs := nsParseSceneIDs(html)
		allSceneIDs = append(allSceneIDs, sceneIDs...)

		// On the first page, calculate total pages from pagination.
		if page == 1 {
			total := nsParsePaginationTotal(html)
			if total > 0 {
				totalPages = (total + nsScenePageSize - 1) / nsScenePageSize
			}
		}

		if len(sceneIDs) == 0 {
			break // no more scenes on this page
		}
	}

	if len(allSceneIDs) == 0 {
		return 0, nil
	}

	// Always update series_id in the store for all scenes found on this series' grid pages.
	// This fixes any existing scenes in the store that had incorrect or generic series IDs.
	_ = nsCatalog.updateSeriesIDForScenes(allSceneIDs, seriesID)

	// Check which scenes are already in the store (have video URLs).
	existingCount := 0
	for _, id := range allSceneIDs {
		if s := nsCatalog.lookupScene(id); s != nil && s.VideoURL != "" {
			existingCount++
		}
	}

	if existingCount > 0 {
		for i := 0; i < existingCount; i++ {
			nsSweep.recordScene(true)
		}
	}

	// If everything is already scraped, skip.
	pending := allSceneIDs
	if existingCount > 0 {
		var filtered []int
		for _, id := range allSceneIDs {
			if s := nsCatalog.lookupScene(id); s == nil || s.VideoURL == "" {
				filtered = append(filtered, id)
			}
		}
		pending = filtered
	}

	if len(pending) == 0 {
		return existingCount, nil
	}

	// Fetch detail pages in batches.
	scraped := 0
	for i := 0; i < len(pending); i += nsSceneBatch {
		end := i + nsSceneBatch
		if end > len(pending) {
			end = len(pending)
		}
		batch := pending[i:end]

		var (
			wg     sync.WaitGroup
			mu     sync.Mutex
			scenes []nsStoredScene
		)

		for _, sceneID := range batch {
			if ctx.Err() != nil {
				break
			}
			wg.Add(1)
			go func(sid int) {
				defer wg.Done()

				path := fmt.Sprintf("gallery.php?id=%d&type=vids", sid)
				html, _, err := nsMemberGet(ctx, path)
				if err != nil {
					logger.Debugf("[apihub] NS scraper: could not fetch scene %d: %v", sid, err)
					nsSweep.recordScene(false)
					return
				}

				parsed := nsParseScenePage(html, sid, seriesID)
				if parsed == nil || parsed.VideoURL == "" {
					nsSweep.recordScene(false)
					return
				}

				mu.Lock()
				scenes = append(scenes, nsStoredScene{
					ID:              parsed.ID,
					Title:           parsed.Title,
					PosterURL:       parsed.PosterURL,
					DurationSeconds: parsed.DurationSeconds,
					VideoURL:        parsed.VideoURL,
					VideoCodec:      parsed.VideoCodec,
					VideoHeight:     parsed.VideoHeight,
					SeriesID:        parsed.SeriesID,
				})
				mu.Unlock()
				nsSweep.recordScene(true)
			}(sceneID)
		}
		wg.Wait()

		if len(scenes) > 0 {
			if err := nsCatalog.upsertScenes(scenes); err != nil {
				logger.Warnf("[apihub] NS scraper: failed to persist %d scenes: %v", len(scenes), err)
			}
			scraped += len(scenes)
		}
	}

	return existingCount + scraped, nil
}

// nsFetchSingleSceneVideoURL fetches a fresh pre-signed video URL on-demand for a single scene
// by scraping its gallery.php page (1 HTTP request, ~200ms). Upserts to SQLite and returns the scene.
func nsFetchSingleSceneVideoURL(ctx context.Context, sceneID int) (*nsScrapedScene, error) {
	if !nsSessionHasCookie() {
		return nil, fmt.Errorf("no NewSensations session cookie stored")
	}

	path := fmt.Sprintf("gallery.php?id=%d&type=vids", sceneID)
	html, _, err := nsMemberGet(ctx, path)
	if err != nil {
		return nil, fmt.Errorf("fetch gallery.php for scene %d: %w", sceneID, err)
	}

	parsed := nsParseScenePage(html, sceneID, "")
	if parsed == nil || parsed.VideoURL == "" {
		return nil, fmt.Errorf("could not parse video URL for scene %d from HTML", sceneID)
	}

	stored := nsStoredScene{
		ID:              parsed.ID,
		Title:           parsed.Title,
		PosterURL:       parsed.PosterURL,
		DurationSeconds: parsed.DurationSeconds,
		VideoURL:        parsed.VideoURL,
		VideoCodec:      parsed.VideoCodec,
		VideoHeight:     parsed.VideoHeight,
		SeriesID:        parsed.SeriesID,
	}

	if err := nsCatalog.upsertScenes([]nsStoredScene{stored}); err != nil {
		logger.Warnf("[apihub] NS scraper: failed to upsert single scene %d: %v", sceneID, err)
	}

	return parsed, nil
}

// ─── sweep state ──────────────────────────────────────────────────────────────

// nsSweepState tracks the progress of the catalog scrape, following the same
// pattern as teamSkeetSweepState.
type nsSweepState struct {
	mu sync.Mutex

	running   bool
	startedAt time.Time
	endedAt   time.Time
	retryAt   time.Time

	// Phase tracks where in the scrape we are.
	phase string // "series", "scenes", ""

	// Series enumeration progress.
	seriesDone  int
	seriesTotal int

	// Scene scraping progress.
	sceneDone   int
	sceneTotal  int
	sceneFailed int

	lastErr error
}

var nsSweep = &nsSweepState{}

func (s *nsSweepState) forceReset() {
	s.mu.Lock()
	s.endedAt = time.Time{}
	s.retryAt = time.Time{}
	s.mu.Unlock()
}

func (s *nsSweepState) begin() bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return false
	}
	if time.Now().Before(s.retryAt) {
		return false
	}
	if !s.endedAt.IsZero() && time.Since(s.endedAt) < nsSweepIdle {
		return false
	}

	s.running = true
	s.startedAt = time.Now()
	s.phase = ""
	s.seriesDone, s.seriesTotal = 0, 0
	s.sceneDone, s.sceneTotal, s.sceneFailed = 0, 0, 0
	s.lastErr = nil
	return true
}

func (s *nsSweepState) end(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.running = false
	s.phase = ""
	s.lastErr = err

	if err != nil {
		s.retryAt = time.Now().Add(nsSweepRetry)
		return
	}
	s.endedAt = time.Now()
	s.retryAt = time.Time{}
}

func (s *nsSweepState) setPhase(phase string) {
	s.mu.Lock()
	s.phase = phase
	s.mu.Unlock()
}

func (s *nsSweepState) setSeriesTotal(n int) {
	s.mu.Lock()
	s.seriesTotal = n
	s.mu.Unlock()
}

func (s *nsSweepState) recordSeries() {
	s.mu.Lock()
	s.seriesDone++
	s.mu.Unlock()
}

func (s *nsSweepState) setSceneTotal(n int) {
	s.mu.Lock()
	s.sceneTotal = n
	s.mu.Unlock()
}

func (s *nsSweepState) recordScene(ok bool) {
	s.mu.Lock()
	if ok {
		s.sceneDone++
	} else {
		s.sceneFailed++
	}
	s.mu.Unlock()
}

func (s *nsSweepState) progress() (running bool, phase string, seriesDone, seriesTotal, sceneDone, sceneTotal, sceneFailed int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running, s.phase, s.seriesDone, s.seriesTotal, s.sceneDone, s.sceneTotal, s.sceneFailed
}

// ─── the sweep ────────────────────────────────────────────────────────────────

// nsRunSweep is the full catalog scrape: enumerate series, then scrape scenes.
func nsRunSweep(ctx context.Context) {
	var err error
	defer func() { nsSweep.end(err) }()

	// Phase 1: Series enumeration
	nsSweep.setPhase("series")
	logger.Infof("[apihub] NS scraper: starting series enumeration")

	series, seriesErr := nsScrapeSeriesIndex(ctx)
	if seriesErr != nil {
		err = seriesErr
		logger.Warnf("[apihub] NS scraper: series enumeration failed: %v", err)
		return
	}

	nsSweep.setSeriesTotal(len(series))
	for range series {
		nsSweep.recordSeries()
	}

	// Phase 2: Scene detail scraping
	nsSweep.setPhase("scenes")

	// Count total scenes across all series for progress tracking.
	totalScenes := 0
	for _, s := range series {
		totalScenes += s.SceneCount
	}
	nsSweep.setSceneTotal(totalScenes)

	logger.Infof("[apihub] NS scraper: starting scene detail scraping across %d series (~%d scenes)", len(series), totalScenes)

	for _, s := range series {
		if ctx.Err() != nil {
			err = ctx.Err()
			return
		}
		scraped, sceneErr := nsScrapeSeriesScenes(ctx, s.ID, s.SceneCount)
		if sceneErr != nil {
			logger.Debugf("[apihub] NS scraper: failed to scrape scenes for series %s (%s): %v", s.ID, s.Name, sceneErr)
			continue
		}
		if scraped > 0 {
			logger.Debugf("[apihub] NS scraper: %d scenes scraped for series %s (%s)", scraped, s.ID, s.Name)
		}
	}

	running, _, _, _, sceneDone, _, sceneFailed := nsSweep.progress()
	if running {
		logger.Infof("[apihub] NS scraper: completed. %d scenes scraped (%d could not be read); %d series in the catalog",
			sceneDone, sceneFailed, len(series))
	}
}
