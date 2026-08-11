//go:build windows

package amf

import (
	"errors"
	"fmt"
	"image"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const (
	// convertPollInterval is how long to wait before asking the converter again
	// when it has work in flight. AMF's own samples poll at a millisecond; a
	// conversion of an already-small frame takes considerably less than that, and
	// the wait only ever happens when the GPU is genuinely behind.
	convertPollInterval = 250 * time.Microsecond

	// maxConverterPolls bounds that wait, so a wedged converter fails the file
	// over to ffmpeg rather than hanging the generator. At the interval above
	// this is a little over a hundredth of a second.
	maxConverterPolls = 64
)

// Decoder decodes compressed video frames on the GPU and returns them scaled
// and colour-converted in host memory.
//
// The pipeline chains two AMF components: a hardware decoder producing NV12
// surfaces in DX11 memory, and a video converter that scales them and converts
// to BGRA without the pixels ever leaving the GPU. Only the final,
// thumbnail-sized surface is copied back across PCIe — for an 8K source that is
// the difference between moving ~50 MB per frame and ~50 KB.
//
// A Decoder is not safe for concurrent use.
type Decoder struct {
	mu   sync.Mutex
	cfg  Config
	ctx  unsafe.Pointer // AMFContext*, owned only when ownCtx
	dec  unsafe.Pointer // AMFComponent*, the hardware decoder
	conv unsafe.Pointer // AMFComponent*, the scaler and colour converter

	// ownCtx records that this decoder created its own context and must tear it
	// down. A decoder built on a caller's Device shares that context with other
	// decoders and must leave it alone.
	ownCtx bool

	outW, outH int
	want       func(pts int64) bool
	drained    bool
	closed     bool

	// swap records that the converter is producing BGRA rather than RGBA, so
	// readback has to exchange the red and blue channels on the way past.
	swap bool

	// reuse lets readback hand the same image back every time, for a caller
	// that has finished with a frame before it asks for the next one.
	reuse bool
	buf   *image.RGBA
}

// NewDecoder starts a decode session on the GPU.
//
// It fails with an error wrapping ErrUnavailable when AMF is missing, when no
// AMD device is present, or when this GPU's video engine cannot decode the
// requested codec — a 7900 XTX handles H.264, HEVC, AV1 and VP9, but no current
// AMD part decodes VC-1. Callers should fall back to ffmpeg on that error.
//
// When Config.SkipConverter is true, no converter is created and the decoder
// surfaces are read back directly as NV12. Call ReceiveNV12 instead of Receive.
func NewDecoder(cfg Config) (*Decoder, error) {
	return newDecoder(nil, cfg)
}

// Device is an AMF context bound to a D3D11 device, on which several decoders can
// be created.
//
// It exists because which video engine a decoder runs on is not ours to choose.
// AMF exposes no property naming an engine, so placement is the driver's, and
// two decoders each holding their own context land on the same engine often
// enough to erase the benefit of having two. A Device makes the context the unit
// that is kept and reused, so that whatever placement it was given can be
// measured once and then relied on, rather than redrawn per file.
//
// Sharing a Device is what makes that possible at all: a decoder is bound to one
// codec and one frame size at Init, so decoders cannot outlive the file they were
// made for, while the context they sit on can.
//
// A Device is safe to create decoders from concurrently. The decoders themselves
// are not safe for concurrent use, as before.
type Device struct {
	mu     sync.Mutex
	ctx    unsafe.Pointer // AMFContext*
	closed bool
}

// NewDevice creates an AMF context bound to a D3D11 device.
//
// The caller owns it and must Close it, after every decoder created on it has
// been closed — a context torn down under a live component takes the driver with
// it.
func NewDevice() (*Device, error) {
	rt := loadRuntime()
	if rt.err != nil {
		return nil, rt.err
	}

	dev := &Device{}
	if err := check("CreateContext", vres(rt.factory, iFacCreateContext,
		uintptr(unsafe.Pointer(&dev.ctx)))); err != nil {
		return nil, err
	}
	if err := initDX11(dev.ctx); err != nil {
		vcall(dev.ctx, iCtxTerminate)
		release(dev.ctx)
		return nil, err
	}
	return dev, nil
}

// Close releases the device. It is safe to call more than once.
func (dev *Device) Close() error {
	dev.mu.Lock()
	defer dev.mu.Unlock()

	if dev.closed || dev.ctx == nil {
		return nil
	}
	dev.closed = true
	vcall(dev.ctx, iCtxTerminate)
	release(dev.ctx)
	dev.ctx = nil
	return nil
}

// NewDecoderOn starts a decode session on an existing Device, rather than on a
// context of its own.
//
// Closing the returned decoder releases its components and leaves the device
// alone, so one device can outlive any number of decoders built on it.
func NewDecoderOn(dev *Device, cfg Config) (*Decoder, error) {
	if dev == nil {
		return nil, fmt.Errorf("%w: nil device", ErrUnavailable)
	}
	return newDecoder(dev, cfg)
}

func newDecoder(dev *Device, cfg Config) (*Decoder, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	rt := loadRuntime()
	if rt.err != nil {
		return nil, rt.err
	}

	componentID, _ := decoderComponentID(cfg.Codec)

	d := &Decoder{cfg: cfg, ownCtx: dev == nil}
	d.outW, d.outH = cfg.outputSize()

	// Nothing past this point may leak AMF objects, and teardown order matters:
	// components before the context that owns them.
	ok := false
	defer func() {
		if !ok {
			d.destroy()
		}
	}()

	if dev != nil {
		dev.mu.Lock()
		closed := dev.closed
		d.ctx = dev.ctx
		dev.mu.Unlock()
		if closed || d.ctx == nil {
			return nil, fmt.Errorf("%w: device is closed", ErrUnavailable)
		}
	} else {
		if err := check("CreateContext", vres(rt.factory, iFacCreateContext,
			uintptr(unsafe.Pointer(&d.ctx)))); err != nil {
			return nil, err
		}
		if err := initDX11(d.ctx); err != nil {
			return nil, err
		}
	}

	if err := d.initDecoder(componentID); err != nil {
		return nil, err
	}
	if !cfg.SkipConverter {
		if err := d.initConverter(); err != nil {
			return nil, err
		}
	}

	ok = true
	runtime.SetFinalizer(d, func(d *Decoder) { _ = d.Close() })
	return d, nil
}

// initDX11 binds a context to a Direct3D 11 device.
//
// Passing a nil device asks AMF to create and own one. That avoids binding
// d3d11.dll here and choosing an adapter ourselves, and AMF picks a device it
// can actually decode on — which on a machine with both a discrete card and an
// integrated APU is exactly the choice we would otherwise have to make by hand.
func initDX11(ctx unsafe.Pointer) error {
	code := vres(ctx, iCtxInitDX11, 0, dx11_1)
	if code == resOK {
		return nil
	}
	// Some older runtime and driver combinations only advertise 11.0.
	if vres(ctx, iCtxInitDX11, 0, dx11_0) == resOK {
		return nil
	}
	return fmt.Errorf("%w: %v", ErrUnavailable, check("InitDX11", code))
}

func (d *Decoder) initDecoder(componentID string) error {
	if err := d.createComponent(componentID, &d.dec); err != nil {
		return err
	}

	if d.cfg.LowLatency {
		// Zero DPB delay: each submitted frame yields its output immediately
		// rather than being held for a reorder window. Valid here because
		// keyframes carry no reordering dependencies.
		if err := setProperty(d.dec, propDecoderReorderMode,
			variantInt64Value(decodeModeLowLatency)); err != nil {
			return err
		}
		// Best effort: older runtimes lack this property, and failing to set it
		// only costs latency.
		_ = setProperty(d.dec, propDecoderLowLatency, variantBoolValue(true))
	}

	if len(d.cfg.ExtraData) > 0 {
		buf, err := d.allocBuffer(d.cfg.ExtraData)
		if err != nil {
			return fmt.Errorf("amf: allocating extradata buffer: %w", err)
		}
		err = setProperty(d.dec, propDecoderExtraData, variantInterfaceValue(buf))
		release(buf) // AMF took its own reference
		if err != nil {
			return err
		}
	}

	// For a decoder, Init's format argument describes the surfaces it will
	// produce. NV12 is what every AMD video engine decodes 8-bit content into
	// natively, so asking for it avoids an implicit conversion.
	code := vres(d.dec, iCompInit, surfaceNV12,
		uintptr(int32(d.cfg.Width)), uintptr(int32(d.cfg.Height)))
	switch code {
	case resCodecNotSupported, resDecoderNotPresent, resNotSupported:
		return fmt.Errorf("%w: this GPU cannot decode %s: %v",
			ErrUnavailable, d.cfg.Codec, check("Init", code))
	}
	return check("decoder Init", code)
}

func (d *Decoder) initConverter() error {
	if err := d.createComponent(componentVideoConverter, &d.conv); err != nil {
		return err
	}

	// RGBA is asked for first and BGRA accepted as a fallback.
	//
	// image.RGBA wants its channels in that order, so a converter that will
	// produce them saves a full-frame channel swap on the CPU for every frame —
	// on the VR path that is a thirty-megabyte read and a thirty-megabyte write
	// per frame, which measured as most of the readback's cost. BGRA is the
	// format every AMD driver has always produced, so it stays as the fallback
	// rather than the assumption: a converter that rejects RGBA fails at Init,
	// not at SetProperty, so the format has to be tried rather than queried.
	for _, format := range []int{surfaceRGBA, surfaceBGRA} {
		// Output stays in DX11 memory; reading back is a separate, explicit step
		// so the scale always happens before anything crosses PCIe.
		props := []struct {
			name string
			val  variant
		}{
			{propConverterMemoryType, variantInt64Value(memDX11)},
			{propConverterOutputFormat, variantInt64Value(int64(format))},
			{propConverterOutputSize, variantSizeValue(int32(d.outW), int32(d.outH))},
			{propConverterScale, variantInt64Value(scaleBicubic)},
			{propConverterKeepAspect, variantBoolValue(false)},
		}
		for _, p := range props {
			if err := setProperty(d.conv, p.name, p.val); err != nil {
				return err
			}
		}

		code := vres(d.conv, iCompInit, surfaceNV12,
			uintptr(int32(d.cfg.Width)), uintptr(int32(d.cfg.Height)))
		if code == resOK {
			d.swap = format == surfaceBGRA
			return nil
		}
		if format == surfaceBGRA {
			return check("converter Init", code)
		}

		// Terminate before trying again: a component that failed Init still
		// holds whatever it managed to set up.
		vcall(d.conv, iCompTerminate)
	}
	return nil
}

func (d *Decoder) createComponent(id string, out *unsafe.Pointer) error {
	wid, err := syscall.UTF16PtrFromString(id)
	if err != nil {
		return fmt.Errorf("amf: component id %q: %w", id, err)
	}
	code := vres(loadRuntime().factory, iFacCreateComponent,
		uintptr(d.ctx),
		uintptr(unsafe.Pointer(wid)),
		uintptr(unsafe.Pointer(out)),
	)
	runtime.KeepAlive(wid)
	if code != resOK {
		return fmt.Errorf("%w: creating %s: %v", ErrUnavailable, id,
			check("CreateComponent", code))
	}
	return nil
}

// allocBuffer allocates AMF host memory and copies data into it. The caller
// owns the returned reference and must release it.
func (d *Decoder) allocBuffer(data []byte) (unsafe.Pointer, error) {
	var buf unsafe.Pointer
	defer pin(&buf)()
	if err := check("AllocBuffer", vres(d.ctx, iCtxAllocBuffer,
		memHost, uintptr(len(data)), uintptr(unsafe.Pointer(&buf)))); err != nil {
		return nil, err
	}

	native := foreignPtr(vcall(buf, iBufGetNative))
	if native == nil {
		release(buf)
		return nil, errors.New("amf: AllocBuffer returned a buffer with no host pointer")
	}
	copy(unsafe.Slice((*byte)(native), len(data)), data)
	return buf, nil
}

// Submit hands one compressed frame to the decoder.
//
// data must be in Annex-B form with parameter sets present, which is what
// container/mp4's SampleAnnexB produces for sync samples.
//
// pts is carried through the pipeline and returned on the corresponding Frame.
// This package treats it as opaque, so a caller submitting an arbitrary set of
// frames can pass a tile index here and use it to identify outputs rather than
// having to assume anything about decode order.
//
// It returns ErrInputFull when the decoder's queue is full, in which case the
// caller should drain with Receive and retry.
func (d *Decoder) Submit(data []byte, pts int64) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.closed {
		return errors.New("amf: decoder is closed")
	}
	if len(data) == 0 {
		return errors.New("amf: empty sample")
	}

	buf, err := d.allocBuffer(data)
	if err != nil {
		return err
	}
	defer release(buf)

	vcall(buf, iDataSetPts, uintptr(pts))

	switch code := vres(d.dec, iCompSubmitInput, uintptr(buf)); code {
	case resOK:
		return nil
	case resInputFull, resNoFreeSurfaces:
		// Both mean "retry after draining output", not "this frame failed".
		return ErrInputFull
	default:
		return check("SubmitInput", code)
	}
}

