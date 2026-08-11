package videophash

import (
	"testing"
	"time"

	"github.com/stashapp/stash/pkg/ffmpeg"
	"github.com/stashapp/stash/pkg/models"
)

// PhashOptions.Native is the switch behind the "Include perceptual hashes"
// setting, and it makes two claims that have to hold together: that it chooses a
// backend, and that the choice does not change the hash. The rest of this
// package's real-file tests check the second claim at the frame level, comparing
// the images the two paths decode. This one checks both at the level the setting
// actually operates on -- Generate, the exported function the generate task and
// the GeneratePhash mutation both call -- because a switch that is wired to the
// wrong side of the fallback would pass every frame-level test in here.
//
// Run it with:
//
//	STASH_PHASH_TEST_FILES="a.mp4;b.mkv" go test ./pkg/hash/videophash/ -run PhashBackendSwitchRealFile -v -count=1
//
// -count=1 matters: these are timings, and Go will serve a cached result.

func TestPhashBackendSwitchRealFile(t *testing.T) {
	encoder := realFileEncoder(t)

	for _, path := range realFilePaths(t) {
		t.Run(shortName(path), func(t *testing.T) {
			duration, width, height := probeDurationSize(t, path)
			vf := &models.VideoFile{
				BaseFile: &models.BaseFile{Path: path},
				Duration: duration,
				Width:    width,
				Height:   height,
			}
			probePath := ffmpeg.LookPathFFProbe()

			// ffmpeg first, so the native run is the one measured on a warm file
			// cache and cannot be flattered by it.
			started := time.Now()
			reference, err := Generate(encoder, vf, PhashOptions{FFProbePath: probePath})
			if err != nil {
				t.Fatalf("ffmpeg phash: %v", err)
			}
			ffmpegTook := time.Since(started)

			started = time.Now()
			native, err := Generate(encoder, vf, PhashOptions{FFProbePath: probePath, Native: true})
			if err != nil {
				t.Fatalf("native phash: %v", err)
			}
			nativeTook := time.Since(started)

			t.Logf("%dx%d  ffmpeg %v -> %016x", width, height,
				ffmpegTook.Round(time.Millisecond), *reference)
			t.Logf("%dx%d  native %v -> %016x  (%.2fx)", width, height,
				nativeTook.Round(time.Millisecond), *native,
				ffmpegTook.Seconds()/nativeTook.Seconds())

			if *native != *reference {
				t.Errorf("native phash %016x differs from ffmpeg's %016x by %d bits — the setting is not supposed to be able to change the fingerprint",
					*native, *reference, hammingDistance(*native, *reference))
			}

			// A native run that took as long as ffmpeg's did not happen: the native
			// path declines silently by design, so an equal hash on its own cannot
			// distinguish "both backends agree" from "ffmpeg ran twice". The margin
			// is wide because this only has to catch a fallback, not measure a
			// speedup -- the smallest real gain observed is about 1.8x.
			if nativeTook > ffmpegTook {
				t.Errorf("native run took %v against ffmpeg's %v, so it probably fell back to ffmpeg — check the log for \"native phash declined\"",
					nativeTook.Round(time.Millisecond), ffmpegTook.Round(time.Millisecond))
			}
		})
	}
}
