package nativegen

import (
	"sync"

	"github.com/stashapp/stash/pkg/nativegen/amf"
)

// Which video engine a decoder runs on is the driver's choice and not ours: AMF
// exposes no property naming an engine. That matters because a decode split
// across two decoders only goes faster if the two land on different engines, and
// two decoders that each create their own AMF context land on the same one often
// enough to make the split a coin flip — on a 7900 XTX the same phash measured
// 26s and 50s on consecutive runs of one binary, an exact factor of the
// single-engine rate apart.
//
// Placement follows the context and its D3D11 device, and it holds for as long as
// the device does. Measured on a 7680x3840 HEVC file, where one engine is 88 fps
// and two are 169:
//
//	two devices created once and kept        169 fps on 13 of 13 runs
//	a fresh context per decoder (no pool)    169 fps on 2 of 3 runs
//	both decoders on one shared device        88 fps — no better than one decoder
//
// So the device is the thing worth keeping, distinctness is the property that
// matters, and keeping it is possible precisely because the device is not what
// varies between files: a decoder is bound to one codec and one frame size at
// Init and cannot outlive the scene it was built for, while a device is bound to
// neither.
//
// Every generator in this package takes its devices from here, which is what
// makes the placement above hold across a whole Generate run rather than only
// within one job: two sprite sheets running side by side get an engine each for
// the same reason a split phash does, and a preview's own two-way split — which
// had exactly the phash coin flip in it — becomes reliable.
//
// What this does not do is cap how many decode sessions exist at once. A caller
// that finds the set busy still decodes, on a context of its own, because the
// alternative is waiting out somebody else's whole file (a preview holds its
// decoders for the length of the scene) for a share of an engine that contending
// would have given it anyway.
//
// That used to read as an admission for a cap yet to be built. It has since been
// measured and there is nothing to build: throughput plateaus at about 2.5x
// serial from four concurrent sheets out to sixteen and never degrades, and
// sixteen concurrent 8K HEVC sessions neither exhausted VRAM nor were refused by
// the driver. A cap at decodeDeviceCount would have held the whole pipeline at
// two-way's 1.66x instead, so the semaphore would have cost a third of the
// throughput it was meant to protect. See concurrency_real_test.go.

// decodeDeviceCount is how many devices the decode set holds.
//
// Two, because that is the number of fixed-function decode engines on the
// hardware this was built for, and a device buys nothing except the engine
// behind it. Holding more would hand out devices whose decoders then contend,
// which is the arrangement the pool exists to avoid; holding fewer would leave an
// engine reachable only by luck.
const decodeDeviceCount = 2

// encodeDeviceCount is how many devices the encode set holds.
//
// It is sized the same as the decode set for the same structural reason — a
// caller with one engine free should not have to wait behind another caller's
// whole job — but nothing here has measured whether this hardware's encode
// block actually has room for two independent sessions the way its decode
// block does. Wrong in either direction costs less than decode getting it
// wrong: too many devices leaves the extras idle rather than contended, and too
// few only reintroduces the coin flip acquire already tolerates.
const encodeDeviceCount = 2

// DevicePoolSize reports how many independent decode-and-encode pipelines can
// run at once without either pool falling back to an unpooled context.
//
// A caller that runs more sessions than this concurrently is not wrong —
// acquire hands out an unpooled context rather than blocking, and every
// generator in this package already tolerates that as a placement cost, not a
// correctness one. But an unpooled context is a full CreateContext/InitDX11
// stood up and torn down for that one session alone, and doing that
// repeatedly across a long-running batch (many markers across many scenes,
// for instance) churns GPU contexts at a rate nothing here has measured the
// driver against. A caller deciding its own concurrency and wanting to stay
// inside pooled placement entirely should size itself to this rather than to
// a guess.
func DevicePoolSize() int {
	return min(decodeDeviceCount, encodeDeviceCount)
}

