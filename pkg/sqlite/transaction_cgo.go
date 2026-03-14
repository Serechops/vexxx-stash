//go:build cgo

package sqlite

import (
	"errors"

	sqlite3 "github.com/mattn/go-sqlite3"
)

func (db *Database) IsLocked(err error) bool {
	var sqliteError sqlite3.Error
	if errors.As(err, &sqliteError) {
		return sqliteError.Code == sqlite3.ErrBusy
	}
	return false
}
