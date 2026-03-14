//go:build !cgo

package sqlite

func (qb *BlobStore) isConstraintError(_ error) bool {
	return false
}
