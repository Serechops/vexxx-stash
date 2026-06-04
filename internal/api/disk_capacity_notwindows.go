//go:build !windows
// +build !windows

package api

import "golang.org/x/sys/unix"

func getDiskCapacity(path string) (total uint64, free uint64, err error) {
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return 0, 0, err
	}

	totalBytes := uint64(stat.Blocks) * uint64(stat.Bsize) //nolint:unconvert
	freeBytes := uint64(stat.Bavail) * uint64(stat.Bsize)  //nolint:unconvert
	return totalBytes, freeBytes, nil
}
