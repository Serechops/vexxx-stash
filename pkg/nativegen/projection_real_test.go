package nativegen

import (
	"fmt"
	"image"
	"image/png"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/disintegration/imaging"
)

// v360Filters mirrors the filter strings in pkg/ffmpeg/transcoder/screenshot.go.
// They are duplicated rather than imported because the point of this test is to
// check the native reprojection against what ffmpeg actually does with them, so
// sharing a definition would weaken it.
var v360Filters = map[string]string{
	"LR180":      "v360=input=hequirect:output=flat:in_stereo=sbs:out_stereo=2d:d_fov=120:w=1280:h=720",
	"TB360":      "v360=input=equirect:output=flat:in_stereo=tb:out_stereo=2d:d_fov=120:w=1280:h=720",
	"MONO360":    "v360=input=equirect:output=flat:in_stereo=2d:out_stereo=2d:d_fov=120:w=1280:h=720",
	"FISHEYE190": "v360=input=fisheye:ih_fov=190:iv_fov=190:in_stereo=sbs:out_stereo=2d:output=flat:d_fov=120:w=1280:h=720",
}

// TestProjectionMatchesFFmpeg checks the reprojection against ffmpeg's v360 on a
// real frame.
//
// The projection geometry is the one part of this package that cannot be
// reasoned into correctness: a sign error in a latitude or a field of view
// confused for a half-field still produces a smooth, plausible image, just of
// the wrong part of the scene, and at tile size nobody would notice until the
// scrubber disagreed with the video. So it is checked against the filter it has
// to agree with, on a frame out of the library.
//
// Both sides are given the same decoded frame, which takes decoding and seeking
// out of the comparison and leaves only the mapping. All four modes are
// exercised regardless of which one the file is really in — the frame is just
// pixels, and ffmpeg will reproject it as whatever it is told it is.
//
// Set STASH_NATIVEGEN_TEST_VR to a video file to run it, and
// STASH_NATIVEGEN_TEST_OUT to a directory to keep the images for inspection.
func TestProjectionMatchesFFmpeg(t *testing.T) {
	path := os.Getenv("STASH_NATIVEGEN_TEST_VR")
	if path == "" {
		t.Skip("set STASH_NATIVEGEN_TEST_VR to a VR video file to run this test")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is not on PATH")
	}

	tmp := t.TempDir()
	framePath := filepath.Join(tmp, "frame.png")
	runFFmpeg(t, "-ss", "60", "-i", path, "-frames:v", "1", framePath)

	frame := loadPNG(t, framePath)
	t.Logf("source frame %dx%d", frame.Bounds().Dx(), frame.Bounds().Dy())

	const tileWidth = 320
	outW, outH := vrTileSize(tileWidth)

	// Renders keyed by mode, kept so that each ground truth can afterwards be
	// compared against the other modes' output as well as its own.
	got := make(map[string]*image.RGBA, len(v360Filters))
	want := make(map[string]*image.RGBA, len(v360Filters))

	for mode, filter := range v360Filters {
		truthPath := filepath.Join(tmp, mode+"-ffmpeg.png")
		runFFmpeg(t, "-i", framePath, "-vf", filter+fmt.Sprintf(",scale=%d:-2", tileWidth), truthPath)
		want[mode] = loadPNG(t, truthPath)

		rm, err := newRemapper(mode, frame.Bounds().Dx(), frame.Bounds().Dy(), outW, outH)
		if err != nil {
			t.Fatalf("newRemapper(%s): %v", mode, err)
		}

		// Stand in for the scaling the decoder would have done on the GPU.
		srcW, srcH := rm.srcSize()
		scaled := toRGBA(imaging.Resize(frame, srcW, srcH, imaging.Lanczos))

		tile, err := rm.remap(scaled)
		if err != nil {
			t.Fatalf("remap(%s): %v", mode, err)
		}
		got[mode] = tile

		if b := want[mode].Bounds(); b.Dx() != outW || b.Dy() != outH {
			t.Errorf("%s: ffmpeg produced a %dx%d tile, native produced %dx%d",
				mode, b.Dx(), b.Dy(), outW, outH)
		}
		t.Logf("%s: decoder asked for %dx%d, tile %dx%d", mode, srcW, srcH, outW, outH)
	}

	if out := os.Getenv("STASH_NATIVEGEN_TEST_OUT"); out != "" {
		for mode := range v360Filters {
			savePNG(t, filepath.Join(out, "vr-"+mode+"-ffmpeg.png"), want[mode])
			savePNG(t, filepath.Join(out, "vr-"+mode+"-native.png"), got[mode])
		}
		t.Logf("wrote tiles to %s", out)
	}

	// A tile is a heavy reduction of a compressed frame through two different
	// scalers, so the two renders are never identical. What matters is that the
	// difference is at the level of resampling rather than of geometry, and the
	// cross-comparison below is what establishes the scale for that: it is the
	// error from rendering the *wrong* projection, which is what a sign error or
	// a mistaken field of view would look like.
	const maxRMSE = 12.0

	for mode := range v360Filters {
		self := rmse(t, want[mode], got[mode])
		t.Logf("%-11s RMSE vs ffmpeg: %6.2f", mode, self)

		if self > maxRMSE {
			t.Errorf("%s: native reprojection differs from ffmpeg by RMSE %.2f, over the %.0f allowed",
				mode, self, maxRMSE)
		}

		for other := range v360Filters {
			if other == mode {
				continue
			}
			cross := rmse(t, want[mode], got[other])
			if cross <= self {
				t.Errorf("%s: rendering it as %s matches ffmpeg's %s at least as well (RMSE %.2f vs %.2f); "+
					"the test cannot tell the projections apart, so it is not proving anything",
					mode, other, mode, cross, self)
			}
		}
	}
}

// rmse is the root mean squared difference over the colour channels, in levels
// out of 255.
func rmse(t *testing.T, a, b *image.RGBA) float64 {
	t.Helper()
	if a.Bounds() != b.Bounds() {
		t.Fatalf("comparing a %v image with a %v one", a.Bounds(), b.Bounds())
	}

	var sum float64
	var n int
	for i := 0; i < len(a.Pix); i += 4 {
		for c := 0; c < 3; c++ {
			d := float64(a.Pix[i+c]) - float64(b.Pix[i+c])
			sum += d * d
			n++
		}
	}
	return math.Sqrt(sum / float64(n))
}

func runFFmpeg(t *testing.T, args ...string) {
	t.Helper()
	full := append([]string{"-loglevel", "error", "-y"}, args...)
	out, err := exec.Command("ffmpeg", full...).CombinedOutput()
	if err != nil {
		t.Fatalf("ffmpeg %v: %v\n%s", full, err, out)
	}
}

func loadPNG(t *testing.T, path string) *image.RGBA {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("opening %s: %v", path, err)
	}
	defer f.Close()

	img, err := png.Decode(f)
	if err != nil {
		t.Fatalf("decoding %s: %v", path, err)
	}
	return toRGBA(img)
}

func toRGBA(img image.Image) *image.RGBA {
	if r, ok := img.(*image.RGBA); ok && r.Bounds().Min == (image.Point{}) {
		return r
	}
	b := img.Bounds()
	out := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			out.Set(x, y, img.At(b.Min.X+x, b.Min.Y+y))
		}
	}
	return out
}

func savePNG(t *testing.T, path string, img image.Image) {
	t.Helper()
	if err := imaging.Save(img, path); err != nil {
		t.Fatalf("saving %s: %v", path, err)
	}
}
