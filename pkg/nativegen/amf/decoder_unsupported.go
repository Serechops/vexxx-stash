//go:build !windows

package amf

import (
	"fmt"
	"image"
)

// Decoder is the non-Windows placeholder. AMF ships a Linux runtime, but this
// binding dispatches through the Windows calling convention and loads
// amfrt64.dll by name, so it is Windows-only for now. Callers get
// ErrUnavailable and fall back to ffmpeg.
type Decoder struct{}

func unavailable() error {
	return fmt.Errorf("%w: the AMF backend is only implemented on Windows", ErrUnavailable)
}

// Available always reports false on this platform.
func Available() bool { return false }

// Version always fails on this platform.
func Version() (string, error) { return "", unavailable() }

// NewDecoder always fails on this platform.
func NewDecoder(cfg Config) (*Decoder, error) { return nil, unavailable() }

// Device is the non-Windows placeholder, for the same reason as Decoder.
type Device struct{}

// NewDevice always fails on this platform.
func NewDevice() (*Device, error) { return nil, unavailable() }

func (dev *Device) Close() error { return nil }

// NewDecoderOn always fails on this platform.
func NewDecoderOn(dev *Device, cfg Config) (*Decoder, error) { return nil, unavailable() }

func (d *Decoder) Submit(data []byte, pts int64) error { return unavailable() }
func (d *Decoder) Receive() (*Frame, error)            { return nil, unavailable() }
func (d *Decoder) ReceiveNV12() (*FrameNV12, error)    { return nil, unavailable() }
func (d *Decoder) Drain() error                        { return unavailable() }
func (d *Decoder) Flush() error                        { return unavailable() }
func (d *Decoder) SetWanted(want func(pts int64) bool) {}
func (d *Decoder) Close() error                        { return nil }
func (d *Decoder) Reuse(reuse bool)                    {}

// Encoder is the non-Windows placeholder, for the same reason as Decoder.
type Encoder struct{}

// NewEncoder always fails on this platform.
func NewEncoder(cfg EncoderConfig) (*Encoder, error) { return nil, unavailable() }

// NewEncoderOn always fails on this platform.
func NewEncoderOn(dev *Device, cfg EncoderConfig) (*Encoder, error) { return nil, unavailable() }

func (e *Encoder) Submit(img *image.RGBA) error { return unavailable() }
func (e *Encoder) Receive() (*Packet, error)    { return nil, unavailable() }
func (e *Encoder) ExtraData() []byte            { return nil }
func (e *Encoder) Drain() error                 { return unavailable() }
func (e *Encoder) Close() error                 { return nil }
