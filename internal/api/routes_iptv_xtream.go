package api

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/logger"
)

// Xtream Codes Series API — Adult Time movies only, as on-demand content
// alongside (never instead of) the 24/7 linear channels in routes_iptv.go.
//
// TiviMate's dedicated TV Shows/Series tab, and every other Xtream-compatible
// IPTV app, only get real on-demand browsing (posters, per-title metadata,
// click-through episode lists) through this panel API — plain M3U has no such
// support. The protocol fixes the URL shapes clients call, so these routes
// are registered at the server root (see server.go) rather than nested under
// /iptv: `/player_api.php` and `/series/{username}/{password}/{id}.{ext}` are
// exactly what a TiviMate "Xtream Codes" login constructs, verbatim.
//
// A "movie" in Adult Time's catalog is a multi-scene collection — there is no
// single file that is the movie. Xtream's VOD/Movies content type has no
// answer for that (a VOD "stream" is definitionally the one playable file),
// which is why this is Series instead: **series = movie**, **episode = one
// scene** belonging to it, all under a single season. That gives exactly the
// browsing shape the site itself has — open a movie, see its scene list,
// pick one — and it's what TiviMate's Series tab already does natively
// (poster grid → click → episode list), rather than a VOD tab dumping every
// scene from every movie as its own top-level tile.
const (
	iptvXtreamPlayerAPIPath    = "/player_api.php"
	iptvXtreamSeriesPathPrefix = "/series/"
	iptvXtreamLivePathPrefix   = "/live/"
	iptvXtreamXMLTVPath        = "/xmltv.php"

	// adultTimeSeriesCategoryID is the one category every movie/series lives
	// in. There's nothing meaningful to group movies by beyond "Adult Time"
	// itself (no channel/studio hierarchy the way scenes have) — one category
	// keeps the Series tab a single poster grid rather than a list of
	// one-series-each folders.
	adultTimeSeriesCategoryID = "1"
)

// ─── auth bridge ────────────────────────────────────────────────────────────

// iptvXtreamAuthBridge lets Xtream clients authenticate the way an M3U player
// already does — via the Stash API key — without teaching Stash's core
// session handling anything about the Xtream protocol.
//
// Xtream apps have no field for a raw `apikey` query param; they only offer
// username/password and build every request themselves in a fixed shape this
// server cannot change. This middleware, registered in server.go immediately
// before authenticateHandler(), copies whichever of those two shapes carries
// the credential into the `apikey` query param the rest of the server already
// validates — the same one `iptvURL()` appends for the M3U/logo/EPG URLs (see
// routes_iptv.go). No new credential storage, no new auth mechanism: the
// username field is never inspected, since Xtream requires it to exist, not
// that it mean anything. The password field is expected to be the Stash API
// key.
//
// Only bridged when a real API key is actually configured. An instance with
// none has authentication fully disabled server-wide (the same condition
// iptvURL already special-cases — it omits the `apikey` param entirely rather
// than sending an empty one), and an Xtream client always sends *some*
// password whether or not the user has a real key to put there. Bridging a
// placeholder value through unconditionally turned a request that would have
// been let in for free into one carrying a garbage apikey — which
// SessionStore.Authenticate correctly treats as an actively invalid
// credential and rejects, a strictly worse outcome than sending nothing.
// Confirmed live: password=vexxx on a server with no configured key answered
// 401, while the identical request with no password/apikey at all answered
// 200. When a real key *is* configured, whatever the client sent is bridged
// through unconditionally and stands or falls on its own — this only ever
// widens access on a server that already has none.
func iptvXtreamAuthBridge(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if cred := iptvXtreamCredential(r); cred != "" && config.GetInstance().GetAPIKey() != "" {
			q := r.URL.Query()
			if q.Get("apikey") == "" {
				q.Set("apikey", cred)
				r.URL.RawQuery = q.Encode()
			}
		}
		next.ServeHTTP(w, r)
	})
}

// iptvXtreamCredential extracts the Xtream "password" field from whichever of
// three request shapes this is: a query param (player_api.php, xmltv.php) or
// a path segment (/series/..., /live/...).
func iptvXtreamCredential(r *http.Request) string {
	if r.URL.Path == iptvXtreamPlayerAPIPath || r.URL.Path == iptvXtreamXMLTVPath {
		return r.URL.Query().Get("password")
	}
	for _, prefix := range [...]string{iptvXtreamSeriesPathPrefix, iptvXtreamLivePathPrefix} {
		if rest, ok := strings.CutPrefix(r.URL.Path, prefix); ok {
			parts := strings.SplitN(rest, "/", 3)
			if len(parts) >= 2 {
				return parts[1]
			}
			break
		}
	}
	return ""
}

