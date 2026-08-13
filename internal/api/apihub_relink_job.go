package api

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/job"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/txn"
)

// apihubRelinkJob restores what a moved library or a fresh Stash install
// can't otherwise recover on its own. It walks every configured library path
// for apihub.json manifests (see apihub_download_metadata.go) written by past
// APIHub downloads, and for each one whose scene/gallery have already been
// (re)created by a normal library scan, stamps the scene's StashIDs and
// source URL back on and re-links its gallery — all without hitting the
// network.
//
// It never creates scenes or galleries itself — run a library Scan first if
// the files haven't been imported yet. Matching is scoped to "whatever
// scene/gallery file sits in the same folder as the manifest" rather than to
// any filename recorded in it, so it's unaffected by renames that happened
// after the download, including this fork's own Rename Scenes feature (which
// only touches the video file, not a sibling gallery zip).
type apihubRelinkJob struct{}

type apihubRelinkStats struct {
	manifests       int
	scenesPatched   int
	galleriesLinked int
	unmatched       int
}

func (j *apihubRelinkJob) Execute(ctx context.Context, progress *job.Progress) error {
	roots := config.GetInstance().GetStashPaths()
	if len(roots) == 0 {
		return fmt.Errorf("no library paths configured")
	}

	var manifestPaths []string
	for _, root := range roots {
		_ = filepath.WalkDir(root.Path, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				// Skip unreadable entries rather than aborting the whole walk over
				// one bad folder (permissions, a dangling symlink, etc.).
				return nil
			}
			if !d.IsDir() && d.Name() == apihubManifestFile {
				manifestPaths = append(manifestPaths, path)
			}
			return nil
		})
	}

	progress.SetTotal(len(manifestPaths))

	stats := apihubRelinkStats{manifests: len(manifestPaths)}
	repo := manager.GetInstance().Repository
	videoExts := config.GetInstance().GetVideoExtensions()
	galleryExts := config.GetInstance().GetGalleryExtensions()

	for _, manifestPath := range manifestPaths {
		if job.IsCancelled(ctx) {
			break
		}

		dir := filepath.Dir(manifestPath)
		progress.ExecuteTask(fmt.Sprintf("Relinking %s", dir), func() {
			matched, err := j.relinkOne(ctx, repo, manifestPath, dir, videoExts, galleryExts, &stats)
			if err != nil {
				logger.Warnf("[apihub-relink] %s: %v", dir, err)
			}
			if !matched {
				stats.unmatched++
			}
		})
		progress.Increment()
	}

	logger.Infof(
		"[apihub-relink] finished: %d manifest(s) found, %d scene(s) patched, %d gallery link(s) restored, %d without a matching scene yet (run a library Scan first if you haven't already)",
		stats.manifests, stats.scenesPatched, stats.galleriesLinked, stats.unmatched,
	)
	return nil
}

// relinkOne processes a single apihub.json: finds whichever video/gallery
// file currently sit in its folder, resolves the scene/gallery DB rows the
// scan already created for them (if any), and patches them from the
// manifest. Returns whether a scene was found at all.
func (j *apihubRelinkJob) relinkOne(ctx context.Context, repo models.Repository, manifestPath, dir string, videoExts, galleryExts []string, stats *apihubRelinkStats) (bool, error) {
	m, err := readApihubManifest(manifestPath)
	if err != nil {
		return false, fmt.Errorf("reading manifest: %w", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return false, fmt.Errorf("reading folder: %w", err)
	}

	var videoPath, zipPath string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(e.Name()), "."))
		switch {
		case videoPath == "" && slices.Contains(videoExts, ext):
			videoPath = filepath.Join(dir, e.Name())
		case zipPath == "" && slices.Contains(galleryExts, ext):
			zipPath = filepath.Join(dir, e.Name())
		}
	}

	var scene *models.Scene
	if videoPath != "" {
		if err := txn.WithReadTxn(ctx, repo.TxnManager, func(ctx context.Context) error {
			scenes, err := repo.Scene.FindByPath(ctx, videoPath)
			if err != nil {
				return err
			}
			if len(scenes) > 0 {
				scene = scenes[0]
			}
			return nil
		}); err != nil {
			return false, fmt.Errorf("finding scene: %w", err)
		}
	}

	if scene == nil {
		return false, nil
	}

	if err := j.patchScene(ctx, repo, scene, m); err != nil {
		return true, fmt.Errorf("patching scene %d: %w", scene.ID, err)
	}
	stats.scenesPatched++

	if zipPath != "" && m.Gallery != nil {
		linked, err := j.linkGallery(ctx, repo, scene, zipPath)
		if err != nil {
			return true, fmt.Errorf("linking gallery: %w", err)
		}
		if linked {
			stats.galleriesLinked++
		}
	}

	return true, nil
}

