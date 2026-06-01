package models

import "context"

// BlobReader provides methods to get files by ID.
type BlobReader interface {
	EntryExists(ctx context.Context, checksum string) (bool, error)
	// GetAllChecksums returns a set of all blob checksums stored in the database.
	GetAllChecksums(ctx context.Context) (map[string]struct{}, error)
}
