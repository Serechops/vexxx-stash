package api

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/logger"

	_ "github.com/stashapp/stash/pkg/sqlite"
)

// Persistent local cache for the small per-series/per-collection banner
// images the Series and Movies browse tabs render. NewSensations and
// TeamSkeet previously pointed <img src> straight at the source site's CDN —
// re-fetched by the browser on every tile render, every visit, forever (NS
// additionally caches the *URL list* client-side for 24h, but never the
// image bytes; the URLs themselves carry a short validity window, so even
// that cache can go stale before it expires). This sidecar downloads each
// banner once and serves it from local disk from then on.
//
// Same shape as nsCatalogStore (apihub_newsensations_store.go): lazily
// opened, single connection, WAL, re-opened only if the resolved path
// changes.

const bannerCacheSchema = `
CREATE TABLE IF NOT EXISTS banners (
	network TEXT NOT NULL,
	item_id TEXT NOT NULL,
	local_path TEXT NOT NULL,
	content_type TEXT NOT NULL,
	downloaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (network, item_id)
);
`

// bannerCacheStore persists which banners have already been downloaded.
type bannerCacheStore struct {
	mu      sync.Mutex
	handle  *sql.DB
	openedP string
}

// bannerCache is the process-wide store, package-level singleton matching
// nsCatalog / teamSkeetDurations.
var bannerCache = &bannerCacheStore{}

// dbPath follows the same plugin-dir-first, apihub-data-dir-fallback
// resolution as nsCatalogStore.dbPath.
func (s *bannerCacheStore) dbPath() (path string) {
	defer func() {
		if recover() != nil {
			path = ""
		}
	}()

	cfgPath := config.GetInstance().GetConfigPath()

	pluginDB := filepath.Join(cfgPath, "plugins", "apihub", "banner_cache.db")
	rootDB := filepath.Join(cfgPath, "apihub", "banner_cache.db")

	pluginInfo, pluginErr := os.Stat(pluginDB)
	rootInfo, rootErr := os.Stat(rootDB)

	if pluginErr == nil && rootErr == nil {
		if pluginInfo.Size() >= rootInfo.Size() {
			return pluginDB
		}
		return rootDB
	}
	if pluginErr == nil {
		return pluginDB
	}
	if rootErr == nil {
		return rootDB
	}
	return pluginDB
}

func (s *bannerCacheStore) conn() (*sql.DB, error) {
	path := s.dbPath()
	if path == "" {
		return nil, fmt.Errorf("no configuration, so no banner cache")
	}
	if s.handle != nil && s.openedP == path {
		return s.handle, nil
	}
	if s.handle != nil {
		_ = s.handle.Close()
		s.handle = nil
	}

	logger.Infof("[apihub] banner cache: using database at %s", path)

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create apihub data dir: %w", err)
	}

	dsn := "file:" + filepath.ToSlash(path) + "?_journal_mode=WAL&_busy_timeout=5000"
	h, err := sql.Open("sqlite3ex", dsn)
	if err != nil {
		return nil, err
	}
	h.SetMaxOpenConns(1)

	if _, err := h.Exec(bannerCacheSchema); err != nil {
		_ = h.Close()
		return nil, fmt.Errorf("init banner cache schema: %w", err)
	}

	s.handle = h
	s.openedP = path
	return h, nil
}

type bannerRecord struct {
	LocalPath   string
	ContentType string
}

func (s *bannerCacheStore) lookup(network, itemID string) *bannerRecord {
	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.conn()
	if err != nil {
		return nil
	}
	var r bannerRecord
	err = db.QueryRow(
		`SELECT local_path, content_type FROM banners WHERE network = ? AND item_id = ?`,
		network, itemID,
	).Scan(&r.LocalPath, &r.ContentType)
	if err != nil {
		return nil
	}
	return &r
}

func (s *bannerCacheStore) upsert(network, itemID, localPath, contentType string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.conn()
	if err != nil {
		return err
	}
	_, err = db.Exec(
		`INSERT INTO banners (network, item_id, local_path, content_type, downloaded_at)
		 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(network, item_id) DO UPDATE SET
		   local_path = excluded.local_path, content_type = excluded.content_type,
		   downloaded_at = excluded.downloaded_at`,
		network, itemID, localPath, contentType,
	)
	return err
}

// ─── HTTP handler ─────────────────────────────────────────────────────────

var bannerAllowedNetworks = map[string]bool{
	"newsensations": true,
	"teamskeet":     true,
	"adulttime":     true,
}

// bannerMaxBytes caps a single banner download — these are small tile
// images, this is generous headroom rather than an expected size.
const bannerMaxBytes = 10 << 20 // 10 MB

