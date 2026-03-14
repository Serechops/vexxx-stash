//go:build !cgo

package sqlite

// sqlite3Driver is the registered driver name used when opening database
// connections. On non-CGo platforms the custom driver is unavailable; this
// constant is still required so that database.go compiles.
const sqlite3Driver = "sqlite3ex"
