package api

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
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
	"github.com/stashapp/stash/pkg/stashbox"
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
// Returns the scene the scan created, so a follow-up step (the gallery import)
// can attach to it. The scene is returned even when there was no metadata to
// identify against.
func (j *apihubDownloadJob) importAndStamp(ctx context.Context, path string, item apihubDownloadItem) (*models.Scene, error) {
	mgr := manager.GetInstance()

	// A full library scan creates a Folder row for every directory as it walks
	// top-down; the single-file ScanFile does not, and the Studio/Performer
	// subfolders we just created on disk have no rows yet. Without them the scan
	// fails with `parent folder for %q doesn't exist`, so create the chain from
	// the containing library root down to the file's parent first.
	libRoot := config.GetInstance().GetStashPaths().GetStashFromDirPath(path)
	if libRoot == nil {
		return nil, fmt.Errorf("downloaded file %q is not inside a configured library path", path)
	}
	if err := ensureFolderHierarchy(ctx, mgr.Repository, libRoot.Path, filepath.Dir(path)); err != nil {
		return nil, fmt.Errorf("preparing library folders: %w", err)
	}

	// Synchronous single-file scan — creates the scene via the same handlers the
	// library scan uses, and returns the file (with its ID).
	//
	// SkipGenerate is set because this same path may also be sitting inside a
	// watched library folder: the library watcher's own fsnotify-triggered scan
	// wires the identical scan handlers, and its post-scan generator step runs
	// a scan-time auto-identify (against only the user's saved default Identify
	// sources) as soon as the scene row exists. Without SkipGenerate that step
	// runs synchronously as part of this ScanFile call, ahead of the fuller
	// URL+phash+catalog identify below — and because Identify's default MERGE
	// field strategy leaves a field alone once it has any value, a partial
	// match from that first pass can silently block this function's own,
	// better identify from filling in the rest (studio code, URL, etc.).
	logger.Infof("[apihub-download] scanning %q into library", path)
	res, err := mgr.ScanFile(ctx, manager.ScanFileInput{Path: path, SkipGenerate: true})
	if err != nil {
		return nil, fmt.Errorf("scan: %w", err)
	}
	if res.Error != nil {
		return nil, fmt.Errorf("scan: %s", *res.Error)
	}
	if res.File == nil || res.File.Base() == nil {
		return nil, fmt.Errorf("scan produced no file")
	}
	fileID := res.File.Base().ID
	logger.Infof("[apihub-download] scan status=%s fileID=%d for %q", res.Status, fileID, path)

	// Generate the perceptual hash before identifying. ScanFile computes the
	// standard fingerprints (oshash/md5) but not the phash — that normally only
	// happens in the scan's generate step when "Generate phashes" is enabled.
	// phash is the fallback identify source (see identifyDownloadedScene), so
	// force it here before identification runs (best-effort — a phash failure
	// shouldn't block the rest of the import).
	if vf, ok := res.File.(*models.VideoFile); ok {
		if err := mgr.GeneratePhashForFile(ctx, vf); err != nil {
			logger.Warnf("[apihub-download] phash generation failed for %q: %v", path, err)
		} else {
			logger.Debugf("[apihub-download] phash generated for %q", path)
		}
	}

	repo := mgr.Repository

	// Find the scene the scan just created for this file. Done before the
	// metadata check so the scene is returned (and a gallery can still be
	// attached to it) even when there's nothing to identify against.
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
		return nil, err
	}

	if item.Metadata == nil {
		logger.Infof("[apihub-download] no catalog metadata carried for scene %d (%q); skipping identify", scene.ID, path)
		return scene, nil // imported, nothing to identify against
	}

	// The scene row was cached by the read above, before the phash generated
	// a few lines up was written to its file. Scene.Find serves straight from
	// that cache (see SceneStore.Find), and LoadFiles on an already-loaded
	// scene doesn't re-hit the DB, so a stash-box source's fingerprint lookup
	// (identify.go -> stashboxSource.ScrapeScenes -> GetScenesFingerprints ->
	// Scene.Find) would see the file without its phash and never match —
	// exactly the staleness the watcher's own auto-identify already guards
	// against (see watcherSceneGenerator.autoIdentify). Invalidate so the
	// identify below reads the phash that's actually on disk in the DB now.
	if mgr.Database.Caches != nil {
		mgr.Database.Caches.InvalidateScene(scene.ID)
	}

	logger.Infof("[apihub-download] identifying scene %d (%q)", scene.ID, path)
	if err := j.identifyDownloadedScene(ctx, repo, scene, item); err != nil {
		return scene, err
	}
	logger.Infof("[apihub-download] identify finished for scene %d (%q)", scene.ID, path)

	// vr_mode is never something identify.SceneIdentifier can fill in — no
	// stash-box or scraper source carries it, and (unlike title/studio/tags)
	// the provider catalogs don't reliably expose it either: at best Aylo/
	// EvilAngel/AdultTime flag a release as VR with a plain yes/no, never the
	// actual projection layout, and TeamSkeet has no VR data at all. So this
	// is only ever what the user explicitly chose in the download cart —
	// stamped verbatim, never guessed.
	if item.Metadata.VRMode != "" {
		vrMode := models.VRMode(item.Metadata.VRMode)
		if !vrMode.IsValid() {
			logger.Warnf("[apihub-download] ignoring unrecognised vrMode %q for scene %d", item.Metadata.VRMode, scene.ID)
		} else if err := txn.WithTxn(ctx, repo.TxnManager, func(ctx context.Context) error {
			_, err := repo.Scene.UpdatePartial(ctx, scene.ID, models.ScenePartial{
				VRMode: models.NewOptionalString(string(vrMode)),
			})
			return err
		}); err != nil {
			logger.Warnf("[apihub-download] setting vr_mode for scene %d: %v", scene.ID, err)
		} else {
			logger.Infof("[apihub-download] scene %d vr_mode set to %s", scene.ID, vrMode)
		}
	}

	// identify.SceneIdentifier.Identify writes the studio/performers/tags it
	// resolved straight to the DB via scene.UpdateSet.Update, but discards the
	// updated row that call returns — our `scene` pointer still reflects the
	// blank, just-scanned state from before identify ran. A caller reading
	// scene.StudioID (the gallery import mirrors it onto the gallery) would
	// otherwise always see nil. Re-fetch so it reflects what was actually
	// applied.
	refreshed, err := reloadScene(ctx, repo, scene.ID)
	if err != nil {
		// The scene itself imported and was identified fine — a failure here
		// just means the gallery (if any) won't get the studio/performers/tags
		// mirrored onto it, not that the whole download failed.
		logger.Warnf("[apihub-download] reloading identified scene %d: %v", scene.ID, err)
		return scene, nil
	}
	return refreshed, nil
}