var bannerHTTPClient = &http.Client{Timeout: 15 * time.Second}

// ServeCachedBanner serves a previously-downloaded banner from local disk,
// or downloads it once (from the `src` query param) and caches it before
// serving.
//
// GET /apihub-banners/{network}/{id}?src=<url>
func ServeCachedBanner(w http.ResponseWriter, r *http.Request) {
	network := chi.URLParam(r, "network")
	id := chi.URLParam(r, "id")
	if !bannerAllowedNetworks[network] || id == "" {
		http.Error(w, "unknown network or missing id", http.StatusBadRequest)
		return
	}

	if rec := bannerCache.lookup(network, id); rec != nil {
		if f, err := os.Open(rec.LocalPath); err == nil {
			defer f.Close()
			w.Header().Set("Content-Type", rec.ContentType)
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			io.Copy(w, f)
			return
		}
		// Local file went missing (e.g. manual deletion) — fall through and
		// re-download below.
	}

	src := r.URL.Query().Get("src")
	if src == "" {
		http.Error(w, "no cached banner and no src to fetch", http.StatusNotFound)
		return
	}

	localPath, contentType, err := downloadBanner(r.Context(), network, id, src)
	if err != nil {
		logger.Debugf("[apihub] banner cache: failed to download %s/%s from %s: %v", network, id, src, err)
		// Fall back to a redirect so the tile still renders even though this
		// banner couldn't be cached.
		http.Redirect(w, r, src, http.StatusFound)
		return
	}

	if err := bannerCache.upsert(network, id, localPath, contentType); err != nil {
		logger.Warnf("[apihub] banner cache: failed to record %s/%s: %v", network, id, err)
	}

	f, err := os.Open(localPath)
	if err != nil {
		http.Redirect(w, r, src, http.StatusFound)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	io.Copy(w, f)
}

// downloadBanner fetches src and writes it atomically (via a .part file,
// renamed on success — same pattern as apihub_download_job.go's download())
// to <config>/apihub/banners/{network}/{id}.{ext}, rejecting anything that
// isn't a reasonably-sized image response.
//
// src's host is resolved and checked against loopback/private/link-local
// ranges before the request is made. This route is already behind Stash's
// own session auth (server.go's authenticateHandler wraps the whole router),
// but it still accepts an arbitrary URL from that authenticated session, so
// this is basic SSRF hardening on top of that — not a substitute for it.
func downloadBanner(ctx context.Context, network, id, src string) (localPath, contentType string, err error) {
	parsed, err := url.Parse(src)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return "", "", fmt.Errorf("invalid or non-https src URL")
	}
	if err := rejectPrivateHost(parsed.Hostname()); err != nil {
		return "", "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, src, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")

	resp, err := bannerHTTPClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("unexpected status %s", resp.Status)
	}

	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "image/") {
		return "", "", fmt.Errorf("unexpected content-type %q", ct)
	}

	cfgPath := config.GetInstance().GetConfigPath()
	dir := filepath.Join(cfgPath, "apihub", "banners", network)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", fmt.Errorf("create banner dir: %w", err)
	}

	ext := bannerExtFromContentType(ct)
	dest := filepath.Join(dir, id+ext)
	part := dest + ".part"

	out, err := os.Create(part)
	if err != nil {
		return "", "", err
	}

	n, copyErr := io.Copy(out, io.LimitReader(resp.Body, bannerMaxBytes+1))
	closeErr := out.Close()

	if copyErr != nil {
		os.Remove(part)
		return "", "", copyErr
	}
	if closeErr != nil {
		os.Remove(part)
		return "", "", closeErr
	}
	if n > bannerMaxBytes {
		os.Remove(part)
		return "", "", fmt.Errorf("banner exceeds %d bytes", bannerMaxBytes)
	}

	if err := os.Rename(part, dest); err != nil {
		os.Remove(part)
		return "", "", err
	}

	return dest, ct, nil
}

func bannerExtFromContentType(ct string) string {
	switch {
	case strings.Contains(ct, "png"):
		return ".png"
	case strings.Contains(ct, "webp"):
		return ".webp"
	case strings.Contains(ct, "gif"):
		return ".gif"
	default:
		return ".jpg"
	}
}

// rejectPrivateHost resolves hostname and rejects loopback, private, and
// link-local addresses — this endpoint fetches an arbitrary caller-supplied
// URL, so it must not become a way to probe the host's own internal network.
func rejectPrivateHost(hostname string) error {
	ips, err := net.LookupIP(hostname)
	if err != nil {
		return fmt.Errorf("could not resolve host: %w", err)
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return fmt.Errorf("refusing to fetch from a private/loopback address")
		}
	}
	return nil
}
