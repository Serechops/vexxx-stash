// Package faptap is a read-only reader for the optional FapTap sidecar database
// (faptap_data.db) produced by the external FapTap scraper. It powers the
// premium "FapTap" content mode in the immersive VR Home wall.
//
// The database lives entirely outside Stash's own library: it is never written
// to here and is opened read-only. Its mere presence in the configured FapTap
// directory is what unlocks the addon, so [DB] re-checks the file on every call
// and transparently (re)opens when it appears, disappears, or is replaced by a
// fresh scrape — no server restart required.
//
// Schema note: the scrape stores creators in a `users` table but does not link
// them to `videos` (no user_id FK), so creator-scoped filtering is not possible
// from this data. The filter rail is therefore tag-only; [Creators] returns the
// known creators for display but they cannot be used as a video filter until the
// scraper persists a video→user association.
package faptap

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	// Registers the "sqlite3ex" driver used below (side-effect import).
	_ "github.com/stashapp/stash/pkg/sqlite"
)

const driverName = "sqlite3ex"

// ErrUnavailable is returned by every query method when the sidecar database is
// not present. Callers translate this into the "locked" state on the frontend.
var ErrUnavailable = errors.New("faptap database not available")

// Tag is a FapTap tag attached to a video card.
type Tag struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Card is the lightweight grid entry rendered on the Home wall.
type Card struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ThumbnailURL string `json:"thumbnail_url"`
	PreviewURL   string `json:"preview_url"`
	Duration     int    `json:"duration"`
	Views        int    `json:"views"`
	VR           bool   `json:"vr"`
	Projection   string `json:"projection"`
	HasFunscript bool   `json:"has_funscript"`
	Tags         []Tag  `json:"tags"`
}

// Detail is the full record needed to synthesize a playable scene.
type Detail struct {
	Card
	Description string `json:"description"`
	Creator    string `json:"creator"`
}

// Source is one playable CDN source for a video.
type Source struct {
	URL     string `json:"url"`
	Quality string `json:"quality"`
	Format  string `json:"format"`
}

// RailEntry is a tag/creator tile for the filter rail.
type RailEntry struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// Counts are the per-media-type totals under the active filter.
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
	Media   string // all | vr | funscript
	TagID   string
	Sort    string // recent | views | rating
	Query   string
}

// DB is a lazily-opened, hot-swappable read-only handle to the sidecar database.
type DB struct {
	mu sync.Mutex
	// dir resolves the FapTap data directory on each call, so changing the
	// configured path (e.g. via the plugin setting) takes effect on the next
	// request without a server restart.
	dir     func() string
	handle  *sql.DB
	openedP string // path the open handle was opened for
	modSig  string // size+mtime signature the open handle was opened against
}

// New returns a reader whose data directory is resolved lazily via dirProvider.
// The database is expected at <dir>/faptap_data.db.
func New(dirProvider func() string) *DB {
	return &DB{dir: dirProvider}
}

