package nativegen

import (
	"context"
	"image"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stashapp/stash/pkg/nativegen/container/mp4"
)

// Skipping disposable pictures rests on a claim about the bitstream: that a
// picture nothing is predicted from cannot affect the reconstruction of the
// picture being walked to. The claim is sound and the codec specifications say so
// outright, and neither of those is a reason to ship it unverified — what has to
// hold is that this decoder, on these files, hands back the same pixels either
// way.
//
// So this runs the production phash walk twice over each file, once with the skip
// and once without, and compares the frames pixel for pixel. Not the hash: the
// pixels, so a failure says which frame and where. A single differing byte means
// the classifier is admitting something that is referenced after all, and the
// skip has to come out.
//
//	STASH_NATIVEGEN_TEST_FILES="E:\API Hub\*.mp4" \
//	  go test ./pkg/nativegen/ -run DisposableSkipIsExact -v -count=1 -timeout 60m
func TestDisposableSkipIsExactRealFiles(t *testing.T) {
	if !Available() {
		t.Skip("no native hardware backend on this machine")
	}
	files := concurrencyTestFiles(t)
	if len(files) == 0 {
		t.Skip("no files matched")
	}
	if len(files) > 6 {
		files = files[:6]
	}

	ffmpeg := os.Getenv("STASH_FFMPEG_PATH")
	if ffmpeg == "" {
		ffmpeg = "ffmpeg"
	}

	frames := func(path string, skip bool) ([]image.Image, time.Duration, error) {
		f, err := mp4.Open(path)
		if err != nil {
			return nil, 0, err
		}
		duration := f.Video().DurationSeconds()
		_ = f.Close()

		disposableSkipEnabled = skip
		defer func() { disposableSkipEnabled = true }()

		start := time.Now()
		imgs, err := PhashFrames(context.Background(), PhashFrameOptions{
			Path: path, Times: PhashTimes(duration), Width: 160,
		}, ffmpeg)
		return imgs, time.Since(start), err
	}

	checked, exact := 0, 0
	var withSkip, withoutSkip time.Duration

	for _, path := range files {
		name := filepath.Base(path)

		// Without the skip first, so the skip is the one measured on a warm cache
		// and cannot be flattered by it.
		want, slow, err := frames(path, false)
		if err != nil {
			t.Logf("%-46s declined without the skip: %v", trunc(name, 46), err)
			continue
		}
		got, fast, err := frames(path, true)
		if err != nil {
			t.Errorf("%s: declined with the skip but not without it: %v", name, err)
			continue
		}
		checked++

		if len(got) != len(want) {
			t.Errorf("%s: %d frames with the skip, %d without", name, len(got), len(want))
			continue
		}

		differed := false
		for i := range want {
			if got[i].Bounds() != want[i].Bounds() {
				t.Errorf("%s frame %d: %v with the skip, %v without", name, i, got[i].Bounds(), want[i].Bounds())
				differed = true
				break
			}
			if x, y, g, w, ok := firstPixelDifference(got[i], want[i]); !ok {
				t.Errorf("%s frame %d differs at (%d,%d): %v with the skip against %v without — a skipped picture was referenced after all",
					name, i, x, y, g, w)
				differed = true
				break
			}
		}
		if !differed {
			exact++
		}

		withSkip += fast
		withoutSkip += slow
		t.Logf("%-46s %s  %7v -> %7v  (%.2fx)", trunc(name, 46),
			map[bool]string{true: "exact", false: "DIFFERS"}[!differed],
			slow.Round(time.Millisecond), fast.Round(time.Millisecond),
			slow.Seconds()/fast.Seconds())
	}

	if checked == 0 {
		t.Skip("no file could be walked")
	}
	t.Logf("")
	t.Logf("%d of %d files pixel-identical; %v -> %v overall (%.2fx)",
		exact, checked, withoutSkip.Round(time.Millisecond), withSkip.Round(time.Millisecond),
		withoutSkip.Seconds()/withSkip.Seconds())
}

// The same check for Frames, which is the other exact-frame walk in the package
// and the one the marker generator runs through. It reprojects, so it exercises a
// path the phash never touches: frames come back through the GPU converter and
// the remapper rather than as raw NV12.
//
//	STASH_NATIVEGEN_TEST_FILES="E:\API Hub\*.mp4" STASH_NATIVEGEN_TEST_VRMODE=LR180 \
//	  go test ./pkg/nativegen/ -run DisposableSkipIsExactFrames -v -count=1 -timeout 30m
func TestDisposableSkipIsExactFramesRealFiles(t *testing.T) {
	if !Available() {
		t.Skip("no native hardware backend on this machine")
	}
	files := concurrencyTestFiles(t)
	if len(files) == 0 {
		t.Skip("no files matched")
	}
	if len(files) > 4 {
		files = files[:4]
	}
	vrMode := os.Getenv("STASH_NATIVEGEN_TEST_VRMODE")

	extract := func(path string, skip bool) ([]image.Image, time.Duration, error) {
		f, err := mp4.Open(path)
		if err != nil {
			return nil, 0, err
		}
		duration := f.Video().DurationSeconds()
		_ = f.Close()

		// Times well inside the file, so every one of them has a real run-up in
		// front of it rather than landing on the opening keyframe.
		times := make([]float64, 8)
		for i := range times {
			times[i] = duration * (0.2 + 0.07*float64(i))
		}

		disposableSkipEnabled = skip
		defer func() { disposableSkipEnabled = true }()

		start := time.Now()
		imgs, err := Frames(context.Background(), FrameOptions{
			Path: path, Times: times, Width: 640, VRMode: vrMode,
		})
		return imgs, time.Since(start), err
	}

	checked, exact := 0, 0
	for _, path := range files {
		name := filepath.Base(path)

		want, slow, err := extract(path, false)
		if err != nil {
			t.Logf("%-46s declined without the skip: %v", trunc(name, 46), err)
			continue
		}
		got, fast, err := extract(path, true)
		if err != nil {
			t.Errorf("%s: declined with the skip but not without it: %v", name, err)
			continue
		}
		checked++

		if len(got) != len(want) {
			t.Errorf("%s: %d frames with the skip, %d without", name, len(got), len(want))
			continue
		}
		differed := false
		for i := range want {
			if x, y, g, w, ok := firstPixelDifference(got[i], want[i]); !ok {
				t.Errorf("%s frame %d differs at (%d,%d): %v with the skip against %v without",
					name, i, x, y, g, w)
				differed = true
				break
			}
		}
		if !differed {
			exact++
		}
		t.Logf("%-46s %s  %7v -> %7v  (%.2fx)", trunc(name, 46),
			map[bool]string{true: "exact", false: "DIFFERS"}[!differed],
			slow.Round(time.Millisecond), fast.Round(time.Millisecond),
			slow.Seconds()/fast.Seconds())
	}

	if checked == 0 {
		t.Skip("no file could be walked")
	}
	t.Logf("%d of %d files pixel-identical", exact, checked)
}
