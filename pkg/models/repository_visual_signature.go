package models

import "context"

// VisualSignatureReader provides read access to scene visual colour signatures.
type VisualSignatureReader interface {
	// Get returns the stored visual signature for the given scene, or nil if none exists.
	Get(ctx context.Context, sceneID int) ([]float32, error)
	// GetAll returns all stored visual signatures as a map of sceneID → signature.
	GetAll(ctx context.Context) (map[int][]float32, error)
}

// VisualSignatureWriter provides write access to scene visual colour signatures.
type VisualSignatureWriter interface {
	// Set inserts or replaces the visual signature for the given scene.
	Set(ctx context.Context, sceneID int, sig []float32) error
	// Delete removes the stored visual signature for the given scene.
	Delete(ctx context.Context, sceneID int) error
}

// VisualSignatureReaderWriter provides full read/write access to scene visual colour signatures.
type VisualSignatureReaderWriter interface {
	VisualSignatureReader
	VisualSignatureWriter
}
