//go:build windows
// +build windows

package api

import (
	"fmt"
	"os"
)

// getSystemRoots enumerates available drive letters (A:\ through Z:\).
// It includes local disks, USB drives, and network drives mapped to letters.
func getSystemRoots() []string {
	var roots []string
	for c := 'A'; c <= 'Z'; c++ {
		drive := fmt.Sprintf(`%c:\`, c)
		if _, err := os.Stat(drive); err == nil {
			roots = append(roots, drive)
		}
	}
	return roots
}
