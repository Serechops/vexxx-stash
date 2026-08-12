package api

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/stashapp/stash/internal/manager/config"

	_ "github.com/stashapp/stash/pkg/sqlite"
)

// Persistent store for scraped NewSensations catalog data.
//
// NewSensations has no JSON API — everything is HTML scraping (category.php,
// gallery.php, sets.php). Every IPTV warm cycle and every API Hub series page
// load would otherwise re-scrape the same pages, which is both slow (224 banner
// track redirects + per-series scene grids + per-scene detail pages) and fragile
// (HTML parsers break when the site's markup changes).
//
// This sidecar stores the scraped data once and serves it forever. The schema
// mirrors what the HTML parsers extract: series (id, name, poster, scene count)
// and scenes (id, title, poster, duration, video URL, series membership).
//
// It sits beside the download-history sidecar under <config>/apihub and follows
// the same shape: lazily opened, single connection, re-opened only if the
// resolved path changes.
//
// Only successful scrapes are stored. A failure is left out on purpose: the
// alternative is recording "unscrapable" for what may have been a transient
// network error and never trying again.

const nsCatalogSchema = `
CREATE TABLE IF NOT EXISTS ns_series (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	poster_url TEXT,
	scene_count INTEGER NOT NULL DEFAULT 0,
	scraped_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ns_scenes (
	id INTEGER PRIMARY KEY,
	title TEXT NOT NULL,
	poster_url TEXT,
	duration_seconds REAL,
	video_url TEXT,
	video_codec TEXT,
	video_height INTEGER,
	series_id TEXT,
	scraped_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ns_scenes_series ON ns_scenes(series_id);
`

// nsCatalogStore persists scraped NewSensations catalog data.
type nsCatalogStore struct {
	mu      sync.Mutex
	handle  *sql.DB
	openedP string
}

// nsCatalog is the process-wide store. Package-level singleton matching the
// TeamSkeet durations pattern.
var nsCatalog = &nsCatalogStore{}

// dbPath resolves the sidecar's location, or "" when there is no configuration.
func (s *nsCatalogStore) dbPath() (path string) {
	defer func() {
		if recover() != nil {
			path = ""
		}
	}()
	return filepath.Join(config.GetInstance().GetConfigPath(), "apihub", "newsensations_catalog.db")
}

// conn returns an open read-write handle, (re)opening it if the configured
// directory changed since the last call, and running schema init on first open.
func (s *nsCatalogStore) conn() (*sql.DB, error) {
	path := s.dbPath()
	if path == "" {
		return nil, fmt.Errorf("no configuration, so no NS catalog cache")
	}
	if s.handle != nil && s.openedP == path {
		return s.handle, nil
	}
	if s.handle != nil {
		_ = s.handle.Close()
		s.handle = nil
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create apihub data dir: %w", err)
	}

	dsn := "file:" + filepath.ToSlash(path) + "?_journal_mode=WAL&_busy_timeout=5000"
	h, err := sql.Open("sqlite3ex", dsn)
	if err != nil {
		return nil, err
	}
	h.SetMaxOpenConns(1)

	if _, err := h.Exec(nsCatalogSchema); err != nil {
		_ = h.Close()
		return nil, fmt.Errorf("init NS catalog schema: %w", err)
	}

	s.handle = h
	s.openedP = path
	return h, nil
}

// ─── series ───────────────────────────────────────────────────────────────────

// nsStoredSeries is a series record from the store.
type nsStoredSeries struct {
	ID         string
	Name       string
	PosterURL  string
	SceneCount int
}

// listSeries returns every known series, ordered by name.
func (s *nsCatalogStore) listSeries() []nsStoredSeries {
	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.conn()
	if err != nil {
		return nil
	}

	rows, err := db.Query("SELECT id, name, COALESCE(poster_url, ''), scene_count FROM ns_series ORDER BY name")
	if err != nil {
		return nil
	}
	defer rows.Close()

	var out []nsStoredSeries
	for rows.Next() {
		var r nsStoredSeries
		if err := rows.Scan(&r.ID, &r.Name, &r.PosterURL, &r.SceneCount); err != nil {
			continue
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil
	}
	return out
}

// seriesCount returns how many series are known.
func (s *nsCatalogStore) seriesCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.conn()
	if err != nil {
		return 0
	}
	var n int
	_ = db.QueryRow("SELECT COUNT(*) FROM ns_series").Scan(&n)
	return n
}

// ─── scenes ───────────────────────────────────────────────────────────────────

// nsStoredScene is a scene record from the store.
type nsStoredScene struct {
	ID              int
	Title           string
	PosterURL       string
	DurationSeconds float64
	VideoURL        string
	VideoCodec      string
	VideoHeight     int
	SeriesID        string
}

