package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/stashapp/stash/internal/pmvhaven"
)

// pmvhavenCDN is the only upstream host the thumb/media proxies will fetch from.
// The PMVHaven CDN serves no Access-Control-Allow-Origin header, so its assets
// must be re-served same-origin (see thumb/media) for the crossorigin canvas/
// video pipeline to accept them.
const pmvhavenCDN = "https://video.pmvhaven.com/"

// pmvhavenRoutes serves the optional PMVHaven sidecar catalog to the immersive
// VR Home wall. Everything is read-only and gated on the database file existing;
// when it is absent the handlers report "unavailable" rather than erroring so
// the frontend can render the tab in its locked state.
//
// Unlike FapTap, PMVHaven has no funscripts of its own — the funscript endpoint
// generates one on demand from the video's audio and caches it (see Generator).
type pmvhavenRoutes struct {
	db  *pmvhaven.DB
	gen *pmvhaven.Generator
}

func (rs pmvhavenRoutes) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/status", rs.status)
	r.Get("/thumb", rs.thumb)
	r.Get("/media", rs.media)
	r.Get("/videos", rs.videos)
	r.Get("/counts", rs.counts)
	r.Get("/tags", rs.tags)
	r.Get("/stars", rs.stars)
	r.Route("/videos/{videoId}", func(r chi.Router) {
		r.Get("/", rs.video)
		r.Get("/sources", rs.sources)
		r.Get("/funscript", rs.funscript)
	})

	return r
}

func (rs pmvhavenRoutes) status(w http.ResponseWriter, r *http.Request) {
	total, err := rs.db.Total()
	if err != nil {
		writeJSON(w, map[string]interface{}{"available": false, "total": 0})
		return
	}
	writeJSON(w, map[string]interface{}{"available": true, "total": total})
}

// thumb proxies a PMVHaven CDN image through the backend. The CDN sends no
// Access-Control-Allow-Origin, so a cross-origin <img crossorigin="anonymous">
// (required to draw the card into the WebGL canvas wall) is rejected by the
// browser and the scene cards render blank. Serving it same-origin here fixes
// that. Only the PMVHaven CDN host is accepted.
func (rs pmvhavenRoutes) thumb(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if !strings.HasPrefix(rawURL, pmvhavenCDN) {
		http.Error(w, "invalid url", http.StatusBadRequest)
		return
	}
	resp, err := http.Get(rawURL) //nolint:gosec // URL host is validated above
	if err != nil || resp.StatusCode != http.StatusOK {
		if resp != nil {
			resp.Body.Close()
		}
		http.Error(w, "upstream error", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "image/webp"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = io.Copy(w, resp.Body)
}

// media proxies a PMVHaven CDN video (full stream or hover preview) through the
// backend with Range support. Same CORS reason as thumb: flat scenes upload
// video frames into a WebGL texture via a crossorigin="anonymous" <video>, which
// the browser refuses for a non-CORS cross-origin source — so without this the
// video never loads and the panel stays black. Range/conditional headers are
// forwarded both ways so seeking still works, and the request context is kept so
// a client disconnect cancels the upstream fetch. Only the PMVHaven CDN host is
// accepted.
func (rs pmvhavenRoutes) media(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if !strings.HasPrefix(rawURL, pmvhavenCDN) {
		http.Error(w, "invalid url", http.StatusBadRequest)
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, rawURL, nil)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	for _, h := range []string{"Range", "If-Range", "If-None-Match", "If-Modified-Since"} {
		if v := r.Header.Get(h); v != "" {
			req.Header.Set(h, v)
		}
	}
	resp, err := http.DefaultClient.Do(req) //nolint:gosec // URL host is validated above
	if err != nil {
		http.Error(w, "upstream error", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	for _, h := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag"} {
		if v := resp.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (rs pmvhavenRoutes) videos(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	p := pmvhaven.ListParams{
		Page:    atoiQuery(q.Get("page"), 1),
		PerPage: atoiQuery(q.Get("per_page"), 12),
		Media:   q.Get("media"),
		TagID:   q.Get("tag"),
		StarID:  q.Get("star"),
		Sort:    q.Get("sort"),
		Query:   q.Get("q"),
	}
	res, err := rs.db.List(p)
	if err != nil {
		pmvhavenErr(w, err)
		return
	}
	writeJSON(w, res)
}

func (rs pmvhavenRoutes) video(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "videoId")
	det, err := rs.db.Get(id)
	if err != nil {
		pmvhavenErr(w, err)
		return
	}
	if det == nil {
		http.Error(w, http.StatusText(http.StatusNotFound), http.StatusNotFound)
		return
	}
	writeJSON(w, det)
}

func (rs pmvhavenRoutes) sources(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "videoId")
	srcs, err := rs.db.Sources(id)
	if err != nil {
		pmvhavenErr(w, err)
		return
	}
	stream := ""
	fallbacks := make([]string, 0, len(srcs))
	for i, s := range srcs {
		if i == 0 {
			stream = s.URL
		} else {
			fallbacks = append(fallbacks, s.URL)
		}
	}
	writeJSON(w, map[string]interface{}{
		"stream":    stream,
		"fallbacks": fallbacks,
		"sources":   srcs,
	})
}

func (rs pmvhavenRoutes) counts(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	c, err := rs.db.CountsFor(q.Get("tag"), q.Get("star"))
	if err != nil {
		pmvhavenErr(w, err)
		return
	}
	writeJSON(w, c)
}

func (rs pmvhavenRoutes) tags(w http.ResponseWriter, r *http.Request) {
	entries, err := rs.db.Tags(atoiQuery(r.URL.Query().Get("limit"), 200))
	if err != nil {
		pmvhavenErr(w, err)
		return
	}
	writeJSON(w, entries)
}

func (rs pmvhavenRoutes) stars(w http.ResponseWriter, r *http.Request) {
	entries, err := rs.db.Stars(atoiQuery(r.URL.Query().Get("limit"), 200))
	if err != nil {
		pmvhavenErr(w, err)
		return
	}
	writeJSON(w, entries)
}

// funscript serves the video's beat-synced funscript JSON, generating and
// caching it on first request (ffmpeg audio extract → analyzer.py). The call
// blocks for the duration of that pipeline on a cache miss.
func (rs pmvhavenRoutes) funscript(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "videoId")
	// Detach generation from the request context: a player that aborts this
	// fetch (e.g. a quick scene switch) must not cancel the ffmpeg+analyzer
	// pipeline, otherwise the cache would never build and every play would
	// re-trigger it. The Generator bounds the work with its own timeout.
	path, err := rs.gen.Ensure(context.Background(), id)
	if err != nil {
		if errors.Is(err, pmvhaven.ErrUnavailable) {
			pmvhavenErr(w, err)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	f, err := os.Open(path)
	if err != nil {
		http.Error(w, http.StatusText(http.StatusNotFound), http.StatusNotFound)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = io.Copy(w, f)
}

// pmvhavenErr maps the unavailable sentinel onto a clean "locked" payload and
// any other error onto a 500.
func pmvhavenErr(w http.ResponseWriter, err error) {
	if errors.Is(err, pmvhaven.ErrUnavailable) {
		w.WriteHeader(http.StatusServiceUnavailable)
		writeJSON(w, map[string]interface{}{"available": false})
		return
	}
	http.Error(w, err.Error(), http.StatusInternalServerError)
}
