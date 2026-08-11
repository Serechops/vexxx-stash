//go:build windows

package amf

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// testFrame draws a frame with a block whose position depends on n, so that a
// stream of them is genuinely moving. A static pattern would encode to almost
// nothing and would not exercise the encoder in any interesting way.
func testFrame(w, h, n int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, color.RGBA{R: uint8(x * 255 / w), G: uint8(y * 255 / h), B: 0x40, A: 0xff})
		}
	}
	bx := (n * 7) % (w - 64)
	for y := h/2 - 32; y < h/2+32; y++ {
		for x := bx; x < bx+64; x++ {
			img.SetRGBA(x, y, color.RGBA{R: 0xff, G: 0xff, B: 0xff, A: 0xff})
		}
	}
	return img
}

// encodeFrames runs n synthetic frames through an encoder and returns the
// packets, which is the sequence every other test here works from.
func encodeFrames(t *testing.T, cfg EncoderConfig, n int) []*Packet {
	t.Helper()

	enc, err := NewEncoder(cfg)
	if err != nil {
		if errors.Is(err, ErrUnavailable) {
			t.Skipf("no AMF encoder on this machine: %v", err)
		}
		t.Fatalf("NewEncoder: %v", err)
	}
	defer enc.Close()

	var packets []*Packet
	collect := func() {
		for {
			pkt, err := enc.Receive()
			if err != nil {
				return
			}
			packets = append(packets, pkt)
		}
	}

	for i := 0; i < n; i++ {
		frame := testFrame(cfg.Width, cfg.Height, i)
		for attempt := 0; ; attempt++ {
			err := enc.Submit(frame)
			if err == nil {
				break
			}
			if !errors.Is(err, ErrInputFull) {
				t.Fatalf("Submit frame %d: %v", i, err)
			}
			if attempt > 256 {
				t.Fatalf("encoder input stayed full on frame %d", i)
			}
			collect()
			time.Sleep(time.Millisecond)
		}
		collect()
	}

	if err := enc.Drain(); err != nil {
		t.Fatalf("Drain: %v", err)
	}
	for i := 0; i < 1024 && len(packets) < n; i++ {
		pkt, err := enc.Receive()
		if errors.Is(err, ErrDrained) {
			break
		}
		if errors.Is(err, ErrNeedMoreInput) {
			time.Sleep(time.Millisecond)
			continue
		}
		if err != nil {
			t.Fatalf("Receive during drain: %v", err)
		}
		packets = append(packets, pkt)
	}

	if len(packets) != n {
		t.Fatalf("got %d packets for %d frames", len(packets), n)
	}
	return packets
}

func testEncoderConfig() EncoderConfig {
	return EncoderConfig{
		Width: 640, Height: 360,
		FrameRateNum: 30, FrameRateDen: 1,
		QP: 22, GOP: 30,
	}
}

func TestEncoderProducesParameterSets(t *testing.T) {
	enc, err := NewEncoder(testEncoderConfig())
	if err != nil {
		if errors.Is(err, ErrUnavailable) {
			t.Skipf("no AMF encoder on this machine: %v", err)
		}
		t.Fatalf("NewEncoder: %v", err)
	}
	defer enc.Close()

	extra := enc.ExtraData()
	if len(extra) == 0 {
		t.Fatal("encoder produced no parameter sets")
	}

	// The muxer builds the codec configuration record out of this, so it has to
	// be Annex-B with both an SPS (NAL type 7) and a PPS (type 8) in it.
	if !bytes.HasPrefix(extra, []byte{0, 0, 0, 1}) && !bytes.HasPrefix(extra, []byte{0, 0, 1}) {
		t.Errorf("parameter sets do not start with a start code: %x", extra[:min(8, len(extra))])
	}
	var sawSPS, sawPPS bool
	for _, nal := range splitAnnexBForTest(extra) {
		switch nal[0] & 0x1f {
		case 7:
			sawSPS = true
		case 8:
			sawPPS = true
		}
	}
	if !sawSPS || !sawPPS {
		t.Errorf("parameter sets are missing SPS (%v) or PPS (%v): %x", sawSPS, sawPPS, extra)
	}
	t.Logf("parameter sets: %d bytes", len(extra))
}

func TestEncoderRejectsBadConfig(t *testing.T) {
	tests := []struct {
		name string
		cfg  EncoderConfig
	}{
		{"no size", EncoderConfig{FrameRateNum: 30, FrameRateDen: 1}},
		{"odd width", EncoderConfig{Width: 641, Height: 360, FrameRateNum: 30, FrameRateDen: 1}},
		{"odd height", EncoderConfig{Width: 640, Height: 361, FrameRateNum: 30, FrameRateDen: 1}},
		{"no frame rate", EncoderConfig{Width: 640, Height: 360}},
		{"quantiser out of range", EncoderConfig{Width: 640, Height: 360, FrameRateNum: 30, FrameRateDen: 1, QP: 99}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := NewEncoder(tt.cfg); err == nil {
				t.Error("NewEncoder accepted an invalid config")
			}
		})
	}
}

