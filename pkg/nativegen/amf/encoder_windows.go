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

// Encoder encodes RGBA frames to H.264 on the GPU.
//
// It is the mirror of Decoder and chains the same two kinds of component the
// other way round: a video converter that takes the frame from BGRA to the NV12
// the video engine encodes from, and the AVC encoder itself. The conversion runs
// on the GPU, so the only per-pixel work on the CPU is the byte swap that puts a
// Go image.RGBA into an AMF surface.
//
// An Encoder is not safe for concurrent use.
type Encoder struct {
	mu     sync.Mutex
	cfg    EncoderConfig
	ctx    unsafe.Pointer // AMFContext*
	ownCtx bool           // whether Close tears ctx down, or merely a Device backing it
	conv   unsafe.Pointer // AMFComponent*, BGRA -> NV12
	enc    unsafe.Pointer // AMFComponent*, the AVC encoder

	extraData []byte
	drained   bool
	closed    bool
}

// NewEncoder starts an encode session on the GPU, on a context of its own.
//
// It fails with an error wrapping ErrUnavailable when AMF is missing or this GPU
// has no encode engine. Callers should fall back to ffmpeg on that error: every
// AMD part that can decode can also encode H.264, but a machine can have the
// runtime installed with no usable device behind it.
func NewEncoder(cfg EncoderConfig) (*Encoder, error) {
	return newEncoder(nil, cfg)
}

// NewEncoderOn starts an encode session on an existing Device, rather than on a
// context of its own.
//
// Creating the context is most of what NewEncoder costs — the AMF component
// underneath it is comparatively cheap to stand up and tear down. A caller
// that opens and closes many short encoders in a row, as a scene's markers do
// one file each, should share a Device between them the way decoders already
// do; see devices.go.
//
// Closing the returned encoder releases its components and leaves the device
// alone, so one device can outlive any number of encoders built on it.
func NewEncoderOn(dev *Device, cfg EncoderConfig) (*Encoder, error) {
	if dev == nil {
		return nil, fmt.Errorf("%w: nil device", ErrUnavailable)
	}
	return newEncoder(dev, cfg)
}

func newEncoder(dev *Device, cfg EncoderConfig) (*Encoder, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	rt := loadRuntime()
	if rt.err != nil {
		return nil, rt.err
	}

	e := &Encoder{cfg: cfg, ownCtx: dev == nil}

	ok := false
	defer func() {
		if !ok {
			e.destroy()
		}
	}()

	if dev != nil {
		dev.mu.Lock()
		closed := dev.closed
		e.ctx = dev.ctx
		dev.mu.Unlock()
		if closed || e.ctx == nil {
			return nil, fmt.Errorf("%w: device is closed", ErrUnavailable)
		}
	} else {
		if err := check("CreateContext", vres(rt.factory, iFacCreateContext,
			uintptr(unsafe.Pointer(&e.ctx)))); err != nil {
			return nil, err
		}
		if code := vres(e.ctx, iCtxInitDX11, 0, dx11_1); code != resOK {
			if code2 := vres(e.ctx, iCtxInitDX11, 0, dx11_0); code2 != resOK {
				return nil, fmt.Errorf("%w: %v", ErrUnavailable, check("InitDX11", code))
			}
		}
	}
	if err := e.initConverter(); err != nil {
		return nil, err
	}
	if err := e.initEncoder(); err != nil {
		return nil, err
	}

	ok = true
	runtime.SetFinalizer(e, func(e *Encoder) { _ = e.Close() })
	return e, nil
}

// initConverter sets up the BGRA-to-NV12 step.
//
// No scaling happens here: frames arrive at their final size, because for VR
// footage the reprojection has already decided what that size is and for flat
// footage the decoder scaled on the way out. The converter is present only for
// the colour space.
func (e *Encoder) initConverter() error {
	if err := e.createComponent(componentVideoConverter, &e.conv); err != nil {
		return err
	}

	props := []struct {
		name string
		val  variant
	}{
		{propConverterMemoryType, variantInt64Value(memDX11)},
		{propConverterOutputFormat, variantInt64Value(surfaceNV12)},
		{propConverterOutputSize, variantSizeValue(int32(e.cfg.Width), int32(e.cfg.Height))},
		{propConverterScale, variantInt64Value(scaleBicubic)},
		{propConverterKeepAspect, variantBoolValue(false)},
	}
	for _, p := range props {
		if err := setProperty(e.conv, p.name, p.val); err != nil {
			return err
		}
	}

	return check("converter Init", vres(e.conv, iCompInit, surfaceBGRA,
		uintptr(int32(e.cfg.Width)), uintptr(int32(e.cfg.Height))))
}