// Receive returns the next decoded frame.
//
// It returns ErrNeedMoreInput when the decoder has nothing ready yet, and
// ErrDrained once a drained decoder has emitted everything it was holding.
func (d *Decoder) Receive() (*Frame, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.closed {
		return nil, errors.New("amf: decoder is closed")
	}

	for {
		surface, pts, err := d.queryOutput()
		if err != nil {
			return nil, err
		}

		frame, err := d.materialise(surface, pts)
		release(surface)
		if err != nil {
			return nil, err
		}
		if frame != nil {
			return frame, nil
		}
	}
}

// ReceiveNV12 returns the next decoded frame as raw NV12, bypassing the
// converter and its scaling and colour conversion.
//
// It returns ErrNeedMoreInput when the decoder has nothing ready yet, and
// ErrDrained once a drained decoder has emitted everything it was holding.
//
// This method is only usable when the decoder was configured with
// Config.SkipConverter set to true. Without the converter, every frame is
// returned at the coded size.
func (d *Decoder) ReceiveNV12() (*FrameNV12, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.closed {
		return nil, errors.New("amf: decoder is closed")
	}
	if !d.cfg.SkipConverter {
		return nil, errors.New("amf: ReceiveNV12 requires SkipConverter in config")
	}

	for {
		surface, pts, err := d.queryOutput()
		if err != nil {
			return nil, err
		}

		if d.want != nil && !d.want(pts) {
			release(surface)
			continue
		}

		// Convert the decoded surface to host memory so the plane data is
		// accessible from the CPU.
		if err := check("Convert(HOST)", vres(surface, iDataConvert, memHost)); err != nil {
			release(surface)
			return nil, err
		}

		w, h := d.cfg.Width, d.cfg.Height
		lumaSize := w * h
		chromaSize := (w / 2) * (h / 2) * 2
		buf := make([]byte, lumaSize+chromaSize)

		// Luma plane (Y).
		plane0 := foreignPtr(vcall(surface, iSurfGetPlaneAt, 0))
		if plane0 == nil {
			release(surface)
			return nil, errors.New("amf: NV12 surface has no luma plane")
		}
		p0 := foreignPtr(vcall(plane0, iPlaneGetNative))
		if p0 == nil {
			release(surface)
			return nil, errors.New("amf: luma plane has no host pointer")
		}
		p0Pitch := int(int32(vcall(plane0, iPlaneGetHPitch)))
		if p0Pitch < w || p0Pitch*h > len(unsafe.Slice((*byte)(p0), p0Pitch*h)) {
			release(surface)
			return nil, fmt.Errorf("amf: implausible luma pitch %d for %dx%d NV12", p0Pitch, w, h)
		}
		_ = lumaSize // used below
		p0Src := unsafe.Slice((*byte)(p0), p0Pitch*h)
		for y := 0; y < h; y++ {
			copy(buf[y*w:y*w+w], p0Src[y*p0Pitch:y*p0Pitch+w])
		}

		// Chroma plane (UV interleaved).
		plane1 := foreignPtr(vcall(surface, iSurfGetPlaneAt, 1))
		if plane1 == nil {
			release(surface)
			return nil, errors.New("amf: NV12 surface has no chroma plane")
		}
		p1 := foreignPtr(vcall(plane1, iPlaneGetNative))
		if p1 == nil {
			release(surface)
			return nil, errors.New("amf: chroma plane has no host pointer")
		}
		p1Pitch := int(int32(vcall(plane1, iPlaneGetHPitch)))
		chromaH := h / 2
		if p1Pitch < w || p1Pitch*chromaH > len(unsafe.Slice((*byte)(p1), p1Pitch*chromaH)) {
			release(surface)
			return nil, fmt.Errorf("amf: implausible chroma pitch %d for %dx%d NV12", p1Pitch, w, h)
		}
		p1Src := unsafe.Slice((*byte)(p1), p1Pitch*chromaH)
		for y := 0; y < chromaH; y++ {
			copy(buf[lumaSize+y*w:lumaSize+y*w+w], p1Src[y*p1Pitch:y*p1Pitch+w])
		}

		release(surface)
		return &FrameNV12{PTS: pts, Width: w, Height: h, Data: buf}, nil
	}
}

