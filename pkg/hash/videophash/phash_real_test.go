package videophash

import (
	"fmt"
	"image"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/corona10/goimagehash"
	"github.com/stashapp/stash/pkg/ffmpeg"
)

// The batched sprite is only worth having if it produces the same hash as the
// per-frame one. A phash is stored, compared against the rest of the library,
// and submitted to stash-box, so a generator that is merely close is a
// regression however fast it is. These tests run against real media because
// that is the only place the question can be answered.
//
// Run them with:
//
//	STASH_PHASH_TEST_FILES="a.mp4;b.mkv" go test ./pkg/hash/videophash/ -run RealFile -v
//
// Set STASH_FFMPEG_PATH if ffmpeg is not on PATH.

func realFileEncoder(t *testing.T) *ffmpeg.FFMpeg {
	t.Helper()

	path := os.Getenv("STASH_FFMPEG_PATH")
	if path == "" {
		path = ffmpeg.LookPathFFMpeg()
	}
	if path == "" {
		t.Skip("ffmpeg not found; set STASH_FFMPEG_PATH")
	}

	return ffmpeg.NewEncoder(path)
}

func realFilePaths(t *testing.T) []string {
	t.Helper()

	spec := os.Getenv("STASH_PHASH_TEST_FILES")
	if spec == "" {
		t.Skip("set STASH_PHASH_TEST_FILES to a ;-separated list of video files")
	}

	var paths []string
	for _, p := range strings.Split(spec, ";") {
		if p = strings.TrimSpace(p); p != "" {
			paths = append(paths, p)
		}
	}
	return paths
}

// spriteTimes is the timestamp series generateSprite uses, restated so the
// tests can drive both paths over identical inputs.
func spriteTimes(duration float64) []float64 {
	chunkCount := columns * rows
	offset := 0.05 * duration
	stepSize := (0.9 * duration) / float64(chunkCount)

	times := make([]float64, chunkCount)
	for i := range times {
		times[i] = offset + float64(i)*stepSize
	}
	return times
}

func probeDurationSize(t *testing.T, path string) (float64, int, int) {
	t.Helper()

	probe := ffmpeg.NewFFProbe(ffmpeg.LookPathFFProbe())
	vf, err := probe.NewVideoFile(path)
	if err != nil {
		t.Fatalf("probing %s: %v", path, err)
	}
	return vf.FileDuration, vf.Width, vf.Height
}

// TestBatchedSpriteMatchesPerFrameRealFile is the one that matters: same file,
// both paths, and the hashes must be equal, not close.
func TestBatchedSpriteMatchesPerFrameRealFile(t *testing.T) {
	encoder := realFileEncoder(t)

	for _, path := range realFilePaths(t) {
		t.Run(shortName(path), func(t *testing.T) {
			duration, width, height := probeDurationSize(t, path)
			times := spriteTimes(duration)
			batch := batchSizeFor(width, height)

			t.Logf("%dx%d, %.0fs, batch size %d", width, height, duration, batch)

			start := time.Now()
			var perFrame []image.Image
			for _, ts := range times {
				img, err := generateSpriteScreenshot(encoder, path, ts)
				if err != nil {
					t.Fatalf("per-frame screenshot at %.3f: %v", ts, err)
				}
				perFrame = append(perFrame, img)
			}
			perFrameTime := time.Since(start)

			start = time.Now()
			batched, err := generateSpriteScreenshots(encoder, path, times, batch)
			if err != nil {
				t.Fatalf("batched screenshots: %v", err)
			}
			batchedTime := time.Since(start)

			if len(batched) != len(perFrame) {
				t.Fatalf("batched returned %d frames, per-frame returned %d", len(batched), len(perFrame))
			}

			// Compare the frames before the hash: if they differ, knowing which
			// frame and by how much is the difference between a seek bug and a
			// scaler difference.
			for i := range perFrame {
				if diff := maxAbsDiff(perFrame[i], batched[i]); diff != 0 {
					t.Errorf("frame %d (t=%.3f) differs, max channel difference %d", i, times[i], diff)
				}
			}

			perFrameHash, err := goimagehash.PerceptionHash(combineImages(perFrame))
			if err != nil {
				t.Fatalf("hashing per-frame montage: %v", err)
			}
			batchedHash, err := goimagehash.PerceptionHash(combineImages(batched))
			if err != nil {
				t.Fatalf("hashing batched montage: %v", err)
			}

			distance, err := perFrameHash.Distance(batchedHash)
			if err != nil {
				t.Fatalf("comparing hashes: %v", err)
			}

			t.Logf("per-frame %v -> %016x", perFrameTime.Round(time.Millisecond), perFrameHash.GetHash())
			t.Logf("batched   %v -> %016x  (%.2fx)", batchedTime.Round(time.Millisecond), batchedHash.GetHash(),
				float64(perFrameTime)/float64(batchedTime))

			if distance != 0 {
				t.Errorf("hashes differ by %d bits: %016x vs %016x",
					distance, perFrameHash.GetHash(), batchedHash.GetHash())
			}
		})
	}
}

// TestBatchSizeSweepRealFile reports what each batch size costs, so the pixel
// budget can be re-derived rather than guessed at when hardware changes.
func TestBatchSizeSweepRealFile(t *testing.T) {
	if testing.Short() {
		t.Skip("sweep is slow")
	}

	encoder := realFileEncoder(t)

	for _, path := range realFilePaths(t) {
		t.Run(shortName(path), func(t *testing.T) {
			duration, width, height := probeDurationSize(t, path)
			_ = encoder // probes are separate from the encoder used for screenshots
			times := spriteTimes(duration)
			t.Logf("%dx%d, %.0fs", width, height, duration)

			for _, batch := range []int{1, 3, 5, 8, 13, 25} {
				start := time.Now()
				if _, err := generateSpriteScreenshots(encoder, path, times, batch); err != nil {
					t.Fatalf("batch %d: %v", batch, err)
				}
				t.Logf("batch %2d: %v", batch, time.Since(start).Round(time.Millisecond))
			}
		})
	}
}

// maxAbsDiff returns the largest per-channel difference between two images, or
// -1 if their bounds do not match.
func maxAbsDiff(a, b image.Image) int {
	ab, bb := a.Bounds(), b.Bounds()
	if ab.Dx() != bb.Dx() || ab.Dy() != bb.Dy() {
		return -1
	}

	var worst int
	for y := 0; y < ab.Dy(); y++ {
		for x := 0; x < ab.Dx(); x++ {
			ar, ag, ablue, aa := a.At(ab.Min.X+x, ab.Min.Y+y).RGBA()
			br, bg, bblue, ba := b.At(bb.Min.X+x, bb.Min.Y+y).RGBA()
			for _, d := range []int{
				int(ar) - int(br), int(ag) - int(bg),
				int(ablue) - int(bblue), int(aa) - int(ba),
			} {
				if d < 0 {
					d = -d
				}
				if d > worst {
					worst = d
				}
			}
		}
	}
	return worst
}

func shortName(path string) string {
	path = strings.ReplaceAll(path, "\\", "/")
	if i := strings.LastIndex(path, "/"); i >= 0 {
		path = path[i+1:]
	}
	return strings.NewReplacer(" ", "_", "/", "_").Replace(fmt.Sprintf("%.40s", path))
}