func (e *Encoder) initEncoder() error {
	if err := e.createComponent(componentEncoderAVC, &e.enc); err != nil {
		return err
	}

	// Usage first and on its own: setting it loads a preset for the named
	// scenario, which overwrites properties already set. Everything that has to
	// survive is set after it.
	if err := setProperty(e.enc, propEncUsage, variantInt64Value(encUsageTranscoding)); err != nil {
		return err
	}

	props := []struct {
		name string
		val  variant
	}{
		{propEncFrameSize, variantSizeValue(int32(e.cfg.Width), int32(e.cfg.Height))},
		{propEncFrameRate, variantRateValue(int32(e.cfg.FrameRateNum), int32(e.cfg.FrameRateDen))},
		{propEncProfile, variantInt64Value(encProfileHigh)},
		{propEncQualityPreset, variantInt64Value(encPresetQuality)},

		// Constant quantiser. The alternative rate-control modes all aim at a
		// bitrate, which for a preview cut from twelve unrelated parts of a film
		// means the still segments are given the same budget as the busy ones.
		{propEncRateControl, variantInt64Value(encRateControlConstantQP)},
		{propEncQPI, variantInt64Value(int64(e.cfg.QP))},
		{propEncQPP, variantInt64Value(int64(e.cfg.QP))},

		{propEncIDRPeriod, variantInt64Value(int64(e.cfg.GOP))},

		// No B-frames. They would buy a little compression and cost a great
		// deal: a B-frame is shown in a different order from the one it is coded
		// in, so the muxer would need a composition-offset table and the
		// encoder's output order would stop matching its input order. Neither is
		// worth it on a nine-second preview.
		{propEncBPicPattern, variantInt64Value(0)},
	}
	for _, p := range props {
		if err := setProperty(e.enc, p.name, p.val); err != nil {
			return err
		}
	}

	code := vres(e.enc, iCompInit, surfaceNV12,
		uintptr(int32(e.cfg.Width)), uintptr(int32(e.cfg.Height)))
	switch code {
	case resCodecNotSupported, resNotSupported:
		return fmt.Errorf("%w: this GPU cannot encode H.264: %v",
			ErrUnavailable, check("Init", code))
	}
	if err := check("encoder Init", code); err != nil {
		return err
	}

	return e.readExtraData()
}

// readExtraData collects the parameter sets the encoder decided on.
//
// These are only available after Init, because they describe choices the
// encoder makes from the configuration rather than choices we handed it. The
// muxer needs them to build the codec configuration record, and they are the one
// thing that cannot be recovered from the packets when the first keyframe
// carries them inline — it does, but a record built from a guess about which
// NALs those are would be worse than the encoder's own answer.
func (e *Encoder) readExtraData() error {
	v, err := getProperty(e.enc, propEncExtraData)
	if err != nil {
		return err
	}
	buf := v.interfaceValue()
	if buf == nil {
		return errors.New("amf: encoder reported no parameter sets")
	}
	defer release(buf)

	native := foreignPtr(vcall(buf, iBufGetNative))
	size := int(vcall(buf, iBufGetSize))
	if native == nil || size <= 0 {
		return errors.New("amf: encoder parameter sets are empty")
	}

	e.extraData = make([]byte, size)
	copy(e.extraData, unsafe.Slice((*byte)(native), size))
	return nil
}

// ExtraData returns the encoder's parameter sets in Annex-B form, valid once the
// encoder has been created.
func (e *Encoder) ExtraData() []byte { return e.extraData }

