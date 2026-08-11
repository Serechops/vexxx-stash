package videophash

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/corona10/goimagehash"
	"github.com/stashapp/stash/pkg/ffmpeg"
	"github.com/stashapp/stash/pkg/ffmpeg/transcoder"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/nativegen/container"
	"github.com/stashapp/stash/pkg/nativegen/container/mp4"
)

// The VR phash has three independent ways to disagree with the hash upstream
// stash and stash-box compute, and until now they have only ever been measured
// together as one "up to 4 bits". Added together they are indistinguishable, and
// the three have completely different remedies, so this test takes them apart:
//
//	frame choice   nearest keyframe instead of the exact frame, up to half a
//	               GOP away in time
//	scaler         AMF's converter, or a swscale call over a stacked strip,
//	               instead of a per-frame swscale
//	reprojection   the native VR path remaps to a rectilinear view; every
//	               ffmpeg path in this package hashes the raw equirect frame
//
// Each is isolated by holding the other two fixed, so the output says which one
// to spend effort on rather than that the total is nonzero.
//
// It also reports the frame-exact decode budget, which is the number that
// explains the runtime: a frame-exact phash has to decode every frame from each
// of the twenty-five targets' preceding keyframe, and on a long-GOP 8K file that
// is thousands of full-resolution frames.
//
// Run it with:
//
//	STASH_PHASH_TEST_FILES="vr.mp4" STASH_PHASH_TEST_VRMODE=LR180 \
//	  go test ./pkg/hash/videophash/ -run VRPhashDecomposition -v -timeout 30m
//
// -short omits the two frame-exact variants, which are the slow ones.
func TestVRPhashDecompositionRealFile(t *testing.T) {
	encoder := realFileEncoder(t)

	// Optional: naming the projection adds the reprojected reference, which is
	// the variant that says what dropping reprojection was worth. Flat files have
	// no such variant and run the rest.
	vrMode := os.Getenv("STASH_PHASH_TEST_VRMODE")

	for _, path := range realFilePaths(t) {
		t.Run(shortName(path), func(t *testing.T) {
			duration, width, height := probeDurationSize(t, path)
			times := spriteTimes(duration)
			t.Logf("%dx%d, %.0fs, VR mode %s", width, height, duration, vrMode)

			reportDecodeBudget(t, path, times)

			type variant struct {
				name   string
				slow   bool
				frames func() ([]image.Image, error)
			}

			variants := []variant{
				// The reference: what upstream stash stores and what stash-box
				// holds for this file. No reprojection, exact frames, one
				// swscale per frame.
				{"A ffmpeg exact, flat      (reference)", true, func() ([]image.Image, error) {
					return ffmpegFrames(encoder, path, times, "", true)
				}},
				// Frame choice, and nothing else: same scaler, same absence of
				// reprojection, but seeking to the keyframe at or before each
				// target rather than decoding forward to the exact frame.
				{"B ffmpeg keyframe, flat", false, func() ([]image.Image, error) {
					return ffmpegFrames(encoder, path, times, "", false)
				}},
				// What production ships: keyframe-snapped, not reprojected,
				// scaled by swscale through the pipe. Should agree with B
				// exactly, and any difference from it is the native path's
				// alone.
				{"D native keyframe, flat  (production)", false, func() ([]image.Image, error) {
					return nativePhashFrames(t, encoder, path, times)
				}},
			}

			// Reprojection, and nothing else: exact frames, ffmpeg's own scaler,
			// but through v360 the way the sprite path does it. Only meaningful
			// when the footage really is in that projection.
			if vrMode != "" {
				variants = append(variants, variant{"C ffmpeg exact, reprojected", true,
					func() ([]image.Image, error) {
						return ffmpegFrames(encoder, path, times, vrMode, true)
					}})
			}

			hashes := map[byte]uint64{}
			tiles := map[byte][]image.Image{}

			for _, v := range variants {
				if v.slow && testing.Short() {
					t.Logf("%-38s skipped (-short)", v.name)
					continue
				}

				start := time.Now()
				imgs, err := v.frames()
				elapsed := time.Since(start)
				if err != nil {
					t.Logf("%-38s FAILED after %v: %v", v.name, elapsed.Round(time.Millisecond), err)
					continue
				}
				if len(imgs) == 0 {
					t.Logf("%-38s produced no frames", v.name)
					continue
				}

				h, err := goimagehash.PerceptionHash(combineImages(imgs))
				if err != nil {
					t.Fatalf("%s: hashing montage: %v", v.name, err)
				}

				b := v.name[0]
				hashes[b] = h.GetHash()
				tiles[b] = imgs

				// A hash distance says two montages differ; only the montages say
				// why. Set STASH_PHASH_TEST_OUT to a directory to get them.
				if out := os.Getenv("STASH_PHASH_TEST_OUT"); out != "" {
					dumpMontage(t, out, fmt.Sprintf("%s_%c.png", shortName(path), b), imgs)
				}

				t.Logf("%-38s %8v  %016x  (tile %dx%d)", v.name,
					elapsed.Round(time.Millisecond), h.GetHash(),
					imgs[0].Bounds().Dx(), imgs[0].Bounds().Dy())
			}

			// Each comparison changes exactly one thing from the reference, so a
			// nonzero distance names its own cause.
			for _, cmp := range []struct {
				from, to byte
				what     string
			}{
				{'A', 'B', "frame choice   (what snapping would cost)"},
				{'A', 'C', "reprojection   (v360 alone, why it was dropped)"},
				{'A', 'D', "native vs the reference -- MUST be 0"},
			} {
				a, aok := hashes[cmp.from]
				b, bok := hashes[cmp.to]
				if !aok || !bok {
					continue
				}
				t.Logf("%c -> %c  %-46s %2d bits", cmp.from, cmp.to, cmp.what, hammingDistance(a, b))
			}

			// The design rests on this one. The native path takes the same frames
			// as the reference and lets swscale do the same reduction, so it must
			// land on the reference's value exactly -- that is what makes the hash
			// comparable with stash-box and independent of the machine that ran it.
			if ref, ok := hashes['A']; ok {
				if native, ok := hashes['D']; ok {
					if d := hammingDistance(ref, native); d != 0 {
						t.Errorf("native differs from the ffmpeg reference by %d bits: %016x vs %016x",
							d, ref, native)
					}
				}
			}

			// Where the pixels differ matters as much as whether they do, so
			// compare the two paths that took the same frames. A scaler run over
			// a stacked strip pulls neighbouring tiles into the rows at each
			// join; a per-frame one cannot.
			if ref, ok := tiles['A']; ok {
				if got, ok := tiles['D']; ok && len(got) == len(ref) {
					reportSeamBleed(t, ref, got)
				}
			}
		})
	}
}

