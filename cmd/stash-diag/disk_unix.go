//go:build !windows

package main

import "golang.org/x/sys/unix"

// freeSpaceBytes returns the number of available (unprivileged) bytes on the
// filesystem containing the given path.
func freeSpaceBytes(path string) (uint64, error) {
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return 0, err
	}
	return stat.Bavail * uint64(stat.Bsize), nil //nolint:unconvert
}
