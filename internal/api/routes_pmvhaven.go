package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"

	"github.com/stashapp/stash/internal/pmvhaven"
)

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
