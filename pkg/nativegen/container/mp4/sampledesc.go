package mp4

import (
	"fmt"

	"github.com/stashapp/stash/pkg/nativegen/container"
)

// videoSampleEntryHeader is the size of the fixed portion of a
// VisualSampleEntry, after which the codec configuration child boxes begin.
//
//	reserved[6] + data_reference_index(2)      =  8
//	pre_defined(2) + reserved(2) + pre_defined[3](12) = 16
//	width(2) + height(2)                       =  4
//	horizresolution(4) + vertresolution(4)     =  8
//	reserved(4) + frame_count(2)               =  6
//	compressorname[32]                         = 32
//	depth(2) + pre_defined(2)                  =  4
const videoSampleEntryHeader = 78

// parseVideoSampleDescription identifies the track codec from stsd and extracts
// the codec configuration record for a video track.
func parseVideoSampleDescription(stbl []byte, track *container.VideoTrack) error {
	stsd, ok := findBox(stbl, "stsd")
	if !ok {
		return fmt.Errorf("%w: no stsd box", container.ErrUnsupported)
	}

	r := reader{buf: stsd}
	r.fullBox()
	r.skip(4) // entry_count
	if r.err != nil {
		return r.err
	}

	return walkBoxes(stsd[r.pos:], func(b box) error {
		var codec container.Codec
		switch b.typ {
		case "avc1", "avc3":
			codec = container.CodecH264
		case "hvc1", "hev1":
			codec = container.CodecHEVC
		case "av01":
			codec = container.CodecAV1
		case "vp09":
			codec = container.CodecVP9
		default:
			return nil // audio entry, or a codec we cannot hardware-decode
		}

		if len(b.payload) < videoSampleEntryHeader {
			return fmt.Errorf("mp4: %s sample entry is truncated", b.typ)
		}

		track.Codec = codec

		// The coded dimensions in the sample entry are authoritative; tkhd
		// carries the display size, which may differ for anamorphic content.
		e := reader{buf: b.payload, pos: 24}
		if w, h := int(e.u16()), int(e.u16()); w > 0 && h > 0 {
			track.Width, track.Height = w, h
		}

		config := b.payload[videoSampleEntryHeader:]
		switch codec {
		case container.CodecH264:
			if avcC, ok := findBox(config, "avcC"); ok {
				sets, n, err := parseAVCC(avcC)
				if err != nil {
					return err
				}
				track.ParameterSets, track.NALLengthSize = sets, n
			}
		case container.CodecHEVC:
			if hvcC, ok := findBox(config, "hvcC"); ok {
				sets, n, err := parseHVCC(hvcC)
				if err != nil {
					return err
				}
				track.ParameterSets, track.NALLengthSize = sets, n
			}
		}

		// avc3/hev1 signal in-band parameter sets, so a missing or empty
		// configuration record is legitimate. Default the prefix length so the
		// Annex-B converter still knows how to split NAL units.
		if track.NALLengthSize == 0 && (codec == container.CodecH264 || codec == container.CodecHEVC) {
			track.NALLengthSize = 4
		}

		return errStopWalk
	})
}

// parseAVCC reads an AVCDecoderConfigurationRecord, returning its SPS and PPS
// concatenated in Annex-B form along with the NAL length prefix size.
func parseAVCC(cfg []byte) ([]byte, int, error) {
	r := reader{buf: cfg}
	r.skip(1)   // configurationVersion
	r.skip(3)   // profile, profile compatibility, level
	b := r.u8() // reserved(6) + lengthSizeMinusOne(2)
	n := r.u8() // reserved(3) + numOfSequenceParameterSets(5)
	if r.err != nil {
		return nil, 0, fmt.Errorf("mp4: avcC is truncated: %w", r.err)
	}
	nalLengthSize := int(b&0x03) + 1

	var out []byte
	out = appendParameterSets(&r, out, int(n&0x1f))
	if r.err != nil {
		return nil, 0, fmt.Errorf("mp4: avcC sequence parameter sets: %w", r.err)
	}

	numPPS := int(r.u8())
	out = appendParameterSets(&r, out, numPPS)
	if r.err != nil {
		return nil, 0, fmt.Errorf("mp4: avcC picture parameter sets: %w", r.err)
	}

	return out, nalLengthSize, nil
}

// hvccArrayOffset is the offset within an HEVCDecoderConfigurationRecord of the
// byte holding lengthSizeMinusOne; numOfArrays follows it, then the arrays.
const hvccArrayOffset = 21

