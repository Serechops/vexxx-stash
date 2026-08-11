//go:build windows

package amf_test

import (
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stashapp/stash/pkg/nativegen/amf"
	"github.com/stashapp/stash/pkg/nativegen/container/mp4"
)

func TestAvailable(t *testing.T) {
	// Availability is a property of the machine, not a correctness assertion:
	// on a box with no AMD runtime the honest outcome is an error wrapping
	// ErrUnavailable, which is exactly what makes the ffmpeg fallback fire.
	if !amf.Available() {
		if _, err := amf.Version(); !errors.Is(err, amf.ErrUnavailable) {
			t.Errorf("AMF is unavailable but Version returned %v, want ErrUnavailable", err)
		}
		t.Skip("AMF runtime not available on this machine")
	}

	v, err := amf.Version()
	if err != nil {
		t.Fatalf("Version: %v", err)
	}
	t.Logf("AMF runtime %s", v)
}

func TestNewDecoderRejectsUnknownCodec(t *testing.T) {
	_, err := amf.NewDecoder(amf.Config{Codec: "vc1", Width: 640, Height: 480})
	if !errors.Is(err, amf.ErrUnavailable) {
		t.Errorf("NewDecoder for an unsupported codec = %v, want ErrUnavailable", err)
	}
}

func TestNewDecoderRejectsBadSize(t *testing.T) {
	if _, err := amf.NewDecoder(amf.Config{Codec: "h264"}); err == nil {
		t.Error("NewDecoder with a zero coded size succeeded, want an error")
	}
}

// TestDecodeRealFile decodes a grid of keyframes out of a real video file and
// writes the resulting sprite sheet, which is the end-to-end proof that the
// vtable indices, the property marshalling and the surface readback are all
// correct — a wrong index here would fault rather than produce an image.
//
// Opt in with:
//
//	STASH_NATIVEGEN_TEST_MP4=<path> go test ./pkg/nativegen/amf/ -run RealFile -v
//
// Set STASH_NATIVEGEN_TEST_OUT to keep the sprite sheet somewhere you can look
// at it; otherwise it goes to the test's temp directory.
func TestDecodeRealFile(t *testing.T) {
	path := os.Getenv("STASH_NATIVEGEN_TEST_MP4")
	if path == "" {
		t.Skip("set STASH_NATIVEGEN_TEST_MP4 to run")
	}
	if !amf.Available() {
		t.Skip("AMF runtime not available on this machine")
	}

	f, err := mp4.Open(path)
	if err != nil {
		t.Fatalf("opening %s: %v", path, err)
	}
	defer f.Close()

	track := f.Video()
	t.Logf("%s: %s %dx%d, %d samples, %d keyframes, %.1fs",
		filepath.Base(path), track.Codec, track.Width, track.Height,
		len(track.Samples), len(track.SyncSamples()), track.DurationSeconds())

	const cols, rows = 3, 3
	const tileW, tileH = 240, 135
	tiles := cols * rows

	// Same tile timing the sprite generator uses: evenly spaced across the
	// duration, snapped to whichever keyframes are nearest.
	times := make([]float64, tiles)
	for i := range times {
		times[i] = track.DurationSeconds() * float64(i) / float64(tiles)
	}
	frames := track.KeyframesAt(times)

	dec, err := amf.NewDecoder(amf.Config{
		Codec:      track.Codec,
		Width:      track.Width,
		Height:     track.Height,
		ExtraData:  track.ParameterSets,
		OutWidth:   tileW,
		OutHeight:  tileH,
		LowLatency: true,
	})
	if err != nil {
		if errors.Is(err, amf.ErrUnavailable) {
			t.Skipf("no AMF decoder for %s on this GPU: %v", track.Codec, err)
		}
		t.Fatalf("NewDecoder: %v", err)
	}
	defer dec.Close()

	sheet := image.NewRGBA(image.Rect(0, 0, cols*tileW, rows*tileH))
	got := 0
	start := time.Now()

	for i, sample := range frames {
		if sample < 0 {
			t.Fatalf("tile %d resolved to no keyframe", i)
		}
		data, err := f.SampleAnnexB(sample)
		if err != nil {
			t.Fatalf("reading sample %d: %v", sample, err)
		}

		// The PTS is the tile index, so output frames identify themselves and
		// nothing depends on assuming decode order.
		if err := submit(dec, data, int64(i), sheet, &got, tileW, tileH, cols); err != nil {
			t.Fatalf("tile %d: %v", i, err)
		}
	}

	if err := dec.Drain(); err != nil {
		t.Fatalf("Drain: %v", err)
	}
	for {
		frame, err := dec.Receive()
		if errors.Is(err, amf.ErrDrained) || errors.Is(err, amf.ErrNeedMoreInput) {
			break
		}
		if err != nil {
			t.Fatalf("Receive after drain: %v", err)
		}
		place(sheet, frame, tileW, tileH, cols)
		got++
	}

	elapsed := time.Since(start)
	t.Logf("decoded %d/%d tiles in %v (%.1f ms/tile)",
		got, tiles, elapsed.Round(time.Millisecond),
		float64(elapsed.Microseconds())/1000/float64(max(got, 1)))

	if got == 0 {
		t.Fatal("decoder produced no frames at all")
	}

	outDir := os.Getenv("STASH_NATIVEGEN_TEST_OUT")
	if outDir == "" {
		outDir = t.TempDir()
	}
	out := filepath.Join(outDir, "amf_sprite.png")
	w, err := os.Create(out)
	if err != nil {
		t.Fatalf("creating %s: %v", out, err)
	}
	defer w.Close()
	if err := png.Encode(w, sheet); err != nil {
		t.Fatalf("encoding png: %v", err)
	}
	t.Logf("wrote %s", out)

	if got != tiles {
		t.Errorf("decoded %d of %d tiles", got, tiles)
	}
}

// submit pushes one frame in, draining output whenever the decoder says its
// input queue is full.
func submit(dec *amf.Decoder, data []byte, pts int64, sheet *image.RGBA, got *int, tileW, tileH, cols int) error {
	for attempt := 0; ; attempt++ {
		err := dec.Submit(data, pts)
		if err == nil {
			break
		}
		if !errors.Is(err, amf.ErrInputFull) {
			return fmt.Errorf("submit: %w", err)
		}
		if attempt > 64 {
			return errors.New("decoder input stayed full")
		}
		if err := receiveInto(dec, sheet, got, tileW, tileH, cols); err != nil {
			return err
		}
	}
	return receiveInto(dec, sheet, got, tileW, tileH, cols)
}

// receiveInto collects whatever output is ready, treating "nothing yet" as
// success rather than an error.
func receiveInto(dec *amf.Decoder, sheet *image.RGBA, got *int, tileW, tileH, cols int) error {
	frame, err := dec.Receive()
	switch {
	case errors.Is(err, amf.ErrNeedMoreInput), errors.Is(err, amf.ErrDrained):
		return nil
	case err != nil:
		return fmt.Errorf("receive: %w", err)
	}
	place(sheet, frame, tileW, tileH, cols)
	*got++
	return nil
}

func place(sheet *image.RGBA, frame *amf.Frame, tileW, tileH, cols int) {
	idx := int(frame.PTS)
	x := (idx % cols) * tileW
	y := (idx / cols) * tileH
	draw.Draw(sheet, image.Rect(x, y, x+tileW, y+tileH), frame.Image, image.Point{}, draw.Src)
}
