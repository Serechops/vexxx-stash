package nativegen

import (
	"context"
	"io"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/stashapp/stash/pkg/nativegen/amf"
	"github.com/stashapp/stash/pkg/nativegen/container/mp4"
)

// Splitting the phash walk across two decoders doubles its speed when the two
// land on different video engines and does nothing when they land on the same
// one, and which happens is not ours to choose: AMF exposes no property naming an
// engine. Measured on one real file with an idle GPU, the same call came out at
// 26s and at 50s on consecutive runs of the same binary.
//
// A first pass at this established where placement is decided. Two decoders on
// two devices kept across runs held their good placement three times over where
// two decoders on fresh contexts did not, and two decoders on one shared device
// were as slow as one decoder — so placement follows the AMF context and its
// D3D11 device, and the device is therefore the thing worth keeping. That it is
// keepable at all is the point: a decoder is bound to one codec and frame size at
// Init and cannot outlive its file, while a device is bound to neither.
//
// But a later run of that same comparison had the kept pair come out slow once,
// in a pass where other decoders were being created and closed between uses. So
// keeping devices is necessary and not sufficient, and this measures the
// difference that matters for the design:
//
//   - a pool used on its own, which is what a controller owning every decode
//     session would give
//   - the same pool with unrelated decoders created and closed between its runs,
//     which is what today's code does, where sprite, preview and phash each
//     create decoders whenever they like
//
// If the first is reliable and the second is not, the fix is not only to pool the
// devices but to make the pool the only thing that creates them.
//
// The walk is the production one writing to io.Discard, so what is timed is
// decode and placement with no scaling or piping in it.
//
//	STASH_NATIVEGEN_TEST_MP4="vr.mp4" go test ./pkg/nativegen/ -run PhashDecoderPlacement -count=1 -v -timeout 40m
func TestPhashDecoderPlacementRealFile(t *testing.T) {
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

	// A third of the usual twenty-five targets: enough frames that the two rates
	// are unmistakable, few enough that repeated measurement stays affordable.
	duration := float64(track.Samples[len(track.Samples)-1].PTS) / float64(track.Timescale)
	times := PhashTimes(duration)[:8]

	wanted, err := samplesAt(track, times)
	if err != nil {
		t.Fatalf("resolving times: %v", err)
	}
	parts := partitionWantedN(track, wanted, 2)
	if len(parts) != 2 {
		t.Fatalf("wanted 2 groups, got %d", len(parts))
	}
	budget := estimateBudget(track, wanted)
	t.Logf("%dx%d, %d targets, budget ~%d frames; one engine is ~88 fps, two ~169",
		track.Width, track.Height, len(wanted), budget)

	cfg := phashDecoderConfig(track)

	// walk runs one group to completion on one decoder, through the production
	// walk, discarding the frames it writes.
	walk := func(dec *amf.Decoder, part []wantedFrame) error {
		// Its own handle: SampleAnnexB seeks and then reads, so two walks sharing
		// one would each move the other's offset.
		h, err := mp4.Open(path)
		if err != nil {
			return err
		}
		defer h.Close()

		return feedExactFrames(context.Background(), h, dec, localSlots(part),
			track.Width, track.Height, io.Discard)
	}

	// measure builds a decoder per device, runs both groups at once and times it.
	measure := func(t *testing.T, devs [2]*amf.Device) time.Duration {
		t.Helper()

		decs, err := buildDecoders(cfg, devs[0], devs[1])
		if err != nil {
			t.Fatalf("building decoders: %v", err)
		}
		defer func() {
			for _, d := range decs {
				d.Close()
			}
		}()

		start := time.Now()
		errs := make([]error, len(parts))
		var wg sync.WaitGroup
		for i := range parts {
			wg.Add(1)
			go func() {
				defer wg.Done()
				errs[i] = walk(decs[i], parts[i])
			}()
		}
		wg.Wait()
		elapsed := time.Since(start)

		for i, err := range errs {
			if err != nil {
				t.Fatalf("group %d: %v", i, err)
			}
		}
		return elapsed
	}

	newPool := func(t *testing.T) [2]*amf.Device {
		t.Helper()

		var devs [2]*amf.Device
		for i := range devs {
			dev, err := amf.NewDevice()
			if err != nil {
				t.Fatalf("creating device %d: %v", i, err)
			}
			devs[i] = dev
		}
		return devs
	}

	report := func(label string, i int, d time.Duration) {
		fps := float64(budget) / d.Seconds()
		engines := "ONE engine"
		if fps > 130 {
			engines = "two engines"
		}
		t.Logf("  %s %d: %8v  (%5.1f fps, %s)", label, i, d.Round(time.Millisecond),
			fps, engines)
	}

	// One pool, used repeatedly, with nothing else creating decoders.
	t.Log("pool alone (a controller owning every decode session):")
	pool := newPool(t)
	for i := 0; i < 8; i++ {
		report("run", i, measure(t, pool))
	}
	for _, dev := range pool {
		dev.Close()
	}

	// The same arrangement, but with an unrelated decoder created and closed
	// between runs, the way an independent sprite or preview job would.
	t.Log("pool with unrelated decoders churning between runs (today's code):")
	pool = newPool(t)
	for i := 0; i < 5; i++ {
		other, err := amf.NewDecoder(cfg)
		if err != nil {
			t.Fatalf("churn %d: %v", i, err)
		}
		other.Close()

		report("run", i, measure(t, pool))
	}
	for _, dev := range pool {
		dev.Close()
	}
}

// buildDecoders makes one decoder per device given, creating its own context for
// any nil entry. Closing them is the caller's business; the devices are not
// touched.
func buildDecoders(cfg amf.Config, devs ...*amf.Device) ([]*amf.Decoder, error) {
	decs := make([]*amf.Decoder, 0, len(devs))
	for _, dev := range devs {
		var (
			d   *amf.Decoder
			err error
		)
		if dev == nil {
			d, err = amf.NewDecoder(cfg)
		} else {
			d, err = amf.NewDecoderOn(dev, cfg)
		}
		if err != nil {
			for _, made := range decs {
				made.Close()
			}
			return nil, err
		}
		decs = append(decs, d)
	}
	return decs, nil
}