// queryOutput calls QueryOutput on the decoder component and returns the
// decoded surface along with its PTS. It handles the various AMF return codes.
func (d *Decoder) queryOutput() (surface unsafe.Pointer, pts int64, err error) {
	for {
		var data unsafe.Pointer
		unpin := pin(&data)
		code := vres(d.dec, iCompQueryOutput, uintptr(unsafe.Pointer(&data)))
		unpin()
		switch code {
		case resOK:
			if data == nil {
				return nil, 0, ErrNeedMoreInput
			}
		case resRepeat, resNeedMoreInput:
			return nil, 0, ErrNeedMoreInput
		case resEOF:
			return nil, 0, ErrDrained
		default:
			return nil, 0, check("QueryOutput", code)
		}

		if dt := vcall(data, iDataGetDataType); dt != dataTypeSurface {
			release(data)
			continue
		}

		pts = int64(vcall(data, iDataGetPts))
		return data, pts, nil
	}
}

// materialise turns a decoded surface into a host image, or returns nil for a
// frame the caller has said it does not want.
//
// Skipping is worth a great deal more than it looks. Decoding a run of frames
// means decoding everything from the preceding keyframe, and on a file with
// keyframes seconds apart most of that run exists only to reconstruct its end.
// Every one of those frames would otherwise be scaled on the GPU and copied
// across PCIe before the caller got the chance to throw it away.
func (d *Decoder) materialise(data unsafe.Pointer, pts int64) (*Frame, error) {
	if d.want != nil && !d.want(pts) {
		return nil, nil
	}

	// AMFSurface derives from AMFData through single inheritance, so the
	// pointer needs no adjustment to be used as a surface.
	scaled, err := d.scale(data)
	if err != nil {
		return nil, err
	}
	defer release(scaled)

	img, err := d.readback(scaled)
	if err != nil {
		return nil, err
	}
	return &Frame{PTS: pts, Image: img}, nil
}

