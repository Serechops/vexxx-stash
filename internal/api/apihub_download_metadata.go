package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
)

// apihubManifestFile is the fixed name of the portable identifier sidecar
// written into every per-item download subdirectory (see download() in
// apihub_download_job.go). The name never changes, so it survives any rename
// of the video or gallery file it sits beside — unlike the native scene<->
// gallery association (pkg/scene/scan.go, pkg/gallery/scan.go), which is pure
// basename string matching and breaks the moment either file's name diverges.
//
// The relink task (apihub_relink_job.go) restores what it can from this file
// after a moved library or a fresh Stash install: it scopes its matching to
// "whatever scene/gallery files are in this same folder" rather than to any
// filename recorded at download time.
const apihubManifestFile = "apihub.json"

// apihubManifest is the portable identifier for one APIHub download. LinkID
// ties the scene and gallery halves of a pairing together independent of
// either file's current name; the rest is enough to restore StashIDs/URLs
// onto a scene re-created by a plain library scan without hitting the network
// again.
type apihubManifest struct {
	SchemaVersion int       `json:"schema_version"`
	LinkID        string    `json:"link_id"`
	DownloadedAt  time.Time `json:"downloaded_at"`
	Provider      string    `json:"provider,omitempty"`
	SourceURL     string    `json:"source_url,omitempty"`

	Scene   apihubManifestScene    `json:"scene"`
	Gallery *apihubManifestGallery `json:"gallery,omitempty"`
}

// apihubManifestScene is descriptive metadata plus everything needed to
// re-identify the scene without a network round-trip: resolved StashIDs (so
// the relink task can stamp them straight back on) and the content oshash (a
// belt-and-braces cross-check, since the manifest could in principle be
// copied next to the wrong file by hand).
type apihubManifestScene struct {
	Title      string             `json:"title,omitempty"`
	Studio     string             `json:"studio,omitempty"`
	Date       string             `json:"date,omitempty"`
	Performers []string           `json:"performers,omitempty"`
	Tags       []string           `json:"tags,omitempty"`
	VRMode     string             `json:"vr_mode,omitempty"`
	OSHash     string             `json:"oshash,omitempty"`
	StashIDs   []apihubManifestID `json:"stash_ids,omitempty"`
}

type apihubManifestGallery struct {
	Title string `json:"title,omitempty"`
}

type apihubManifestID struct {
	Endpoint string `json:"endpoint"`
	StashID  string `json:"stash_id"`
}

// newLinkID returns a fresh identifier shared between one scene and its
// gallery for the lifetime of the pairing.
func newLinkID() string {
	return uuid.NewString()
}

// writeApihubManifest writes (or overwrites) the manifest into dir. Failures
// are the caller's to decide how to handle — this never touches the media
// files themselves, so a write failure here should never fail the download.
func writeApihubManifest(dir string, m *apihubManifest) error {
	m.SchemaVersion = 1
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, apihubManifestFile), b, 0o644)
}

// writeManifest builds the apihub.json sidecar for a downloaded item from its
// now-identified scene and writes it into dir (the item's own subdirectory,
// see download() in apihub_download_job.go). Best-effort: a failure here
// never affects the scene/gallery already imported, so it's only logged.
func (j *apihubDownloadJob) writeManifest(dir string, scene *models.Scene, item apihubDownloadItem, gallerySucceeded bool) {
	title := scene.Title
	if title == "" {
		title = item.Title
	}

	m := &apihubManifest{
		LinkID:       newLinkID(),
		DownloadedAt: time.Now(),
		Provider:     item.Provider,
	}
	m.Scene.Title = title
	m.Scene.OSHash = scene.OSHash
	if scene.VRMode != nil {
		m.Scene.VRMode = string(*scene.VRMode)
	}
	for _, sid := range scene.StashIDs.List() {
		m.Scene.StashIDs = append(m.Scene.StashIDs, apihubManifestID{Endpoint: sid.Endpoint, StashID: sid.StashID})
	}

	if meta := item.Metadata; meta != nil {
		m.SourceURL = meta.URL
		m.Scene.Studio = meta.Studio
		m.Scene.Date = meta.Date
		m.Scene.Tags = append(m.Scene.Tags, meta.Tags...)
		for _, p := range meta.Performers {
			if name := strings.TrimSpace(p.Name); name != "" {
				m.Scene.Performers = append(m.Scene.Performers, name)
			}
		}
	}

	if gallerySucceeded && item.Gallery != nil {
		galTitle := strings.TrimSpace(item.Gallery.Title)
		if galTitle == "" {
			galTitle = title
		}
		m.Gallery = &apihubManifestGallery{Title: galTitle}
	}

	if err := writeApihubManifest(dir, m); err != nil {
		logger.Warnf("[apihub-download] writing apihub.json manifest for %q failed: %v", title, err)
	}
}

// readApihubManifest reads and parses a manifest file at path.
func readApihubManifest(path string) (*apihubManifest, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var m apihubManifest
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return &m, nil
}
