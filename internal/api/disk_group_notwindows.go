//go:build !windows
// +build !windows

package api

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

func getDiskGroup(path string) (key string, label string, err error) {
	info, err := os.Stat(path)
	if err != nil {
		clean := filepath.Clean(path)
		return clean, clean, err
	}

	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat == nil {
		clean := filepath.Clean(path)
		return clean, clean, nil
	}

	clean := filepath.Clean(path)
	return fmt.Sprintf("dev:%d", stat.Dev), clean, nil
}