// ─── routes ─────────────────────────────────────────────────────────────────

// iptvXtreamRoutes holds the same iptvRoutes the /iptv mount uses, so live
// channels are the exact lineup, schedule cache and streaming pipeline the
// M3U/EPG/channel-stream endpoints already have — not a second copy warming
// its own background scrapes of every network catalog.
type iptvXtreamRoutes struct {
	iptv iptvRoutes
}

func newIPTVXtreamRoutes(iptv iptvRoutes) iptvXtreamRoutes { return iptvXtreamRoutes{iptv: iptv} }

// Register adds the Xtream endpoints directly to the root router. Not a
// chi.Mount: a mounted sub-router adds its own prefix, and these paths must
// be exactly what an Xtream client constructs from a bare server URL.
func (rs iptvXtreamRoutes) Register(r chi.Router) {
	r.Get(iptvXtreamPlayerAPIPath, rs.PlayerAPI)
	r.Get(iptvXtreamSeriesPathPrefix+"{username}/{password}/{episodeId}", rs.SeriesEpisodeStream)
	// No required extension: confirmed live that TiviMate ignores
	// direct_source for live channels and reconstructs the URL itself from
	// the numeric stream_id with no container_extension appended at all
	// (unlike series episodes, where it happened to line up either way — see
	// LiveChannelStream for why live needs its own handler rather than
	// reusing ChannelStream directly).
	r.Get(iptvXtreamLivePathPrefix+"{username}/{password}/{streamId}", rs.LiveChannelStream)
	// The standard Xtream EPG endpoint — TiviMate requests this
	// unconditionally for any Xtream playlist. Answered with the exact same
	// guide /iptv/xmltv.xml already generates rather than a stub, so live
	// channels get a real programme guide through Xtream too.
	r.Get(iptvXtreamXMLTVPath, rs.iptv.XMLTV)
}

// PlayerAPI answers every `player_api.php` action this panel supports.
// Actions this deployment doesn't carry (live, VOD, EPG) answer an empty list
// rather than an error — the same shape a real panel gives a category it
// happens to have nothing in, which is how Xtream apps expect an
// unsupported/empty content type to look.
func (rs iptvXtreamRoutes) PlayerAPI(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Query().Get("action") {
	case "":
		rs.accountInfo(w, r)
	case "get_live_categories":
		rs.liveCategories(w, r)
	case "get_live_streams":
		rs.liveStreams(w, r)
	case "get_series_categories":
		rs.seriesCategories(w, r)
	case "get_series":
		rs.seriesList(w, r)
	case "get_series_info":
		rs.seriesInfo(w, r)
	default:
		writeJSON(w, []interface{}{})
	}
}

// ─── account/server info ───────────────────────────────────────────────────

type xtreamUserInfo struct {
	Username       string `json:"username"`
	Password       string `json:"password"`
	Auth           int    `json:"auth"`
	Status         string `json:"status"`
	ExpDate        string `json:"exp_date"`
	IsTrial        string `json:"is_trial"`
	ActiveCons     string `json:"active_cons"`
	MaxConnections string `json:"max_connections"`
}

type xtreamServerInfo struct {
	URL            string `json:"url"`
	Port           string `json:"port"`
	HTTPSPort      string `json:"https_port"`
	ServerProtocol string `json:"server_protocol"`
	Timezone       string `json:"timezone"`
	TimestampNow   int64  `json:"timestamp_now"`
	TimeNow        string `json:"time_now"`
}

// accountInfo answers the login-check call every Xtream client makes first.
// By the time this handler runs, iptvXtreamAuthBridge + authenticateHandler
// have already accepted the request's apikey, so the account is genuinely
// active — there is nothing further to validate here.
func (rs iptvXtreamRoutes) accountInfo(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	scheme, host, port := iptvXtreamHostParts(r)

	writeJSON(w, struct {
		UserInfo   xtreamUserInfo   `json:"user_info"`
		ServerInfo xtreamServerInfo `json:"server_info"`
	}{
		UserInfo: xtreamUserInfo{
			Username: r.URL.Query().Get("username"),
			Password: r.URL.Query().Get("password"),
			Auth:     1,
			Status:   "Active",
			// Far in the future — this server has no real subscription expiry,
			// and a blank/zero value reads to some clients as already expired.
			ExpDate:        strconv.FormatInt(now.AddDate(10, 0, 0).Unix(), 10),
			IsTrial:        "0",
			ActiveCons:     "0",
			MaxConnections: "1",
		},
		ServerInfo: xtreamServerInfo{
			URL:            host,
			Port:           port,
			HTTPSPort:      port,
			ServerProtocol: scheme,
			Timezone:       "UTC",
			TimestampNow:   now.Unix(),
			TimeNow:        now.UTC().Format("2006-01-02 15:04:05"),
		},
	})
}

