//go:build !cgo

package sqlite

func (db *Database) IsLocked(_ error) bool {
	return false
}
