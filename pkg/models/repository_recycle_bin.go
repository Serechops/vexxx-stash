package models

import "context"

// RecycleBinReader provides read-only access to the recycle bin.
type RecycleBinReader interface {
	FindByID(ctx context.Context, id int) (*RecycleBinEntry, error)
	FindAll(ctx context.Context, limit, offset int) ([]*RecycleBinEntry, error)
	Count(ctx context.Context) (int, error)
}

// RecycleBinWriter provides write access to the recycle bin.
type RecycleBinWriter interface {
	// Snapshot methods — each resolver calls the appropriate one before
	// calling the entity store's Destroy method.

	SnapshotTag(ctx context.Context, qb TagReader, t *Tag, groupID *string) error
	SnapshotPerformer(ctx context.Context, qb PerformerReader, p *Performer, groupID *string) error
	SnapshotStudio(ctx context.Context, qb StudioReader, s *Studio, groupID *string) error
	SnapshotGallery(ctx context.Context, qb GalleryReader, g *Gallery, groupID *string) error
	SnapshotImage(ctx context.Context, qb ImageReader, i *Image, groupID *string) error
	SnapshotGroup(ctx context.Context, qb GroupReader, g *Group, groupID *string) error
	SnapshotSceneMarker(ctx context.Context, qb SceneMarkerReader, m *SceneMarker, groupID *string) error

	// Restore re-inserts the original entity row and its join-table data.
	Restore(ctx context.Context, id int) error

	// Purge permanently removes a single entry from the recycle bin.
	Purge(ctx context.Context, id int) error

	// PurgeAll permanently removes all entries from the recycle bin.
	PurgeAll(ctx context.Context) error
}

// RecycleBinReaderWriter provides all recycle-bin methods.
type RecycleBinReaderWriter interface {
	RecycleBinReader
	RecycleBinWriter
}
