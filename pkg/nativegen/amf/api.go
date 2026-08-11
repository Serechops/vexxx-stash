// Package amf provides a pure-Go binding to AMD's Advanced Media Framework for
// hardware video decoding, with no cgo and no build-time dependency on the AMF
// SDK.
//
// AMF ships as amfrt64.dll, which exports only two C functions: AMFInit and
// AMFQueryVersion. Everything beyond that is a C++ object graph reached through
// virtual method tables. This package calls those methods by loading the vtable
// pointer stored at each object's address, indexing it, and dispatching through
// syscall.SyscallN. The vtable layouts are transcribed from the AMF public
// headers (GPUOpen-LibrariesAndSDKs/AMF, version 1.5.2) and are recorded in
// vtable_windows.go with the indices spelled out, because a wrong index here is
// an immediate access violation rather than a Go error.
//
// The pipeline this package exposes is deliberately narrow: submit compressed
// Annex-B frames, receive scaled RGBA images in host memory. Decode, colour
// conversion and scaling all happen on the GPU, so a frame crosses PCIe already
// at thumbnail size rather than at full resolution.
//
// On any platform other than Windows, and on Windows without a working AMD
// runtime, every entry point fails with an error wrapping ErrUnavailable. That
// is the expected path on machines without AMD hardware and is how callers know
// to fall back to ffmpeg.
package amf

import (
	"errors"
	"fmt"
	"image"

	"github.com/stashapp/stash/pkg/nativegen/container"
)

// ErrUnavailable indicates AMF cannot be used on this machine: the runtime is
// missing, too old, reported no usable device, or this is not Windows. Callers
// should fall back to ffmpeg.
var ErrUnavailable = errors.New("amf: unavailable")

// ErrNeedMoreInput indicates the decoder has no output ready and needs more
// compressed data submitted before it will produce a frame.
var ErrNeedMoreInput = errors.New("amf: need more input")

// ErrInputFull indicates the decoder's input queue is full. Drain output with
// Receive before submitting again.
var ErrInputFull = errors.New("amf: input full")

// ErrDrained indicates the decoder has been drained and will produce no further
// frames.
var ErrDrained = errors.New("amf: drained")

// Frame is a decoded frame that has already been scaled and colour-converted on
// the GPU and copied back to host memory.
type Frame struct {
	// PTS is the presentation timestamp carried through from the submitted
	// sample, in the units the caller supplied.
	PTS int64

	// Image holds the frame at the configured output size.
	Image *image.RGBA
}

// FrameNV12 is a decoded frame read back from the GPU in raw NV12, without the
// converter's colour conversion or scaling.
//
// It is what a caller needs when the pixels themselves matter — when they must
// be handed to a scaler that is trusted to reproduce a reference output, rather
// than whatever the GPU's converter happens to produce. Perceptual hashing is
// the case in point: AMF's converter and swscale filter a reduction differently,
// and a hash that merely moved is useless. The decoded YUV, by contrast, is
// defined by the codec: bit-exact for a given decoder, and a decoder is
// contractually required to produce it.
type FrameNV12 struct {
	// PTS is the presentation timestamp carried through from the submitted
	// sample, in the units the caller supplied.
	PTS int64

	// Width and Height are the coded dimensions of the frame. The NV12 data
	// holds a luma plane of Width*Height bytes followed by an interleaved
	// chroma plane of (Width/2)*(Height/2) byte pairs.
	Width, Height int

	// Data is the raw NV12 frame, luma then interleaved chroma.
	Data []byte
}

// NV12PlaneSizes returns the byte lengths of the luma and chroma planes of an
// NV12 frame of the given dimensions, and whether the dimensions are valid for
// NV12 (even width and height).
func NV12PlaneSizes(w, h int) (luma, chroma int, ok bool) {
	if w <= 0 || h <= 0 || w%2 != 0 || h%2 != 0 {
		return 0, 0, false
	}
	return w * h, w / 2 * h / 2 * 2, true
}

