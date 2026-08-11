package nativegen

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/stashapp/stash/pkg/nativegen/amf"
	"github.com/stashapp/stash/pkg/nativegen/container/mp4"
)

// TestDecodeStagesRealFile times a preview's pipeline one stage at a time.
//
// It exists because two rounds of optimising this package went into the wrong
// place for want of exactly these numbers. SetWanted(false) makes the decoder
// throw every frame away instead of scaling it and copying it back, so the
// first run times decode and the submit loop and nothing else; each run after
// it adds one stage, and the differences are what each stage costs. The last
// run says whether the second media engine is real.
//
// Measured 2026-08-10 on a 5400x2700 HEVC 59.94 stereo file: decode 5.4
// ms/frame (184 fps, and 353 fps aggregate across two decoders), readback a
// further 8.6, the reprojection a further 1.7. The readback is the target: most
// of it is a per-frame allocation of a thirty-megabyte image and a full-frame
// channel swap, neither of which the pipeline actually needs.
//
// Opt in with:
//
//	STASH_NATIVEGEN_TEST_MP4=<path> go test ./pkg/nativegen/ -run DecodeStages -v
func TestDecodeStagesRealFile(t *testing.T) {
	path := os.Getenv("STASH_NATIVEGEN_TEST_MP4")
	if path == "" {
		t.Skip("set STASH_NATIVEGEN_TEST_MP4 to run")
	}
	if !Available() {
		t.Skip("no native hardware backend on this machine")
	}
	t.Logf("backend: %s", Describe())

	f, err := mp4.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	track := f.Video()

	// A keyframe a few minutes in, then a long consecutive run from it.
	const frames = 1200
	syncs := track.SyncSamples()
	from := syncs[len(syncs)/8]
	if from+frames >= len(track.Samples) {
		t.Skip("file too short")
	}

	// The size the VR path asks the decoder to scale to, so the readback here is
	// the readback a real preview does.
	rm, err := newRemapper("LR180", track.Width, track.Height, 640, 360)
	if err != nil {
		t.Fatal(err)
	}
	decW, decH := rm.srcSize()
	t.Logf("coded %dx%d, decoding to %dx%d, %d frames from sample %d",
		track.Width, track.Height, decW, decH, frames, from)

	run := func(readback bool, remap bool) (time.Duration, int, error) {
		dec, err := amf.NewDecoder(amf.Config{
			Codec: track.Codec, Width: track.Width, Height: track.Height,
			ExtraData: track.ParameterSets,
			OutWidth:  decW, OutHeight: decH,
			LowLatency: false,
		})
		if err != nil {
			return 0, 0, err
		}
		defer dec.Close()

		if !readback {
			dec.SetWanted(func(int64) bool { return false })
		}
		// What the VR preview path asks for: each frame is consumed before the
		// next is fetched, so one buffer serves the whole decode.
		dec.Reuse(true)

		got := 0
		p := &pump{ctx: context.Background(), dec: dec, place: func(fr *amf.Frame) error {
			got++
			if remap {
				if _, err := rm.remap(fr.Image); err != nil {
					return err
				}
			}
			return nil
		}}

		start := time.Now()
		for i := from; i < from+frames; i++ {
			data, err := f.SampleAnnexB(i)
			if err != nil {
				return 0, 0, err
			}
			if err := p.submit(data, int64(i)); err != nil {
				return 0, 0, err
			}
		}
		return time.Since(start), got, nil
	}

	for _, c := range []struct {
		name            string
		readback, remap bool
	}{
		{"decode only (no readback)", false, false},
		{"decode + readback", true, false},
		{"decode + readback + remap", true, true},
	} {
		d, got, err := run(c.readback, c.remap)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		t.Logf("%-28s %v for %d frames (%.1f fps, %.2f ms/frame, %d materialised)",
			c.name, d.Round(time.Millisecond), frames,
			float64(frames)/d.Seconds(), float64(d.Microseconds())/1000/frames, got)
	}

	// And the same decode-only run on two decoders at once, to see whether the
	// second media engine is real.
	start := time.Now()
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _, errs[i] = run(false, false)
		}(i)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	d := time.Since(start)
	t.Logf("%-28s %v for %d frames (%.1f fps aggregate)", "decode only, 2 decoders",
		d.Round(time.Millisecond), 2*frames, float64(2*frames)/d.Seconds())
}
