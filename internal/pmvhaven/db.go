// Package pmvhaven is a read-only reader for the optional PMVHaven sidecar
// database (pmvhaven_data.db) produced by the external PMVHaven scraper. It
// powers the premium "PMVHaven" content mode in the immersive VR Home wall.
//
// Like the FapTap addon it lives entirely outside Stash's own library: the file
// is never written to here and is opened read-only. Its mere presence in the
// configured PMVHaven directory unlocks the addon, so [DB] re-checks the file on
// every call and transparently (re)opens when it appears, disappears, or is
// replaced by a fresh scrape — no server restart required.
//
// Schema differences vs FapTap (which shape the queries below):
//   - all content is flat (no VR/projection columns);
//   - a single CDN mp4 per row (videos.video_url) rather than a sources table;
//   - tags are stored as a comma-joined TEXT column (videos.tags), not a join
//     table, so the tag rail/filter is computed by splitting that column;
//   - performers ARE linked: stars_tags(video_id, star_name) gives a real,
//     filterable "stars" rail (5k+ distinct performers).
//
// PMVHaven ships no funscripts; they are generated on demand from each video's
// audio by [Generator] (see funscript.go). Because any video can be scripted,
// HasFunscript is reported true for every card.
package pmvhaven

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	// Registers the "sqlite3ex" driver used below (side-effect import).
	_ "github.com/stashapp/stash/pkg/sqlite"
)

const driverName = "sqlite3ex"

// ErrUnavailable is returned by every query method when the sidecar database is
// not present. Callers translate this into the "locked" state on the frontend.
var ErrUnavailable = errors.New("pmvhaven database not available")

// PMVHaven retired its original asset host: video.pmvhaven.com no longer
// resolves in DNS. Every asset (thumbnails, previews, mp4s) moved to the OVH
// object store below under identical paths, so a stored URL is corrected by a
// pure host swap. The sidecar DB is produced by an external scraper we do not
// control and may still carry either host, so the rewrite is applied on read
// (idempotent: URLs already on the live host — or any unrelated host — pass
// through untouched).
const (
	RetiredCDN = "https://video.pmvhaven.com/"
	CurrentCDN = "https://pmvhavencloud.s3.eu-west-par.io.cloud.ovh.net/"
)

// CanonicalAssetURL rewrites a stored asset URL from the retired PMVHaven host
// to the live one; all other URLs are returned unchanged.
func CanonicalAssetURL(u string) string {
	if strings.HasPrefix(u, RetiredCDN) {
		return CurrentCDN + strings.TrimPrefix(u, RetiredCDN)
	}
	return u
}

// IsAssetURL reports whether u targets a PMVHaven asset host the thumb/media
// proxies may fetch. Both hosts are accepted; the retired one is meant to be
// run through CanonicalAssetURL before the upstream fetch.
func IsAssetURL(u string) bool {
	return strings.HasPrefix(u, CurrentCDN) || strings.HasPrefix(u, RetiredCDN)
}

// Tag is a PMVHaven tag attached to a video card. Since the scrape has no tag
// table the id is simply the tag name.
type Tag struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Card is the lightweight grid entry rendered on the Home wall.
type Card struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	ThumbnailURL string  `json:"thumbnail_url"`
	PreviewURL   string  `json:"preview_url"`
	Duration     int     `json:"duration"`
	Views        int     `json:"views"`
	Rating       float64 `json:"rating"`
	Width        int     `json:"width"`
	Height       int     `json:"height"`
	HasFunscript bool    `json:"has_funscript"`
	Tags         []Tag   `json:"tags"`
}

// Detail is the full record needed to synthesize a playable scene.
type Detail struct {
	Card
	Description string   `json:"description"`
	Uploader   string   `json:"uploader"`
	Stars      []string `json:"stars"`
}

// Source is one playable CDN source for a video. PMVHaven exposes a single mp4.
type Source struct {
	URL     string `json:"url"`
	Quality string `json:"quality"`
	Format  string `json:"format"`
}