// importMarkers creates a Stash scene marker for each native provider marker
// carried with this download (Adult Time's action_tags, some Aylo releases'
// timeTags — see cart.ts's CartItem.markers on the frontend). A provider only
// ever gives us a label and a timestamp, never a category, so each marker's
// label becomes its own primary tag (matched case-insensitively by name, or
// created — mirroring how identify creates missing tags). Markers already
// present at the same timestamp are left alone, so re-running this (a
// relink, or a re-download of the same scene) never duplicates them.
func (j *apihubDownloadJob) importMarkers(ctx context.Context, repo models.Repository, scene *models.Scene, item apihubDownloadItem) error {
	if item.Metadata == nil || len(item.Metadata.Markers) == 0 {
		return nil
	}

	var errs []string
	for _, m := range item.Metadata.Markers {
		title := strings.TrimSpace(m.Title)
		if title == "" || m.Seconds < 0 {
			continue
		}

		if err := txn.WithTxn(ctx, repo.TxnManager, func(ctx context.Context) error {
			existing, err := repo.SceneMarker.FindBySceneID(ctx, scene.ID)
			if err != nil {
				return fmt.Errorf("checking existing markers: %w", err)
			}
			for _, e := range existing {
				if e.Seconds == m.Seconds {
					return nil // already imported
				}
			}

			tag, err := findOrCreateTag(ctx, repo.Tag, title)
			if err != nil {
				return fmt.Errorf("resolving tag %q: %w", title, err)
			}

			newMarker := models.NewSceneMarker()
			newMarker.Seconds = m.Seconds
			newMarker.PrimaryTagID = &tag.ID
			newMarker.SceneID = scene.ID

			if err := repo.SceneMarker.Create(ctx, &newMarker); err != nil {
				return fmt.Errorf("creating marker %q at %.0fs: %w", title, m.Seconds, err)
			}
			return nil
		}); err != nil {
			errs = append(errs, err.Error())
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("%d of %d marker(s) failed: %s", len(errs), len(item.Metadata.Markers), strings.Join(errs, "; "))
	}
	return nil
}

// findOrCreateTag resolves a tag by name (case-insensitively), creating it if
// no tag with that name exists yet.
func findOrCreateTag(ctx context.Context, tagWriter models.TagFinderCreator, name string) (*models.Tag, error) {
	existing, err := tagWriter.FindByNames(ctx, []string{name}, true)
	if err != nil {
		return nil, err
	}
	if len(existing) > 0 {
		return existing[0], nil
	}

	newTag := models.NewTag()
	newTag.Name = name
	if err := tagWriter.Create(ctx, &newTag); err != nil {
		return nil, err
	}
	return &newTag, nil
}

// reloadScene re-fetches a scene by ID along with the relationship IDs the
// gallery import mirrors onto its gallery (performers/tags; StudioID and
// OSHash come back as part of the base row already), plus the StashIDs that
// the download manifest (apihub_download_metadata.go) stamps onto the item's
// apihub.json sidecar.
func reloadScene(ctx context.Context, repo models.Repository, id int) (*models.Scene, error) {
	var scene *models.Scene
	if err := txn.WithReadTxn(ctx, repo.TxnManager, func(ctx context.Context) error {
		s, err := repo.Scene.Find(ctx, id)
		if err != nil {
			return err
		}
		if s == nil {
			return fmt.Errorf("scene %d no longer exists", id)
		}
		if err := s.LoadPerformerIDs(ctx, repo.Scene); err != nil {
			return err
		}
		if err := s.LoadTagIDs(ctx, repo.Scene); err != nil {
			return err
		}
		if err := s.LoadStashIDs(ctx, repo.Scene); err != nil {
			return err
		}
		scene = s
		return nil
	}); err != nil {
		return nil, err
	}
	return scene, nil
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

	// Source order matters — SceneIdentifier stops at the first source that
	// returns a match:
	//
	//  1. stash-box by URL. The provider told us the canonical scene page this
	//     file came from, so asking stash-box "which scene has this URL?" is an
	//     identity lookup, not a guess. When it hits, it's right.
	//  2. stash-box by fingerprint (phash). Only reached when no stash-box knows
	//     the URL. phash matching is similarity-based and can return a false
	//     positive, so it deliberately runs second.
	//  3. the provider's own catalog metadata, for scenes stash-box has never
	//     seen at all.
	var sources []identify.ScraperSource
	sources = append(sources, urlIdentifySources(meta.URL)...)
	sources = append(sources, resolveIdentifySources()...)
	sources = append(sources, identify.ScraperSource{
		Name:       "APIHub catalog",
		Scraper:    staticSceneScraper{scene: scraped},
		RemoteSite: endpoint,
	})

	sourceNames := make([]string, len(sources))
	for i, s := range sources {
		sourceNames[i] = s.Name
	}
	logger.Infof("[apihub-download] scene %d: trying identify sources in order: %v", scene.ID, sourceNames)

	identifier := identify.SceneIdentifier{
		TxnManager:         repo.TxnManager,
		SceneReaderUpdater: repo.Scene,
		StudioReaderWriter: repo.Studio,
		PerformerCreator:   repo.Performer,
		TagFinderCreator:   repo.Tag,

		DefaultOptions:              effectiveIdentifyOptions(),
		Sources:                     sources,
		SceneUpdatePostHookExecutor: manager.GetInstance().PluginCache,
	}

	if err := identifier.Identify(ctx, scene); err != nil {
		return fmt.Errorf("identify: %w", err)
	}
	return nil
}

// urlIdentifySources returns one identify source per configured stash-box that
// looks the scene up by its provider URL. Returns nil when the plugin carried
// no URL (nothing to match on) or no stash-box is configured.
func urlIdentifySources(sceneURL string) []identify.ScraperSource {
	sceneURL = strings.TrimSpace(sceneURL)
	if sceneURL == "" {
		return nil
	}

	boxes := config.GetInstance().GetStashBoxes()
	if len(boxes) == 0 {
		return nil
	}

	excludeTags := manager.GetInstance().Config.GetScraperExcludeTagPatterns()
	ret := make([]identify.ScraperSource, 0, len(boxes))
	for _, sb := range boxes {
		ret = append(ret, identify.ScraperSource{
			Name: "stash-box by URL: " + sb.Endpoint,
			Scraper: urlSceneScraper{
				client: stashbox.NewClient(*sb, stashbox.ExcludeTagPatterns(excludeTags)),
				url:    sceneURL,
			},
			RemoteSite: sb.Endpoint,
		})
	}
	return ret
}

// urlSceneScraper is an identify.SceneScraper that resolves a scene by looking
// its provider URL up on a stash-box, instead of by fingerprint.
type urlSceneScraper struct {
	client *stashbox.Client
	url    string
}

func (s urlSceneScraper) ScrapeScenes(ctx context.Context, sceneID int) ([]*models.ScrapedScene, error) {
	for _, q := range urlLookupCandidates(s.url) {
		scenes, err := s.client.FindSceneByURL(ctx, q)
		if err != nil {
			// Don't fail the whole identify run over one unreachable box — log and
			// let the next source (phash, then catalog) have a go.
			logger.Warnf("[apihub-download] stash-box URL lookup for %q failed: %v", q, err)
			return nil, nil
		}

		// stash-box's url filter is a substring ("like") match, so a short or
		// query-string-bearing URL can pull back more than one scene. Multiple hits
		// means we can't be certain which is right — exactly the ambiguity this
		// source exists to avoid, so bail and let a later source decide.
		if len(scenes) > 1 {
			logger.Infof("[apihub-download] stash-box URL lookup for %q returned %d scenes; too ambiguous to use", q, len(scenes))
			return nil, nil
		}
		if len(scenes) == 1 {
			return scenes, nil
		}
	}
	return nil, nil
}

// urlLookupCandidates turns a provider scene URL into the strings worth asking
// stash-box about, most-specific first.
//
// The catalogs hand us member-area URLs (members.adulttime.com/…), but stash-box
// records the public page (www.adulttime.com/…), so matching on the full URL
// alone would miss every time. Since stash-box's url filter is a substring
// match, dropping the scheme+host and querying just the path finds the scene
// whichever host it was submitted under. The path still carries the site, the
// title slug and the numeric clip id, so it's specific enough that a false hit
// is implausible — and the caller's >1 guard catches it if one ever happens.
func urlLookupCandidates(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	candidates := []string{raw}

	if u, err := url.Parse(raw); err == nil {
		// Path only — no query string, which is per-session junk on these sites
		// and would stop a substring match dead.
		if p := strings.TrimSuffix(u.Path, "/"); len(p) > 1 && p != raw {
			candidates = append(candidates, p)
		}
	}
	return candidates
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
	if v := strings.TrimSpace(meta.Code); v != "" {
		s.Code = &v
	}
	if v := strings.TrimSpace(meta.Date); v != "" {
		s.Date = &v
	}
	if v := strings.TrimSpace(meta.URL); v != "" {
		s.URLs = []string{v}
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

// resolveIdentifySources returns the fingerprint-based identify sources to try
// after the URL lookup and before the APIHub catalog fallback. Prefers the
// user's saved default Identify sources (respecting their configured order and
// per-source options); when none are saved, falls back to every configured
// stash-box in order.
func resolveIdentifySources() []identify.ScraperSource {
	if saved := config.GetInstance().GetDefaultIdentifySettings(); saved != nil && len(saved.Sources) > 0 {
		sources, err := manager.BuildIdentifySources(saved.Sources)
		if err != nil {
			logger.Warnf("[apihub-download] resolving configured identify sources: %v", err)
		} else {
			logger.Debugf("[apihub-download] using %d saved default identify source(s)", len(sources))
			return sources
		}
	}
	sources := manager.AllConfiguredStashBoxSources()
	if len(sources) == 0 {
		logger.Debugf("[apihub-download] no default identify sources or stash-boxes configured; falling back to catalog metadata only")
	} else {
		logger.Debugf("[apihub-download] no saved default identify sources; falling back to %d configured stash-box(es)", len(sources))
	}
	return sources
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
	_, err := ensureFolderRow(ctx, repo, libraryRoot, dir)
	return err
}

// ensureFolderRow is ensureFolderHierarchy, additionally returning dir's own
// Folder row — the gallery import needs its ID to find the folder-based gallery
// the image scan creates against it.
func ensureFolderRow(ctx context.Context, repo models.Repository, libraryRoot, dir string) (*models.Folder, error) {
	libraryRoot = filepath.Clean(libraryRoot)
	var out *models.Folder
	err := txn.WithTxn(ctx, repo.TxnManager, func(ctx context.Context) error {
		f, err := ensureFolder(ctx, repo.Folder, libraryRoot, filepath.Clean(dir))
		if err != nil {
			return err
		}
		out = f
		return nil
	})
	return out, err
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
