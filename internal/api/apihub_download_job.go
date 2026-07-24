package api

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/stashapp/stash/pkg/job"
	"github.com/stashapp/stash/pkg/logger"
)

// apihubDownloadItem is one scene to fetch. The plugin has already resolved the
// direct download URL client-side (Aylo signed MP4, or an EvilAngel relay URL),
// so the backend never needs the account tokens — it just fetches a URL and,
// when the CDN requires them, applies whatever per-request headers the plugin
// attached. Studio/Performer drive the on-disk folder layout; Metadata is
// carried for the Phase 2 scan-and-stamp step and unused while streaming.
type apihubDownloadItem struct {
	Provider  string            `json:"provider"`
	URL       string            `json:"url"`
	Filename  string            `json:"filename"`
	Studio    string            `json:"studio"`
	Performer string            `json:"performer"`
	Title     string            `json:"title"`
	Headers   map[string]string    `json:"headers,omitempty"`
	Metadata  *apihubSceneMetadata `json:"metadata,omitempty"`
}

// apihubSceneMetadata is the catalog metadata the plugin already holds for a
// scene, carried alongside the download so the backend can stamp it onto the
// scene the post-download scan creates. All fields are optional.
type apihubSceneMetadata struct {
	Title      string   `json:"title"`
	Date       string   `json:"date"` // YYYY-MM-DD
	Details    string   `json:"details"`
	URL        string   `json:"url"`
	Studio     string                `json:"studio"`
	Performers []apihubPerformerMeta `json:"performers"`
	Tags       []string              `json:"tags"`
	CoverURL   string                `json:"coverUrl"`
}

// apihubPerformerMeta is a catalog performer carried with a download. Gender is
// optional but, when present, lets the Identify pipeline honour the user's
// "don't add male performers" preference.
type apihubPerformerMeta struct {
	Name     string `json:"name"`
	Gender   string `json:"gender,omitempty"`
	ImageURL string `json:"imageUrl,omitempty"` // provider portrait (public CDN URL)
}

// apihubDownloadJob streams a batch of scenes into the library's download root,
// reporting progress to the JobManager so it surfaces in the Tasks JobTable.
type apihubDownloadJob struct {
	items  []apihubDownloadItem
	root   string
	client *http.Client
}

func (j *apihubDownloadJob) Execute(ctx context.Context, progress *job.Progress) error {
	total := len(j.items)
	if total == 0 {
		return nil
	}

	var failures []string

	for i, item := range j.items {
		if job.IsCancelled(ctx) {
			break
		}

		title := item.Title
		if title == "" {
			title = item.Filename
		}

		idx := i
		var dlErr error
		var savedPath string
		// One stable subtask line per scene keeps the JobTable log readable
		// (one row per file); the smooth % comes from SetPercent below.
		progress.ExecuteTask(fmt.Sprintf("Downloading %q (%d/%d)", title, idx+1, total), func() {
			dest, err := j.download(ctx, item, func(frac float64) {
				progress.SetPercent((float64(idx) + frac) / float64(total))
			})
			if err != nil {
				dlErr = err
				return
			}
			savedPath = dest
			logger.Infof("[apihub-download] saved %s", dest)
		})

		if dlErr != nil {
			if job.IsCancelled(ctx) {
				break
			}
			logger.Errorf("[apihub-download] %q failed: %v", title, dlErr)
			failures = append(failures, fmt.Sprintf("%s: %v", title, dlErr))
			continue
		}

		// Import the freshly-downloaded file into the library and stamp its
		// metadata. A failure here is non-fatal: the file is safely on disk, so
		// the user can still scan it manually — we log and carry on.
		if savedPath != "" && !job.IsCancelled(ctx) {
			progress.ExecuteTask(fmt.Sprintf("Importing %q into library", title), func() {
				if err := j.importAndStamp(ctx, savedPath, item); err != nil {
					logger.Errorf("[apihub-download] import %q failed: %v", title, err)
					failures = append(failures, fmt.Sprintf("%s (import): %v", title, err))
				}
			})
		}

		progress.SetPercent(float64(idx+1) / float64(total))
	}

	if job.IsCancelled(ctx) {
		return nil
	}
	if len(failures) > 0 {
		return fmt.Errorf("%d of %d download(s) failed: %s", len(failures), total, strings.Join(failures, "; "))
	}
	return nil
}