// ─── live channels ──────────────────────────────────────────────────────────
//
// The exact lineup, schedule cache and MPEG-TS pipeline /iptv/playlist.m3u
// and /iptv/ch/{id}.ts already use (rs.iptv) — this is a JSON reshape of the
// same data, not a second implementation of any of it.

type xtreamLiveCategory struct {
	CategoryID   string `json:"category_id"`
	CategoryName string `json:"category_name"`
	ParentID     int    `json:"parent_id"`
}

func (rs iptvXtreamRoutes) liveCategories(w http.ResponseWriter, r *http.Request) {
	s := rs.iptv.settings()
	channels, _, err := rs.iptv.channelList(r, s)
	if err != nil {
		logger.Warnf("[iptv] xtream: building channel list: %v", err)
		writeJSON(w, []interface{}{})
		return
	}

	seen := make(map[string]bool, len(channels))
	out := make([]xtreamLiveCategory, 0, len(channels))
	for _, ch := range channels {
		name := iptvGroupTitle(ch, s)
		if seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, xtreamLiveCategory{
			// iptvNetChannelSeed just needs to turn a string into a stable
			// positive int — already used for exactly that (network channel
			// ids), unrelated to what it's named for here.
			CategoryID:   strconv.Itoa(iptvNetChannelSeed(name)),
			CategoryName: name,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CategoryName < out[j].CategoryName })
	writeJSON(w, out)
}

type xtreamLiveStream struct {
	Num                int    `json:"num"`
	Name               string `json:"name"`
	StreamType         string `json:"stream_type"`
	StreamID           int    `json:"stream_id"`
	StreamIcon         string `json:"stream_icon"`
	EPGChannelID       string `json:"epg_channel_id"`
	CategoryID         string `json:"category_id"`
	TvArchive          int    `json:"tv_archive"`
	ContainerExtension string `json:"container_extension"`
	DirectSource       string `json:"direct_source"`
}

func (rs iptvXtreamRoutes) liveStreams(w http.ResponseWriter, r *http.Request) {
	s := rs.iptv.settings()
	channels, _, err := rs.iptv.channelList(r, s)
	if err != nil {
		logger.Warnf("[iptv] xtream: building channel list: %v", err)
		writeJSON(w, []interface{}{})
		return
	}

	categoryID := r.URL.Query().Get("category_id")
	base := iptvBaseURL(r)
	username := r.URL.Query().Get("username")
	password := r.URL.Query().Get("password")

	out := make([]xtreamLiveStream, 0, len(channels))
	for _, ch := range channels {
		name := iptvGroupTitle(ch, s)
		cid := strconv.Itoa(iptvNetChannelSeed(name))
		if categoryID != "" && categoryID != "0" && categoryID != cid {
			continue
		}
		out = append(out, xtreamLiveStream{
			Num:        ch.Number,
			Name:       ch.Name,
			StreamType: "live",
			// A synthetic numeric id — only there because the Xtream schema
			// expects stream_id to be a number, and TiviMate turns out to
			// reconstruct the play URL from this (plus ContainerExtension)
			// rather than using DirectSource verbatim — confirmed live, it
			// requested /live/{user}/{pass}/{this number} with no extension.
			// LiveChannelStream reverses the same hash back to the real
			// channel key.
			StreamID:           iptvNetChannelSeed(ch.Key),
			StreamIcon:         iptvURL(base, fmt.Sprintf("/iptv/logo/%s.png", ch.Key), ""),
			EPGChannelID:       ch.TvgID,
			CategoryID:         cid,
			ContainerExtension: "ts",
			DirectSource:       iptvXtreamLiveURL(base, username, password, ch.Key),
		})
	}
	writeJSON(w, out)
}

// ─── series catalog ─────────────────────────────────────────────────────────

type xtreamSeriesCategory struct {
	CategoryID   string `json:"category_id"`
	CategoryName string `json:"category_name"`
	ParentID     int    `json:"parent_id"`
}

