package nativegen

import (
	"testing"

	"github.com/stashapp/stash/pkg/nativegen/container"
)

// annexB builds a buffer of NAL units with three-byte start codes.
func annexB(nals ...[]byte) []byte {
	var out []byte
	for _, n := range nals {
		out = append(out, 0, 0, 1)
		out = append(out, n...)
	}
	return out
}

// h264NAL builds an H.264 NAL header with the given nal_ref_idc and type, plus a
// byte of payload so it is not mistaken for empty.
func h264NAL(refIDC, nalType byte) []byte {
	return []byte{refIDC<<5 | nalType, 0xaa}
}

// hevcNAL builds an HEVC two-byte NAL header for a type and temporal id.
func hevcNAL(nalType, temporalID byte) []byte {
	return []byte{nalType << 1, temporalID + 1, 0xaa}
}

func TestH264Disposable(t *testing.T) {
	tests := []struct {
		name string
		buf  []byte
		want bool
	}{
		{"non-reference slice", annexB(h264NAL(0, 1)), true},
		{"reference slice", annexB(h264NAL(2, 1)), false},
		{"IDR is always reference", annexB(h264NAL(3, 5)), false},
		// A picture coded as several slices is only disposable if none of them is
		// a reference slice; one is enough to make the picture load-bearing.
		{"all slices non-reference", annexB(h264NAL(0, 1), h264NAL(0, 1)), true},
		{"one reference slice among many", annexB(h264NAL(0, 1), h264NAL(1, 1)), false},
		// Non-VCL units carry a nal_ref_idc field that means nothing here, so they
		// must not be read as evidence either way.
		{"SEI alongside a non-reference slice", annexB(h264NAL(0, 6), h264NAL(0, 1)), true},
		{"SEI alone is not a picture", annexB(h264NAL(0, 6)), false},
		{"no NAL units at all", nil, false},
		{"truncated NAL", annexB([]byte{}), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := h264Disposable(tt.buf); got != tt.want {
				t.Errorf("h264Disposable() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestHEVCDisposable(t *testing.T) {
	const (
		trailN = 0
		trailR = 1
		tsaN   = 2
		raslN  = 8
		idrWR  = 19 // IDR_W_RADL
		sps    = 33
	)

	tests := []struct {
		name        string
		buf         []byte
		topSubLayer byte
		want        bool
	}{
		{"TRAIL_N at the top sub-layer", annexB(hevcNAL(trailN, 0)), 0, true},
		{"TRAIL_R is referenced", annexB(hevcNAL(trailR, 0)), 0, false},
		{"IDR is referenced", annexB(hevcNAL(idrWR, 0)), 0, false},
		{"TSA_N at the top sub-layer", annexB(hevcNAL(tsaN, 0)), 0, true},
		{"RASL_N at the top sub-layer", annexB(hevcNAL(raslN, 2)), 2, true},

		// The distinction the _N types alone do not make: below the top sub-layer,
		// a higher sub-layer is free to reference the picture, so skipping it would
		// corrupt a temporally layered stream.
		{"TRAIL_N below the top sub-layer", annexB(hevcNAL(trailN, 0)), 1, false},
		{"TRAIL_N at the top of three", annexB(hevcNAL(trailN, 2)), 2, true},
		{"TRAIL_N one below the top of three", annexB(hevcNAL(trailN, 1)), 2, false},

		{"all slices non-reference", annexB(hevcNAL(trailN, 0), hevcNAL(trailN, 0)), 0, true},
		{"one reference slice among many", annexB(hevcNAL(trailN, 0), hevcNAL(trailR, 0)), 0, false},

		// Non-VCL units are ignored rather than counted, and cannot on their own
		// make a buffer look like a disposable picture.
		{"SPS alongside a non-reference slice", annexB(hevcNAL(sps, 0), hevcNAL(trailN, 0)), 0, true},
		{"SPS alone is not a picture", annexB(hevcNAL(sps, 0)), 0, false},
		{"no NAL units at all", nil, 0, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := hevcDisposable(tt.buf, tt.topSubLayer); got != tt.want {
				t.Errorf("hevcDisposable(top=%d) = %v, want %v", tt.topSubLayer, got, tt.want)
			}
		})
	}
}

func TestHEVCMaxSubLayerID(t *testing.T) {
	// sps_video_parameter_set_id occupies the top four bits of the payload byte,
	// sps_max_sub_layers_minus1 the next three.
	spsWith := func(maxSubLayersMinus1 byte) []byte {
		return []byte{33 << 1, 1, 0x50 | maxSubLayersMinus1<<1}
	}

	for want := byte(0); want < 7; want++ {
		got, ok := hevcMaxSubLayerID(annexB(spsWith(want)))
		if !ok {
			t.Fatalf("sps_max_sub_layers_minus1 %d: not found", want)
		}
		if got != want {
			t.Errorf("sps_max_sub_layers_minus1 = %d, want %d", got, want)
		}
	}

	if _, ok := hevcMaxSubLayerID(nil); ok {
		t.Error("an empty buffer reported a sub-layer count")
	}
	// A buffer with no SPS in it must be reported as unreadable rather than
	// defaulted to zero, because zero is the value that permits the most skipping.
	if _, ok := hevcMaxSubLayerID(annexB(hevcNAL(0, 0))); ok {
		t.Error("a buffer with no SPS reported a sub-layer count")
	}
}

func TestNewDisposableTestDeclines(t *testing.T) {
	// A codec whose structure this does not read must produce no test at all,
	// rather than one that guesses.
	for _, codec := range []container.Codec{container.CodecAV1, container.CodecVP9, container.CodecUnknown} {
		track := &container.VideoTrack{Codec: codec}
		if newDisposableTest(track, nil) != nil {
			t.Errorf("%s: got a disposability test for a codec that has none", codec)
		}
	}

	// HEVC with no readable SPS anywhere: not out of band, and no sample to read
	// it from either.
	hevc := &container.VideoTrack{Codec: container.CodecHEVC}
	if newDisposableTest(hevc, nil) != nil {
		t.Error("HEVC with no parameter sets and no sample source got a test")
	}

	// And the fallback: an empty hvcC, with the SPS reachable in the first sync
	// sample instead. This is what every HEVC file measured actually looks like.
	hevc = &container.VideoTrack{
		Codec:   container.CodecHEVC,
		Samples: []container.Sample{{Sync: true}},
	}
	sample := func(int) ([]byte, error) {
		return annexB([]byte{33 << 1, 1, 0x50}, hevcNAL(0, 0)), nil
	}
	test := newDisposableTest(hevc, sample)
	if test == nil {
		t.Fatal("HEVC with an in-band SPS got no test")
	}
	if !test(annexB(hevcNAL(0, 0))) {
		t.Error("TRAIL_N not classified as disposable through the in-band SPS")
	}
}

func TestAnnexBNALs(t *testing.T) {
	// Four-byte start codes leave a trailing zero on the end of the preceding
	// unit, which has to be trimmed or the last byte of every NAL is wrong.
	buf := []byte{0, 0, 0, 1, 0x41, 0xaa, 0, 0, 0, 1, 0x42, 0xbb}
	nals := annexBNALs(buf)
	if len(nals) != 2 {
		t.Fatalf("got %d NAL units, want 2", len(nals))
	}
	if string(nals[0]) != "\x41\xaa" {
		t.Errorf("first NAL = % x, want 41 aa", nals[0])
	}
	if string(nals[1]) != "\x42\xbb" {
		t.Errorf("second NAL = % x, want 42 bb", nals[1])
	}

	if got := annexBNALs(nil); got != nil {
		t.Errorf("empty buffer produced %d units", len(got))
	}
}
