//go:build windows

package main

import "golang.org/x/sys/windows"

// freeSpaceBytes returns the number of available bytes on the filesystem
// containing the given path (uses GetDiskFreeSpaceEx on Windows).
func freeSpaceBytes(path string) (uint64, error) {
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	var freeBytes uint64
	if err := windows.GetDiskFreeSpaceEx(ptr, &freeBytes, nil, nil); err != nil {
		return 0, err
	}
	return freeBytes, nil
}
