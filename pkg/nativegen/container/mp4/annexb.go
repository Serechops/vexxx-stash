package mp4

import (
	"encoding/binary"
	"fmt"

	"github.com/stashapp/stash/pkg/nativegen/container"
)

// startCode is the four-byte Annex-B NAL unit delimiter.
var startCode = []byte{0x00, 0x00, 0x00, 0x01}

// SampleAnnexB reads sample i and returns it in a form a hardware decoder will
// accept.
//
// For H.264 and HEVC this converts the length-prefixed NAL units stored in MP4
// into Annex-B start-code form, and prepends the track's parameter sets when
// the sample is a keyframe. Feeding parameter sets ahead of every keyframe —
// rather than only once at the start of the stream — is what lets us submit
// isolated keyframes from anywhere in the file without decoding what came
// before, which is exactly what sprite generation needs.
//
// For codecs that are not NAL-based the sample is returned unchanged.
func (f *File) SampleAnnexB(i int) ([]byte, error) {
	t := f.video
	if i < 0 || i >= len(t.Samples) {
		return nil, fmt.Errorf("mp4: sample index %d out of range", i)
	}

	raw, err := f.ReadSample(t.Samples[i])
	if err != nil {
		return nil, err
	}

	if t.NALLengthSize == 0 {
		return raw, nil
	}

	var prefix []byte
	if t.Samples[i].Sync {
		prefix = t.ParameterSets
	}

	return ToAnnexB(raw, t.NALLengthSize, prefix)
}

// ToAnnexB converts a sample of length-prefixed NAL units into Annex-B form,
// emitting prefix (if any) ahead of the converted units.
func ToAnnexB(sample []byte, nalLengthSize int, prefix []byte) ([]byte, error) {
	switch nalLengthSize {
	case 1, 2, 4:
	default:
		return nil, fmt.Errorf("%w: NAL length prefix of %d bytes", container.ErrUnsupported, nalLengthSize)
	}

	// Each NAL swaps an n-byte length for a 4-byte start code, so the output
	// grows by at most (4 - nalLengthSize) per unit. Assuming the smallest
	// plausible NAL keeps this a single allocation in practice.
	out := make([]byte, 0, len(prefix)+len(sample)+len(sample)/16+16)
	out = append(out, prefix...)

	for pos := 0; pos < len(sample); {
		if pos+nalLengthSize > len(sample) {
			return nil, fmt.Errorf("mp4: truncated NAL length at offset %d", pos)
		}

		var n int
		switch nalLengthSize {
		case 1:
			n = int(sample[pos])
		case 2:
			n = int(binary.BigEndian.Uint16(sample[pos:]))
		case 4:
			n = int(binary.BigEndian.Uint32(sample[pos:]))
		}
		pos += nalLengthSize

		if n < 0 || pos+n > len(sample) {
			return nil, fmt.Errorf("mp4: NAL unit of %d bytes at offset %d overruns the sample", n, pos)
		}

		out = append(out, startCode...)
		out = append(out, sample[pos:pos+n]...)
		pos += n
	}

	return out, nil
}
