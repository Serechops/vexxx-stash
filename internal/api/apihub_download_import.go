package api

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/stashapp/stash/internal/identify"
	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/fsutil"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/match"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/txn"
)

// importAndStamp scans a freshly-downloaded file into the library (creating the
// scene) and then runs it through Stash's real Identify pipeline using the
// catalog metadata the plugin carried alongside it. Rather than blindly
// creating studios/performers/tags by name, it hands the metadata to
// identify.SceneIdentifier so the user's configured Identify preferences are
// honoured — existing studios/performers/tags are matched (not duplicated),
// male performers are skipped when the user opted out of them, single-name
// performers are handled, tags merge, per-field IGNORE/MERGE/OVERWRITE
// strategies apply, and missing entities are only created when the user's
// field options allow it.
func (j *apihubDownloadJob) importAndStamp(ctx context.Context, path string, item apihubDownloadItem) error {
	mgr := manager.GetInstance()

	// A full library scan creates a Folder row for every directory as it walks
	// top-down; the single-file ScanFile does not, and the Studio/Performer
	// subfolders we just created on disk have no rows yet. Without them the scan
	// fails with `parent folder for %q doesn't exist`, so create the chain from
	// the containing library root down to the file's parent first.
	libRoot := config.GetInstance().GetStashPaths().GetStashFromDirPath(path)
	if libRoot == nil {
		return fmt.Errorf("downloaded file %q is not inside a configured library path", path)
	}
	if err := ensureFolderHierarchy(ctx, mgr.Repository, libRoot.Path, filepath.Dir(path)); err != nil {
		return fmt.Errorf("preparing library folders: %w", err)
	}

	// Synchronous single-file scan — creates the scene via the same handlers the
	// library scan uses, and returns the file (with its ID).
	res, err := mgr.ScanFile(ctx, manager.ScanFileInput{Path: path})
	if err != nil {
		return fmt.Errorf("scan: %w", err)
	}
	if res.Error != nil {
		return fmt.Errorf("scan: %s", *res.Error)
	}
	if res.File == nil || res.File.Base() == nil {
		return fmt.Errorf("scan produced no file")
	}
	fileID := res.File.Base().ID

	// Generate the perceptual hash before identifying. ScanFile computes the
	// standard fingerprints (oshash/md5) but not the phash — that normally only
	// happens in the scan's generate step when "Generate phashes" is enabled.
	// phash is fundamental to proper scene matching in Stash, so force it here
	// before identification runs (best-effort — a phash failure shouldn't block
	// the rest of the import).
	if vf, ok := res.File.(*models.VideoFile); ok {
		if err := mgr.GeneratePhashForFile(ctx, vf); err != nil {
			logger.Warnf("[apihub-download] phash generation failed for %q: %v", path, err)
		}
	}

	meta := item.Metadata
	if meta == nil {
		return nil // imported, nothing to identify against
	}

	repo := mgr.Repository

	// Find the scene the scan just created for this file.
	var scene *models.Scene
	if err := txn.WithReadTxn(ctx, repo.TxnManager, func(ctx context.Context) error {
		scenes, err := repo.Scene.FindByFileID(ctx, fileID)
		if err != nil {
			return err
		}
		if len(scenes) == 0 {
			return fmt.Errorf("no scene was created for the downloaded file")
		}
		scene = scenes[0]
		return nil
	}); err != nil {
		return err
	}

	return j.identifyDownloadedScene(ctx, repo, scene, item)
}