// seriesCategories always answers the same single category — see
// adultTimeSeriesCategoryID. Not gated on whether the catalog actually builds
// successfully right now: an empty category is a normal, valid answer (and
// exactly what browsing into it will show if the catalog build is failing),
// whereas hiding the category entirely would look like the feature vanished.
func (rs iptvXtreamRoutes) seriesCategories(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, []xtreamSeriesCategory{
		{CategoryID: adultTimeSeriesCategoryID, CategoryName: "Adult Time"},
	})
}

type xtreamSeriesEntry struct {
	Num          int    `json:"num"`
	Name         string `json:"name"`
	SeriesID     int    `json:"series_id"`
	Cover        string `json:"cover"`
	Plot         string `json:"plot"`
	CategoryID   string `json:"category_id"`
	LastModified string `json:"last_modified"`
	Rating       string `json:"rating"`
}

// seriesList answers one entry per movie — the poster grid a client shows
// before anyone has picked one. Grouping happens here rather than in the
// catalog layer: gammaListMovieScenes hands back a flat list of (movie,
// scene) pairs, same shape the VOD version of this feature used, and only
// the presentation differs now.
func (rs iptvXtreamRoutes) seriesList(w http.ResponseWriter, r *http.Request) {
	categoryID := r.URL.Query().Get("category_id")
	if categoryID != "" && categoryID != "0" && categoryID != adultTimeSeriesCategoryID {
		writeJSON(w, []interface{}{})
		return
	}

	entries, err := adultTimeVODEntries(r.Context())
	if err != nil {
		logger.Warnf("[iptv] xtream: building Adult Time series catalog: %v", err)
		writeJSON(w, []interface{}{})
		return
	}

	type movieAgg struct {
		title string
		cover string
		count int
	}
	movies := make(map[int]*movieAgg)
	var order []int
	for _, e := range entries {
		m, ok := movies[e.MovieID]
		if !ok {
			m = &movieAgg{title: e.MovieTitle, cover: e.MovieCover}
			movies[e.MovieID] = m
			order = append(order, e.MovieID)
		}
		m.count++
	}

	out := make([]xtreamSeriesEntry, 0, len(movies))
	for _, id := range order {
		m := movies[id]
		scenes := "scenes"
		if m.count == 1 {
			scenes = "scene"
		}
		out = append(out, xtreamSeriesEntry{
			Name:         m.title,
			SeriesID:     id,
			Cover:        m.cover,
			Plot:         fmt.Sprintf("%d %s", m.count, scenes),
			CategoryID:   adultTimeSeriesCategoryID,
			LastModified: strconv.FormatInt(time.Now().Unix(), 10),
			Rating:       "0",
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	for i := range out {
		out[i].Num = i + 1
	}
	writeJSON(w, out)
}

type xtreamEpisode struct {
	ID                 string `json:"id"`
	EpisodeNum         int    `json:"episode_num"`
	Title              string `json:"title"`
	ContainerExtension string `json:"container_extension"`
	Added              string `json:"added"`
	Season             int    `json:"season"`
	DirectSource       string `json:"direct_source"`
	Info               struct {
		MovieImage   string `json:"movie_image"`
		Plot         string `json:"plot"`
		ReleaseDate  string `json:"releasedate"`
		Duration     string `json:"duration"`
		DurationSecs int    `json:"duration_secs"`
	} `json:"info"`
}

type xtreamSeriesInfo struct {
	Info struct {
		Name       string `json:"name"`
		Cover      string `json:"cover"`
		Plot       string `json:"plot"`
		CategoryID string `json:"category_id"`
	} `json:"info"`
	Episodes map[string][]xtreamEpisode `json:"episodes"`
}

// seriesInfo answers one movie's full scene list — the episode list a client
// shows once someone has picked a series. Every scene lands in a single
// season ("1"): a movie's scenes have no natural season grouping, and Xtream
// requires episodes be bucketed by season number, so one bucket is the
// simplest shape that satisfies the protocol without inventing a division
// that isn't real.
func (rs iptvXtreamRoutes) seriesInfo(w http.ResponseWriter, r *http.Request) {
	seriesID, err := strconv.Atoi(r.URL.Query().Get("series_id"))
	if err != nil {
		http.Error(w, "invalid series_id", http.StatusBadRequest)
		return
	}

	entries, err := adultTimeVODEntries(r.Context())
	if err != nil {
		logger.Warnf("[iptv] xtream: building Adult Time series catalog: %v", err)
		http.Error(w, "error building series catalog", http.StatusInternalServerError)
		return
	}

	scheme, host, port := iptvXtreamHostParts(r)
	base := fmt.Sprintf("%s://%s:%s", scheme, host, port)
	username := r.URL.Query().Get("username")
	password := r.URL.Query().Get("password")

	var (
		title, cover string
		episodes     []xtreamEpisode
	)
	for _, e := range entries {
		if e.MovieID != seriesID {
			continue
		}
		if title == "" {
			title, cover = e.MovieTitle, e.MovieCover
		}
		ep := xtreamEpisode{
			ID:                 strconv.Itoa(e.ClipID),
			EpisodeNum:         len(episodes) + 1,
			Title:              e.SceneTitle,
			ContainerExtension: "mp4",
			Added:              iptvXtreamAddedDate(e.ReleaseDate),
			Season:             1,
			DirectSource:       iptvXtreamEpisodeURL(base, username, password, e.ClipID),
		}
		ep.Info.MovieImage = iptvXtreamThumbnail(e)
		ep.Info.Plot = e.Description
		ep.Info.ReleaseDate = e.ReleaseDate
		ep.Info.DurationSecs = e.Length
		ep.Info.Duration = iptvXtreamDurationLabel(e.Length)
		episodes = append(episodes, ep)
	}

	if title == "" {
		http.Error(w, "unknown series_id", http.StatusNotFound)
		return
	}

	var info xtreamSeriesInfo
	info.Info.Name = title
	info.Info.Cover = cover
	info.Info.CategoryID = adultTimeSeriesCategoryID
	info.Episodes = map[string][]xtreamEpisode{"1": episodes}

	writeJSON(w, info)
}

// ─── live stream ────────────────────────────────────────────────────────────

// LiveChannelStream resolves a synthetic numeric stream id (see liveStreams)
// back to the channel's real key and hands off to the exact same handler
// /iptv/ch/{channelId}.ts uses — not a reimplementation, a redirect at the Go
// level. ChannelStream reads the channel key via chi.URLParam(r, "channelId"),
// so this constructs a fresh chi route context carrying that param instead of
// duplicating everything after key resolution (schedule lookup, ffmpeg pipe,
// failure backoff — all of it).
//
// This exists as a separate handler (rather than registering ChannelStream
// directly, which the M3U-facing /iptv/ch/ route can do because it always
// writes its own URLs) because a channel key is frequently non-numeric
// ("aylo-bangbros-115261"), while Xtream's schema requires stream_id to be a
// number — so a synthetic id has to exist somewhere, and this is where it's
// reversed.
func (rs iptvXtreamRoutes) LiveChannelStream(w http.ResponseWriter, r *http.Request) {
	raw := chi.URLParam(r, "streamId")
	raw = strings.TrimSuffix(raw, path.Ext(raw))
	numID, err := strconv.Atoi(raw)
	if err != nil {
		http.Error(w, "invalid stream id", http.StatusBadRequest)
		return
	}

	s := rs.iptv.settings()
	channels, _, err := rs.iptv.channelList(r, s)
	if err != nil {
		logger.Errorf("[iptv] xtream: building channel list: %v", err)
		http.Error(w, "error building channel list", http.StatusInternalServerError)
		return
	}

	var key string
	for _, ch := range channels {
		if iptvNetChannelSeed(ch.Key) == numID {
			key = ch.Key
			break
		}
	}
	if key == "" {
		http.Error(w, "unknown channel", http.StatusNotFound)
		return
	}

	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("channelId", key)
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))

	rs.iptv.ChannelStream(w, r)
}

// ─── stream proxy ───────────────────────────────────────────────────────────

// SeriesEpisodeStream proxies a single scene's signed CDN URL, forwarding
// Range so the client can seek and buffer ahead. Deliberately not the
// linear-channel ffmpeg pipe (pipeProgram/iptvStreamArgs in routes_iptv.go)
// — that's `-re`-paced for continuous 24/7 stitching and unseekable, wrong
// shape for a title a viewer scrubs through. Also deliberately not a
// redirect to the signed URL: a TV app's own network stack sends no Referer,
// and reaching this CDN through a browser-shaped request is exactly what the
// rest of API Hub already has to do (see routes_proxy.go).
func (rs iptvXtreamRoutes) SeriesEpisodeStream(w http.ResponseWriter, r *http.Request) {
	raw := chi.URLParam(r, "episodeId")
	clipID, err := strconv.Atoi(strings.TrimSuffix(raw, path.Ext(raw)))
	if err != nil {
		http.Error(w, "invalid episode id", http.StatusBadRequest)
		return
	}

	stream, err := gammaResolveStream(r.Context(), adultTimeSite, clipID)
	if err != nil {
		logger.Warnf("[iptv] xtream: resolving episode stream %d: %v", clipID, err)
		http.Error(w, "could not resolve stream", http.StatusBadGateway)
		return
	}
	if stream.Format == "auto" {
		// An adaptive HLS manifest, not a single file a Range-proxy can seek
		// — see gammaResolveStream's preference order. Rare (a very recent
		// release with no fixed rendition yet); the honest answer is "not
		// playable this way yet" rather than serving a manifest no Xtream
		// player can parse as a video file.
		http.Error(w, "no progressive rendition available for this title yet", http.StatusServiceUnavailable)
		return
	}

	iptvProxyRangeRequest(w, r, stream.URL)
}

// iptvVODHTTPClient has no fixed timeout: a stream download's natural
// duration is however long the viewer keeps watching, the same reasoning
// pipeProgram uses for the linear channels (bounded by the slot deadline, not
// an arbitrary client timeout).
var iptvVODHTTPClient = &http.Client{}

// iptvProxyRangeRequest reverse-proxies a single upstream URL, forwarding the
// client's Range header and passing back whatever byte-range response the
// CDN gives.
func iptvProxyRangeRequest(w http.ResponseWriter, r *http.Request, upstreamURL string) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, upstreamURL, nil)
	if err != nil {
		http.Error(w, "could not build upstream request", http.StatusInternalServerError)
		return
	}
	req.Header.Set("User-Agent", iptvRemoteUserAgent)
	if rng := r.Header.Get("Range"); rng != "" {
		req.Header.Set("Range", rng)
	}

	res, err := iptvVODHTTPClient.Do(req)
	if err != nil {
		http.Error(w, "upstream request failed", http.StatusBadGateway)
		return
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusPartialContent {
		http.Error(w, fmt.Sprintf("upstream returned HTTP %d", res.StatusCode), http.StatusBadGateway)
		return
	}

	for _, h := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"} {
		if v := res.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	if res.Header.Get("Accept-Ranges") == "" {
		w.Header().Set("Accept-Ranges", "bytes")
	}
	w.WriteHeader(res.StatusCode)
	_, _ = io.Copy(w, res.Body)
}