// reportDecodeBudget says how many frames a frame-exact phash has to decode, and
// how many a keyframe-snapped one does. The ratio between them is the entire
// speed argument, and it is a property of the file's GOP length rather than of
// the hardware.
func reportDecodeBudget(t *testing.T, path string, times []float64) {
	t.Helper()

	f, err := mp4.Open(path)
	if err != nil {
		t.Logf("container stats unavailable (%v)", err)
		return
	}
	defer f.Close()

	track := f.Video()
	if track == nil {
		t.Logf("container stats unavailable (no video track)")
		return
	}

	syncs := track.SyncSamples()
	total := len(track.Samples)
	if total == 0 || len(syncs) == 0 {
		t.Logf("container stats unavailable (%d samples, %d keyframes)", total, len(syncs))
		return
	}

	dur := track.DurationSeconds()
	fps := float64(total) / dur

	// Frames from each target's preceding keyframe up to and including the
	// target: what a frame-exact decode must push through the decoder.
	budget := 0
	worst := 0
	for _, ts := range times {
		target := sampleAtOrAfter(track, ts)
		from := track.SyncAtOrBefore(track.SampleTime(target))
		if from < 0 || from > target {
			continue
		}
		n := target - from + 1
		budget += n
		if n > worst {
			worst = n
		}
	}

	t.Logf("container: %s, %d samples, %d keyframes, %.2f fps, mean GOP %.1f frames (%.2fs)",
		track.Codec, total, len(syncs), fps,
		float64(total)/float64(len(syncs)), dur/float64(len(syncs)))
	t.Logf("decode budget: frame-exact %d frames (worst single target %d), keyframe-snapped %d frames — %.0fx",
		budget, worst, len(times), float64(budget)/float64(len(times)))
}

