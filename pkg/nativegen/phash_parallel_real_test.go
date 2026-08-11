package nativegen

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stashapp/stash/pkg/nativegen/container/mp4"
)

// Splitting the phash walk across both decode engines paid for itself on one real
// file and did nothing on another, which means the engine is not always what the
// walk is waiting for. This says which part it is waiting for, by timing the
// pieces separately on the same targets:
//
//   - how the budget divides between the groups, since a split that hands one
//     group most of the frames cannot go faster than that group
//   - reading the samples with no decoding at all, which is the disk's share
//   - the whole walk on one decoder and then on two
//
//	STASH_NATIVEGEN_TEST_MP4="vr.mp4" go test ./pkg/nativegen/ -run PhashParallelBreakdown -v -timeout 30m
func TestPhashParallelBreakdownRealFile(t *testing.T) {
	path := os.Getenv("STASH_NATIVEGEN_TEST_MP4")
	if path == "" {
		t.Skip("set STASH_NATIVEGEN_TEST_MP4 to a video file")
	}

	f, err := mp4.Open(path)
	if err != nil {
		t.Fatalf("opening %s: %v", path, err)
	}
	defer f.Close()

	track := f.Video()
	if track == nil {
		t.Fatal("no video track")
	}

	duration := float64(track.Samples[len(track.Samples)-1].PTS) / float64(track.Timescale)
	times := PhashTimes(duration)

	wanted, err := samplesAt(track, times)
	if err != nil {
		t.Fatalf("resolving times: %v", err)
	}

	t.Logf("%dx%d, %d samples, %d keyframes", track.Width, track.Height,
		len(track.Samples), len(track.SyncSamples()))

	// How the work divides. The interesting figure is the largest group: two
	// engines cannot finish sooner than the group carrying the most frames.
	parts := partitionWanted(track, wanted)
	worst := 0
	for i, part := range parts {
		b := estimateBudget(track, part)
		if b > worst {
			worst = b
		}
		t.Logf("group %d: %2d slots, budget ~%d frames", i, len(part), b)
	}
	total := estimateBudget(track, wanted)
	t.Logf("total budget ~%d frames; largest group has %.0f%% of it -- best case %.2fx",
		total, 100*float64(worst)/float64(total), float64(total)/float64(worst))

	// The disk's share: every sample the walk would submit, read and converted to
	// Annex-B, but nothing decoded.
	start := time.Now()
	bytesRead := 0
	samples := 0
	high := -1
	for _, wf := range wanted {
		from := syncBefore(track, wf.sample)
		if high+1 > from {
			from = high + 1
		}
		for i := from; i <= wf.sample; i++ {
			data, err := f.SampleAnnexB(i)
			if err != nil {
				t.Fatalf("reading sample %d: %v", i, err)
			}
			bytesRead += len(data)
			samples++
			high = i
		}
	}
	readTime := time.Since(start)
	t.Logf("read only:  %v for %d samples, %.0f MB (%.0f MB/s, %.2f ms/frame)",
		readTime.Round(time.Millisecond), samples, float64(bytesRead)/(1<<20),
		float64(bytesRead)/(1<<20)/readTime.Seconds(),
		float64(readTime.Microseconds())/1000/float64(samples))

	// And the walk itself, one group at a time and then all at once. Both go
	// through the production path, so the difference is the split and nothing else.
	ffmpegPath := os.Getenv("STASH_FFMPEG_PATH")
	if ffmpegPath == "" {
		ffmpegPath = "ffmpeg"
	}
	opts := PhashFrameOptions{Path: path, Times: times, Width: 160}

	// The unsplit walk, for the single-engine rate to read the rest against.
	dec, err := newPhashDecoder(track)
	if err != nil {
		t.Fatalf("decoder: %v", err)
	}
	start = time.Now()
	_, err = decodeAndScale(context.Background(), f, dec, wanted,
		track.Width, track.Height, opts, ffmpegPath)
	dec.Close()
	if err != nil {
		t.Fatalf("1 decoder: %v", err)
	}
	d := time.Since(start)
	t.Logf("1 decoder:   %v (%.1f fps)", d.Round(time.Millisecond), float64(total)/d.Seconds())

	// And the real entry point, repeated. Before the devices were pooled this
	// alternated between the rate above and twice it, depending on which engines
	// the driver happened to give two freshly created contexts; these should now
	// all be the fast one. See devices.go.
	for i := 0; i < 3; i++ {
		start := time.Now()
		if _, err := PhashFrames(context.Background(), opts, ffmpegPath); err != nil {
			t.Fatalf("PhashFrames run %d: %v", i, err)
		}
		d := time.Since(start)
		t.Logf("PhashFrames run %d: %v (%.1f fps)", i, d.Round(time.Millisecond),
			float64(total)/d.Seconds())
	}
}
