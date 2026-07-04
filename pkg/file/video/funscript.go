package video

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// GetFunscriptPath returns the path of a file
// with the extension changed to .funscript
func GetFunscriptPath(path string) string {
	ext := filepath.Ext(path)
	fn := strings.TrimSuffix(path, ext)
	return fn + ".funscript"
}

// ListFunscripts returns the absolute paths of every .funscript file found in the
// same directory as videoPath, sorted by filename for a stable order. Used to
// auto-discover the full set of funscripts available to a scene (a scene may have
// several beyond the one matching the video filename). Returns an empty slice if
// the directory cannot be read.
func ListFunscripts(videoPath string) []string {
	dir := filepath.Dir(videoPath)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}

	var ret []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if strings.EqualFold(filepath.Ext(e.Name()), ".funscript") {
			ret = append(ret, filepath.Join(dir, e.Name()))
		}
	}
	sort.Strings(ret)
	return ret
}