// RailEntry is a tag/star tile for the filter rail.
type RailEntry struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// Counts are the per-media-type totals under the active filter. PMVHaven is all
// flat and every video is funscript-capable, so vr is always 0 and flat ==
// funscript == all; the field is kept for wire-compatibility with the shared
// Home grid.
type Counts struct {
	All       int `json:"all"`
	VR        int `json:"vr"`
	Flat      int `json:"flat"`
	Funscript int `json:"funscript"`
}

// ListResult is a page of cards plus the total under the query.
type ListResult struct {
	Videos []Card `json:"videos"`
	Total  int    `json:"total"`
}

// ListParams describes a page request from the Home wall.
type ListParams struct {
	Page    int
	PerPage int
	Media   string // all | funscript (treated identically — see Counts)
	TagID   string // tag name to filter by (comma-list match)
	StarID  string // star name to filter by (stars_tags join)
	Sort    string // recent | views | rating | title
	Query   string
}

// DB is a lazily-opened, hot-swappable read-only handle to the sidecar database.
type DB struct {
	mu sync.Mutex
	// dir resolves the PMVHaven data directory on each call, so changing the
	// configured path (e.g. via the plugin setting) takes effect on the next
	// request without a server restart.
	dir     func() string
	handle  *sql.DB
	openedP string // path the open handle was opened for
	modSig  string // size+mtime signature the open handle was opened against
}

// New returns a reader whose data directory is resolved lazily via dirProvider.
// The database is expected at <dir>/pmvhaven_data.db.
func New(dirProvider func() string) *DB {
	return &DB{dir: dirProvider}
}

// dbPath resolves the current database file path.
func (d *DB) dbPath() string {
	return filepath.Join(d.dir(), "pmvhaven_data.db")
}

// conn returns an open read-only handle, (re)opening it if the file appeared,
// was replaced, or the configured path changed since the last call, and dropping
// it if the file is now gone.
func (d *DB) conn() (*sql.DB, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	path := d.dbPath()
	info, err := os.Stat(path)
	if err != nil {
		if d.handle != nil {
			_ = d.handle.Close()
			d.handle = nil
			d.modSig = ""
			d.openedP = ""
		}
		return nil, ErrUnavailable
	}

	sig := fmt.Sprintf("%d:%d", info.Size(), info.ModTime().UnixNano())
	if d.handle != nil && sig == d.modSig && path == d.openedP {
		return d.handle, nil
	}
	if d.handle != nil {
		_ = d.handle.Close()
		d.handle = nil
	}
	dsn := "file:" + filepath.ToSlash(path) + "?mode=ro"
	h, err := sql.Open(driverName, dsn)
	if err != nil {
		return nil, err
	}
	h.SetMaxOpenConns(2)
	d.handle = h
	d.modSig = sig
	d.openedP = path
	return h, nil
}

// Available reports whether the sidecar database can currently be opened.
func (d *DB) Available() bool {
	_, err := d.conn()
	return err == nil
}

