package api

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/pkg/job"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
)

// apihubDownloadItem is one scene to fetch. The plugin has already resolved the
// direct download URL client-side (Aylo signed MP4, or an EvilAngel relay URL),
// so the backend never needs the account tokens — it just fetches a URL and,
// when the CDN requires them, applies whatever per-request headers the plugin
// attached. Studio/Performer feed the on-disk filename (see
// buildDownloadFilename); Metadata is carried for the Phase 2 scan-and-stamp
// step and unused while streaming.
type apihubDownloadItem struct {
	Provider  string            `json:"provider"`
	URL       string            `json:"url"`
	Filename  string            `json:"filename"`
	Studio    string            `json:"studio"`
	Performer string            `json:"performer"`
	Title     string            `json:"title"`
	// Quality is the human-readable rendition label the user picked in the
	// cart (e.g. "1080p"), carried along purely for display in the download
	// history — it plays no part in the download itself.
	Quality   string               `json:"quality,omitempty"`
	Headers   map[string]string    `json:"headers,omitempty"`
	Metadata  *apihubSceneMetadata `json:"metadata,omitempty"`
	// Gallery, when present, is the accompanying photo set to download and
	// attach to the imported scene. Nil when the user didn't opt in, or the
	// provider has no gallery for this scene.
	Gallery *apihubGalleryMeta `json:"gallery,omitempty"`
}

// apihubSceneMetadata is the catalog metadata the plugin already holds for a
// scene, carried alongside the download so the backend can stamp it onto the
// scene the post-download scan creates. All fields are optional.
type apihubSceneMetadata struct {
	Title   string `json:"title"`
	Date    string `json:"date"` // YYYY-MM-DD
	Details string `json:"details"`
	// URL is the scene's canonical page on the provider's own site. Beyond
	// being stamped onto the scene, it's what the first identify source looks
	// the scene up by on stash-box — an identity match, unlike a phash.
	URL string `json:"url"`
	// Code is the scene's ID on the source site, stamped as Stash's studio
	// code (the studio's own identifier for the scene). Only used when no
	// stash-box source supplied one.
	Code       string                `json:"code"`
	Studio     string                `json:"studio"`
	Performers []apihubPerformerMeta `json:"performers"`
	Tags       []string              `json:"tags"`
	CoverURL   string                `json:"coverUrl"`
	// VRMode is a models.VRMode value ("LR180" | "TB360" | "MONO360" |
	// "FISHEYE190") the user explicitly picked in the download cart, or empty
	// for a flat scene. The provider catalogs never expose the real projection
	// layout (at best a yes/no VR hint), so this is never auto-detected — see
	// importAndStamp for where it gets stamped onto scene.vr_mode as-is.
	VRMode string `json:"vrMode,omitempty"`
	// Markers are position/action timestamps the provider's own catalog
	// carried for this scene (Adult Time's action_tags, some Aylo releases'
	// timeTags) — not something Stash or this plugin infers. Empty when the
	// provider gave none. See importMarkers.
	Markers []apihubMarkerMeta `json:"markers,omitempty"`
}