// dbPath resolves the current database file path.
func (d *DB) dbPath() string {
	return filepath.Join(d.dir(), "faptap_data.db")
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
	// File is new, changed, or the configured path moved — reopen.
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

// Total returns the count of (non soft-deleted) videos, or 0 when unavailable.
func (d *DB) Total() (int, error) {
	db, err := d.conn()
	if err != nil {
		return 0, err
	}
	var n int
	row := db.QueryRow("SELECT COUNT(*) FROM videos WHERE " + notDeleted)
	if err := row.Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

// notDeleted excludes soft-deleted rows. is_softdeleted is stored as text and is
// empty/NULL for live videos.
const notDeleted = "(is_softdeleted IS NULL OR is_softdeleted = '' OR is_softdeleted = '0')"

// mediaWhere returns the SQL predicate for a media filter.
func mediaWhere(media string) string {
	switch media {
	case "vr":
		return " AND vr = 1"
	case "flat":
		return " AND vr = 0"
	case "funscript":
		return " AND has_funscript = 1"
	default:
		return ""
	}
}

// orderBy maps a sort key onto a videos column.
func orderBy(sort string) string {
	switch sort {
	case "views", "rating":
		// No rating column on videos; approximate popularity by view count.
		return " ORDER BY views DESC"
	case "title":
		return " ORDER BY name COLLATE NOCASE ASC"
	default: // recent
		return " ORDER BY created_at DESC"
	}
}

// buildFilter assembles the shared WHERE clause + args for list/count queries.
// A non-empty TagID adds an EXISTS sub-query against video_tags.
func buildFilter(p ListParams) (string, []interface{}) {
	var sb strings.Builder
	var args []interface{}
	sb.WriteString(" WHERE ")
	sb.WriteString(notDeleted)
	sb.WriteString(mediaWhere(p.Media))
	if p.TagID != "" {
		sb.WriteString(" AND EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = videos.id AND vt.tag_id = ?)")
		args = append(args, p.TagID)
	}
	if q := strings.TrimSpace(p.Query); q != "" {
		sb.WriteString(" AND name LIKE ?")
		args = append(args, "%"+q+"%")
	}
	return sb.String(), args
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

	q := "SELECT id, name, thumbnail_url, preview_url, duration, views, vr, projection, has_funscript FROM videos" +
		where + orderBy(p.Sort) + " LIMIT ? OFFSET ?"
	rowArgs := append(append([]interface{}{}, args...), p.PerPage, offset)

	rows, err := db.Query(q, rowArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cards := make([]Card, 0, p.PerPage)
	ids := make([]string, 0, p.PerPage)
	for rows.Next() {
		var c Card
		var vrInt, fs int
		var thumb, preview, proj sql.NullString
		if err := rows.Scan(&c.ID, &c.Name, &thumb, &preview, &c.Duration, &c.Views, &vrInt, &proj, &fs); err != nil {
			return nil, err
		}
		c.ThumbnailURL = thumb.String
		c.PreviewURL = preview.String
		c.Projection = proj.String
		c.VR = vrInt == 1
		c.HasFunscript = fs == 1
		c.Tags = []Tag{}
		cards = append(cards, c)
		ids = append(ids, c.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(ids) > 0 {
		tagsByVideo, err := d.tagsFor(db, ids)
		if err == nil {
			for i := range cards {
				if t := tagsByVideo[cards[i].ID]; t != nil {
					cards[i].Tags = t
				}
			}
		}
	}

	return &ListResult{Videos: cards, Total: total}, nil
}

// tagsFor batch-loads tags for a set of video ids.
func (d *DB) tagsFor(db *sql.DB, ids []string) (map[string][]Tag, error) {
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	q := "SELECT vt.video_id, t.id, t.name FROM video_tags vt " +
		"JOIN tags t ON t.id = vt.tag_id WHERE vt.video_id IN (" + placeholders + ")"
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string][]Tag)
	for rows.Next() {
		var vid string
		var t Tag
		if err := rows.Scan(&vid, &t.ID, &t.Name); err != nil {
			return nil, err
		}
		out[vid] = append(out[vid], t)
	}
	return out, rows.Err()
}

// Get returns the full detail for a single video.
func (d *DB) Get(id string) (*Detail, error) {
	db, err := d.conn()
	if err != nil {
		return nil, err
	}
	var det Detail
	var vrInt, fs int
	var thumb, preview, proj, desc sql.NullString
	row := db.QueryRow(
		"SELECT id, name, description, thumbnail_url, preview_url, duration, views, vr, projection, has_funscript FROM videos WHERE id = ?",
		id,
	)
	if err := row.Scan(&det.ID, &det.Name, &desc, &thumb, &preview, &det.Duration, &det.Views, &vrInt, &proj, &fs); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	det.Description = desc.String
	det.ThumbnailURL = thumb.String
	det.PreviewURL = preview.String
	det.Projection = proj.String
	det.VR = vrInt == 1
	det.HasFunscript = fs == 1
	det.Tags = []Tag{}
	if tagsByVideo, err := d.tagsFor(db, []string{id}); err == nil {
		if t := tagsByVideo[id]; t != nil {
			det.Tags = t
		}
	}
	return &det, nil
}

// Sources returns the playable CDN sources for a video, best (highest quality,
// mp4-preferred) first.
func (d *DB) Sources(id string) ([]Source, error) {
	db, err := d.conn()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(
		"SELECT url, quality, format FROM video_sources WHERE video_id = ?", id,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Source
	for rows.Next() {
		var s Source
		var url, quality, format sql.NullString
		if err := rows.Scan(&url, &quality, &format); err != nil {
			return nil, err
		}
		if url.String == "" {
			continue
		}
		s.URL = url.String
		s.Quality = quality.String
		s.Format = format.String
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sortSources(out)
	return out, nil
}

// sortSources orders by descending quality (parsed leading integer), preferring
// mp4 on ties.
func sortSources(s []Source) {
	rank := func(src Source) int {
		n := 0
		for _, r := range src.Quality {
			if r < '0' || r > '9' {
				break
			}
			n = n*10 + int(r-'0')
		}
		// mp4 wins ties with a small bump.
		if strings.EqualFold(src.Format, "mp4") {
			n = n*10 + 1
		} else {
			n = n * 10
		}
		return n
	}
	// simple insertion sort — source lists are tiny.
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && rank(s[j]) > rank(s[j-1]); j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

// FunscriptPath returns the local CSV funscript path for a video (may be empty).
func (d *DB) FunscriptPath(id string) (string, error) {
	db, err := d.conn()
	if err != nil {
		return "", err
	}
	var p sql.NullString
	row := db.QueryRow("SELECT funscript_local_path FROM videos WHERE id = ?", id)
	if err := row.Scan(&p); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return p.String, nil
}

// CountsFor returns per-media-type counts under the active tag filter and free-
// text query. The query belongs here because the counts label the media-toggle
// chips above a grid that IS search-filtered — counting without it reports
// whole-library totals over a searched-down wall.
func (d *DB) CountsFor(tagID, query string) (*Counts, error) {
	db, err := d.conn()
	if err != nil {
		return nil, err
	}
	base := ListParams{TagID: tagID, Query: query}
	count := func(media string) (int, error) {
		p := base
		p.Media = media
		where, args := buildFilter(p)
		var n int
		err := db.QueryRow("SELECT COUNT(*) FROM videos"+where, args...).Scan(&n)
		return n, err
	}
	all, err := count("all")
	if err != nil {
		return nil, err
	}
	vr, err := count("vr")
	if err != nil {
		return nil, err
	}
	fs, err := count("funscript")
	if err != nil {
		return nil, err
	}
	flat := all - vr
	if flat < 0 {
		flat = 0
	}
	return &Counts{All: all, VR: vr, Flat: flat, Funscript: fs}, nil
}

// Tags returns the tags that have at least one live video, by descending video
// count, capped at limit.
func (d *DB) Tags(limit int) ([]RailEntry, error) {
	db, err := d.conn()
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 200
	}
	q := "SELECT t.id, t.name, COUNT(vt.video_id) c FROM tags t " +
		"JOIN video_tags vt ON vt.tag_id = t.id " +
		"JOIN videos v ON v.id = vt.video_id AND " + strings.ReplaceAll(notDeleted, "is_softdeleted", "v.is_softdeleted") + " " +
		"GROUP BY t.id, t.name HAVING c > 0 ORDER BY c DESC LIMIT ?"
	rows, err := db.Query(q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]RailEntry, 0, limit)
	for rows.Next() {
		var e RailEntry
		if err := rows.Scan(&e.ID, &e.Name, &e.Count); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Creators returns known creators for display. NOTE: the scrape does not link
// videos to creators, so these cannot currently be used as a video filter and
// carry no count. Returns an empty slice rather than erroring on absence.
func (d *DB) Creators(limit int) ([]RailEntry, error) {
	db, err := d.conn()
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 200
	}
	rows, err := db.Query(
		"SELECT id, username FROM users WHERE username IS NOT NULL AND username != '' ORDER BY subscribers DESC LIMIT ?",
		limit,
	)
	if err != nil {
		// users table may be sparse; treat as empty.
		return []RailEntry{}, nil //nolint:nilerr
	}
	defer rows.Close()
	out := make([]RailEntry, 0, limit)
	for rows.Next() {
		var e RailEntry
		if err := rows.Scan(&e.ID, &e.Name); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