func TestEncoderFirstPacketIsAKeyframe(t *testing.T) {
	packets := encodeFrames(t, testEncoderConfig(), 30)

	if !packets[0].Keyframe {
		t.Error("the first packet is not a keyframe, so the stream cannot be decoded from its start")
	}
	for i, pkt := range packets {
		if len(pkt.Data) == 0 {
			t.Fatalf("packet %d is empty", i)
		}
	}

	keys := 0
	for _, pkt := range packets {
		if pkt.Keyframe {
			keys++
		}
	}
	t.Logf("%d packets, %d keyframes", len(packets), keys)
}

func TestEncoderRejectsAFrameOfTheWrongSize(t *testing.T) {
	enc, err := NewEncoder(testEncoderConfig())
	if err != nil {
		if errors.Is(err, ErrUnavailable) {
			t.Skipf("no AMF encoder on this machine: %v", err)
		}
		t.Fatalf("NewEncoder: %v", err)
	}
	defer enc.Close()

	if err := enc.Submit(image.NewRGBA(image.Rect(0, 0, 320, 180))); err == nil {
		t.Error("the encoder accepted a frame that was not the configured size")
	}
}

// TestEncoderOutputIsDecodableH264 is the check that matters: it hands the raw
// stream to ffmpeg and confirms ffmpeg decodes it back to the frames that went
// in. Everything else here tests that the binding behaves; this tests that the
// bytes are real H.264.
func TestEncoderOutputIsDecodableH264(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not on PATH")
	}

	const frames = 60
	cfg := testEncoderConfig()
	packets := encodeFrames(t, cfg, frames)

	var stream bytes.Buffer
	for _, pkt := range packets {
		stream.Write(pkt.Data)
	}
	t.Logf("%d frames encoded to %d bytes (%.1f kbps at %d fps)",
		frames, stream.Len(),
		float64(stream.Len())*8/1000/(float64(frames)/float64(cfg.FrameRateNum)),
		cfg.FrameRateNum)

	path := filepath.Join(t.TempDir(), "encoded.h264")
	if err := os.WriteFile(path, stream.Bytes(), 0o600); err != nil {
		t.Fatalf("writing stream: %v", err)
	}

	// Decoding to null proves the stream parses and every frame reconstructs;
	// ffmpeg reports how many frames it got, which must match what went in.
	out, err := exec.Command(ffmpeg, "-v", "error",
		"-i", path, "-f", "null", "-").CombinedOutput()
	if err != nil {
		t.Fatalf("ffmpeg could not decode the stream: %v\n%s", err, out)
	}
	if len(out) > 0 {
		t.Errorf("ffmpeg reported errors decoding the stream:\n%s", out)
	}

	probe, err := exec.LookPath("ffprobe")
	if err != nil {
		return
	}
	info, err := exec.Command(probe, "-v", "error",
		"-select_streams", "v:0",
		"-count_frames",
		"-show_entries", "stream=width,height,nb_read_frames,codec_name",
		"-of", "default=noprint_wrappers=1", path).Output()
	if err != nil {
		t.Fatalf("ffprobe: %v", err)
	}
	got := string(info)
	t.Logf("ffprobe:\n%s", strings.TrimSpace(got))

	for _, want := range []string{"codec_name=h264", "width=640", "height=360"} {
		if !strings.Contains(got, want) {
			t.Errorf("ffprobe output is missing %q", want)
		}
	}
	// A stream that decodes but holds a different number of frames than were
	// submitted would mean the encoder is dropping or duplicating them.
	if !strings.Contains(got, "nb_read_frames=60") {
		t.Errorf("ffprobe did not read back %d frames", frames)
	}
}

// splitAnnexBForTest cuts a byte stream into NAL unit payloads. It is
// deliberately simple: the muxer has its own, and a test that shared it would
// not be checking anything.
func splitAnnexBForTest(b []byte) [][]byte {
	var out [][]byte
	var starts []int
	for i := 0; i+3 <= len(b); i++ {
		if b[i] == 0 && b[i+1] == 0 && b[i+2] == 1 {
			starts = append(starts, i+3)
			i += 2
		}
	}
	for i, s := range starts {
		end := len(b)
		if i+1 < len(starts) {
			end = starts[i+1] - 3
			if end > 0 && b[end-1] == 0 {
				end--
			}
		}
		if s < end {
			out = append(out, b[s:end])
		}
	}
	return out
}