// SetWanted installs a filter deciding which decoded frames are worth bringing
// back to host memory. A nil filter, the default, wants all of them.
//
// The filter is consulted with the timestamp the frame was submitted under, so a
// caller that submits sample indices can answer in those terms.
func (d *Decoder) SetWanted(want func(pts int64) bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.want = want
}

// scale runs one decoded surface through the converter, returning a new surface
// at the configured output size in BGRA. The caller owns the result.
//
// The converter is an AMF component like the decoder, and components are
// asynchronous: submitting work does not mean the work is done. So both halves
// of this have to tolerate "not yet". A full input queue means the previous
// conversion is still running, and an empty output means this one is. Neither is
// a failure, and the answer to both is to wait and ask again.
//
// Treating them as failures is what this originally did, and it survived the
// sprite path — which submits eighty-one isolated keyframes with a readback and
// a reprojection between each, so the GPU is never behind. Decoding a run of
// consecutive frames removes all of that slack and the converter is asked for
// the next frame while it is still working on the last one.
func (d *Decoder) scale(surface unsafe.Pointer) (unsafe.Pointer, error) {
	for attempt := 0; ; attempt++ {
		code := vres(d.conv, iCompSubmitInput, uintptr(surface))
		if code == resOK {
			break
		}
		if code != resInputFull && code != resNoFreeSurfaces {
			return nil, check("converter SubmitInput", code)
		}
		if attempt >= maxConverterPolls {
			return nil, errors.New("amf: converter input stayed full")
		}
		time.Sleep(convertPollInterval)
	}

	for attempt := 0; ; attempt++ {
		var out unsafe.Pointer
		unpin := pin(&out)
		code := vres(d.conv, iCompQueryOutput, uintptr(unsafe.Pointer(&out)))
		unpin()
		switch code {
		case resOK:
			// A converter reports success with no surface attached to mean the
			// same thing as REPEAT: the frame is accepted but not finished.
			if out != nil {
				return out, nil
			}
		case resRepeat, resNeedMoreInput:
		default:
			return nil, check("converter QueryOutput", code)
		}
		if attempt >= maxConverterPolls {
			return nil, errors.New("amf: converter accepted a frame but produced no output")
		}
		time.Sleep(convertPollInterval)
	}
}

