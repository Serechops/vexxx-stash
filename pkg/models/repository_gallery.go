package models

import "context"

// GalleryGetter provides methods to get galleries by ID.
type GalleryGetter interface {
	// TODO - rename this to Find and remove existing method
	FindMany(ctx context.Context, ids []int) ([]*Gallery, error)
	Find(ctx context.Context, id int) (*Gallery, error)
}

// GalleryFinder provides methods to find galleries.
type GalleryFinder interface {
	GalleryGetter
	IDsFromFileIDsLoader
	FindByFingerprints(ctx context.Context, fp []Fingerprint) ([]*Gallery, error)
	FindByChecksum(ctx context.Context, checksum string) ([]*Gallery, error)
	FindByChecksums(ctx context.Context, checksums []string) ([]*Gallery, error)
	FindByPath(ctx context.Context, path string) ([]*Gallery, error)
	FindByFileID(ctx context.Context, fileID FileID) ([]*Gallery, error)
	FindByFolderID(ctx context.Context, folderID FolderID) ([]*Gallery, error)
	FindBySceneID(ctx context.Context, sceneID int) ([]*Gallery, error)
	FindByImageID(ctx context.Context, imageID int) ([]*Gallery, error)
	FindUserGalleryByTitle(ctx context.Context, title string) ([]*Gallery, error)
}

// GalleryQueryer provides methods to query galleries.
type GalleryQueryer interface {
	Query(ctx context.Context, galleryFilter *GalleryFilterType, findFilter *FindFilterType) ([]*Gallery, int, error)
	QueryCount(ctx context.Context, galleryFilter *GalleryFilterType, findFilter *FindFilterType) (int, error)
}

// GalleryCounter provides methods to count galleries.
type GalleryCounter interface {
	Count(ctx context.Context) (int, error)
	CountByFileID(ctx context.Context, fileID FileID) (int, error)
}

// GalleryCreator provides methods to create galleries.
type GalleryCreator interface {
	Create(ctx context.Context, newGallery *Gallery, fileIDs []FileID) error
}

// GalleryUpdater provides methods to update galleries.
type GalleryUpdater interface {
	Update(ctx context.Context, updatedGallery *Gallery) error
	UpdatePartial(ctx context.Context, id int, updatedGallery GalleryPartial) (*Gallery, error)
	UpdateImages(ctx context.Context, galleryID int, imageIDs []int) error
}

// GalleryDestroyer provides methods to destroy galleries.
type GalleryDestroyer interface {
	Destroy(ctx context.Context, id int) error
}

type GalleryCreatorUpdater interface {
	GalleryCreator
	GalleryUpdater
}

// GalleryReader provides all methods to read galleries.
type GalleryReader interface {
	GalleryFinder
	GalleryQueryer
	GalleryCounter

	URLLoader
	FileIDLoader
	ImageIDLoader
	SceneIDLoader
	PerformerIDLoader
	TagIDLoader
	FileLoader

	All(ctx context.Context) ([]*Gallery, error)

	// GetCover/HasCover read the gallery's explicitly-set cover (cover_blob) —
	// independent of any Image row, unlike SetCover's galleries_images.cover
	// flag. See GalleryWriter.UpdateCover.
	GetCover(ctx context.Context, galleryID int) ([]byte, error)
	HasCover(ctx context.Context, galleryID int) (bool, error)
}

// GalleryWriter provides all methods to modify galleries.
type GalleryWriter interface {
	GalleryCreator
	GalleryUpdater
	GalleryDestroyer

	AddSceneIDs(ctx context.Context, galleryID int, sceneIDs []int) error
	AddFileID(ctx context.Context, id int, fileID FileID) error
	AddImages(ctx context.Context, galleryID int, imageIDs ...int) error
	RemoveImages(ctx context.Context, galleryID int, imageIDs ...int) error
	SetCover(ctx context.Context, galleryID int, coverImageID int) error
	ResetCover(ctx context.Context, galleryID int) error

	// UpdateCover sets an explicit cover image for the gallery, decoupled from
	// its photo set — it doesn't add an Image row, so it never affects
	// ImageCount or the gallery's image grid. Takes priority over SetCover's
	// image-flag and FindGalleryCover's filename-regex/first-image fallback
	// (see resolver_model_gallery.go's Cover() and routes_gallery.go's Cover
	// handler). Passing a nil/empty image clears it.
	UpdateCover(ctx context.Context, galleryID int, image []byte) error
}

// GalleryReaderWriter provides all gallery methods.
type GalleryReaderWriter interface {
	GalleryReader
	GalleryWriter
}