// identifyDownloadedScene applies the carried catalog metadata to the scene via
// the real identify.SceneIdentifier, so every user Identify preference is
// respected. The metadata is turned into a *models.ScrapedScene, its
// relationships are matched against the local DB (so existing studios/
// performers/tags link instead of duplicating), and the whole thing is fed
// through the identifier as an in-memory scraper source.
func (j *apihubDownloadJob) identifyDownloadedScene(ctx context.Context, repo models.Repository, scene *models.Scene, item apihubDownloadItem) error {
	meta := item.Metadata

	// Fetch the cover before the identify transaction so a slow network fetch
	// doesn't hold a DB transaction open. Best-effort — a failed cover fetch
	// shouldn't block the rest of the metadata. Passed to identify as a base64
	// data URL so it goes through the same cover-processing path a scraper uses
	// (and so we can send the CDN the auth headers the plugin attached).
	var coverDataURL string
	if meta.CoverURL != "" {
		if b, err := j.fetchBytes(ctx, meta.CoverURL, item.Headers); err == nil && len(b) > 0 {
			coverDataURL = "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(b)
		}
	}

	scraped := buildScrapedScene(meta, coverDataURL)

	// Match the scraped relationships against existing library entities so we
	// link rather than duplicate. No endpoint — this isn't a stash-box source,
	// so matching is purely by name/alias.
	matcher := match.SceneRelationships{
		PerformerFinder: repo.Performer,
		TagFinder:       repo.Tag,
		StudioFinder:    repo.Studio,
	}
	if err := txn.WithReadTxn(ctx, repo.TxnManager, func(ctx context.Context) error {
		return matcher.MatchRelationships(ctx, scraped, "")
	}); err != nil {
		return fmt.Errorf("matching catalog metadata to library: %w", err)
	}

	// Flesh out any studio/performers that aren't already in the library from the
	// user's stash-box, so Identify creates them with full metadata (and a linked
	// StashID) rather than name-only. The endpoint is applied to the source so the
	// merged RemoteSiteID becomes a StashID on the created entity. No-op ("") when
	// no stash-box is configured — the provider metadata alone is used, as before.
	endpoint := enrichUnmatchedEntities(ctx, scraped)

	identifier := identify.SceneIdentifier{
		TxnManager:         repo.TxnManager,
		SceneReaderUpdater: repo.Scene,
		StudioReaderWriter: repo.Studio,
		PerformerCreator:   repo.Performer,
		TagFinderCreator:   repo.Tag,

		DefaultOptions: effectiveIdentifyOptions(),
		Sources: []identify.ScraperSource{
			{
				Name:       "APIHub catalog",
				Scraper:    staticSceneScraper{scene: scraped},
				RemoteSite: endpoint,
			},
		},
		SceneUpdatePostHookExecutor: manager.GetInstance().PluginCache,
	}

	if err := identifier.Identify(ctx, scene); err != nil {
		return fmt.Errorf("identify: %w", err)
	}
	return nil
}

// staticSceneScraper is an identify.SceneScraper that always returns a single,
// already-built scraped scene. It lets us drive the identify pipeline with the
// catalog metadata we already hold instead of hitting a remote scraper.
type staticSceneScraper struct {
	scene *models.ScrapedScene
}

func (s staticSceneScraper) ScrapeScenes(ctx context.Context, sceneID int) ([]*models.ScrapedScene, error) {
	return []*models.ScrapedScene{s.scene}, nil
}

// buildScrapedScene converts the carried catalog metadata into the ScrapedScene
// shape the identify pipeline consumes. Performer gender is carried through so
// the "don't add male performers" preference can take effect.
func buildScrapedScene(meta *apihubSceneMetadata, coverDataURL string) *models.ScrapedScene {
	s := &models.ScrapedScene{}

	if v := strings.TrimSpace(meta.Title); v != "" {
		s.Title = &v
	}
	if v := strings.TrimSpace(meta.Details); v != "" {
		s.Details = &v
	}
	if v := strings.TrimSpace(meta.Date); v != "" {
		s.Date = &v
	}
	if v := strings.TrimSpace(meta.URL); v != "" {
		s.URLs = []string{v}
	}
	if coverDataURL != "" {
		s.Image = &coverDataURL
	}
	if v := strings.TrimSpace(meta.Studio); v != "" {
		s.Studio = &models.ScrapedStudio{Name: v}
	}

	for _, p := range meta.Performers {
		name := strings.TrimSpace(p.Name)
		if name == "" {
			continue
		}
		sp := &models.ScrapedPerformer{Name: &name}
		if g := strings.TrimSpace(p.Gender); g != "" {
			gu := strings.ToUpper(g)
			sp.Gender = &gu
		}
		// Provider portrait (public CDN URL). ProcessImageInput fetches URLs, so
		// the created performer picks it up; ScrapedPerformer.GetImage reads
		// Images[0]. This takes precedence over the stash-box fallback image,
		// which only fills in when Images is empty (see mergeScrapedPerformer).
		if img := strings.TrimSpace(p.ImageURL); img != "" {
			sp.Images = []string{img}
			sp.Image = &img
		}
		s.Performers = append(s.Performers, sp)
	}

	for _, raw := range meta.Tags {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		s.Tags = append(s.Tags, &models.ScrapedTag{Name: name})
	}

	return s
}