// download streams a single item straight into the download root as a flat
// file named "Studio - Date - Title.ext" (see buildDownloadFilename), writing
// to a .part file and renaming atomically on success so a cancelled or failed
// transfer never leaves a half-written file the scan would import.
func (j *apihubDownloadJob) download(ctx context.Context, item apihubDownloadItem, onProgress func(float64)) (string, error) {
	name := buildDownloadFilename(item)
	if name == "" {
		return "", fmt.Errorf("empty filename")
	}

	if err := os.MkdirAll(j.root, 0o755); err != nil {
		return "", fmt.Errorf("create folder: %w", err)
	}

	// Flat layout — everything lands directly in the download root. Guard
	// against clobbering an unrelated existing file by appending " (n)" when a
	// name already exists.
	dest := uniqueDest(j.root, name)
	part := dest + ".part"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, item.URL, nil)
	if err != nil {
		return "", err
	}
	for k, v := range item.Headers {
		req.Header.Set(k, v)
	}

	resp, err := j.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected status %s", resp.Status)
	}

	out, err := os.Create(part)
	if err != nil {
		return "", err
	}

	pr := &progressReader{r: resp.Body, total: resp.ContentLength, onProgress: onProgress}
	_, copyErr := io.Copy(out, pr)
	closeErr := out.Close()

	if copyErr != nil {
		os.Remove(part)
		return "", copyErr
	}
	if closeErr != nil {
		os.Remove(part)
		return "", closeErr
	}

	if err := os.Rename(part, dest); err != nil {
		os.Remove(part)
		return "", err
	}
	return dest, nil
}

// progressReader wraps the response body to report a 0..1 fraction as bytes
// arrive, throttled so it doesn't spam the job subscription on every chunk.
type progressReader struct {
	r          io.Reader
	total      int64
	read       int64
	onProgress func(float64)
	lastUpdate time.Time
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	if n > 0 {
		p.read += int64(n)
		if p.total > 0 && p.onProgress != nil {
			now := time.Now()
			if now.Sub(p.lastUpdate) >= 200*time.Millisecond {
				p.lastUpdate = now
				p.onProgress(float64(p.read) / float64(p.total))
			}
		}
	}
	return n, err
}

// sanitizePathComponent makes a single folder/file name safe on disk: strips
// path separators and characters illegal on Windows/macOS/Linux, and caps the
// length so a long title can't overflow the filesystem's per-name limit.
func sanitizePathComponent(s string) string {
	s = strings.TrimSpace(s)
	s = strings.NewReplacer(
		"/", "-", "\\", "-", ":", "-", "*", "-", "?", "",
		"\"", "'", "<", "-", ">", "-", "|", "-", "\n", " ", "\r", " ",
	).Replace(s)
	s = strings.Trim(s, ". ")
	if len(s) > 180 {
		s = strings.TrimSpace(s[:180])
	}
	return s
}

// buildDownloadFilename produces a flat filename of the form
// "Studio - Date - Title.ext" (e.g. "Brazzers - 2026-12-25 - Scene Title.mp4").
// Missing pieces are dropped along with their separator, so a scene with no
// date becomes "Studio - Title.ext". The extension is taken from the resolved
// download filename, and the whole thing is run through sanitizeFileName so it
// is safe to sit directly in the download directory.
func buildDownloadFilename(item apihubDownloadItem) string {
	ext := filepath.Ext(item.Filename)

	studio := strings.TrimSpace(item.Studio)
	title := strings.TrimSpace(item.Title)
	var date string
	if item.Metadata != nil {
		if studio == "" {
			studio = strings.TrimSpace(item.Metadata.Studio)
		}
		if title == "" {
			title = strings.TrimSpace(item.Metadata.Title)
		}
		date = strings.TrimSpace(item.Metadata.Date)
	}
	// Fall back to the resolved filename's base if we have no catalog title.
	if title == "" {
		title = strings.TrimSpace(strings.TrimSuffix(filepath.Base(item.Filename), ext))
	}

	var parts []string
	for _, p := range []string{studio, date, title} {
		if p != "" {
			parts = append(parts, p)
		}
	}

	return sanitizeFileName(strings.Join(parts, " - ") + ext)
}

// uniqueDest returns a path in dir for name that does not already exist,
// appending " (2)", " (3)", … before the extension on collision so a flat
// download never overwrites an unrelated file already on disk.
func uniqueDest(dir, name string) string {
	dest := filepath.Join(dir, name)
	if _, err := os.Stat(dest); os.IsNotExist(err) {
		return dest
	}
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for i := 2; i < 1000; i++ {
		candidate := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", base, i, ext))
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
	return dest
}

// sanitizeFileName cleans a filename while preserving its extension — the base
// name is sanitized and length-capped separately so a very long title can't
// truncate away the ".mp4" the scan relies on to recognise a video file.
func sanitizeFileName(filename string) string {
	ext := filepath.Ext(filename)
	base := sanitizePathComponent(strings.TrimSuffix(filename, ext))
	if base == "" {
		base = "download"
	}
	if len(base) > 170 {
		base = strings.TrimSpace(base[:170])
	}
	// Keep only safe characters in the extension (alphanumerics and the dot).
	ext = strings.Map(func(r rune) rune {
		switch {
		case r == '.', r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		default:
			return -1
		}
	}, ext)
	return base + ext
}