// Total returns the count of videos, or 0 when unavailable.
func (d *DB) Total() (int, error) {
	db, err := d.conn()
	if err != nil {
		return 0, err
	}
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM videos").Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

// orderBy maps a sort key onto a videos column.
func orderBy(sortKey string) string {
	switch sortKey {
	case "views":
		return " ORDER BY views DESC"
	case "rating":
		return " ORDER BY bayesian_rating DESC, views DESC"
	case "title":
		return " ORDER BY title COLLATE NOCASE ASC"
	default: // recent
		return " ORDER BY COALESCE(NULLIF(release_date,''), upload_date, scraped_at) DESC"
	}
}

// buildFilter assembles the shared WHERE clause + args for list/count queries.
// Tag filtering matches the comma-joined tags column on a whole-segment basis;
// star filtering joins stars_tags.
func buildFilter(p ListParams) (string, []interface{}) {
	var sb strings.Builder
	var args []interface{}
	sb.WriteString(" WHERE 1=1")
	if p.TagID != "" {
		// Whole-segment match against the comma list, case-insensitively.
		sb.WriteString(" AND (',' || REPLACE(LOWER(IFNULL(tags,'')), ', ', ',') || ',') LIKE '%,' || LOWER(?) || ',%'")
		args = append(args, p.TagID)
	}
	if p.StarID != "" {
		// id IN (subquery) scans stars_tags ONCE and probes videos by primary
		// key. The previous correlated EXISTS re-scanned the unindexed
		// stars_tags (~20k rows) once per video (~8k rows) — ~5s per query,
		// which froze the grid whenever a performer was tapped in the rail.
		sb.WriteString(" AND videos.id IN (SELECT video_id FROM stars_tags WHERE star_name = ?)")
		args = append(args, p.StarID)
	}
	if q := strings.TrimSpace(p.Query); q != "" {
		sb.WriteString(" AND title LIKE ?")
		args = append(args, "%"+q+"%")
	}
	return sb.String(), args
}

// splitTags parses the comma-joined tags column into a clean slice.
func splitTags(raw string) []Tag {
	if raw == "" {
		return []Tag{}
	}
	parts := strings.Split(raw, ",")
	out := make([]Tag, 0, len(parts))
	for _, p := range parts {
		name := strings.TrimSpace(p)
		if name == "" {
			continue
		}
		out = append(out, Tag{ID: name, Name: name})
	}
	return out
}

// List returns one page of cards plus the total matching the query.
func (d *DB) List(p ListParams) (*ListResult, error) {
	db, err := d.conn()
	if err != nil {
		return nil, err
	}
	where, args := buildFilter(p)

	var total int
	if err := db.QueryRow("SELECT COUNT(*) FROM videos"+where, args...).Scan(&total); err != nil {
		return nil, err
	}

	if p.PerPage <= 0 {
		p.PerPage = 12
	}
	if p.Page <= 0 {
		p.Page = 1
	}
	offset := (p.Page - 1) * p.PerPage

	q := "SELECT id, title, thumbnail_url, preview_url, duration_seconds, views, bayesian_rating, width, height, tags FROM videos" +
		where + orderBy(p.Sort) + " LIMIT ? OFFSET ?"
	rowArgs := append(append([]interface{}{}, args...), p.PerPage, offset)

	rows, err := db.Query(q, rowArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cards := make([]Card, 0, p.PerPage)
	for rows.Next() {
		c, err := scanCard(rows)
		if err != nil {
			return nil, err
		}
		cards = append(cards, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &ListResult{Videos: cards, Total: total}, nil
}

// scanCard reads the common card columns from a row.
func scanCard(rows *sql.Rows) (Card, error) {
	var c Card
	var thumb, preview, tags sql.NullString
	var rating sql.NullFloat64
	var dur, views, w, h sql.NullInt64
	if err := rows.Scan(&c.ID, &c.Name, &thumb, &preview, &dur, &views, &rating, &w, &h, &tags); err != nil {
		return c, err
	}
	c.ThumbnailURL = CanonicalAssetURL(thumb.String)
	c.PreviewURL = CanonicalAssetURL(preview.String)
	c.Duration = int(dur.Int64)
	c.Views = int(views.Int64)
	c.Rating = rating.Float64
	c.Width = int(w.Int64)
	c.Height = int(h.Int64)
	c.HasFunscript = true // every PMVHaven video is funscript-capable (on demand)
	c.Tags = splitTags(tags.String)
	return c, nil
}

// Get returns the full detail for a single video, including its linked stars.
func (d *DB) Get(id string) (*Detail, error) {
	db, err := d.conn()
	if err != nil {
		return nil, err
	}
	var det Detail
	var thumb, preview, tags, uploader, uploaderUser, featured sql.NullString
	var rating sql.NullFloat64
	var dur, views, w, h sql.NullInt64
	row := db.QueryRow(
		"SELECT id, title, thumbnail_url, preview_url, duration_seconds, views, bayesian_rating, width, height, tags, uploader, uploader_username, featured_star FROM videos WHERE id = ?",
		id,
	)
	if err := row.Scan(&det.ID, &det.Name, &thumb, &preview, &dur, &views, &rating, &w, &h, &tags, &uploader, &uploaderUser, &featured); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	det.ThumbnailURL = CanonicalAssetURL(thumb.String)
	det.PreviewURL = CanonicalAssetURL(preview.String)
	det.Duration = int(dur.Int64)
	det.Views = int(views.Int64)
	det.Rating = rating.Float64
	det.Width = int(w.Int64)
	det.Height = int(h.Int64)
	det.HasFunscript = true
	det.Tags = splitTags(tags.String)
	det.Uploader = firstNonEmpty(uploaderUser.String, uploader.String)
	det.Stars = d.starsFor(db, id)
	// PMVHaven has no free-text description; surface the featured star as a hint.
	if featured.String != "" {
		det.Description = "Featuring " + featured.String
	}
	return &det, nil
}

// starsFor returns the performer names linked to a video (best-effort).
func (d *DB) starsFor(db *sql.DB, id string) []string {
	rows, err := db.Query("SELECT star_name FROM stars_tags WHERE video_id = ? ORDER BY star_name", id)
	if err != nil {
		return []string{}
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var s sql.NullString
		if err := rows.Scan(&s); err == nil && s.String != "" {
			out = append(out, s.String)
		}
	}
	return out
}

// Sources returns the single playable CDN mp4 for a video.
func (d *DB) Sources(id string) ([]Source, error) {
	db, err := d.conn()
	if err != nil {
		return nil, err
	}
	var url sql.NullString
	var h sql.NullInt64
	row := db.QueryRow("SELECT video_url, height FROM videos WHERE id = ?", id)
	if err := row.Scan(&url, &h); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return []Source{}, nil
		}
		return nil, err
	}
	if url.String == "" {
		return []Source{}, nil
	}
	quality := ""
	if h.Int64 > 0 {
		quality = fmt.Sprintf("%dp", h.Int64)
	}
	return []Source{{URL: CanonicalAssetURL(url.String), Quality: quality, Format: "mp4"}}, nil
}

// VideoURL returns the raw CDN mp4 url for a video (used by the funscript
// generator to pull the audio). Empty when the video is unknown.
func (d *DB) VideoURL(id string) (string, error) {
	db, err := d.conn()
	if err != nil {
		return "", err
	}
	var url sql.NullString
	row := db.QueryRow("SELECT video_url FROM videos WHERE id = ?", id)
	if err := row.Scan(&url); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return CanonicalAssetURL(url.String), nil
}

// CountsFor returns per-media-type counts under the active tag/star filter. All
// PMVHaven videos are flat and funscript-capable, so flat == funscript == all
// and vr == 0.
func (d *DB) CountsFor(tagID, starID string) (*Counts, error) {
	db, err := d.conn()
	if err != nil {
		return nil, err
	}
	where, args := buildFilter(ListParams{TagID: tagID, StarID: starID})
	var all int
	if err := db.QueryRow("SELECT COUNT(*) FROM videos"+where, args...).Scan(&all); err != nil {
		return nil, err
	}
	return &Counts{All: all, VR: 0, Flat: all, Funscript: all}, nil
}

// Tags returns the most common tags (by video count) parsed from the comma-list
// column, capped at limit. The tag id is its name.
func (d *DB) Tags(limit int) ([]RailEntry, error) {
	db, err := d.conn()
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 200
	}
	rows, err := db.Query("SELECT tags FROM videos WHERE tags IS NOT NULL AND tags != ''")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := make(map[string]int)
	display := make(map[string]string) // lower -> first-seen display form
	for rows.Next() {
		var raw sql.NullString
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		for _, t := range splitTags(raw.String) {
			key := strings.ToLower(t.Name)
			counts[key]++
			if _, ok := display[key]; !ok {
				display[key] = t.Name
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]RailEntry, 0, len(counts))
	for key, n := range counts {
		out = append(out, RailEntry{ID: display[key], Name: display[key], Count: n})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Name < out[j].Name
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// Stars returns the performers with the most videos, by descending video count,
// capped at limit. The star id is its name (the filter key).
func (d *DB) Stars(limit int) ([]RailEntry, error) {
	db, err := d.conn()
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 200
	}
	q := "SELECT star_name, COUNT(DISTINCT video_id) c FROM stars_tags " +
		"WHERE star_name IS NOT NULL AND star_name != '' " +
		"GROUP BY star_name ORDER BY c DESC, star_name ASC LIMIT ?"
	rows, err := db.Query(q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]RailEntry, 0, limit)
	for rows.Next() {
		var e RailEntry
		if err := rows.Scan(&e.Name, &e.Count); err != nil {
			return nil, err
		}
		e.ID = e.Name
		out = append(out, e)
	}
	return out, rows.Err()
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
