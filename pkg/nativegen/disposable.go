package nativegen

import (
	"github.com/stashapp/stash/pkg/nativegen/container"
)

// Reaching a frame that is not a keyframe means decoding everything from the
// keyframe before it, and on a long-GOP file that run-up is the whole cost of a
// perceptual hash: 4378 frames for 25 targets on a 5.95-second-GOP 8K file, of
// which 25 are wanted and the rest exist only to reconstruct them.
//
// Not all of that run-up is load-bearing. A picture that no other picture is
// predicted from contributes nothing to any later reconstruction, so leaving it
// out of the run-up cannot change the pixels of the frame being walked to. This
// is not an approximation that happens to work — it is the same property that
// lets a stream be temporally scaled by throwing frames away, and both codecs
// mark it in the bitstream.
//
// The marking is not the same in the two codecs, and the difference matters:
//
//   - H.264 says it outright. nal_ref_idc == 0 on a slice means the picture is
//     not a reference picture, full stop. frame_num does not advance past a
//     non-reference picture either, so dropping one leaves no gap for the
//     decoder to notice.
//   - HEVC says something weaker. The _N nal_unit_types mean "not referenced by
//     pictures of the same sub-layer", which leaves pictures of a *higher*
//     sub-layer free to reference them. So an _N picture is only genuinely
//     disposable when there is no higher sub-layer, which means at the top
//     temporal_id — and the top is what the SPS declares in
//     sps_max_sub_layers_minus1. Skipping every _N picture regardless would
//     corrupt any stream that actually uses temporal layering.
//
// Anything not positively established as disposable is decoded. There is no
// heuristic here and no codec this guesses at: a stream whose structure cannot be
// read this way simply gets the full run-up, which is what it got before.

// disposableSkipEnabled turns the skip off, for tests that need to compare the
// frames it produces against the frames produced without it.
//
// It exists because the argument above is a correctness argument, and a
// correctness argument about a hardware decoder is worth exactly as much as the
// measurement that confirms it: the frames have to come back identical with this
// on and off, on real files, or the reasoning is wrong somewhere. Production
// never changes it. See disposable_exact_real_test.go.
var disposableSkipEnabled = true

// hevcSubLayerNonReference reports whether an HEVC nal_unit_type is one of the
// _N types — TRAIL_N, TSA_N, STSA_N, RADL_N, RASL_N and the reserved
// non-reference types, which are the even values below 16.
func hevcSubLayerNonReference(nalType byte) bool {
	return nalType < 16 && nalType%2 == 0
}

// hevcVCL reports whether an HEVC nal_unit_type carries coded slice data.
func hevcVCL(nalType byte) bool {
	return nalType < 32
}

// h264VCL reports whether an H.264 nal_unit_type carries coded slice data.
//
// Types 1 and 5 are coded slices; 2 to 4 are the partitions of a data-partitioned
// slice, which are treated the same way here because they carry nal_ref_idc too.
func h264VCL(nalType byte) bool {
	return nalType >= 1 && nalType <= 5
}

// disposableTest reports whether a sample's Annex-B data is a picture nothing
// else is predicted from. A nil test means disposability cannot be established
// for the stream and every sample must be decoded.
type disposableTest func(annexB []byte) bool

// newDisposableTest builds the test for a track, or returns nil when the track's
// codec or configuration does not allow one to be built safely.
//
// sample fetches a sample's Annex-B data by index, because the configuration this
// needs is not always out of band: every HEVC file measured here carries an empty
// hvcC and repeats its parameter sets in each keyframe instead, so a test built
// only from track.ParameterSets refused every one of them.
func newDisposableTest(track *container.VideoTrack, sample func(int) ([]byte, error)) disposableTest {
	switch track.Codec {
	case container.CodecH264:
		return h264Disposable

	case container.CodecHEVC:
		// The top sub-layer is the only one where an _N picture is certainly
		// unreferenced, so the stream has to say how many sub-layers it has before
		// any of them can be skipped.
		top, ok := hevcMaxSubLayerID(track.ParameterSets)
		if !ok {
			syncs := track.SyncSamples()
			if len(syncs) == 0 || sample == nil {
				return nil
			}
			data, err := sample(syncs[0])
			if err != nil {
				return nil
			}
			if top, ok = hevcMaxSubLayerID(data); !ok {
				return nil
			}
		}
		return func(annexB []byte) bool { return hevcDisposable(annexB, top) }

	default:
		// AV1 and VP9 carry their own structure that this does not read, and an
		// unknown codec is not one to speculate about.
		return nil
	}
}

