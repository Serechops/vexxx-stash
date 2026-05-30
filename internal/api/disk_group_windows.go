//go:build windows
// +build windows

package api

import (
	"path/filepath"
	"strings"
)

func getDiskGroup(path string) (key string, label string, err error) {
	volume := filepath.VolumeName(path)
	if volume == "" {
		clean := filepath.Clean(path)
		return clean, clean, nil
	}

	if strings.HasPrefix(volume, `\\`) {
		// UNC volume format: \\server\share
		return strings.ToLower(volume), volume, nil
	}

	root := strings.ToUpper(volume) + `\`
	return strings.ToLower(root), root, nil
}
