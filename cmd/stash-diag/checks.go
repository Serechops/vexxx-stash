package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	// CGo SQLite driver — same driver used by stash itself.
	_ "github.com/mattn/go-sqlite3"
	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/ffmpeg"
)

// expectedSchemaVersion must stay in sync with appSchemaVersion
// in pkg/sqlite/database.go.
const expectedSchemaVersion = 85

// ---------------------------------------------------------------------------
// PATHS
// ---------------------------------------------------------------------------

type pathEntry struct {
	name string
	path string
	// mustExist controls whether a missing path is an error (true) or a warning.
	mustExist bool
}

func checkPaths(cfg *config.Config) []CheckResult {
	const sec = "PATHS"

	dirs := []pathEntry{
		{"cache", cfg.GetCachePath(), false},
		{"generated", cfg.GetGeneratedPath(), false},
		{"metadata", cfg.GetMetadataPath(), false},
		{"blobs", cfg.GetBlobsPath(), false},
	}

	// Library paths (stash dirs) are expected to already exist.
	for _, sp := range cfg.GetStashPaths() {
		dirs = append(dirs, pathEntry{
			name:      fmt.Sprintf("library: %s", sp.Path),
			path:      sp.Path,
			mustExist: true,
		})
	}

	var results []CheckResult
	for _, d := range dirs {
		if d.path == "" {
			results = append(results, warn(sec, d.name, "not configured"))
			continue
		}

		info, err := os.Stat(d.path)
		if err != nil {
			if os.IsNotExist(err) {
				if d.mustExist {
					results = append(results, errResult(sec, d.name, fmt.Sprintf("not found: %s", d.path)))
				} else {
					results = append(results, warn(sec, d.name, fmt.Sprintf("not found (will be created on first use): %s", d.path)))
				}
			} else {
				results = append(results, errResult(sec, d.name, fmt.Sprintf("%s: %v", d.path, err)))
			}
			continue
		}

		if !info.IsDir() {
			results = append(results, errResult(sec, d.name, fmt.Sprintf("not a directory: %s", d.path)))
			continue
		}

		free, freeErr := freeSpaceBytes(d.path)
		if freeErr == nil {
			freeMsg := fmt.Sprintf("%s  (%s free)", d.path, formatBytes(free))
			const warnThreshold = 1 << 30 // 1 GiB
			if free < warnThreshold {
				results = append(results, warn(sec, d.name, freeMsg+" — LOW DISK SPACE"))
			} else {
				results = append(results, ok(sec, d.name, freeMsg))
			}
		} else {
			results = append(results, ok(sec, d.name, d.path))
		}
	}

	return results
}

// ---------------------------------------------------------------------------
// FFMPEG
// ---------------------------------------------------------------------------

func checkFFmpeg(cfg *config.Config) []CheckResult {
	const sec = "FFMPEG"
	var results []CheckResult

	ffmpegPath := ffmpeg.ResolveFFMpeg(cfg.GetFFMpegPath(), cfg.GetGeneratedPath())
	if ffmpegPath == "" {
		results = append(results, errResult(sec, "ffmpeg", "not found — check PATH or set ffmpeg_path in config"))
		return results
	}

	if err := ffmpeg.ValidateFFMpeg(ffmpegPath); err != nil {
		results = append(results, errResult(sec, "ffmpeg", fmt.Sprintf("%s: %v", ffmpegPath, err)))
		return results
	}

	codecErr := ffmpeg.ValidateFFMpegCodecSupport(ffmpegPath)
	if codecErr != nil {
		results = append(results, withDetail(
			warn(sec, "ffmpeg", fmt.Sprintf("%s (missing codec support)", ffmpegPath)),
			codecErr.Error(),
		))
	} else {
		results = append(results, ok(sec, "ffmpeg", fmt.Sprintf("%s — codecs OK", ffmpegPath)))
	}

	ffprobePath := ffmpeg.ResolveFFProbe(cfg.GetFFProbePath(), cfg.GetGeneratedPath())
	if ffprobePath == "" {
		results = append(results, errResult(sec, "ffprobe", "not found — check PATH or set ffprobe_path in config"))
	} else if err := ffmpeg.ValidateFFProbe(ffprobePath); err != nil {
		results = append(results, errResult(sec, "ffprobe", fmt.Sprintf("%s: %v", ffprobePath, err)))
	} else {
		results = append(results, ok(sec, "ffprobe", ffprobePath))
	}

	return results
}