// apihubMarkerMeta is one native provider marker: a label and its timestamp
// in seconds from the start of the scene.
type apihubMarkerMeta struct {
	Title   string  `json:"title"`
	Seconds float64 `json:"seconds"`
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
	items   []apihubDownloadItem
	root    string
	client  *http.Client
	history *apihubHistoryStore
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
			j.recordHistory(item, apihubHistoryFailed, dlErr.Error(), "")
			continue
		}

		// itemErrs collects failures scoped to this item (import/gallery) so the
		// history entry below can distinguish "downloaded but not fully wired
		// up" from a clean success, independent of the job-wide failures slice.
		var itemErrs []string

		// Import the freshly-downloaded file into the library and stamp its
		// metadata. A failure here is non-fatal: the file is safely on disk, so
		// the user can still scan it manually — we log and carry on.
		var scene *models.Scene
		if savedPath != "" && !job.IsCancelled(ctx) {
			progress.ExecuteTask(fmt.Sprintf("Importing %q into library", title), func() {
				s, err := j.importAndStamp(ctx, savedPath, item)
				scene = s
				if err != nil {
					logger.Errorf("[apihub-download] import %q failed: %v", title, err)
					msg := fmt.Sprintf("%s (import): %v", title, err)
					failures = append(failures, msg)
					itemErrs = append(itemErrs, msg)
				}
			})
		}

		// Photo gallery, when the user opted in and the provider has one. Also
		// non-fatal — the scene itself is already imported, so a gallery failure
		// shouldn't mark the whole scene as failed.
		gallerySucceeded := false
		if scene != nil && item.Gallery != nil && !job.IsCancelled(ctx) {
			progress.ExecuteTask(fmt.Sprintf("Downloading gallery for %q", title), func() {
				if err := j.importGallery(ctx, savedPath, scene, item); err != nil {
					logger.Errorf("[apihub-download] gallery for %q failed: %v", title, err)
					msg := fmt.Sprintf("%s (gallery): %v", title, err)
					failures = append(failures, msg)
					itemErrs = append(itemErrs, msg)
				} else {
					gallerySucceeded = true
				}
			})
		}

		// Native provider markers (position/action timestamps), when the
		// catalog carried any for this scene. Also non-fatal, for the same
		// reason as the gallery step above.
		if scene != nil && !job.IsCancelled(ctx) {
			progress.ExecuteTask(fmt.Sprintf("Adding markers for %q", title), func() {
				if err := j.importMarkers(ctx, manager.GetInstance().Repository, scene, item); err != nil {
					logger.Errorf("[apihub-download] markers for %q failed: %v", title, err)
					msg := fmt.Sprintf("%s (markers): %v", title, err)
					failures = append(failures, msg)
					itemErrs = append(itemErrs, msg)
				}
			})
		}

		// Portable identifier sidecar — see apihub_download_metadata.go. Written
		// whenever the scene imported, even if the gallery step failed or wasn't
		// requested, so the relink task can still restore this scene's StashIDs.
		if scene != nil {
			j.writeManifest(filepath.Dir(savedPath), scene, item, gallerySucceeded)
		}

		var sceneID string
		if scene != nil {
			sceneID = strconv.Itoa(scene.ID)
		}
		if len(itemErrs) > 0 {
			j.recordHistory(item, apihubHistoryPartial, strings.Join(itemErrs, "; "), sceneID)
		} else {
			j.recordHistory(item, apihubHistorySuccess, "", sceneID)
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

// recordHistory best-effort records the outcome of one item to the history
// sidecar. A write failure here must never affect the download itself, so
// it's only logged.
func (j *apihubDownloadJob) recordHistory(item apihubDownloadItem, status apihubHistoryStatus, errMsg, sceneID string) {
	if j.history == nil {
		return
	}
	title := item.Title
	studio := item.Studio
	var vrMode, sourceURL, coverURL string
	if item.Metadata != nil {
		if title == "" {
			title = item.Metadata.Title
		}
		if studio == "" {
			studio = item.Metadata.Studio
		}
		vrMode = item.Metadata.VRMode
		sourceURL = item.Metadata.URL
		coverURL = item.Metadata.CoverURL
	}
	if title == "" {
		title = item.Filename
	}
	if err := j.history.record(apihubHistoryEntry{
		Title:     title,
		Studio:    studio,
		Performer: item.Performer,
		Provider:  item.Provider,
		CoverURL:  coverURL,
		SourceURL: sourceURL,
		Quality:   item.Quality,
		VRMode:    vrMode,
		Status:    status,
		Error:     errMsg,
		SceneID:   sceneID,
	}); err != nil {
		logger.Errorf("[apihub-download] recording history for %q failed: %v", title, err)
	}
}

// download streams a single item into its own subdirectory of the download
// root, named "Studio - Date - Title" (see buildDownloadFilename) with the
// video itself as "<same name>.ext" inside it — e.g.
//
//	APIHub Downloads/
//	  Brazzers - 2026-07-24 - Title/
//	    Brazzers - 2026-07-24 - Title.mp4
//	    Brazzers - 2026-07-24 - Title.zip   (gallery, if downloaded)
//	    apihub.json                          (portable link/identifier, see
//	                                           apihub_download_metadata.go)
//
// Grouping each pairing into its own folder keeps the download root
// organized, and — as importantly — gives the relink task a stable scope to
// match within that survives either file being renamed later: it looks at
// what's actually in the folder rather than at filenames recorded elsewhere.
// Writes to a .part file and renames atomically on success so a cancelled or
// failed transfer never leaves a half-written file the scan would import.
func (j *apihubDownloadJob) download(ctx context.Context, item apihubDownloadItem, onProgress func(float64)) (string, error) {
	name := buildDownloadFilename(item)
	if name == "" {
		return "", fmt.Errorf("empty filename")
	}

	if err := os.MkdirAll(j.root, 0o755); err != nil {
		return "", fmt.Errorf("create folder: %w", err)
	}

	// One subdirectory per item, named after its own filename (sans
	// extension). Guard against colliding with an existing folder (e.g. a
	// re-download of the same scene) by appending " (n)".
	itemDir := uniqueDir(j.root, strings.TrimSuffix(name, filepath.Ext(name)))
	if err := os.MkdirAll(itemDir, 0o755); err != nil {
		return "", fmt.Errorf("create item folder: %w", err)
	}

	dest := filepath.Join(itemDir, name)
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

// uniqueDir returns a not-yet-existing subdirectory of dir named name,
// appending " (2)", " (3)", … on collision — the directory equivalent of
// uniqueDest, used to give each downloaded item its own folder.
func uniqueDir(dir, name string) string {
	candidate := filepath.Join(dir, name)
	if _, err := os.Stat(candidate); os.IsNotExist(err) {
		return candidate
	}
	for i := 2; i < 1000; i++ {
		c := filepath.Join(dir, fmt.Sprintf("%s (%d)", name, i))
		if _, err := os.Stat(c); os.IsNotExist(err) {
			return c
		}
	}
	return candidate
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
