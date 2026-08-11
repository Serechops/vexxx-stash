package videophash

import (
	"context"
	"fmt"
	"image"
	"os/exec"
	"strconv"
	"strings"
	"testing"

	"github.com/stashapp/stash/pkg/nativegen/container/mp4"
)

// Both phash backends are supposed to land on the same frame: ffmpeg because
// -noaccurate_seek stops at the keyframe at or before the target, nativegen
// because SyncAtOrBefore picks that same keyframe out of the sync sample table.
// If they disagree the hash depends on which backend ran, which defeats the
// point, and a hash distance cannot tell that apart from a scaling difference.
//
// So ask each one directly which frame it chose, per target, and print both
// times side by side. This is the diagnostic that says whether a mismatch is a
// frame-selection bug or a pixel bug.
//
//	STASH_PHASH_TEST_FILES="a.mp4" go test ./pkg/hash/videophash/ -run KeyframeAgreement -v
func TestPhashKeyframeAgreementRealFile(t *testing.T) {
	ffmpegPath := realFileEncoder(t).Path()

	for _, path := range realFilePaths(t) {
		t.Run(shortName(path), func(t *testing.T) {
			duration, _, _ := probeDurationSize(t, path)
			times := spriteTimes(duration)

			f, err := mp4.Open(path)
			if err != nil {
				t.Skipf("not an mp4 this parser handles: %v", err)
			}
			defer f.Close()

			track := f.Video()
			if track == nil {
				t.Skip("no video track")
			}

			t.Logf("track: timescale %d, duration %.3fs (ffprobe says %.3fs), %d samples",
				track.Timescale, track.DurationSeconds(), duration, len(track.Samples))
			t.Logf("%3s %10s %10s %10s %10s %s", "i", "target", "native", "ffmpeg", "delta", "")

			mismatched := 0
			for i, target := range times {
				sample := track.SyncAtOrBefore(target)
				native := track.SampleTime(sample)

				got, err := ffmpegSeekLandsOn(ffmpegPath, path, target)
				if err != nil {
					t.Fatalf("probing ffmpeg's frame for %.3f: %v", target, err)
				}

				delta := native - got
				flag := ""
				// A frame time is only meaningful to within one frame interval.
				if delta > 0.001 || delta < -0.001 {
					flag = "  <-- MISMATCH"
					mismatched++
				}
				t.Logf("%3d %10.3f %10.3f %10.3f %10.3f%s", i, target, native, got, delta, flag)
			}

			if mismatched > 0 {
				t.Errorf("%d of %d targets resolve to different frames in the two backends",
					mismatched, len(times))
			}
		})
	}
}

// ffmpegSeekLandsOn returns the presentation time of the frame ffmpeg produces
// for the seek the phash path performs.
//
// This asks ffmpeg rather than ffprobe deliberately: the arguments are the ones
// generateSpriteScreenshot uses, so the answer is the frame the phash actually
// hashes and not another tool's interpretation of the same request. showinfo
// prints the timestamp to stderr; -f null discards the frame itself.
func ffmpegSeekLandsOn(ffmpegPath, path string, target float64) (float64, error) {
	cmd := exec.CommandContext(context.Background(), ffmpegPath,
		"-loglevel", "info",
		"-ss", strconv.FormatFloat(target, 'f', 6, 64),
		"-noaccurate_seek",
		// Without -copyts the reported timestamp is rebased onto the seek target,
		// so a correct keyframe reads as a negative number and every row looks
		// like a mismatch. This asks for the frame's own time.
		"-copyts",
		"-i", path,
		"-frames:v", "1",
		"-vf", "showinfo",
		"-f", "null",
		"-",
	)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return 0, fmt.Errorf("%v (%s)", err, lastLines(stderr.String(), 3))
	}

	// showinfo writes lines like: [Parsed_showinfo_0 @ ...] n:0 pts:123 pts_time:4.1
	for _, line := range strings.Split(stderr.String(), "\n") {
		i := strings.Index(line, "pts_time:")
		if i < 0 {
			continue
		}
		field := line[i+len("pts_time:"):]
		if j := strings.IndexAny(field, " \t"); j >= 0 {
			field = field[:j]
		}
		return strconv.ParseFloat(strings.TrimSpace(field), 64)
	}
	return 0, fmt.Errorf("showinfo reported no frame for %.3f (%s)", target, lastLines(stderr.String(), 3))
}