// ---------------------------------------------------------------------------
// DATABASE
// ---------------------------------------------------------------------------

func checkDatabase(cfg *config.Config) []CheckResult {
	const sec = "DATABASE"

	dbPath := cfg.GetDatabasePath()
	if dbPath == "" {
		dbPath = cfg.GetDefaultDatabaseFilePath()
	}
	if dbPath == "" {
		return []CheckResult{warn(sec, "database", "path not configured")}
	}

	info, err := os.Stat(dbPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []CheckResult{warn(sec, "database", fmt.Sprintf("file not found (new installation?): %s", dbPath))}
		}
		return []CheckResult{errResult(sec, "database", fmt.Sprintf("cannot stat %s: %v", dbPath, err))}
	}

	size := formatBytes(uint64(info.Size()))

	// Open with ?mode=ro so we never accidentally write or create.
	dsn := fmt.Sprintf("file:%s?mode=ro&_busy_timeout=5000&cache=shared", dbPath)
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return []CheckResult{errResult(sec, "database", fmt.Sprintf("%s (%s): cannot open: %v", dbPath, size, err))}
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var schemaVersion int
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&schemaVersion); err != nil {
		return []CheckResult{errResult(sec, "database", fmt.Sprintf("%s (%s): cannot read schema version: %v", dbPath, size, err))}
	}

	var results []CheckResult

	switch {
	case schemaVersion == expectedSchemaVersion:
		results = append(results, ok(sec, "database", fmt.Sprintf("%s (%s)  schema %d (up to date)", dbPath, size, schemaVersion)))
	case schemaVersion < expectedSchemaVersion:
		results = append(results, withDetail(
			warn(sec, "database", fmt.Sprintf("%s (%s)  schema %d (migration needed — expected %d)", dbPath, size, schemaVersion, expectedSchemaVersion)),
			"Run Stash to perform the automatic migration",
		))
	default:
		results = append(results, errResult(sec, "database", fmt.Sprintf("%s (%s)  schema %d (newer than expected %d — downgrade?)", dbPath, size, schemaVersion, expectedSchemaVersion)))
	}

	// WAL journal mode
	var journalMode string
	if err := db.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&journalMode); err == nil {
		if journalMode == "wal" {
			results = append(results, ok(sec, "journal_mode", "WAL (expected)"))
		} else {
			results = append(results, warn(sec, "journal_mode", fmt.Sprintf("%s (expected WAL)", journalMode)))
		}
	}

	// Quick integrity check — only checks the first page to avoid long hangs
	var integrity string
	ictx, icancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer icancel()
	if err := db.QueryRowContext(ictx, "PRAGMA integrity_check(1)").Scan(&integrity); err == nil {
		if integrity == "ok" {
			results = append(results, ok(sec, "integrity", "ok (quick check passed)"))
		} else {
			results = append(results, errResult(sec, "integrity", fmt.Sprintf("FAILED: %s", integrity)))
		}
	} else {
		results = append(results, warn(sec, "integrity", fmt.Sprintf("could not run integrity_check: %v", err)))
	}

	return results
}

// ---------------------------------------------------------------------------
// PLUGINS & SCRAPERS
// ---------------------------------------------------------------------------

func checkPlugins(cfg *config.Config) []CheckResult {
	dirPath := cfg.GetPluginsPath()
	if dirPath == "" {
		dirPath = cfg.GetDefaultPluginsPath()
	}
	return checkYMLDir("PLUGINS", "plugins", dirPath)
}

func checkScrapers(cfg *config.Config) []CheckResult {
	dirPath := cfg.GetScrapersPath()
	if dirPath == "" {
		dirPath = cfg.GetDefaultScrapersPath()
	}
	return checkYMLDir("SCRAPERS", "scrapers", dirPath)
}