// readback copies a GPU surface into a Go image.
//
// Convert(AMF_MEMORY_HOST) is what actually moves the pixels; once it returns,
// the surface's planes address host memory. Rows are padded out to the plane's
// horizontal pitch for GPU alignment, and that pitch is generally wider than
// width*4, so rows have to be copied one at a time rather than as one block.
func (d *Decoder) readback(surface unsafe.Pointer) (*image.RGBA, error) {
	if err := check("Convert(HOST)", vres(surface, iDataConvert, memHost)); err != nil {
		return nil, err
	}

	plane := foreignPtr(vcall(surface, iSurfGetPlaneAt, 0))
	if plane == nil {
		return nil, errors.New("amf: converted surface has no plane 0")
	}
	native := foreignPtr(vcall(plane, iPlaneGetNative))
	if native == nil {
		return nil, errors.New("amf: converted surface plane has no host pointer")
	}

	w := int(int32(vcall(plane, iPlaneGetWidth)))
	h := int(int32(vcall(plane, iPlaneGetHeight)))
	pitch := int(int32(vcall(plane, iPlaneGetHPitch)))
	if w <= 0 || h <= 0 || pitch < w*4 {
		return nil, fmt.Errorf("amf: implausible plane geometry %dx%d pitch %d", w, h, pitch)
	}

	src := unsafe.Slice((*byte)(native), pitch*h)
	img := d.destination(w, h)

	for y := 0; y < h; y++ {
		srcRow := src[y*pitch : y*pitch+w*4]
		dstRow := img.Pix[y*img.Stride : y*img.Stride+w*4]

		if !d.swap {
			copy(dstRow, srcRow)
			continue
		}

		// The converter would only give us BGRA, so red and blue are exchanged
		// on the way past. This costs about as much again as the copy itself,
		// which is why RGBA is asked for first.
		for x := 0; x < w*4; x += 4 {
			dstRow[x+0] = srcRow[x+2]
			dstRow[x+1] = srcRow[x+1]
			dstRow[x+2] = srcRow[x+0]
			dstRow[x+3] = srcRow[x+3]
		}
	}
	return img, nil
}