// h264Disposable reports whether every coded slice in the sample has
// nal_ref_idc == 0.
//
// Every slice, rather than the first: a picture may be coded as several slices,
// and a sample containing even one reference slice is a sample later pictures may
// depend on.
func h264Disposable(annexB []byte) bool {
	slices := 0
	for _, nal := range annexBNALs(annexB) {
		if len(nal) < 1 {
			continue
		}
		nalType := nal[0] & 0x1f
		if !h264VCL(nalType) {
			continue
		}
		slices++
		if refIDC := (nal[0] >> 5) & 0x03; refIDC != 0 {
			return false
		}
	}
	// A sample with no slice in it is not a picture, so there is nothing to skip.
	return slices > 0
}

// hevcDisposable reports whether every coded slice in the sample is a
// sub-layer non-reference picture sitting at the stream's top sub-layer.
func hevcDisposable(annexB []byte, topSubLayer byte) bool {
	slices := 0
	for _, nal := range annexBNALs(annexB) {
		if len(nal) < 2 {
			continue
		}
		nalType := (nal[0] >> 1) & 0x3f
		if !hevcVCL(nalType) {
			continue
		}
		slices++
		if !hevcSubLayerNonReference(nalType) {
			return false
		}
		// nuh_temporal_id_plus1 occupies the low three bits of the second header
		// byte. Below the top sub-layer, a higher one may reference this picture.
		if temporalID := (nal[1] & 0x07); temporalID == 0 || temporalID-1 != topSubLayer {
			return false
		}
	}
	return slices > 0
}

// hevcMaxSubLayerID reads sps_max_sub_layers_minus1 out of the first SPS in the
// track's parameter sets, which is the top temporal_id the stream uses.
//
// The field sits in the first byte of the SPS payload — after
// sps_video_parameter_set_id's four bits — so no bitstream parsing beyond the
// header is needed to reach it, and emulation prevention cannot have altered a
// byte this early.
func hevcMaxSubLayerID(parameterSets []byte) (byte, bool) {
	const nalTypeSPS = 33
	for _, nal := range annexBNALs(parameterSets) {
		if len(nal) < 3 {
			continue
		}
		if (nal[0]>>1)&0x3f != nalTypeSPS {
			continue
		}
		return (nal[2] >> 1) & 0x07, true
	}
	return 0, false
}

// annexBNALs splits an Annex-B buffer into its NAL units, without their start
// codes and without copying.
func annexBNALs(buf []byte) [][]byte {
	var nals [][]byte

	i := 0
	start := -1
	for i < len(buf) {
		// A start code is 0x000001, optionally preceded by any number of extra
		// zero bytes, of which the three-byte form is what this looks for.
		if i+2 < len(buf) && buf[i] == 0 && buf[i+1] == 0 && buf[i+2] == 1 {
			if start >= 0 {
				nals = append(nals, trimTrailingZeros(buf[start:i]))
			}
			i += 3
			start = i
			continue
		}
		i++
	}
	if start >= 0 && start < len(buf) {
		nals = append(nals, trimTrailingZeros(buf[start:]))
	}
	return nals
}

// trimTrailingZeros drops the zero bytes a four-byte start code leaves on the end
// of the preceding NAL unit.
func trimTrailingZeros(nal []byte) []byte {
	for len(nal) > 0 && nal[len(nal)-1] == 0 {
		nal = nal[:len(nal)-1]
	}
	return nal
}
