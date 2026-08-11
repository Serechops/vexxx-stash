package nativegen

import (
	"context"
	"os"
	"testing"
	"time"
)

// TestFramesRealFile decodes exact frames from a real file.
//
// Unlike the sprite path this submits long runs of consecutive samples, which is
// what preview generation will do and what exposed both of the pump's
// asynchrony bugs — a converter asked for the next frame while still working on
// the last, and a decoder reporting a full input queue because it was busy
// rather than wedged. Neither reproduces on isolated keyframes, so this test
// exists to keep them from coming back.
//
// Opt in with:
//
//	STASH_NATIVEGEN_TEST_MP4=<path> go test ./pkg/nativegen/ -run FramesRealFile -v
//
// Set STASH_NATIVEGEN_TEST_VRMODE to exercise the reprojection, which is the
// shape a marker still asks for: the flattened view at its natural size, which
// the caller then scales to whatever width it wanted.
func TestFramesRealFile(t *testing.T) {
	path := os.Getenv("STASH_NATIVEGEN_TEST_MP4")
	if path == "" {
		t.Skip("set STASH_NATIVEGEN_TEST_MP4 to run")
	}
	if !Available() {
		t.Skip("no native hardware backend on this machine")
	}
	t.Logf("backend: %s", Describe())

	vrMode := os.Getenv("STASH_NATIVEGEN_TEST_VRMODE")
	width := 160
	if vrMode != "" {
		width = VRFlatWidth
		t.Logf("projection: %s", vrMode)
	}

	// Times deep into the file, spread widely enough that each is its own run
	// from its own keyframe. The failures appeared tens of thousands of samples
	// in, so reaching that far matters more than asking for many frames.
	const count = 25
	times := make([]float64, count)
	for i := range times {
		times[i] = 20 + float64(i)*37.5
	}

	start := time.Now()
	frames, err := Frames(context.Background(), FrameOptions{
		Path:   path,
		Times:  times,
		Width:  width,
		VRMode: vrMode,
	})
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("Frames: %v", err)
	}
	if len(frames) != count {
		t.Fatalf("got %d frames, want %d", len(frames), count)
	}
	for i, fr := range frames {
		if fr == nil {
			t.Fatalf("frame %d is missing", i)
		}
		if got := fr.Bounds().Dx(); got != width {
			t.Fatalf("frame %d is %d wide, want %d", i, got, width)
		}
	}
	size := frames[0].Bounds().Size()
	t.Logf("%d exact %dx%d frames in %v", count, size.X, size.Y, elapsed.Round(time.Millisecond))

	// VR footage is flattened into a fixed 16:9 view whatever the source's
	// shape, as it is for sprites and previews.
	if vrMode != "" && size.Y != VRFlatWidth*9/16 {
		t.Errorf("flattened frame is %d high, want %d", size.Y, VRFlatWidth*9/16)
	}

	// Frames from times this far apart are different frames. Identical output
	// would mean the decoder is handing back a stale surface, which is the
	// failure the reorder push and the pump's back-pressure handling both guard
	// against.
	if distinct := countDistinct(frames); distinct < count/2 {
		t.Errorf("only %d of %d frames are visually distinct", distinct, count)
	}
}