// destination returns the image readback should write into.
//
// Every pixel of it is overwritten, so allocating a new one per frame buys
// nothing and costs the zeroing Go does on every allocation — on the VR path
// that is thirty megabytes of memset per frame, for a buffer whose contents are
// about to be thrown away. A caller that has finished with each frame before
// asking for the next says so with Reuse, and then one buffer serves the whole
// decode.
func (d *Decoder) destination(w, h int) *image.RGBA {
	if !d.reuse {
		return image.NewRGBA(image.Rect(0, 0, w, h))
	}
	if d.buf == nil || d.buf.Rect.Dx() != w || d.buf.Rect.Dy() != h {
		d.buf = image.NewRGBA(image.Rect(0, 0, w, h))
	}
	return d.buf
}

// Reuse declares that the caller is finished with each frame before it asks for
// the next, which lets one image serve the whole decode instead of one being
// allocated and zeroed per frame.
//
// It is off by default, because the safe reading of a returned frame is that
// the caller owns it. Turn it on only where every frame is consumed on the spot
// — copied, reprojected, encoded — and never where frames are collected into a
// slice that outlives the loop.
func (d *Decoder) Reuse(reuse bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.reuse = reuse
}

// Drain tells the decoder no more input is coming. Keep calling Receive until
// it returns ErrDrained to collect frames still held in the pipeline.
func (d *Decoder) Drain() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.closed || d.drained {
		return nil
	}
	d.drained = true
	return check("Drain", vres(d.dec, iCompDrain))
}

