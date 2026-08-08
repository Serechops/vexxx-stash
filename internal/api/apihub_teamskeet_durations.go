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

// dbPath resolves the sidecar's location, or "" when there is no configuration
// to resolve it against.
//
// config.GetInstance panics rather than returning nil, and this store is now
// reached from an HTTP handler — the panel asks how many runtimes are known
// every time it refreshes. Taking the whole page down over an uninitialised
// config would be a poor trade for a progress number, so the panic is contained
// here and reported as "no store", which every caller below already degrades on.
func (s *teamSkeetDurationStore) dbPath() (path string) {
	defer func() {
		if recover() != nil {
			path = ""
		}
	}()
	return filepath.Join(config.GetInstance().GetConfigPath(), "apihub", "teamskeet_durations.db")
}

// conn returns an open read-write handle, (re)opening it if the configured
// directory changed since the last call, and running schema init on first open.
func (s *teamSkeetDurationStore) conn() (*sql.DB, error) {
	path := s.dbPath()
	if path == "" {
		return nil, fmt.Errorf("no configuration, so no duration cache")
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

// ─── the sweep ────────────────────────────────────────────────────────────────

// teamSkeetSweep measures the whole entitled catalog, once, in the background.
//
// It replaces a ration of 800 measurements per ten minutes. The ration was meant
// to keep a cold start from firing ~14,000 requests at once, but it was solving
// a problem that was already solved: teamSkeetFetchSem bounds this provider to
// six requests in flight at any moment, whatever asks for them. All the window
// added was idle time — the peak load was identical either way, so pausing after
// 800 did not make the burst gentler, it just made it last all afternoon. Worse,
// the measuring was smeared across channel schedule builds, so a channel nobody
// had asked for never measured anything, and the lineup crawled in whatever
// order channels happened to be tuned.
//
// Sweeping instead is both faster and simpler to reason about: one pass over
// every scene id, measuring the ones not already known, at the same six in
// flight. Around 14,000 requests at roughly six concurrent is on the order of
// twenty minutes, paid once for the life of the install — after which the store
// answers everything and later sweeps find only new releases.
const (
	// teamSkeetSweepWorkers is how many measurements are offered at once. The
	// real throttle is teamSkeetFetchSem; this only needs to be comfortably
	// above it so the semaphore is the thing deciding the pace.
	teamSkeetSweepWorkers = 12

	// teamSkeetSweepIdle is how long after a completed sweep before another is
	// worth starting. Long, because a finished sweep means every scene in the
	// catalog has a runtime and only new releases can change that.
	teamSkeetSweepIdle = 6 * time.Hour

	// teamSkeetSweepRetry is the wait after a sweep that *failed*, which is a
	// different thing entirely and must not inherit the idle period. A sweep
	// that cannot list the catalog ends in milliseconds; treating that as "the
	// catalog is measured, come back in six hours" would stop the lineup dead
	// over a momentary network error. Short, but not so short that a provider
	// which is properly down is asked again on every request.
	teamSkeetSweepRetry = 5 * time.Minute
)

type teamSkeetSweepState struct {
	mu sync.Mutex

	running   bool
	startedAt time.Time

	// endedAt is set only by a run that *completed*, and retryAt only by one that
	// failed. Kept apart on purpose — see teamSkeetSweepRetry.
	endedAt time.Time
	retryAt time.Time

	// total is how many scenes this run found unmeasured, and done how many of
	// them it has since measured. Both are about the run in progress, so the
	// panel reports movement rather than a ratio that barely changes.
	total int
	done  int

	// failed counts scenes this run could not measure. Reported, because a sweep
	// that finishes with a large number here explains a lineup that is complete
	// but thinner than expected.
	failed int

	lastErr error
}

var teamSkeetSweep = &teamSkeetSweepState{}

// begin claims the right to run a sweep, and reports whether one is worth
// running at all.
func (s *teamSkeetSweepState) begin() bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return false
	}
	if time.Now().Before(s.retryAt) {
		return false
	}
	if !s.endedAt.IsZero() && time.Since(s.endedAt) < teamSkeetSweepIdle {
		return false
	}

	s.running = true
	s.startedAt = time.Now()
	s.total, s.done, s.failed, s.lastErr = 0, 0, 0, nil
	return true
}

func (s *teamSkeetSweepState) end(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.running = false
	s.lastErr = err

	if err != nil {
		// Failed, so nothing was measured and the long idle period would be a
		// lie. Held off briefly instead, then tried again.
		s.retryAt = time.Now().Add(teamSkeetSweepRetry)
		return
	}
	s.endedAt = time.Now()
	s.retryAt = time.Time{}
}

// setTotal records how much work this run found. A run that finds nothing left
// to do is not held against the idle timer as a real sweep, since it did not
// actually visit anything.
func (s *teamSkeetSweepState) setTotal(n int) {
	s.mu.Lock()
	s.total = n
	s.mu.Unlock()
}

func (s *teamSkeetSweepState) record(ok bool) {
	s.mu.Lock()
	if ok {
		s.done++
	} else {
		s.failed++
	}
	s.mu.Unlock()
}

// progress reports the run in flight, for the panel.
func (s *teamSkeetSweepState) progress() (running bool, done, total, failed int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running, s.done, s.total, s.failed
}
