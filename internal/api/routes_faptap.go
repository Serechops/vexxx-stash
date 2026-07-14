package api

import (
	"bufio"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/stashapp/stash/internal/faptap"
)

// faptapRoutes serves the optional FapTap sidecar catalog to the immersive VR
// Home wall. Everything is read-only and gated on the database file existing;
// when it is absent the handlers report "unavailable" rather than erroring so
// the frontend can render the tab in its locked state.
type faptapRoutes struct {
	db *faptap.DB
	// dir resolves the FapTap data directory lazily (its funscripts/ subfolder
	// holds the downloaded .csv funscripts), so a path change from the plugin
	// setting takes effect on the next request.
	dir func() string
}

func (rs faptapRoutes) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/status", rs.status)
	r.Get("/thumb", rs.thumb)
	r.Get("/videos", rs.videos)
	r.Get("/counts", rs.counts)
	r.Get("/tags", rs.tags)
	r.Get("/creators", rs.creators)
	r.Route("/videos/{videoId}", func(r chi.Router) {
		r.Get("/", rs.video)
		r.Get("/sources", rs.sources)
		r.Get("/funscript", rs.funscript)
	})

	return r
}

// thumb proxies a faptap.net image through the backend to avoid CORS failures.
// Only faptap.net URLs are accepted; anything else gets a 400.
func (rs faptapRoutes) thumb(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if !strings.HasPrefix(rawURL, "https://faptap.net/") {
		http.Error(w, "invalid url", http.StatusBadRequest)
		return
	}
	resp, err := http.Get(rawURL) //nolint:gosec // URL is validated above
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
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = io.Copy(w, resp.Body)
}

func (rs faptapRoutes) status(w http.ResponseWriter, r *http.Request) {
	total, err := rs.db.Total()
	if err != nil {
		writeJSON(w, map[string]interface{}{"available": false, "total": 0})
		return
	}
	writeJSON(w, map[string]interface{}{"available": true, "total": total})
}

func (rs faptapRoutes) videos(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	p := faptap.ListParams{
		Page:    atoiQuery(q.Get("page"), 1),
		PerPage: atoiQuery(q.Get("per_page"), 12),
		Media:   q.Get("media"),
		TagID:   q.Get("tag"),
		Sort:    q.Get("sort"),
		Query:   q.Get("q"),
	}
	res, err := rs.db.List(p)
	if err != nil {
		faptapErr(w, err)
		return
	}
	writeJSON(w, res)
}

func (rs faptapRoutes) video(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "videoId")
	det, err := rs.db.Get(id)
	if err != nil {
		faptapErr(w, err)
		return
	}
	if det == nil {
		http.Error(w, http.StatusText(http.StatusNotFound), http.StatusNotFound)
		return
	}
	writeJSON(w, det)
}

func (rs faptapRoutes) sources(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "videoId")
	srcs, err := rs.db.Sources(id)
	if err != nil {
		faptapErr(w, err)
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

func (rs faptapRoutes) counts(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	c, err := rs.db.CountsFor(q.Get("tag"), q.Get("q"))
	if err != nil {
		faptapErr(w, err)
		return
	}
	writeJSON(w, c)
}

func (rs faptapRoutes) tags(w http.ResponseWriter, r *http.Request) {
	entries, err := rs.db.Tags(atoiQuery(r.URL.Query().Get("limit"), 200))
	if err != nil {
		faptapErr(w, err)
		return
	}
	writeJSON(w, entries)
}

func (rs faptapRoutes) creators(w http.ResponseWriter, r *http.Request) {
	entries, err := rs.db.Creators(atoiQuery(r.URL.Query().Get("limit"), 200))
	if err != nil {
		faptapErr(w, err)
		return
	}
	writeJSON(w, entries)
}

// funscript serves the video's funscript as standard .funscript JSON
// (`{actions:[{at,pos}]}`). FapTap stores funscripts as CSV on disk; this
// converts on the fly. If the on-disk file is already JSON it is streamed as-is.
func (rs faptapRoutes) funscript(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "videoId")
	localPath, err := rs.db.FunscriptPath(id)
	if err != nil {
		faptapErr(w, err)
		return
	}
	if localPath == "" {
		http.Error(w, http.StatusText(http.StatusNotFound), http.StatusNotFound)
		return
	}

	// Resolve against the configured funscripts dir using the basename, so it
	// works regardless of how the scraper recorded the path.
	file := filepath.Join(rs.dir(), "funscripts", filepath.Base(localPath))
	f, err := os.Open(file)
	if err != nil {
		http.Error(w, http.StatusText(http.StatusNotFound), http.StatusNotFound)
		return
	}
	defer f.Close()

	br := bufio.NewReader(f)
	// Peek the first non-space byte: a JSON funscript starts with '{'.
	first, _ := br.Peek(1)
	w.Header().Set("Content-Type", "application/json")
	if len(first) == 1 && first[0] == '{' {
		_, _ = br.WriteTo(w)
		return
	}

	writeFunscriptFromCSV(w, br)
}

// writeFunscriptFromCSV parses a 2-column CSV (time,pos) into funscript JSON.
// `time` is treated as milliseconds and `pos` as a 0..100 position. Rows that
// don't parse (e.g. a header line) are skipped.
func writeFunscriptFromCSV(w http.ResponseWriter, r *bufio.Reader) {
	var b strings.Builder
	b.WriteString(`{"actions":[`)
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	count := 0
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		parts := strings.Split(line, ",")
		if len(parts) < 2 {
			continue
		}
		atF, err1 := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
		posF, err2 := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
		if err1 != nil || err2 != nil {
			continue // header or malformed row
		}
		at := int64(atF)
		pos := int(posF)
		if pos < 0 {
			pos = 0
		} else if pos > 100 {
			pos = 100
		}
		if count > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`{"at":`)
		b.WriteString(strconv.FormatInt(at, 10))
		b.WriteString(`,"pos":`)
		b.WriteString(strconv.Itoa(pos))
		b.WriteByte('}')
		count++
	}
	if err := sc.Err(); err != nil {
		http.Error(w, "error reading funscript", http.StatusInternalServerError)
		return
	}
	b.WriteString("]}")
	_, _ = w.Write([]byte(b.String()))
}

func atoiQuery(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

// faptapErr maps the unavailable sentinel onto a clean "locked" payload and any
// other error onto a 500.
func faptapErr(w http.ResponseWriter, err error) {
	if errors.Is(err, faptap.ErrUnavailable) {
		w.WriteHeader(http.StatusServiceUnavailable)
		writeJSON(w, map[string]interface{}{"available": false})
		return
	}
	http.Error(w, err.Error(), http.StatusInternalServerError)
}
