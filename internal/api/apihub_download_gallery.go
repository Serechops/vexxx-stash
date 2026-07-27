package api

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/pkg/job"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/txn"
)

// apihubGalleryMeta is the photo gallery accompanying a downloaded scene. The
// plugin has already resolved the full-size image URLs client-side (an
// EvilAngel/Adult Time signed photoset, or Aylo's timeline frames), so the
// backend only has to fetch them.
type apihubGalleryMeta struct {
	// Title for the created gallery. Falls back to the scene title.
	Title string `json:"title"`
	// Full-size image URLs, in display order. Used when ZipURL is empty.
	Images []string `json:"images"`
	// ZipURL is a ready-made archive of the gallery, when the provider
	// publishes one (Aylo's "caps_zip"). Preferred over Images — a single
	// fetch instead of one per image, which matters for the thousand-plus
	// frame galleries Aylo can return.
	ZipURL string `json:"zipUrl,omitempty"`
	// Optional per-fetch headers, when the image CDN is member-gated.
	Headers map[string]string `json:"headers,omitempty"`
}

// importGallery downloads a scene's photo gallery, packages it as a zip
// alongside the video, and imports it as a Stash gallery attached to the scene.
//
// The zip is named after the video so that Stash's own scan-time association
// links the two for free: the image scan handler matches a zip-based gallery to
// scenes at `<gallery path minus extension>.*`, i.e.
//
//	Brazzers - 2026-07-24 - Title.mp4
//	Brazzers - 2026-07-24 - Title.zip   ← auto-associates to the scene above
//
// The scene link is still applied explicitly afterwards (alongside the gallery
// metadata), since that match depends on the scene row already existing and on
// naming staying in lockstep — belt and braces rather than relying on it.
//
// Images are written straight into the zip as they download, so a large gallery
// never lands as thousands of loose files: one archive per gallery, one file row,
// one gallery row. Callers get a single scan at the end rather than one scan per
// image (which floods the UI's scan subscription).
func (j *apihubDownloadJob) importGallery(ctx context.Context, videoPath string, scene *models.Scene, item apihubDownloadItem) error {
	meta := item.Gallery
	if meta == nil || (len(meta.Images) == 0 && meta.ZipURL == "") {
		return nil
	}

	// Sibling of the video, same base name — see the association note above.
	zipPath := strings.TrimSuffix(videoPath, filepath.Ext(videoPath)) + ".zip"
	zipPath = uniqueDest(filepath.Dir(zipPath), filepath.Base(zipPath))

	// Prefer the provider's own archive; fall back to assembling one from the
	// individual image URLs (which is the only option for the photoset-based
	// networks, and for an Aylo release with no caps_zip).
	usedProviderZip := false
	if meta.ZipURL != "" {
		logger.Infof("[apihub-download] gallery: fetching provider archive (%d images listed as fallback)", len(meta.Images))
		if err := j.downloadProviderZip(ctx, meta.ZipURL, zipPath, meta.Headers); err != nil {
			logger.Warnf("[apihub-download] provider gallery zip failed (%v) — rebuilding from images", err)
			os.Remove(zipPath)
		} else {
			usedProviderZip = true
		}
	} else {
		logger.Infof("[apihub-download] gallery: no provider archive supplied, fetching %d images individually", len(meta.Images))
	}

	if !usedProviderZip {
		if len(meta.Images) == 0 {
			os.Remove(zipPath)
			return fmt.Errorf("gallery zip could not be fetched and no image list was supplied")
		}
		written, err := j.buildGalleryZip(ctx, zipPath, meta)
		if err != nil {
			os.Remove(zipPath)
			return err
		}
		if written == 0 {
			os.Remove(zipPath)
			return fmt.Errorf("no gallery images could be downloaded")
		}
		logger.Infof("[apihub-download] gallery zip %s (%d images)", zipPath, written)
	}

	if job.IsCancelled(ctx) {
		return nil
	}

	mgr := manager.GetInstance()

	// Scans the archive *and* walks its contents — the images inside have to
	// exist as rows before a gallery can be created for the zip (an empty
	// gallery is refused, and it's the image handler that creates the
	// zip-based gallery). Plain ScanFile does not descend into archives.
	res, err := mgr.ScanZipFile(ctx, zipPath)
	if err != nil {
		return fmt.Errorf("scanning gallery zip: %w", err)
	}
	if res.Error != nil {
		return fmt.Errorf("scanning gallery zip: %s", *res.Error)
	}
	if res.File == nil || res.File.Base() == nil {
		return fmt.Errorf("scan produced no file for the gallery zip")
	}

	// Fetch the scene's cover before the DB transaction below — a slow network
	// fetch shouldn't hold one open, same reasoning as identifyDownloadedScene.
	// Best-effort: a failed fetch just leaves the gallery to Stash's own cover
	// selection (galleries_images.cover / filename regex / first image) rather
	// than matching the scene's.
	var coverImage []byte
	if item.Metadata != nil {
		if coverURL := strings.TrimSpace(item.Metadata.CoverURL); coverURL != "" {
			b, err := j.fetchBytes(ctx, coverURL, item.Headers)
			if err != nil {
				logger.Warnf("[apihub-download] gallery cover image fetch failed: %v", err)
			} else {
				coverImage = b
			}
		}
	}

	return j.linkGalleryToScene(ctx, mgr.Repository, res.File.Base().ID, scene, item, coverImage)
}