// sampleAtOrAfter returns the index of the first sample presented at or after
// the given time, which is the frame ffmpeg's accurate seek lands on.
func sampleAtOrAfter(track *container.VideoTrack, seconds float64) int {
	last := len(track.Samples) - 1
	for i := 0; i <= last; i++ {
		if track.SampleTime(i) >= seconds {
			return i
		}
	}
	return last
}

// ffmpegFrames takes the twenty-five frames with ffmpeg, one process each so
// that nothing about batching or stacking enters the comparison.
//
// accurate selects between decoding forward to the exact frame and stopping at
// the keyframe at or before the target. The keyframe form is not a concession
// ffmpeg makes reluctantly: -noaccurate_seek skips the forward decode entirely,
// so it is as cheap for ffmpeg as it is for the native path.
func ffmpegFrames(encoder *ffmpeg.FFMpeg, path string, times []float64, vrMode string, accurate bool) ([]image.Image, error) {
	images := make([]image.Image, 0, len(times))

	for _, ts := range times {
		var img image.Image
		var err error
		if accurate {
			img, err = ffmpegScreenshotVR(encoder, path, ts, vrMode)
		} else {
			img, err = ffmpegScreenshotKeyframe(encoder, path, ts, vrMode)
		}
		if err != nil {
			return nil, fmt.Errorf("at %.3f: %w", ts, err)
		}
		images = append(images, img)
	}

	return images, nil
}

func ffmpegScreenshotVR(encoder *ffmpeg.FFMpeg, path string, ts float64, vrMode string) (image.Image, error) {
	args := transcoder.ScreenshotTime(path, ts, transcoder.ScreenshotOptions{
		Width:      screenshotSize,
		OutputPath: "-",
		OutputType: transcoder.ScreenshotOutputTypeBMP,
		VRMode:     vrMode,
	})
	return decodeScreenshot(encoder, args)
}

// ffmpegScreenshotKeyframe takes the keyframe at or before ts, which production
// no longer does -- it is kept as the measurement of what snapping would cost.
//
// -copyts is the part that is easy to get wrong. Without it an input seek rebases
// output timestamps onto the seek target, the keyframe lands at a negative
// timestamp, the output stage drops it as preceding the stream, and -frames:v 1
// returns the first survivor: a frame near the target that is neither the
// keyframe nor the exact frame. showinfo does not show this, because it sits in
// the filter graph upstream of where the dropping happens.
func ffmpegScreenshotKeyframe(encoder *ffmpeg.FFMpeg, path string, ts float64, vrMode string) (image.Image, error) {
	var args ffmpeg.Args
	args = args.LogLevel(ffmpeg.LogLevelError)
	args = args.Overwrite()
	args = args.Seek(ts)
	args = append(args, "-noaccurate_seek", "-copyts")
	args = args.Input(path)
	args = args.VideoFrames(1)

	var vf ffmpeg.VideoFilter
	if f := vrFilter(vrMode); f != "" {
		vf = vf.Append(f)
	}
	vf = vf.ScaleWidth(screenshotSize)
	args = args.VideoFilter(vf)

	args = args.AppendArgs(transcoder.ScreenshotOutputTypeBMP)
	args = args.Output("-")

	return decodeScreenshot(encoder, args)
}

// vrFilter repeats the v360 invocations ScreenshotTime uses, because they are
// written inline there and a copy that drifts would silently invalidate the
// reprojection comparison. Kept here only for the keyframe variant, which has to
// build its own argument list.
func vrFilter(vrMode string) string {
	switch vrMode {
	case "LR180":
		return "v360=input=hequirect:output=flat:in_stereo=sbs:out_stereo=2d:d_fov=120:w=1280:h=720"
	case "TB360":
		return "v360=input=equirect:output=flat:in_stereo=tb:out_stereo=2d:d_fov=120:w=1280:h=720"
	case "MONO360":
		return "v360=input=equirect:output=flat:in_stereo=2d:out_stereo=2d:d_fov=120:w=1280:h=720"
	case "FISHEYE190":
		return "v360=input=fisheye:ih_fov=190:iv_fov=190:in_stereo=sbs:out_stereo=2d:output=flat:d_fov=120:w=1280:h=720"
	}
	return ""
}