// listScenes returns known scenes for a series, up to `limit`.
func (s *nsCatalogStore) listScenes(seriesID string, limit int) []nsStoredScene {
	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.conn()
	if err != nil {
		return nil
	}

	q := "SELECT id, title, COALESCE(poster_url, ''), COALESCE(duration_seconds, 0), COALESCE(video_url, ''), COALESCE(video_codec, ''), COALESCE(video_height, 0), COALESCE(series_id, '') FROM ns_scenes WHERE series_id = ? ORDER BY id"
	args := []any{seriesID}
	if limit > 0 {
		q += " LIMIT ?"
		args = append(args, limit)
	}

	rows, err := db.Query(q, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var out []nsStoredScene
	for rows.Next() {
		var r nsStoredScene
		if err := rows.Scan(&r.ID, &r.Title, &r.PosterURL, &r.DurationSeconds, &r.VideoURL, &r.VideoCodec, &r.VideoHeight, &r.SeriesID); err != nil {
			continue
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil
	}
	return out
}

// listAllScenes returns all known scenes, up to `limit`. Used for the
// network-wide channel (no series filter).
func (s *nsCatalogStore) listAllScenes(limit int) []nsStoredScene {
	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.conn()
	if err != nil {
		return nil
	}

	q := "SELECT id, title, COALESCE(poster_url, ''), COALESCE(duration_seconds, 0), COALESCE(video_url, ''), COALESCE(video_codec, ''), COALESCE(video_height, 0), COALESCE(series_id, '') FROM ns_scenes ORDER BY id"
	var args []any
	if limit > 0 {
		q += " LIMIT ?"
		args = append(args, limit)
	}

	rows, err := db.Query(q, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var out []nsStoredScene
	for rows.Next() {
		var r nsStoredScene
		if err := rows.Scan(&r.ID, &r.Title, &r.PosterURL, &r.DurationSeconds, &r.VideoURL, &r.VideoCodec, &r.VideoHeight, &r.SeriesID); err != nil {
			continue
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil
	}
	return out
}

// lookupScene returns one scene by id, or nil.
func (s *nsCatalogStore) lookupScene(id int) *nsStoredScene {
	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.conn()
	if err != nil {
		return nil
	}

	var r nsStoredScene
	err = db.QueryRow(
		`SELECT id, title, COALESCE(poster_url, ''), COALESCE(duration_seconds, 0),
		 COALESCE(video_url, ''), COALESCE(video_codec, ''), COALESCE(video_height, 0), COALESCE(series_id, '')
		 FROM ns_scenes WHERE id = ?`, id,
	).Scan(&r.ID, &r.Title, &r.PosterURL, &r.DurationSeconds, &r.VideoURL, &r.VideoCodec, &r.VideoHeight, &r.SeriesID)
	if err != nil {
		return nil
	}
	return &r
}

// scenesWithDurationForSeries returns how many scenes in a series have a known
// duration.
func (s *nsCatalogStore) scenesWithDurationForSeries(seriesID string) int {
	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.conn()
	if err != nil {
		return 0
	}
	var n int
	_ = db.QueryRow("SELECT COUNT(*) FROM ns_scenes WHERE series_id = ? AND duration_seconds > 0", seriesID).Scan(&n)
	return n
}

// ─── bulk upsert ──────────────────────────────────────────────────────────────

// upsertScenes bulk-inserts scenes in a single transaction.
func (s *nsCatalogStore) upsertScenes(scenes []nsStoredScene) error {
	if len(scenes) == 0 {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.conn()
	if err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(
		`INSERT INTO ns_scenes (id, title, poster_url, duration_seconds, video_url, video_codec, video_height, series_id, scraped_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(id) DO UPDATE SET
		   title = excluded.title, poster_url = excluded.poster_url,
		   duration_seconds = excluded.duration_seconds, video_url = excluded.video_url,
		   video_codec = excluded.video_codec, video_height = excluded.video_height,
		   series_id = excluded.series_id, scraped_at = excluded.scraped_at`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, r := range scenes {
		if _, err := stmt.Exec(r.ID, r.Title, r.PosterURL, r.DurationSeconds, r.VideoURL, r.VideoCodec, r.VideoHeight, r.SeriesID); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// upsertSeriesList bulk-inserts series in a single transaction.
func (s *nsCatalogStore) upsertSeriesList(series []nsStoredSeries) error {
	if len(series) == 0 {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.conn()
	if err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(
		`INSERT INTO ns_series (id, name, poster_url, scene_count, scraped_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(id) DO UPDATE SET name = excluded.name, poster_url = excluded.poster_url,
		   scene_count = excluded.scene_count, scraped_at = excluded.scraped_at`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, r := range series {
		if _, err := stmt.Exec(r.ID, r.Name, r.PosterURL, r.SceneCount); err != nil {
			return err
		}
	}

	return tx.Commit()
}