// downloadProviderZip fetches a provider-published gallery archive straight to
// disk. It verifies the result actually opens as a zip before accepting it —
// a CDN error page saved under a .zip name would otherwise scan as a corrupt
// gallery, and the caller can still fall back to building one from the images.
func (j *apihubDownloadJob) downloadProviderZip(ctx context.Context, zipURL, dest string, headers map[string]string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, zipURL, nil)
	if err != nil {
		return err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := j.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %s", resp.Status)
	}

	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, resp.Body)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}

	zr, err := zip.OpenReader(dest)
	if err != nil {
		return fmt.Errorf("downloaded file is not a valid zip: %w", err)
	}
	n := len(zr.File)
	zr.Close()
	if n == 0 {
		return fmt.Errorf("downloaded zip is empty")
	}

	logger.Infof("[apihub-download] gallery zip %s (%d entries, from provider archive)", dest, n)
	return nil
}

// buildGalleryZip streams each image straight into a zip archive, returning how
// many were successfully written. Individual image failures are logged and
// skipped rather than aborting — a gallery missing a few frames is still worth
// having.
func (j *apihubDownloadJob) buildGalleryZip(ctx context.Context, zipPath string, meta *apihubGalleryMeta) (int, error) {
	out, err := os.Create(zipPath)
	if err != nil {
		return 0, fmt.Errorf("create gallery zip: %w", err)
	}
	defer out.Close()

	zw := zip.NewWriter(out)

	// Zero-padded to the total width so the archive's lexical order (which is
	// the order Stash presents the gallery in) matches the source order.
	width := len(fmt.Sprintf("%d", len(meta.Images)))
	if width < 3 {
		width = 3
	}

	written := 0
	for i, imgURL := range meta.Images {
		if job.IsCancelled(ctx) {
			break
		}
		name := fmt.Sprintf("%0*d%s", width, i+1, galleryImageExt(imgURL))
		if err := j.writeImageToZip(ctx, zw, name, imgURL, meta.Headers); err != nil {
			logger.Warnf("[apihub-download] gallery image %d/%d failed: %v", i+1, len(meta.Images), err)
			continue
		}
		written++
	}

	if err := zw.Close(); err != nil {
		return written, fmt.Errorf("finalising gallery zip: %w", err)
	}
	return written, nil
}

// writeImageToZip fetches one image and copies it into the open archive. Stored
// without compression: these are already-compressed JPEGs, so deflating them
// costs CPU for no meaningful size win.
func (j *apihubDownloadJob) writeImageToZip(ctx context.Context, zw *zip.Writer, name, imgURL string, headers map[string]string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imgURL, nil)
	if err != nil {
		return err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := j.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %s", resp.Status)
	}

	w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store})
	if err != nil {
		return err
	}

	// Cap the read so a mis-resolved URL can't fill the disk (photos are small).
	_, err = io.Copy(w, io.LimitReader(resp.Body, 64<<20))
	return err
}

