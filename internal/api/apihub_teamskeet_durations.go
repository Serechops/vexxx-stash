package api

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/stashapp/stash/internal/manager/config"

	// Registers the "sqlite3ex" driver used below (side-effect import).
	_ "github.com/stashapp/stash/pkg/sqlite"
)

// Persistent store for measured TeamSkeet scene durations.
//
// This exists because of one gap in Reptyle's catalog: nothing in it says how
// long a scene is (see apihub_teamskeet_catalog.go), so each runtime costs two
// HTTP requests to discover. Across 137 channels that is roughly 14,000 requests
// — far too many to repeat on the 24-hour catalog TTL like every other cached
// thing in the IPTV code.
//
// A runtime, though, is *immutable*: scene 32383 will be 2466 seconds long
// forever. That is what justifies a different lifetime from everything else
// here. Measurements are written once and kept indefinitely, so the expensive
// first pass is paid once for the life of the install and later warms only
// measure genuinely new releases.
//
// It sits beside the download-history sidecar under <config>/apihub and follows
// the same shape: lazily opened, single connection, re-opened only if the
// resolved path changes. Like that one — and unlike the FapTap/PMVHaven
// databases — this file is written exclusively by this process, so there is no
// hot-swap detection to do.
//
// Only successful measurements are stored. A failure is left out on purpose: the
// alternative is recording "unmeasurable" for what may have been a transient
// network error and never trying again. Failures are instead suppressed in
// memory for a cooldown (see teamSkeetDurationCache), which forgets on restart —
// the right trade, since retrying a handful of duds occasionally is cheaper than
// permanently blacklisting a scene that was fine.

const teamSkeetDurationSchema = `
CREATE TABLE IF NOT EXISTS movie_durations (
	movie_id INTEGER PRIMARY KEY,
	seconds REAL NOT NULL,
	measured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`

// teamSkeetFailureCooldown is how long a scene that could not be measured is
// left alone. Long enough that a warm does not keep retrying the same duds,
// short enough that a passing outage does not cost a scene its place for the day.
const teamSkeetFailureCooldown = 6 * time.Hour

type teamSkeetDurationStore struct {
	mu      sync.Mutex
	handle  *sql.DB
	openedP string

	// failed suppresses recently unmeasurable scenes. In memory rather than on
	// disk, deliberately — see the file header.
	failed map[int]time.Time
}

// teamSkeetDurations is the process-wide store. A package-level singleton to
// match how the catalog clients are reached (config is read directly rather than
// threaded through the routes), so a provider method can use it without plumbing.
var teamSkeetDurations = &teamSkeetDurationStore{failed: map[int]time.Time{}}

func (s *teamSkeetDurationStore) dbPath() string {
	return filepath.Join(config.GetInstance().GetConfigPath(), "apihub", "teamskeet_durations.db")
}

// conn returns an open read-write handle, (re)opening it if the configured
// directory changed since the last call, and running schema init on first open.
func (s *teamSkeetDurationStore) conn() (*sql.DB, error) {
	path := s.dbPath()
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
	// A single connection, as in the history sidecar: several channels warm at
	// once, and serializing a handful of tiny writes is cheaper than handling
	// "database is locked".
	h.SetMaxOpenConns(1)

	if _, err := h.Exec(teamSkeetDurationSchema); err != nil {
		_ = h.Close()
		return nil, fmt.Errorf("init teamskeet duration schema: %w", err)
	}

	s.handle = h
	s.openedP = path
	return h, nil
}

// lookup returns the known durations among the given movie ids.
//
// A failure to open or read the store is reported as "nothing known" rather than
// as an error: without it every channel would be unschedulable, whereas without
// the *cache* they are merely slow to warm. Losing the cache should degrade the
// feature, not break it.
func (s *teamSkeetDurationStore) lookup(ids []int) map[int]float64 {
	out := make(map[int]float64, len(ids))
	if len(ids) == 0 {
		return out
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.conn()
	if err != nil {
		return out
	}

	// Ids are integers straight from the catalog, so building the IN list is
	// injection-safe; doing it this way keeps it to one query instead of one
	// placeholder set per call size.
	list := make([]string, 0, len(ids))
	for _, id := range ids {
		list = append(list, strconv.Itoa(id))
	}

	rows, err := db.Query(
		"SELECT movie_id, seconds FROM movie_durations WHERE movie_id IN (" + strings.Join(list, ",") + ")")
	if err != nil {
		return out
	}
	defer rows.Close()

	for rows.Next() {
		var id int
		var seconds float64
		if err := rows.Scan(&id, &seconds); err != nil {
			continue
		}
		if seconds > 0 {
			out[id] = seconds
		}
	}
	return out
}

// record stores one measured duration. Upserts, so re-measuring is harmless.
func (s *teamSkeetDurationStore) record(movieID int, seconds float64) error {
	if seconds <= 0 {
		return fmt.Errorf("refusing to record a non-positive duration for movie %d", movieID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.conn()
	if err != nil {
		return err
	}
	_, err = db.Exec(
		`INSERT INTO movie_durations (movie_id, seconds, measured_at) VALUES (?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(movie_id) DO UPDATE SET seconds = excluded.seconds, measured_at = excluded.measured_at`,
		movieID, seconds)
	if err == nil {
		delete(s.failed, movieID)
	}
	return err
}

// noteFailure suppresses a scene that could not be measured, for a cooldown.
func (s *teamSkeetDurationStore) noteFailure(movieID int) {
	s.mu.Lock()
	s.failed[movieID] = time.Now()
	s.mu.Unlock()
}

// recentlyFailed reports a scene still inside its cooldown.
func (s *teamSkeetDurationStore) recentlyFailed(movieID int) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	at, ok := s.failed[movieID]
	return ok && time.Since(at) < teamSkeetFailureCooldown
}

// count reports how many durations are known, for the log line that tells the
// user how far the one-time discovery has got.
func (s *teamSkeetDurationStore) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.conn()
	if err != nil {
		return 0
	}
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM movie_durations").Scan(&n); err != nil {
		return 0
	}
	return n
}

// ─── discovery budget ─────────────────────────────────────────────────────────

// teamSkeetBudget rations duration measurements process-wide.
//
// Without it a cold start would try to measure every scene of every channel at
// once — around 14,000 requests, which is both a bad neighbour and far more than
// a warm's timeout allows. With it, each warm measures a bounded slice and the
// channels earlier in the lineup complete first, so the lineup grows a few whole
// channels at a time rather than showing a hundred half-built ones.
type teamSkeetBudgetLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	used   int
	since  time.Time
}

// 800 measurements per 10 minutes ≈ 1,600 scenes an hour, so a first pass over
// ~6,850 scheduled scenes settles in a few hours and then effectively stops,
// since only new releases need measuring afterwards.
var teamSkeetBudget = &teamSkeetBudgetLimiter{limit: 800, window: 10 * time.Minute}

// take grants up to n measurements, returning how many were actually allowed.
func (b *teamSkeetBudgetLimiter) take(n int) int {
	if n <= 0 {
		return 0
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	if b.since.IsZero() || time.Since(b.since) >= b.window {
		b.since = time.Now()
		b.used = 0
	}

	remaining := b.limit - b.used
	if remaining <= 0 {
		return 0
	}
	if n > remaining {
		n = remaining
	}
	b.used += n
	return n
}
