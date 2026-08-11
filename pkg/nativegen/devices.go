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
// would have given it anyway. A real cap wants a per-segment admission
// semaphore, not a device pool.

// decodeDeviceCount is how many devices the set holds.
//
// Two, because that is the number of fixed-function decode engines on the
// hardware this was built for, and a device buys nothing except the engine
// behind it. Holding more would hand out devices whose decoders then contend,
// which is the arrangement the pool exists to avoid; holding fewer would leave an
// engine reachable only by luck.
const decodeDeviceCount = 2

// deviceSet is a fixed set of AMF devices, created once and kept for the life of
// the process.
//
// It is never torn down. What it holds is a driver context per device and nothing
// per frame, and releasing it between jobs would redraw exactly the placement
// that keeping it exists to preserve.
type deviceSet struct {
	once sync.Once
	devs []*amf.Device

	// free carries the index of every device nobody is using. A token per device
	// rather than one for the whole set, so that a caller wanting one decoder
	// takes one engine and leaves the other reachable.
	free chan int
}

// decodeDevices is the process-wide set. Generators take devices from it while
// they need them and give them back; nothing else creates devices.
var decodeDevices deviceSet

func (s *deviceSet) init() {
	s.once.Do(func() {
		devs := make([]*amf.Device, 0, decodeDeviceCount)
		for i := 0; i < decodeDeviceCount; i++ {
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
