package api

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	// Registers the "sqlite3ex" driver used below (side-effect import).
	_ "github.com/stashapp/stash/pkg/sqlite"
)

// apihubHistoryStatus is the outcome of one download-history entry.
type apihubHistoryStatus string

const (
	apihubHistorySuccess apihubHistoryStatus = "success" // downloaded and imported into the library
	apihubHistoryPartial apihubHistoryStatus = "partial" // file saved, but import (and/or gallery) failed
	apihubHistoryFailed  apihubHistoryStatus = "failed"  // the download itself never completed
)

// apihubHistoryEntry is one row of the download history — recorded once per
// item at the end of apihubDownloadJob.Execute, whatever the outcome.
type apihubHistoryEntry struct {
	ID        int64               `json:"id"`
	Title     string              `json:"title"`
	Studio    string              `json:"studio"`
	Performer string              `json:"performer"`
	Provider  string              `json:"provider"`
	CoverURL  string              `json:"coverUrl,omitempty"`
	SourceURL string              `json:"sourceUrl,omitempty"`
	Quality   string              `json:"quality,omitempty"`
	VRMode    string              `json:"vrMode,omitempty"`
	Status    apihubHistoryStatus `json:"status"`
	Error     string              `json:"error,omitempty"`
	SceneID   string              `json:"sceneId,omitempty"`
	CreatedAt time.Time           `json:"createdAt"`
}

type apihubHistoryListParams struct {
	Limit  int
	Offset int
	Status string // "" | success | partial | failed
	Query  string // matches title/studio, case-insensitive substring
}

type apihubHistoryListResult struct {
	Entries []apihubHistoryEntry `json:"entries"`
	Total   int                  `json:"total"`
}

// apihubHistoryStore is a lazily-opened, writable sqlite sidecar recording the
// outcome of every APIHub download. Neither the cart (cleared the moment a
// job is queued, see CartDrawer.startCartDownload) nor the JobManager (a
// 10-job in-memory graveyard, wiped on restart — see pkg/job/manager.go)
// retains this today, so it lives in its own file rather than reusing either.
//
// Unlike the FapTap/PMVHaven sidecars (internal/faptap, internal/pmvhaven),
// which read a database an external scraper produces, this one is exclusively
// written by this process — there's no hot-swap/mtime-signature detection to
// do, just a single cached handle re-opened only if the resolved path changes.
type apihubHistoryStore struct {
	mu      sync.Mutex
	dir     func() string
	handle  *sql.DB
	openedP string
}

// newApihubHistoryStore returns a store whose data directory is resolved
// lazily via dirProvider. The database lives at <dir>/apihub_history.db.
func newApihubHistoryStore(dirProvider func() string) *apihubHistoryStore {
	return &apihubHistoryStore{dir: dirProvider}
}

func (s *apihubHistoryStore) dbPath() string {
	return filepath.Join(s.dir(), "apihub_history.db")
}

const historySchema = `
CREATE TABLE IF NOT EXISTS download_history (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	title TEXT NOT NULL DEFAULT '',
	studio TEXT NOT NULL DEFAULT '',
	performer TEXT NOT NULL DEFAULT '',
	provider TEXT NOT NULL DEFAULT '',
	cover_url TEXT NOT NULL DEFAULT '',
	source_url TEXT NOT NULL DEFAULT '',
	quality TEXT NOT NULL DEFAULT '',
	vr_mode TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL,
	error TEXT NOT NULL DEFAULT '',
	scene_id TEXT NOT NULL DEFAULT '',
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_apihub_download_history_created_at ON download_history(created_at DESC);
`

// conn returns an open read-write handle, (re)opening it if the configured
// directory changed since the last call, and running schema init on first
// open.
func (s *apihubHistoryStore) conn() (*sql.DB, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	path := s.dbPath()
	if s.handle != nil && s.openedP == path {
		return s.handle, nil
	}
	if s.handle != nil {
		_ = s.handle.Close()
		s.handle = nil
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create apihub history dir: %w", err)
	}

	dsn := "file:" + filepath.ToSlash(path) + "?_journal_mode=WAL&_busy_timeout=5000"
	h, err := sql.Open("sqlite3ex", dsn)
	if err != nil {
		return nil, err
	}
	// A single connection avoids "database is locked" errors from the writer
	// (job Execute) and a reader (the history route) racing each other —
	// volume here is one row per downloaded scene, so serializing is free.
	h.SetMaxOpenConns(1)

	if _, err := h.Exec(historySchema); err != nil {
		_ = h.Close()
		return nil, fmt.Errorf("init apihub history schema: %w", err)
	}

	s.handle = h
	s.openedP = path
	return h, nil
}

// record appends one entry. Best-effort by design — a history write failure
// must never fail (or roll back) the download itself, so callers log and
// carry on rather than surfacing the error to the user; see its call site in
// apihubDownloadJob.Execute.
func (s *apihubHistoryStore) record(e apihubHistoryEntry) error {
	db, err := s.conn()
	if err != nil {
		return err
	}
	_, err = db.Exec(
		`INSERT INTO download_history
			(title, studio, performer, provider, cover_url, source_url, quality, vr_mode, status, error, scene_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.Title, e.Studio, e.Performer, e.Provider, e.CoverURL, e.SourceURL, e.Quality, e.VRMode, string(e.Status), e.Error, e.SceneID,
	)
	return err
}

// list returns a page of history entries, most recent first.
func (s *apihubHistoryStore) list(p apihubHistoryListParams) (*apihubHistoryListResult, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}

	var where strings.Builder
	var args []interface{}
	where.WriteString(" WHERE 1=1")
	if p.Status != "" {
		where.WriteString(" AND status = ?")
		args = append(args, p.Status)
	}
	if q := strings.TrimSpace(p.Query); q != "" {
		where.WriteString(" AND (title LIKE ? OR studio LIKE ?)")
		like := "%" + q + "%"
		args = append(args, like, like)
	}

	var total int
	if err := db.QueryRow("SELECT COUNT(*) FROM download_history"+where.String(), args...).Scan(&total); err != nil {
		return nil, err
	}

	limit := p.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset := p.Offset
	if offset < 0 {
		offset = 0
	}

	rows, err := db.Query(
		`SELECT id, title, studio, performer, provider, cover_url, source_url, quality, vr_mode, status, error, scene_id, created_at
		 FROM download_history`+where.String()+" ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
		append(append([]interface{}{}, args...), limit, offset)...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]apihubHistoryEntry, 0, limit)
	for rows.Next() {
		var e apihubHistoryEntry
		var status string
		if err := rows.Scan(&e.ID, &e.Title, &e.Studio, &e.Performer, &e.Provider, &e.CoverURL, &e.SourceURL, &e.Quality, &e.VRMode, &status, &e.Error, &e.SceneID, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.Status = apihubHistoryStatus(status)
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &apihubHistoryListResult{Entries: entries, Total: total}, nil
}

// deleteEntry removes a single history row by id.
func (s *apihubHistoryStore) deleteEntry(id int64) error {
	db, err := s.conn()
	if err != nil {
		return err
	}
	_, err = db.Exec("DELETE FROM download_history WHERE id = ?", id)
	return err
}

// clear wipes the entire history.
func (s *apihubHistoryStore) clear() error {
	db, err := s.conn()
	if err != nil {
		return err
	}
	_, err = db.Exec("DELETE FROM download_history")
	return err
}