// linkGalleryToScene finds the zip-based gallery the scan created and stamps it:
// title/date/details/url from the catalog metadata, the studio/performers/tags
// already resolved onto the scene by the Identify pass (reusing those rather
// than re-deriving them keeps the gallery consistent with its scene and avoids
// creating duplicate entities), and — when coverImage is non-empty — an
// explicit cover matching the scene's, via Gallery.UpdateCover. That's a
// separate blob column (cover_blob), not an Image row, so it doesn't add a
// photo to the gallery's own image set/count.
func (j *apihubDownloadJob) linkGalleryToScene(ctx context.Context, repo models.Repository, zipFileID models.FileID, scene *models.Scene, item apihubDownloadItem, coverImage []byte) error {
	return txn.WithTxn(ctx, repo.TxnManager, func(ctx context.Context) error {
		galleries, err := repo.Gallery.FindByFileID(ctx, zipFileID)
		if err != nil {
			return fmt.Errorf("finding created gallery: %w", err)
		}
		if len(galleries) == 0 {
			return fmt.Errorf("no gallery was created for the downloaded images")
		}
		g := galleries[0]

		partial := models.NewGalleryPartial()
		partial.SceneIDs = &models.UpdateIDs{
			IDs:  []int{scene.ID},
			Mode: models.RelationshipUpdateModeAdd,
		}

		title := strings.TrimSpace(item.Gallery.Title)
		meta := item.Metadata
		if title == "" && meta != nil {
			title = strings.TrimSpace(meta.Title)
		}
		if title == "" {
			title = strings.TrimSpace(item.Title)
		}
		if title != "" {
			partial.Title = models.NewOptionalString(title)
		}

		if meta != nil {
			if v := strings.TrimSpace(meta.Details); v != "" {
				partial.Details = models.NewOptionalString(v)
			}
			if v := strings.TrimSpace(meta.URL); v != "" {
				partial.URLs = &models.UpdateStrings{
					Values: []string{v},
					Mode:   models.RelationshipUpdateModeSet,
				}
			}
			if v := strings.TrimSpace(meta.Date); v != "" {
				if d, err := models.ParseDate(v); err == nil {
					partial.Date = models.NewOptionalDate(d)
				}
			}
		}

		// Mirror the scene's resolved relationships onto the gallery.
		if scene.StudioID != nil {
			partial.StudioID = models.NewOptionalInt(*scene.StudioID)
		}
		if err := scene.LoadPerformerIDs(ctx, repo.Scene); err == nil && scene.PerformerIDs.Loaded() {
			if ids := scene.PerformerIDs.List(); len(ids) > 0 {
				partial.PerformerIDs = &models.UpdateIDs{IDs: ids, Mode: models.RelationshipUpdateModeSet}
			}
		}
		if err := scene.LoadTagIDs(ctx, repo.Scene); err == nil && scene.TagIDs.Loaded() {
			if ids := scene.TagIDs.List(); len(ids) > 0 {
				partial.TagIDs = &models.UpdateIDs{IDs: ids, Mode: models.RelationshipUpdateModeSet}
			}
		}

		if _, err := repo.Gallery.UpdatePartial(ctx, g.ID, partial); err != nil {
			return fmt.Errorf("updating gallery: %w", err)
		}

		if len(coverImage) > 0 {
			if err := repo.Gallery.UpdateCover(ctx, g.ID, coverImage); err != nil {
				return fmt.Errorf("setting gallery cover: %w", err)
			}
		}

		logger.Infof("[apihub-download] linked gallery %d to scene %d", g.ID, scene.ID)
		return nil
	})
}

// galleryImageExt picks the in-archive extension for an image URL, defaulting to
// .jpg when the URL carries no recognisable one (the scan keys off extension to
// treat the entry as an image).
func galleryImageExt(rawURL string) string {
	ext := ""
	if u, err := url.Parse(rawURL); err == nil {
		ext = strings.ToLower(filepath.Ext(u.Path))
	}
	switch ext {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif":
		return ext
	default:
		return ".jpg"
	}
}