// Flush discards whatever the decoder is holding and returns it to a state
// where it will accept input again.
//
// This is what makes one decoder usable for several unrelated runs. Preview
// generation decodes a dozen short segments from across a film, and each has to
// end by draining the reorder window — which leaves the decoder at end of
// stream. Flushing resets that, so the next segment does not need a decoder of
// its own.
func (d *Decoder) Flush() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.closed {
		return errors.New("amf: decoder is closed")
	}
	if err := check("Flush", vres(d.dec, iCompFlush)); err != nil {
		return err
	}
	if d.conv != nil {
		if err := check("converter Flush", vres(d.conv, iCompFlush)); err != nil {
			return err
		}
	}
	d.drained = false
	return nil
}

// Close releases the GPU resources held by the decoder. It is safe to call more
// than once.
func (d *Decoder) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.closed {
		return nil
	}
	d.closed = true
	d.destroy()
	runtime.SetFinalizer(d, nil)
	return nil
}

// destroy tears the pipeline down in dependency order. It must tolerate partial
// construction, because NewDecoder calls it on every failure path. It also
// tolerates a nil converter, which is the case when SkipConverter is set.
func (d *Decoder) destroy() {
	for _, c := range []*unsafe.Pointer{&d.conv, &d.dec} {
		if *c != nil {
			vcall(*c, iCompTerminate)
			release(*c)
			*c = nil
		}
	}
	// A shared context belongs to the Device, which may still have other decoders
	// on it; terminating it here would take them and the driver with it.
	if d.ctx != nil {
		if d.ownCtx {
			vcall(d.ctx, iCtxTerminate)
			release(d.ctx)
		}
		d.ctx = nil
	}
}