func checkYMLDir(section, name, dirPath string) []CheckResult {
	if dirPath == "" {
		return []CheckResult{warn(section, name, "path not configured")}
	}

	info, err := os.Stat(dirPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []CheckResult{warn(section, name, fmt.Sprintf("directory not found: %s", dirPath))}
		}
		return []CheckResult{errResult(section, name, fmt.Sprintf("%s: %v", dirPath, err))}
	}
	if !info.IsDir() {
		return []CheckResult{errResult(section, name, fmt.Sprintf("not a directory: %s", dirPath))}
	}

	count := countYMLFiles(dirPath)
	return []CheckResult{ok(section, name, fmt.Sprintf("%s (%d found)", dirPath, count))}
}

// countYMLFiles walks one level deep and counts subdirectories that contain a
// .yml manifest — mirroring how stash discovers plugins and scrapers.
func countYMLFiles(dir string) int {
	count := 0
	_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if strings.EqualFold(filepath.Ext(d.Name()), ".yml") {
			count++
		}
		return nil
	})
	return count
}

// ---------------------------------------------------------------------------
// ONLINE (GraphQL)
// ---------------------------------------------------------------------------

func checkOnline(rawURL, apiKey string) []CheckResult {
	const sec = "ONLINE"

	client := &http.Client{Timeout: 10 * time.Second}

	type gqlReq struct {
		Query string `json:"query"`
	}

	doQuery := func(query string) (map[string]interface{}, error) {
		body, _ := json.Marshal(gqlReq{Query: query})
		req, err := http.NewRequest(http.MethodPost, rawURL+"/graphql", bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		if apiKey != "" {
			req.Header.Set("ApiKey", apiKey)
		}

		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("request failed: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return nil, fmt.Errorf("HTTP %d — try --api-key", resp.StatusCode)
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
		}

		var gqlResp struct {
			Data   map[string]interface{} `json:"data"`
			Errors []struct {
				Message string `json:"message"`
			} `json:"errors"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&gqlResp); err != nil {
			return nil, fmt.Errorf("invalid JSON response: %w", err)
		}
		if len(gqlResp.Errors) > 0 {
			return nil, fmt.Errorf("graphql error: %s", gqlResp.Errors[0].Message)
		}
		return gqlResp.Data, nil
	}

	var results []CheckResult

	// --- systemStatus ---
	statusData, err := doQuery(`{ systemStatus { status databaseSchema appSchema ffmpegPath ffprobePath isDocker } }`)
	if err != nil {
		results = append(results, errResult(sec, "connection", fmt.Sprintf("cannot reach %s: %v", rawURL, err)))
		return results // no point continuing if offline
	}
	if ss, found := nestedMap(statusData, "systemStatus"); found {
		status := stringField(ss, "status")
		isDocker := boolField(ss, "isDocker")
		dbSchema := intField(ss, "databaseSchema")
		msg := fmt.Sprintf("status=%s  dbSchema=%d", status, dbSchema)
		if isDocker {
			msg += "  (Docker)"
		}
		switch status {
		case "OK":
			results = append(results, ok(sec, "systemStatus", msg))
		case "NEEDS_MIGRATION":
			results = append(results, warn(sec, "systemStatus", msg+" — migration required"))
		default:
			results = append(results, warn(sec, "systemStatus", msg))
		}
	}

	// --- stats ---
	statsData, err := doQuery(`{ stats { scene_count image_count gallery_count performer_count studio_count tag_count } }`)
	if err == nil {
		if s, found := nestedMap(statsData, "stats"); found {
			results = append(results, ok(sec, "stats", fmt.Sprintf(
				"%d scenes · %d images · %d galleries · %d performers · %d studios · %d tags",
				intField(s, "scene_count"),
				intField(s, "image_count"),
				intField(s, "gallery_count"),
				intField(s, "performer_count"),
				intField(s, "studio_count"),
				intField(s, "tag_count"),
			)))
		}
	} else {
		results = append(results, warn(sec, "stats", fmt.Sprintf("could not fetch: %v", err)))
	}

	// --- systemStats (memory / goroutines) ---
	sysData, err := doQuery(`{ systemStats { memory goroutines } }`)
	if err == nil {
		if s, found := nestedMap(sysData, "systemStats"); found {
			results = append(results, ok(sec, "systemStats", fmt.Sprintf("%.1f MB heap · %d goroutines",
				floatField(s, "memory"), intField(s, "goroutines"))))
		}
	}

	// --- version ---
	versionData, err := doQuery(`{ version { version hash build_time } latestversion { version url } }`)
	if err == nil {
		if v, found := nestedMap(versionData, "version"); found {
			ver := stringField(v, "version")
			hash := stringField(v, "hash")
			built := stringField(v, "build_time")
			msg := fmt.Sprintf("%s (%s)  built %s", ver, hash, built)

			if lv, foundLV := nestedMap(versionData, "latestversion"); foundLV {
				latest := stringField(lv, "version")
				if latest != "" && latest != ver {
					msg += fmt.Sprintf("  — update available: %s", latest)
					results = append(results, warn(sec, "version", msg))
				} else {
					results = append(results, ok(sec, "version", msg))
				}
			} else {
				results = append(results, ok(sec, "version", msg))
			}
		}
	}

	// --- configuration (GQL CONFIG) ---
	const cfgsec = "GQL CONFIG"
	confData, err := doQuery(`{ configuration { general { stashes { path excludeVideo excludeImage } databasePath generatedPath metadataPath cachePath blobsPath scrapersPath pluginsPath ffmpegPath ffprobePath logFile logLevel } } }`)
	if err != nil {
		results = append(results, warn(cfgsec, "configuration", fmt.Sprintf("could not fetch: %v", err)))
	} else if conf, found := nestedMap(confData, "configuration"); found {
		if general, found := nestedMap(conf, "general"); found {
			// Libraries
			if stashesRaw, ok2 := general["stashes"]; ok2 {
				if stashes, ok2 := stashesRaw.([]interface{}); ok2 {
					if len(stashes) == 0 {
						results = append(results, warn(cfgsec, "libraries", "no libraries configured"))
					}
					for i, s := range stashes {
						if sm, ok2 := s.(map[string]interface{}); ok2 {
							path := stringField(sm, "path")
							var flags []string
							if boolField(sm, "excludeVideo") {
								flags = append(flags, "no-video")
							}
							if boolField(sm, "excludeImage") {
								flags = append(flags, "no-image")
							}
							msg := path
							if len(flags) > 0 {
								msg += "  [" + strings.Join(flags, ", ") + "]"
							}
							label := fmt.Sprintf("library[%d]", i)
							if path == "" {
								results = append(results, warn(cfgsec, label, "empty path"))
							} else {
								results = append(results, ok(cfgsec, label, msg))
							}
						}
					}
				}
			}
			// Key paths reported by the running instance
			for _, pf := range []struct{ key, label string }{
				{"databasePath", "database"},
				{"generatedPath", "generated"},
				{"metadataPath", "metadata"},
				{"cachePath", "cache"},
				{"blobsPath", "blobs"},
				{"scrapersPath", "scrapers"},
				{"pluginsPath", "plugins"},
				{"ffmpegPath", "ffmpeg"},
				{"ffprobePath", "ffprobe"},
			} {
				val := stringField(general, pf.key)
				if val == "" {
					results = append(results, warn(cfgsec, pf.label, "not configured"))
				} else {
					results = append(results, ok(cfgsec, pf.label, val))
				}
			}
			// Logging
			logLevel := stringField(general, "logLevel")
			logFile := stringField(general, "logFile")
			logMsg := "level=" + logLevel
			if logFile != "" {
				logMsg += "  file=" + logFile
			} else {
				logMsg += "  (no log file)"
			}
			results = append(results, ok(cfgsec, "logging", logMsg))
		}
	}

	return results
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func formatBytes(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

// nestedMap extracts a map[string]interface{} from a JSON data map.
func nestedMap(data map[string]interface{}, key string) (map[string]interface{}, bool) {
	v, ok := data[key]
	if !ok {
		return nil, false
	}
	m, ok := v.(map[string]interface{})
	return m, ok
}

func stringField(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func intField(m map[string]interface{}, key string) int {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case float64:
			return int(n)
		case int:
			return n
		}
	}
	return 0
}

func floatField(m map[string]interface{}, key string) float64 {
	if v, ok := m[key]; ok {
		if f, ok := v.(float64); ok {
			return f
		}
	}
	return 0
}

func boolField(m map[string]interface{}, key string) bool {
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}