// parseHVCC reads an HEVCDecoderConfigurationRecord, returning its VPS, SPS and
// PPS concatenated in Annex-B form along with the NAL length prefix size.
func parseHVCC(cfg []byte) ([]byte, int, error) {
	if len(cfg) < hvccArrayOffset+2 {
		return nil, 0, fmt.Errorf("mp4: hvcC is truncated")
	}

	nalLengthSize := int(cfg[hvccArrayOffset]&0x03) + 1
	numArrays := int(cfg[hvccArrayOffset+1])

	r := reader{buf: cfg, pos: hvccArrayOffset + 2}
	var out []byte
	for i := 0; i < numArrays; i++ {
		r.skip(1) // array_completeness + reserved + NAL_unit_type
		count := int(r.u16())
		out = appendParameterSets(&r, out, count)
		if r.err != nil {
			return nil, 0, fmt.Errorf("mp4: hvcC array %d: %w", i, r.err)
		}
	}

	return out, nalLengthSize, nil
}

// appendParameterSets reads count length-prefixed NAL units and appends each to
// dst in Annex-B form.
func appendParameterSets(r *reader, dst []byte, count int) []byte {
	for i := 0; i < count; i++ {
		n := int(r.u16())
		nal := r.take(n)
		if nal == nil {
			return dst
		}
		dst = append(dst, startCode...)
		dst = append(dst, nal...)
	}
	return dst
}

// audioSampleEntryHeader is the size of the fixed portion of an
// AudioSampleEntry, after which the codec configuration child boxes begin.
//
//	reserved[6] + data_reference_index(2)  =  8
//	reserved(8) + channelcount(2) + samplesize(2) = 12
//	pre_defined(2) + reserved(2)           =  4
//	samplerate(4)                          =  4
const audioSampleEntryHeader = 28

// parseAudioSampleDescription identifies an audio track's codec from stsd and
// extracts what the muxer needs to write a pass-through sample entry.
//
// A track whose entry this function does not recognise keeps the Unknown codec
// the caller initialised, which is how a soun trak declares itself present but
// not passable.
func parseAudioSampleDescription(stbl []byte, track *container.AudioTrack) error {
	stsd, ok := findBox(stbl, "stsd")
	if !ok {
		return fmt.Errorf("%w: no stsd box", container.ErrUnsupported)
	}

	r := reader{buf: stsd}
	r.fullBox()
	r.skip(4) // entry_count
	if r.err != nil {
		return r.err
	}

	return walkBoxes(stsd[r.pos:], func(b box) error {
		var codec container.AudioCodec
		switch b.typ {
		case "mp4a":
			// mp4a covers AAC and a handful of others, distinguished by the
			// esds object type. Which one it is does not matter here: the
			// samples and the configuration record are passed through whole,
			// so whatever a player read in the source it reads again here.
			codec = container.AudioCodecAAC
		case "ac-3":
			codec = container.AudioCodecAC3
		case "ec-3":
			codec = container.AudioCodecEAC3
		case "Opus":
			codec = container.AudioCodecOpus
		case "fLaC":
			codec = container.AudioCodecFLAC
		case "alac":
			codec = container.AudioCodecALAC
		default:
			return nil // not a codec we can pass through
		}

		if len(b.payload) < audioSampleEntryHeader {
			return fmt.Errorf("mp4: %s sample entry is truncated", b.typ)
		}

		track.Codec = codec

		// The channel count, sample size and sample rate are fixed fields of the
		// entry, at fixed offsets from its start.
		e := reader{buf: b.payload, pos: 16}
		track.Channels = int(e.u16())
		track.BitDepth = int(e.u16())
		e.skip(4) // pre_defined, reserved
		// The sample rate is stored as 16.16 fixed point.
		track.SampleRate = int(e.u32() >> 16)

		// Configuration child boxes begin after the fixed portion. Each codec's
		// record is copied whole; the muxer writes it back under the same box
		// type, so whatever a decoder needs is preserved exactly.
		config := b.payload[audioSampleEntryHeader:]
		switch codec {
		case container.AudioCodecAAC:
			if esds, ok := findBox(config, "esds"); ok {
				track.Config = esds
			}
		case container.AudioCodecAC3:
			if dac3, ok := findBox(config, "dac3"); ok {
				track.Config = dac3
			}
		case container.AudioCodecEAC3:
			if dec3, ok := findBox(config, "dec3"); ok {
				track.Config = dec3
			}
		case container.AudioCodecOpus:
			if dOps, ok := findBox(config, "dOps"); ok {
				track.Config = dOps
			}
		case container.AudioCodecFLAC:
			if dfLa, ok := findBox(config, "dfLa"); ok {
				track.Config = dfLa
			}
		case container.AudioCodecALAC:
			if alac, ok := findBox(config, "alac"); ok {
				track.Config = alac
			}
		}

		// A track whose codec needs a configuration record and does not carry
		// one cannot be written out again, so it is declared Unknown and the
		// caller treats it as not passable.
		if track.Config == nil {
			track.Codec = container.AudioCodecUnknown
			return nil
		}

		return errStopWalk
	})
}