// deviceSet is a fixed set of AMF devices, created once and kept for the life of
// the process.
//
// It is never torn down. What it holds is a driver context per device and nothing
// per frame, and releasing it between jobs would redraw exactly the placement
// that keeping it exists to preserve.
type deviceSet struct {
	// count is how many devices this set holds. Set at declaration, since it
	// differs between the decode and encode sets below.
	count int

	once sync.Once
	devs []*amf.Device

	// free carries the index of every device nobody is using. A token per device
	// rather than one for the whole set, so that a caller wanting one decoder
	// takes one engine and leaves the other reachable.
	free chan int
}

// decodeDevices and encodeDevices are the process-wide sets. Generators take
// devices from whichever one matches the component they are building and give
// them back; nothing else creates devices.
//
// The two are separate pools rather than one shared set: decode and encode are
// different fixed-function blocks, so a decoder and an encoder sharing one
// Device would not be contending for anything real, but nothing here has
// exercised that combination, and getting it wrong would be a session wedged
// against another session's traffic rather than a merely slow one. Keeping
// them apart costs one extra context per pool and nothing else.
var (
	decodeDevices = deviceSet{count: decodeDeviceCount}
	encodeDevices = deviceSet{count: encodeDeviceCount}
)

func (s *deviceSet) init() {
	s.once.Do(func() {
		devs := make([]*amf.Device, 0, s.count)
		for i := 0; i < s.count; i++ {
			dev, err := amf.NewDevice()
			if err != nil {
				// Nothing is kept if the set cannot be built whole: an odd number
				// of devices would make placement depend on which callers arrived
				// first, and every caller has a working path without them.
				for _, d := range devs {
					d.Close()
				}
				return
			}
			devs = append(devs, dev)
		}

		s.free = make(chan int, len(devs))
		for i := range devs {
			s.free <- i
		}
		s.devs = devs
	})
}

// acquire takes up to n devices and returns them with a function that gives them
// back. The function is nil when it took none.
//
// It never waits, and it will hand back fewer than asked. Callers create their
// own contexts for the shortfall — which is the coin flip described above, still
// worth taking, because losing it costs nothing measurable (a phash split that
// landed on one engine ran 50.3s against 50.4s unsplit) while winning it halves
// the job.
func (s *deviceSet) acquire(n int) ([]*amf.Device, func()) {
	if n < 1 {
		return nil, nil
	}

	s.init()
	if len(s.devs) == 0 {
		return nil, nil
	}

	held := make([]int, 0, n)
	for len(held) < n {
		select {
		case i := <-s.free:
			held = append(held, i)
			continue
		default:
		}
		break
	}
	if len(held) == 0 {
		return nil, nil
	}

	devs := make([]*amf.Device, len(held))
	for j, i := range held {
		devs[j] = s.devs[i]
	}

	// Returning a device twice would fill the channel and block the caller on
	// its own defer, so the release is made idempotent rather than trusted.
	var once sync.Once
	return devs, func() {
		once.Do(func() {
			for _, i := range held {
				s.free <- i
			}
		})
	}
}

// decoderOn opens a decoder on devs[i] when the set had that many to spare, and
// on a context of its own when it did not. Every generator here creates its
// decoders through this, so a short set degrades placement and nothing else.
func decoderOn(devs []*amf.Device, i int, cfg amf.Config) (*amf.Decoder, error) {
	if i < len(devs) {
		return amf.NewDecoderOn(devs[i], cfg)
	}
	return amf.NewDecoder(cfg)
}

// encoderOn is decoderOn's mirror for encoders, backed by encodeDevices rather
// than decodeDevices.
func encoderOn(devs []*amf.Device, i int, cfg amf.EncoderConfig) (*amf.Encoder, error) {
	if i < len(devs) {
		return amf.NewEncoderOn(devs[i], cfg)
	}
	return amf.NewEncoder(cfg)
}