func (e *Encoder) createComponent(id string, out *unsafe.Pointer) error {
	wid, err := syscall.UTF16PtrFromString(id)
	if err != nil {
		return fmt.Errorf("amf: component id %q: %w", id, err)
	}
	code := vres(loadRuntime().factory, iFacCreateComponent,
		uintptr(e.ctx),
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

// Submit hands one frame to the encoder.
//
// The image must be exactly the configured size. It returns ErrInputFull when
// the encoder's queue is full, in which case the caller should drain with
// Receive and retry.
func (e *Encoder) Submit(img *image.RGBA) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.closed {
		return errors.New("amf: encoder is closed")
	}
	if b := img.Bounds(); b.Dx() != e.cfg.Width || b.Dy() != e.cfg.Height {
		return fmt.Errorf("amf: frame is %dx%d, encoder expects %dx%d",
			b.Dx(), b.Dy(), e.cfg.Width, e.cfg.Height)
	}

	surface, err := e.upload(img)
	if err != nil {
		return err
	}
	defer release(surface)

	nv12, err := e.convert(surface)
	if err != nil {
		return err
	}
	defer release(nv12)

	switch code := vres(e.enc, iCompSubmitInput, uintptr(nv12)); code {
	case resOK:
		return nil
	case resInputFull, resNoFreeSurfaces:
		return ErrInputFull
	default:
		return check("encoder SubmitInput", code)
	}
}

// upload copies a Go image into a GPU surface.
//
// The surface is allocated in host memory and filled directly, then moved to the
// GPU with the same Convert call readback uses in the other direction. Rows are
// copied one at a time because the plane's pitch is padded for alignment and is
// generally wider than the row.
func (e *Encoder) upload(img *image.RGBA) (unsafe.Pointer, error) {
	var surface unsafe.Pointer
	defer pin(&surface)()
	if err := check("AllocSurface", vres(e.ctx, iCtxAllocSurface,
		memHost, surfaceBGRA,
		uintptr(int32(e.cfg.Width)), uintptr(int32(e.cfg.Height)),
		uintptr(unsafe.Pointer(&surface)))); err != nil {
		return nil, err
	}
	if surface == nil {
		return nil, fmt.Errorf("amf: AllocSurface reported success but returned no surface for %dx%d",
			e.cfg.Width, e.cfg.Height)
	}

	ok := false
	defer func() {
		if !ok {
			release(surface)
		}
	}()

	plane := foreignPtr(vcall(surface, iSurfGetPlaneAt, 0))
	if plane == nil {
		return nil, errors.New("amf: allocated surface has no plane 0")
	}
	native := foreignPtr(vcall(plane, iPlaneGetNative))
	if native == nil {
		return nil, errors.New("amf: allocated surface plane has no host pointer")
	}
	pitch := int(int32(vcall(plane, iPlaneGetHPitch)))
	if pitch < e.cfg.Width*4 {
		return nil, fmt.Errorf("amf: surface pitch %d is too narrow for %d pixels",
			pitch, e.cfg.Width)
	}

	dst := unsafe.Slice((*byte)(native), pitch*e.cfg.Height)
	for y := 0; y < e.cfg.Height; y++ {
		srcRow := img.Pix[y*img.Stride : y*img.Stride+e.cfg.Width*4]
		dstRow := dst[y*pitch : y*pitch+e.cfg.Width*4]
		// Go holds RGBA, AMF wants BGRA.
		for x := 0; x < e.cfg.Width*4; x += 4 {
			dstRow[x+0] = srcRow[x+2]
			dstRow[x+1] = srcRow[x+1]
			dstRow[x+2] = srcRow[x+0]
			dstRow[x+3] = srcRow[x+3]
		}
	}

	if err := check("Convert(DX11)", vres(surface, iDataConvert, memDX11)); err != nil {
		return nil, err
	}
	ok = true
	return surface, nil
}

// convert runs a surface through the colour converter, with the same tolerance
// for asynchrony as the decoder's scale step. See Decoder.scale.
func (e *Encoder) convert(surface unsafe.Pointer) (unsafe.Pointer, error) {
	for attempt := 0; ; attempt++ {
		code := vres(e.conv, iCompSubmitInput, uintptr(surface))
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
		code := vres(e.conv, iCompQueryOutput, uintptr(unsafe.Pointer(&out)))
		unpin()
		switch code {
		case resOK:
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

// Receive returns the next encoded packet.
//
// It returns ErrNeedMoreInput when nothing is ready yet, and ErrDrained once a
// drained encoder has emitted everything it was holding.
func (e *Encoder) Receive() (*Packet, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.closed {
		return nil, errors.New("amf: encoder is closed")
	}

	var data unsafe.Pointer
	unpin := pin(&data)
	code := vres(e.enc, iCompQueryOutput, uintptr(unsafe.Pointer(&data)))
	unpin()
	switch code {
	case resOK:
		if data == nil {
			return nil, ErrNeedMoreInput
		}
	case resRepeat, resNeedMoreInput:
		return nil, ErrNeedMoreInput
	case resEOF:
		return nil, ErrDrained
	default:
		return nil, check("encoder QueryOutput", code)
	}
	defer release(data)

	if dt := vcall(data, iDataGetDataType); dt != dataTypeBuffer {
		return nil, fmt.Errorf("amf: encoder produced data type %d, want a buffer", dt)
	}

	// The frame type is carried as a property on the output buffer rather than
	// in the buffer, so the muxer can tell which samples are seek points without
	// having to parse NAL headers to find out.
	keyframe := false
	if v, err := getProperty(data, propEncOutputType); err == nil {
		switch v.int64Value() {
		case encOutputIDR, encOutputI:
			keyframe = true
		}
	}

	native := foreignPtr(vcall(data, iBufGetNative))
	size := int(vcall(data, iBufGetSize))
	if native == nil || size <= 0 {
		return nil, fmt.Errorf("amf: encoder produced an empty packet (%d bytes)", size)
	}

	out := make([]byte, size)
	copy(out, unsafe.Slice((*byte)(native), size))
	return &Packet{Data: out, Keyframe: keyframe}, nil
}

// Drain tells the encoder no more input is coming. Keep calling Receive until it
// returns ErrDrained to collect packets still held in the pipeline.
func (e *Encoder) Drain() error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.closed || e.drained {
		return nil
	}
	e.drained = true
	return check("Drain", vres(e.enc, iCompDrain))
}

// Close releases the GPU resources held by the encoder. It is safe to call more
// than once.
func (e *Encoder) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.closed {
		return nil
	}
	e.closed = true
	e.destroy()
	runtime.SetFinalizer(e, nil)
	return nil
}

func (e *Encoder) destroy() {
	for _, c := range []*unsafe.Pointer{&e.enc, &e.conv} {
		if *c != nil {
			vcall(*c, iCompTerminate)
			release(*c)
			*c = nil
		}
	}
	// A context borrowed from a Device outlives this encoder; only one this
	// encoder created for itself is torn down here.
	if e.ownCtx && e.ctx != nil {
		vcall(e.ctx, iCtxTerminate)
		release(e.ctx)
	}
	e.ctx = nil
}
