package api

import (
	"io/fs"
	"os"
	"path/filepath"
)

func directorySize(path string) (uint64, error) {
	var total uint64
	var firstErr error

	walkFn := func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			if os.IsPermission(err) {
				return filepath.SkipDir
			}
			return nil
		}

		if d.IsDir() {
			return nil
		}

		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}

		info, infoErr := d.Info()
		if infoErr != nil {
			if firstErr == nil {
				firstErr = infoErr
			}
			return nil
		}

		sz := info.Size()
		if sz > 0 {
			total += uint64(sz)
		}
		return nil
	}

	if err := filepath.WalkDir(path, walkFn); err != nil && firstErr == nil {
		firstErr = err
	}

	return total, firstErr
}
