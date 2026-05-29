//go:build !windows
// +build !windows

package api

import (
	"os"
	"strings"
)

// getSystemRoots returns top-level browsable roots for the host OS.
//
// macOS  – "/" plus each entry under /Volumes (external drives, network shares, DMGs)
// Linux  – "/" plus non-empty entries under /mnt and /media (USB drives, NFS mounts)
// Other  – just "/"
func getSystemRoots() []string {
	roots := []string{"/"}

	// macOS: /Volumes contains all mounted disks and network shares
	if entries, err := os.ReadDir("/Volumes"); err == nil {
		for _, e := range entries {
			if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
				roots = append(roots, "/Volumes/"+e.Name())
			}
		}
	}

	// Linux: /mnt and /media typically hold mounted removable drives / NFS mounts
	for _, base := range []string{"/mnt", "/media"} {
		entries, err := os.ReadDir(base)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
				roots = append(roots, base+"/"+e.Name())
			}
		}
	}

	return roots
}
