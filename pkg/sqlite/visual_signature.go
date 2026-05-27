package sqlite

import (
	"context"
	"database/sql"
	"encoding/binary"
	"errors"
	"math"
	"time"
)

// VisualSignatureStore provides persistent storage for scene visual signatures.
// A visual signature is a 64-bin HSV colour histogram stored as a float32 BLOB.
// Rows are inserted/updated by the "Generate Visual Signatures" background task
// and consumed by the SimilarScenes resolver for full visual-search coverage.
type VisualSignatureStore struct{}

// Get returns the stored visual signature for a scene, or nil if none exists.
// Safe to call inside a read or write transaction.
func (s *VisualSignatureStore) Get(ctx context.Context, sceneID int) ([]float32, error) {
	var blob []byte
	err := dbWrapper.Get(ctx, &blob,
		`SELECT signature FROM scene_visual_signatures WHERE scene_id = ?`,
		sceneID,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return blobToFloat32Slice(blob), nil
}

// Set inserts or replaces the visual signature for a scene.
// Must be called inside a write transaction.
func (s *VisualSignatureStore) Set(ctx context.Context, sceneID int, sig []float32) error {
	blob := float32SliceToBlob(sig)
	_, err := dbWrapper.Exec(ctx,
		`INSERT OR REPLACE INTO scene_visual_signatures (scene_id, signature, updated_at) VALUES (?, ?, ?)`,
		sceneID, blob, time.Now().UTC(),
	)
	return err
}

// GetAll returns all stored visual signatures as a map of sceneID → signature.
// Safe to call inside a read or write transaction.
func (s *VisualSignatureStore) GetAll(ctx context.Context) (map[int][]float32, error) {
	type sigRow struct {
		SceneID   int    `db:"scene_id"`
		Signature []byte `db:"signature"`
	}
	var rows []sigRow
	if err := dbWrapper.Select(ctx, &rows,
		`SELECT scene_id, signature FROM scene_visual_signatures`,
	); err != nil {
		return nil, err
	}
	result := make(map[int][]float32, len(rows))
	for _, r := range rows {
		result[r.SceneID] = blobToFloat32Slice(r.Signature)
	}
	return result, nil
}

// Delete removes the visual signature for a scene.
// Must be called inside a write transaction.
func (s *VisualSignatureStore) Delete(ctx context.Context, sceneID int) error {
	_, err := dbWrapper.Exec(ctx,
		`DELETE FROM scene_visual_signatures WHERE scene_id = ?`,
		sceneID,
	)
	return err
}

// float32SliceToBlob encodes a float32 slice as a little-endian byte slice.
func float32SliceToBlob(data []float32) []byte {
	buf := make([]byte, len(data)*4)
	for i, v := range data {
		binary.LittleEndian.PutUint32(buf[i*4:], math.Float32bits(v))
	}
	return buf
}

// blobToFloat32Slice decodes a little-endian byte slice into a float32 slice.
func blobToFloat32Slice(data []byte) []float32 {
	n := len(data) / 4
	result := make([]float32, n)
	for i := range result {
		bits := binary.LittleEndian.Uint32(data[i*4:])
		result[i] = math.Float32frombits(bits)
	}
	return result
}