func lastLines(s string, n int) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, " | ")
}

// TestPhashSingleFrameProvenanceRealFile answers "which frame did each backend
// actually hash" for one timestamp, by putting all four candidates side by side.
//
// A hash distance cannot distinguish "wrong frame" from "same frame, different
// pixels", and the two have nothing to do with each other. Comparing one tile
// against ffmpeg's exact frame at the target and its exact frame at the keyframe
// says which of those each backend produced, with no inference in between.
func TestPhashSingleFrameProvenanceRealFile(t *testing.T) {
	encoder := realFileEncoder(t)

	for _, path := range realFilePaths(t) {
		t.Run(shortName(path), func(t *testing.T) {
			duration, _, _ := probeDurationSize(t, path)
			target := spriteTimes(duration)[0]

			f, err := mp4.Open(path)
			if err != nil {
				t.Skipf("not an mp4 this parser handles: %v", err)
			}
			defer f.Close()
			track := f.Video()

			sample := track.SyncAtOrBefore(target)
			kfTime := track.SampleTime(sample)
			t.Logf("target %.3fs, keyframe at %.3fs (sample %d), %.3fs apart",
				target, kfTime, sample, target-kfTime)

			exactAtTarget, err := ffmpegScreenshotVR(encoder, path, target, "")
			if err != nil {
				t.Fatalf("ffmpeg exact at target: %v", err)
			}
			exactAtKeyframe, err := ffmpegScreenshotVR(encoder, path, kfTime, "")
			if err != nil {
				t.Fatalf("ffmpeg exact at keyframe: %v", err)
			}
			snapped, err := ffmpegScreenshotKeyframe(encoder, path, target, "")
			if err != nil {
				t.Fatalf("ffmpeg noaccurate_seek: %v", err)
			}
			nativeFrames, err := nativePhashFrames(t, encoder, path, []float64{target})
			if err != nil {
				t.Fatalf("native: %v", err)
			}

			refs := []struct {
				name string
				img  image.Image
			}{
				{"ffmpeg exact @ target  ", exactAtTarget},
				{"ffmpeg exact @ keyframe", exactAtKeyframe},
			}
			for _, got := range []struct {
				name string
				img  image.Image
			}{
				{"ffmpeg -noaccurate_seek", snapped},
				{"nativegen             ", nativeFrames[0]},
			} {
				var parts []string
				for _, ref := range refs {
					// maxAbsDiff returns -1 for mismatched bounds, and -1/257 is
					// 0, so the raw value is printed rather than a scaled one: a
					// bounds mismatch must not be able to read as a perfect match.
					raw := maxAbsDiff(ref.img, got.img)
					parts = append(parts, fmt.Sprintf("%s: max %6d mean %6.1f",
						ref.name, raw, meanAbsDiff(ref.img, got.img)))
				}
				t.Logf("%s %v  vs  %s", got.name, got.img.Bounds().Size(),
					strings.Join(parts, "   "))
			}
		})
	}
}

// meanAbsDiff returns the average per-channel difference between two images, or
// -1 if their bounds do not match. A max says how bad the worst pixel is; a mean
// says whether the whole image moved or only part of it did.
func meanAbsDiff(a, b image.Image) float64 {
	ab, bb := a.Bounds(), b.Bounds()
	if ab.Dx() != bb.Dx() || ab.Dy() != bb.Dy() {
		return -1
	}

	var total, n int64
	for y := 0; y < ab.Dy(); y++ {
		for x := 0; x < ab.Dx(); x++ {
			ar, ag, abl, _ := a.At(ab.Min.X+x, ab.Min.Y+y).RGBA()
			br, bg, bbl, _ := b.At(bb.Min.X+x, bb.Min.Y+y).RGBA()
			for _, d := range []int64{
				int64(ar) - int64(br), int64(ag) - int64(bg), int64(abl) - int64(bbl),
			} {
				if d < 0 {
					d = -d
				}
				total += d
				n++
			}
		}
	}
	if n == 0 {
		return 0
	}
	return float64(total) / float64(n) / 257
}
