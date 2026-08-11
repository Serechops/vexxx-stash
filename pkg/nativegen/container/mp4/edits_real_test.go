package mp4

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// The timeline origin is what decides which frame a time resolves to, and
// therefore what every perceptual hash this package feeds is computed from. A
// file whose edit list we read wrongly does not fail, it quietly hashes frames
// two apart from the ones ffmpeg hashes — so the only useful check is against
// ffmpeg itself, over as many real files as possible.
//
// This one is cheap enough to point at a whole library: it reads headers and
// asks ffprobe for one number per file, and decodes nothing.
//
//	STASH_MP4_TEST_FILES="E:/media/*.mp4" \
//	  go test ./pkg/nativegen/container/mp4/ -run TimelineOrigin -v -count=1
//
// The list is ;-separated and each entry may be a glob.
func TestTimelineOriginMatchesFFprobeRealFiles(t *testing.T) {
	paths := realFileList(t)
	ffprobe := ffprobePath(t)

	var agreed, trimmed, declined int
	for _, path := range paths {
		name := filepath.Base(path)

		f, err := Open(path)
		if err != nil {
			// A file this demuxer declines is a file the ffmpeg path handles, so
			// it is not a disagreement — but it is worth seeing in the log.
			t.Logf("%-60s declined: %v", name, err)
			declined++
			continue
		}
		v := f.Video()

		origin := v.Samples[0].PTS
		for _, s := range v.Samples {
			if s.PTS < origin {
				origin = s.PTS
			}
		}
		_ = f.Close()

		want, timescale, err := ffprobeStartPTS(ffprobe, path)
		if err != nil {
			t.Errorf("%-60s ffprobe: %v", name, err)
			continue
		}
		if timescale != int64(v.Timescale) {
			t.Errorf("%-60s ffprobe reports timebase 1/%d, we read timescale %d — the two numbers below are not comparable",
				name, timescale, v.Timescale)
			continue
		}

		if origin < 0 {
			// The edit list starts the presentation after the first stored
			// frame, so frames genuinely are trimmed. ffprobe reports the first
			// surviving frame; ours are kept at negative times because they are
			// still needed to decode what follows, and no target at or after
			// zero can select one.
			trimmed++
			t.Logf("%-60s trims %d ticks of media before the presentation starts", name, -origin)
			continue
		}
		if origin != want {
			t.Errorf("%-60s timeline starts at %d, ffprobe says %d (%.4fs apart at timescale %d)",
				name, origin, want, float64(origin-want)/float64(v.Timescale), v.Timescale)
			continue
		}
		agreed++
	}

	t.Logf("%d of %d files agree with ffprobe on where their timeline starts (%d trimmed, %d declined)",
		agreed, len(paths), trimmed, declined)
	if agreed+trimmed == 0 {
		t.Skip("no file in the list could be both demuxed and probed")
	}
}

// ffprobeStartPTS returns the first presentation timestamp of a file's video
// stream, in that stream's own units, together with the timebase denominator so
// the caller can confirm the units match its own.
func ffprobeStartPTS(ffprobe, path string) (int64, int64, error) {
	cmd := exec.Command(ffprobe,
		"-v", "error",
		"-select_streams", "v:0",
		"-show_entries", "stream=start_pts,time_base",
		"-of", "default=noprint_wrappers=1",
		path)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return 0, 0, errWith(err, stderr.String())
	}

	var pts, timescale int64
	for _, line := range strings.Split(stdout.String(), "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		switch key {
		case "start_pts":
			pts, _ = strconv.ParseInt(value, 10, 64)
		case "time_base":
			// Always 1/timescale for an mp4 video stream.
			if _, den, ok := strings.Cut(value, "/"); ok {
				timescale, _ = strconv.ParseInt(den, 10, 64)
			}
		}
	}
	return pts, timescale, nil
}

func errWith(err error, stderr string) error {
	if s := strings.TrimSpace(stderr); s != "" {
		return &probeError{err: err, stderr: s}
	}
	return err
}

type probeError struct {
	err    error
	stderr string
}

func (e *probeError) Error() string { return e.err.Error() + ": " + e.stderr }
func (e *probeError) Unwrap() error { return e.err }

// realFileList expands STASH_MP4_TEST_FILES, a ;-separated list of paths or
// globs.
func realFileList(t *testing.T) []string {
	t.Helper()

	spec := os.Getenv("STASH_MP4_TEST_FILES")
	if spec == "" {
		t.Skip("set STASH_MP4_TEST_FILES to a ;-separated list of files or globs")
	}

	var paths []string
	for _, entry := range strings.Split(spec, ";") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		matches, err := filepath.Glob(entry)
		if err != nil {
			t.Fatalf("bad pattern %q: %v", entry, err)
		}
		if len(matches) == 0 {
			// Not a glob, or matched nothing: keep it so the failure names the
			// file the caller actually asked for.
			paths = append(paths, entry)
			continue
		}
		paths = append(paths, matches...)
	}
	if len(paths) == 0 {
		t.Skip("STASH_MP4_TEST_FILES matched no files")
	}
	return paths
}

func ffprobePath(t *testing.T) string {
	t.Helper()

	if p := os.Getenv("STASH_FFPROBE_PATH"); p != "" {
		return p
	}
	p, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe is not on PATH; set STASH_FFPROBE_PATH")
	}
	return p
}