// effectiveIdentifyOptions returns the metadata options the identify run should
// use. It prefers the user's saved default Identify task options (so all their
// configured preferences — skip male performers, single-name handling, field
// strategies, create-missing — are honoured). When the user has never
// configured Identify defaults, it falls back to sensible options that still
// match and create missing studios/performers/tags, so downloads import
// usefully out of the box.
func effectiveIdentifyOptions() *identify.MetadataOptions {
	if saved := config.GetInstance().GetDefaultIdentifySettings(); saved != nil && saved.Options != nil {
		return saved.Options
	}

	createMissing := true
	return &identify.MetadataOptions{
		FieldOptions: []*identify.FieldOptions{
			{Field: "studio", Strategy: identify.FieldStrategyMerge, CreateMissing: &createMissing},
			{Field: "performers", Strategy: identify.FieldStrategyMerge, CreateMissing: &createMissing},
			{Field: "tags", Strategy: identify.FieldStrategyMerge, CreateMissing: &createMissing},
		},
	}
}

// fetchBytes downloads a small resource (the cover image) fully into memory.
func (j *apihubDownloadJob) fetchBytes(ctx context.Context, url string, headers map[string]string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := j.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %s", resp.Status)
	}
	// Cap the read so a bad URL can't balloon memory (covers are small).
	return io.ReadAll(io.LimitReader(resp.Body, 32<<20))
}

// ensureFolderHierarchy makes sure a Folder row exists for dir and every
// ancestor up to (and including) the library root, mirroring the rows a normal
// top-down library scan would create. ScanFile's onNewFile requires the file's
// parent folder row to already exist, so this must run before the scan.
func ensureFolderHierarchy(ctx context.Context, repo models.Repository, libraryRoot, dir string) error {
	libraryRoot = filepath.Clean(libraryRoot)
	return txn.WithTxn(ctx, repo.TxnManager, func(ctx context.Context) error {
		_, err := ensureFolder(ctx, repo.Folder, libraryRoot, filepath.Clean(dir))
		return err
	})
}

// ensureFolder returns the Folder row for path, creating it (and any missing
// ancestors) up to libraryRoot. Recursion stops at the library root, whose row
// has no parent — exactly like a top-level scanned folder. Paths are created
// and matched verbatim (OS-native separators, case-sensitive) so the rows line
// up with what the scan later looks up, avoiding duplicates.
func ensureFolder(ctx context.Context, store models.FolderReaderWriter, libraryRoot, path string) (*models.Folder, error) {
	existing, err := store.FindByPath(ctx, path, true)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}

	var parent *models.Folder
	if !strings.EqualFold(path, libraryRoot) {
		parentPath := filepath.Dir(path)
		// Guard against walking above the library root (or off the disk root) so
		// a mis-resolved path can never create folders all the way to C:\.
		if parentPath == path || !fsutil.IsPathInDir(libraryRoot, path) {
			return nil, fmt.Errorf("path %q is not inside the library root %q", path, libraryRoot)
		}
		parent, err = ensureFolder(ctx, store, libraryRoot, parentPath)
		if err != nil {
			return nil, err
		}
	}

	now := time.Now()
	f := &models.Folder{
		Path:      path,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if info, statErr := os.Stat(path); statErr == nil {
		f.ModTime = info.ModTime()
	} else {
		f.ModTime = now
	}
	if parent != nil {
		f.ParentFolderID = &parent.ID
	}
	if err := store.Create(ctx, f); err != nil {
		return nil, fmt.Errorf("creating folder %q: %w", path, err)
	}
	return f, nil
}
