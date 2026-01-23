package api

import (
	"fmt"

	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/sliceutil"
)

type BaseFile interface {
	IsBaseFile()
}

type VisualFile interface {
	IsVisualFile()
}

func convertVisualFile(f models.File) (VisualFile, error) {
	switch f := f.(type) {
	case VisualFile:
		return f, nil
	case *models.VideoFile:
		return &VideoFile{VideoFile: f}, nil
	case *models.ImageFile:
		return &ImageFile{ImageFile: f}, nil
	default:
		return nil, fmt.Errorf("file %s is not a visual file", f.Base().Path)
	}
}

func convertBaseFile(f models.File) BaseFile {
	if f == nil {
		return nil
	}

	switch f := f.(type) {
	case BaseFile:
		return f
	case *models.VideoFile:
		return &VideoFile{VideoFile: f}
	case *models.ImageFile:
		return &ImageFile{ImageFile: f}
	case *models.BaseFile:
		return &BasicFile{BaseFile: f}
	default:
		panic("unknown file type")
	}
}

func convertBaseFiles(files []models.File) []BaseFile {
	return sliceutil.Map(files, convertBaseFile)
}

type GalleryFile struct {
	*models.BaseFile
}

func (GalleryFile) IsBaseFile() {}

func (GalleryFile) IsVisualFile() {}

func (f *GalleryFile) Fingerprints() []models.Fingerprint {
	return f.BaseFile.Fingerprints
}

type VideoFile struct {
	*models.VideoFile
}

func (VideoFile) IsBaseFile() {}

func (VideoFile) IsVisualFile() {}

func (f *VideoFile) Fingerprints() []models.Fingerprint {
	return f.VideoFile.Fingerprints
}

type ImageFile struct {
	*models.ImageFile
}

func (ImageFile) IsBaseFile() {}

func (ImageFile) IsVisualFile() {}

func (f *ImageFile) Fingerprints() []models.Fingerprint {
	return f.ImageFile.Fingerprints
}

type BasicFile struct {
	*models.BaseFile
}

func (BasicFile) IsBaseFile() {}

func (BasicFile) IsVisualFile() {}

func (f *BasicFile) Fingerprints() []models.Fingerprint {
	return f.BaseFile.Fingerprints
}

// FindPlaylistsResultType is the result type for the findPlaylists query
type FindPlaylistsResultType struct {
	Count     int                `json:"count"`
	Playlists []*models.Playlist `json:"playlists"`
}

// LibraryPathValidationResult is the result of validating a library path
type LibraryPathValidationResult struct {
	// Whether the path is valid and accessible
	Valid bool `json:"valid"`
	// Error message if path is invalid
	Message *string `json:"message,omitempty"`
	// Whether this appears to be a host path rather than a container path
	IsHostPath bool `json:"isHostPath"`
	// Suggested docker mount command if running in Docker
	DockerMountCommand *string `json:"dockerMountCommand,omitempty"`
	// Suggested container path to use after mounting
	SuggestedContainerPath *string `json:"suggestedContainerPath,omitempty"`
	// List of currently available container paths (mounted volumes)
	AvailableContainerPaths []string `json:"availableContainerPaths,omitempty"`
}

// DockerMountedVolume represents a mounted volume in Docker
type DockerMountedVolume struct {
	// The path inside the container
	ContainerPath string `json:"containerPath"`
	// The source path on the host (if available)
	HostPath *string `json:"hostPath,omitempty"`
	// Filesystem type
	FsType *string `json:"fsType,omitempty"`
	// Whether this is a likely media mount point
	IsMediaMount bool `json:"isMediaMount"`
}
