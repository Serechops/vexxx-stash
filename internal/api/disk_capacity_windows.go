//go:build windows
// +build windows

package api

import "golang.org/x/sys/windows"

func getDiskCapacity(path string) (total uint64, free uint64, err error) {
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, 0, err
	}

	var freeBytesAvailable uint64
	var totalBytes uint64
	if err := windows.GetDiskFreeSpaceEx(ptr, &freeBytesAvailable, &totalBytes, nil); err != nil {
		return 0, 0, err
	}

	return totalBytes, freeBytesAvailable, nil
}