// Config describes a decode session.
//
// Width and Height are the coded dimensions from the container. OutWidth and
// OutHeight are the dimensions frames are scaled to on the GPU before readback;
// leaving them zero returns frames at coded size, which for a 8K source means
// moving ~100 MB per frame across PCIe, so sprite callers should always set them.
type Config struct {
	Codec         container.Codec
	Width, Height int

	// ExtraData is the codec configuration record (avcC or hvcC) from the
	// container. It is optional when every submitted frame carries its own
	// parameter sets in Annex-B form, which is what container/mp4's
	// SampleAnnexB produces for keyframes.
	ExtraData []byte

	OutWidth, OutHeight int

	// LowLatency configures the decoder for zero DPB delay, so each submitted
	// frame produces its output immediately rather than after a reorder window.
	// This is correct and considerably faster when submitting only keyframes,
	// which have no reordering dependencies, but it will drop frames on a
	// stream that genuinely reorders.
	LowLatency bool

	// SkipConverter, when true, makes the decoder skip the GPU converter and
	// read back the raw NV12 decoded surfaces directly. The converter is what
	// does scaling and colour conversion, so without it every frame is returned
	// at coded size and in NV12 format. Call ReceiveNV12 instead of Receive.
	//
	// This is for callers that need bit-exact decoded pixels — the converter's
	// scaler and swscale produce different outputs for the same input, which
	// moves a perceptual hash by up to four bits. Reading back NV12 and piping
	// it through ffmpeg's swscale gives bit-identical results to ffmpeg's own
	// decode path, at the cost of moving the full coded frame across PCIe.
	SkipConverter bool
}

//nolint:unused // called only from windows-tagged files
func (c *Config) validate() error {
	if c.Width <= 0 || c.Height <= 0 {
		return fmt.Errorf("amf: invalid coded size %dx%d", c.Width, c.Height)
	}
	if c.OutWidth < 0 || c.OutHeight < 0 {
		return fmt.Errorf("amf: invalid output size %dx%d", c.OutWidth, c.OutHeight)
	}
	if _, ok := decoderComponentID(c.Codec); !ok {
		return fmt.Errorf("%w: no AMF decoder for codec %q", ErrUnavailable, c.Codec)
	}
	return nil
}

// outputSize returns the dimensions decoded frames are scaled to, defaulting to
// the coded size when the caller did not ask for scaling.
//
//nolint:unused // called only from windows-tagged files
func (c *Config) outputSize() (int, int) {
	w, h := c.OutWidth, c.OutHeight
	if w == 0 {
		w = c.Width
	}
	if h == 0 {
		h = c.Height
	}
	return w, h
}

// A Packet is one encoded frame in Annex-B form.
type Packet struct {
	// Data holds the frame's NAL units with start codes. For a keyframe the
	// encoder includes the parameter sets ahead of the picture.
	Data []byte

	// Keyframe reports whether this frame can be decoded on its own.
	Keyframe bool
}

// EncoderConfig describes an encode session.
//
// The encoder produces H.264, because that is what the preview player can be
// relied on to play and what the ffmpeg path already writes. Frames go in as
// RGBA images and come out as Annex-B packets.
type EncoderConfig struct {
	Width, Height int

	// FrameRateNum and FrameRateDen give the frame rate as an exact ratio, so
	// that rates like 30000/1001 stay exact rather than becoming 29.97.
	FrameRateNum, FrameRateDen int

	// QP is the constant quantiser, 0 (best) to 51 (worst). Constant-quality is
	// the right control for a preview: the segments vary enormously in how much
	// motion they hold, and a bitrate target would spend the same bits on a still
	// shot as on a busy one.
	QP int

	// GOP is how often a keyframe is forced, in frames. Previews are seeked
	// around and scrubbed, so they want keyframes more often than a normal
	// encode would use.
	GOP int
}

//nolint:unused // called only from windows-tagged files
func (c *EncoderConfig) validate() error {
	if c.Width <= 0 || c.Height <= 0 {
		return fmt.Errorf("amf: invalid encode size %dx%d", c.Width, c.Height)
	}
	// H.264 codes in 16x16 macroblocks and AMF rejects sizes that are not even;
	// the caller's own rounding should already guarantee this, so catch it here
	// rather than as an opaque failure inside Init.
	if c.Width%2 != 0 || c.Height%2 != 0 {
		return fmt.Errorf("amf: encode size %dx%d must be even", c.Width, c.Height)
	}
	if c.FrameRateNum <= 0 || c.FrameRateDen <= 0 {
		return fmt.Errorf("amf: invalid frame rate %d/%d", c.FrameRateNum, c.FrameRateDen)
	}
	if c.QP < 0 || c.QP > 51 {
		return fmt.Errorf("amf: quantiser %d out of range 0..51", c.QP)
	}
	return nil
}

// decoderComponentID maps a container codec to the AMF component that decodes
// it. The UVD/HW split in the names is historical: UVD was the pre-VCN decode
// block, and AMD kept the old identifiers for the codecs that predate it.
func decoderComponentID(c container.Codec) (string, bool) {
	switch c {
	case container.CodecH264:
		return "AMFVideoDecoderUVD_H264_AVC", true
	case container.CodecHEVC:
		return "AMFVideoDecoderHW_H265_HEVC", true
	case container.CodecAV1:
		return "AMFVideoDecoderHW_AV1", true
	case container.CodecVP9:
		return "AMFVideoDecoderHW_VP9", true
	}
	return "", false
}