func decodeScreenshot(encoder *ffmpeg.FFMpeg, args ffmpeg.Args) (image.Image, error) {
	data, err := encoder.GenerateOutput(context.Background(), args, nil)
	if err != nil {
		return nil, err
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decoding image: %w", err)
	}
	return img, nil
}

// reportSeamBleed compares the outer rows of each tile against its interior. A
// per-frame scaler cannot tell the difference between the two; a scaler run over
// a stacked strip pulls neighbouring tiles' pixels into the rows at the join, so
// a much larger error at the edges than in the middle is that and not content.
func reportSeamBleed(t *testing.T, ref, got []image.Image) {
	t.Helper()

	const band = 2
	var edge, interior int
	var worstTiles []string
	for i := range ref {
		e, in := edgeVsInterior(ref[i], got[i], band)
		if e > edge {
			edge = e
		}
		if in > interior {
			interior = in
		}
		// Which tiles differ, and whether it is all of them, separates a global
		// pixel-format problem from a handful of misplaced frames.
		if in > 8*257 {
			worstTiles = append(worstTiles, fmt.Sprintf("%d:%d", i, in/257))
		}
	}
	if len(worstTiles) > 0 {
		t.Logf("tiles differing by more than 8/255 in their interior (tile:worst): %s",
			strings.Join(worstTiles, " "))
	} else {
		t.Logf("every tile agrees to within 8/255 in its interior")
	}

	t.Logf("native-vs-ffmpeg pixels: worst %d rows from a tile join %d/255, tile interior %d/255",
		band, edge/257, interior/257)
	if edge > 0 && interior == 0 {
		t.Logf("  -> error is confined to the joins: the stacked-strip scale is bleeding between tiles")
	}
}

// edgeVsInterior returns the worst per-channel difference within band rows of
// the top or bottom of the tile, and the worst outside that.
func edgeVsInterior(a, b image.Image, band int) (edge, interior int) {
	ab, bb := a.Bounds(), b.Bounds()
	if ab.Dx() != bb.Dx() || ab.Dy() != bb.Dy() {
		return -1, -1
	}

	for y := 0; y < ab.Dy(); y++ {
		isEdge := y < band || y >= ab.Dy()-band
		for x := 0; x < ab.Dx(); x++ {
			ar, ag, abl, aa := a.At(ab.Min.X+x, ab.Min.Y+y).RGBA()
			br, bg, bbl, ba := b.At(bb.Min.X+x, bb.Min.Y+y).RGBA()
			for _, d := range []int{
				int(ar) - int(br), int(ag) - int(bg),
				int(abl) - int(bbl), int(aa) - int(ba),
			} {
				if d < 0 {
					d = -d
				}
				if isEdge {
					if d > edge {
						edge = d
					}
				} else if d > interior {
					interior = d
				}
			}
		}
	}
	return edge, interior
}

// dumpMontage writes the 5x5 montage a variant produced, which is the image the
// hash is actually computed from.
func dumpMontage(t *testing.T, dir, name string, imgs []image.Image) {
	t.Helper()

	path := filepath.Join(dir, name)
	f, err := os.Create(path)
	if err != nil {
		t.Logf("writing %s: %v", path, err)
		return
	}
	defer f.Close()

	if err := png.Encode(f, combineImages(imgs)); err != nil {
		t.Logf("encoding %s: %v", path, err)
		return
	}
	t.Logf("  wrote %s", path)
}

func hammingDistance(a, b uint64) int {
	x := a ^ b
	n := 0
	for ; x != 0; x &= x - 1 {
		n++
	}
	return n
}

// nativePhashFrames runs the production native path, colour probe included.
//
// It goes through tryNativePhash rather than calling nativegen directly so that
// the test cannot pass while production is misconfigured -- the colour tags are
// resolved here exactly as they are for a real scan.
func nativePhashFrames(t *testing.T, encoder *ffmpeg.FFMpeg, path string, times []float64) ([]image.Image, error) {
	t.Helper()

	_, w, h := probeDurationSize(t, path)
	vf := &models.VideoFile{
		BaseFile: &models.BaseFile{Path: path},
		Width:    w,
		Height:   h,
	}
	return tryNativePhash(encoder, vf, times, ffmpeg.LookPathFFProbe())
}