// ─── helpers ────────────────────────────────────────────────────────────────

func iptvXtreamHostParts(r *http.Request) (scheme, host, port string) {
	scheme = "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	host = r.Host
	port = "80"
	if h, p, err := net.SplitHostPort(r.Host); err == nil {
		host, port = h, p
	}
	return scheme, host, port
}

func iptvXtreamThumbnail(e gammaMovieVODEntry) string {
	if e.ThumbnailURL != "" {
		return e.ThumbnailURL
	}
	return e.MovieCover
}

func iptvXtreamAddedDate(releaseDate string) string {
	if t, err := time.Parse("2006-01-02", releaseDate); err == nil {
		return strconv.FormatInt(t.Unix(), 10)
	}
	return strconv.FormatInt(time.Now().Unix(), 10)
}

func iptvXtreamDurationLabel(seconds int) string {
	d := time.Duration(seconds) * time.Second
	h := int(d.Hours())
	m := int(d.Minutes()) % 60
	s := int(d.Seconds()) % 60
	return fmt.Sprintf("%02d:%02d:%02d", h, m, s)
}

func iptvXtreamEpisodeURL(base, username, password string, clipID int) string {
	if username == "" {
		username = "vexxx"
	}
	return fmt.Sprintf("%s/series/%s/%s/%d.mp4", base, url.PathEscape(username), url.PathEscape(password), clipID)
}

// iptvXtreamLiveURL builds a channel's stream URL keyed by its real Key
// (which the /live/{user}/{pass}/{channelId}.ts route reads as "channelId" —
// the same param name and lookup ChannelStream already uses for
// /iptv/ch/{channelId}.ts). Not URL-escaped: a channel key is always
// alphanumeric-with-hyphens (see adultTimeChannelKey/gammaSlug and library
// keys, which are just a studio's numeric id), never anything that needs it.
func iptvXtreamLiveURL(base, username, password, channelKey string) string {
	if username == "" {
		username = "vexxx"
	}
	return fmt.Sprintf("%s/live/%s/%s/%s.ts", base, url.PathEscape(username), url.PathEscape(password), channelKey)
}
