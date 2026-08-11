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

// The device set decides which video engine a decoder lands on, and nothing
// else. A caller that finds it empty decodes on a context of its own, which is
// a placement decision and must not be a correctness one: the frames have to
// come back identical either way, because the hash computed from them is
// compared against hashes computed elsewhere.
//
// This is the test for that. It hashes the same file twice, once with the set
// free and once with every device held by someone else, and compares the frames
// pixel for pixel rather than through a hash, so a failure says where.
//
//	STASH_NATIVEGEN_TEST_MP4="scene.mp4" \
//	  go test ./pkg/nativegen/ -run PhashFramesIgnoresDevices -v -count=1 -timeout 30m
func TestPhashFramesIgnoresDevicesRealFile(t *testing.T) {
	path := os.Getenv("STASH_NATIVEGEN_TEST_MP4")
	if path == "" {
		t.Skip("set STASH_NATIVEGEN_TEST_MP4 to a video file")
	}
	if !Available() {
		t.Skip("no native hardware backend on this machine")
	}

	f, err := mp4.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	duration := f.Video().DurationSeconds()
	_ = f.Close()

	// The production time list, so that this measures the frames a real hash
	// would be built from rather than an arbitrary 25.
	opts := PhashFrameOptions{Path: path, Times: PhashTimes(duration), Width: 160}

	decode := func(what string) []image.Image {
		start := time.Now()
		frames, err := PhashFrames(context.Background(), opts, "ffmpeg")
		if err != nil {
			t.Fatalf("%s: %v", what, err)
		}
		t.Logf("%-28s %d frames in %v", what, len(frames), time.Since(start).Round(time.Millisecond))
		return frames
	}

	withDevices := decode("with the set free")

	// Hold everything the set has, so the decoders below have to fall back to
	// contexts of their own — the path a second concurrent job takes.
	held, release := decodeDevices.acquire(decodeDeviceCount)
	if release == nil {
		t.Skip("the device set is empty on this machine, so there is nothing to withhold")
	}
	if len(held) != decodeDeviceCount {
		release()
		t.Fatalf("could not withhold the whole set: got %d of %d devices", len(held), decodeDeviceCount)
	}
	withoutDevices := decode("with the set exhausted")
	release()

	if len(withDevices) != len(withoutDevices) {
		t.Fatalf("%d frames with devices, %d without", len(withDevices), len(withoutDevices))
	}

	name := filepath.Base(path)
	for i := range withDevices {
		a, b := withDevices[i], withoutDevices[i]
		if a.Bounds() != b.Bounds() {
			t.Errorf("%s frame %d: %v with devices, %v without", name, i, a.Bounds(), b.Bounds())
			continue
		}
		if x, y, got, want, ok := firstPixelDifference(a, b); !ok {
			t.Errorf("%s frame %d differs at (%d,%d): %v against %v — placement changed the pixels",
				name, i, x, y, got, want)
		}
	}
}

// firstPixelDifference reports the first pixel at which two images disagree.
func firstPixelDifference(a, b image.Image) (x, y int, got, want [4]uint32, ok bool) {
	r := a.Bounds()
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			ar, ag, ab, aa := a.At(x, y).RGBA()
			br, bg, bb, ba := b.At(x, y).RGBA()
			if ar != br || ag != bg || ab != bb || aa != ba {
				return x, y, [4]uint32{ar, ag, ab, aa}, [4]uint32{br, bg, bb, ba}, false
			}
		}
	}
	return 0, 0, [4]uint32{}, [4]uint32{}, true
}