// patchScene merges the manifest's StashIDs and source URL onto scene,
// leaving any existing values in place. Only issues a write when there's
// something new to add, so re-running the relink task is cheap.
func (j *apihubRelinkJob) patchScene(ctx context.Context, repo models.Repository, scene *models.Scene, m *apihubManifest) error {
	if len(m.Scene.StashIDs) == 0 && m.SourceURL == "" {
		return nil
	}

	return txn.WithTxn(ctx, repo.TxnManager, func(ctx context.Context) error {
		partial := models.NewScenePartial()

		if len(m.Scene.StashIDs) > 0 {
			existing, err := repo.Scene.GetStashIDs(ctx, scene.ID)
			if err != nil {
				return err
			}
			merged := &models.UpdateStashIDs{Mode: models.RelationshipUpdateModeSet}
			for _, sid := range existing {
				merged.AddUnique(sid)
			}
			for _, sid := range m.Scene.StashIDs {
				merged.AddUnique(models.StashID{Endpoint: sid.Endpoint, StashID: sid.StashID, UpdatedAt: time.Now()})
			}
			if len(merged.StashIDs) > len(existing) {
				partial.StashIDs = merged
			}
		}

		if m.SourceURL != "" {
			existingURLs, err := repo.Scene.GetURLs(ctx, scene.ID)
			if err != nil {
				return err
			}
			if !slices.Contains(existingURLs, m.SourceURL) {
				partial.URLs = &models.UpdateStrings{Values: []string{m.SourceURL}, Mode: models.RelationshipUpdateModeAdd}
			}
		}

		if partial.StashIDs == nil && partial.URLs == nil {
			return nil
		}

		_, err := repo.Scene.UpdatePartial(ctx, scene.ID, partial)
		return err
	})
}

// linkGallery finds the gallery row for the zip file at zipPath (created by a
// prior scan of it) and attaches it to scene, mirroring linkGalleryToScene's
// SceneIDs update but idempotent — safe to run against an already-linked
// gallery. Returns false (not an error) when the zip hasn't been scanned yet.
func (j *apihubRelinkJob) linkGallery(ctx context.Context, repo models.Repository, scene *models.Scene, zipPath string) (bool, error) {
	linked := false
	err := txn.WithTxn(ctx, repo.TxnManager, func(ctx context.Context) error {
		f, err := repo.File.FindByPath(ctx, zipPath, true)
		if err != nil {
			return err
		}
		if f == nil || f.Base() == nil {
			return nil
		}

		galleries, err := repo.Gallery.FindByFileID(ctx, f.Base().ID)
		if err != nil {
			return err
		}
		if len(galleries) == 0 {
			return nil
		}

		partial := models.NewGalleryPartial()
		partial.SceneIDs = &models.UpdateIDs{IDs: []int{scene.ID}, Mode: models.RelationshipUpdateModeAdd}
		if _, err := repo.Gallery.UpdatePartial(ctx, galleries[0].ID, partial); err != nil {
			return err
		}
		linked = true
		return nil
	})
	return linked, err
}
