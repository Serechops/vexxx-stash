package handy

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/stashapp/stash/pkg/logger"
)

const defaultCallTimeout = 5 * time.Second

// errSessionClosed fails calls made on (or outstanding against) a torn-down
// session immediately, instead of letting them sit out defaultCallTimeout.
//
// Engine ops hold e.mu across BLE round-trips, and a feed loop issues dozens of
// them back to back. On a dead link every one of those would block for the full
// timeout, so an explicit Disconnect — which needs e.mu — could be stuck for
// tens of seconds and blow past the UI's op timeout. Closing the session cuts
// them all loose at once.
var errSessionClosed = errors.New("handy session closed")

// notifyQueueDepth bounds the notification hand-off queue. Overflow drops the
// oldest wake-ups, which the engine's watchdog poll recovers from.
const notifyQueueDepth = 64

// Session is the RPC layer over one BLE transport: it correlates responses
// to requests by ID and dispatches notifications.
type Session struct {
	tr *bleTransport

	nextID  atomic.Uint32
	pending sync.Map // uint32 → chan *Response

	// notify receives device notifications on a dedicated dispatch goroutine
	// (never the BLE callback goroutine — see handleFrame). Handlers may block.
	notify  func(*Notification)
	notifCh chan *Notification

	done      chan struct{}
	closeOnce sync.Once

	// clock sync results (for status/UI display)
	syncRtdMs int32
	synced    bool
}

func newSession(notify func(*Notification)) *Session {
	s := &Session{
		notify:  notify,
		notifCh: make(chan *Notification, notifyQueueDepth),
		done:    make(chan struct{}),
	}
	go s.dispatchNotifications()
	return s
}

// close stops the notification dispatcher. Safe to call more than once.
func (s *Session) close() {
	s.closeOnce.Do(func() { close(s.done) })
}

func (s *Session) dispatchNotifications() {
	for {
		select {
		case n := <-s.notifCh:
			if s.notify != nil {
				s.notify(n)
			}
		case <-s.done:
			return
		}
	}
}

// handleFrame is wired as the BLE transport's onFrame callback. It runs on the
// BLE notification goroutine, which is the *only* goroutine that delivers RPC
// responses — so it must never block.
//
// Notifications are therefore queued for the dispatch goroutine rather than
// invoked inline: the engine's handler takes the engine lock, and engine ops
// hold that lock across BLE round-trips. Calling the handler here would block
// the one goroutine that has to deliver the response those ops are waiting for,
// wedging every call until its 5s timeout fires.
func (s *Session) handleFrame(buf []byte) {
	resp, notif, err := DecodeRpcMessage(buf)
	if err != nil {
		logger.Warnf("[handy] undecodable BLE frame (%d bytes): %v", len(buf), err)
		return
	}
	if resp != nil {
		if ch, ok := s.pending.LoadAndDelete(resp.ID); ok {
			ch.(chan *Response) <- resp
		} else {
			logger.Debugf("[handy] response for unknown request id %d", resp.ID)
		}
	}
	if notif != nil {
		select {
		case s.notifCh <- notif:
		default:
			logger.Warnf("[handy] notification queue full; dropped field %d", notif.Field)
		}
	}
}

// call sends one request frame and waits for the matching response.
// enc builds the frame for the allocated request ID.
func (s *Session) call(ctx context.Context, enc func(id uint32) []byte) (*Response, error) {
	if s.tr == nil {
		return nil, fmt.Errorf("not connected")
	}
	select {
	case <-s.done:
		return nil, errSessionClosed
	default:
	}
	id := s.nextID.Add(1)
	ch := make(chan *Response, 1)
	s.pending.Store(id, ch)
	defer s.pending.Delete(id)

	if err := s.tr.write(enc(id)); err != nil {
		return nil, err
	}

	timeout := defaultCallTimeout
	if dl, ok := ctx.Deadline(); ok {
		if until := time.Until(dl); until < timeout {
			timeout = until
		}
	}
	select {
	case resp := <-ch:
		if resp.Err != nil {
			return resp, resp.Err
		}
		return resp, nil
	case <-s.done:
		return nil, errSessionClosed
	case <-time.After(timeout):
		return nil, fmt.Errorf("request %d timed out after %s", id, timeout)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// callHsp performs a call whose response wraps `HspState state = 1`.
func (s *Session) callHsp(ctx context.Context, enc func(id uint32) []byte) (*HspState, error) {
	resp, err := s.call(ctx, enc)
	if err != nil {
		return nil, err
	}
	return DecodeHspState(resp.ResultBytes)
}

// ── Typed RPC wrappers ──────────────────────────────────────────────────────

func (s *Session) ModeSet(ctx context.Context, mode uint64) error {
	_, err := s.call(ctx, func(id uint32) []byte { return encModeSet(id, mode) })
	return err
}

func (s *Session) StopCurrentMode(ctx context.Context) error {
	_, err := s.call(ctx, encStopCurrentMode)
	return err
}

func (s *Session) Capabilities(ctx context.Context) (*Capabilities, error) {
	resp, err := s.call(ctx, encCapabilitiesGet)
	if err != nil {
		return nil, err
	}
	return DecodeCapabilities(resp.ResultBytes)
}

func (s *Session) Battery(ctx context.Context) (*BatteryState, error) {
	resp, err := s.call(ctx, encBatteryGet)
	if err != nil {
		return nil, err
	}
	return DecodeBatteryState(resp.ResultBytes)
}

func (s *Session) HspSetup(ctx context.Context, streamID uint32) (*HspState, error) {
	return s.callHsp(ctx, func(id uint32) []byte { return encHspSetup(id, streamID) })
}

func (s *Session) HspAdd(ctx context.Context, points []Point, flush bool, tailIndex, tailThreshold uint32) (*HspState, error) {
	return s.callHsp(ctx, func(id uint32) []byte {
		return encHspAdd(id, points, flush, tailIndex, tailThreshold)
	})
}

func (s *Session) HspFlush(ctx context.Context) (*HspState, error) {
	return s.callHsp(ctx, encHspFlush)
}

func (s *Session) HspPlay(ctx context.Context, startTimeMs int32, rate float32, loop, pauseOnStarving bool) (*HspState, error) {
	return s.callHsp(ctx, func(id uint32) []byte {
		return encHspPlay(id, startTimeMs, s.serverTimeNow(), rate, loop, pauseOnStarving)
	})
}

func (s *Session) HspStop(ctx context.Context) (*HspState, error) { return s.callHsp(ctx, encHspStop) }
func (s *Session) HspPause(ctx context.Context) (*HspState, error) {
	return s.callHsp(ctx, encHspPause)
}

func (s *Session) HspResume(ctx context.Context, pickUp bool) (*HspState, error) {
	return s.callHsp(ctx, func(id uint32) []byte { return encHspResume(id, pickUp) })
}

func (s *Session) HspState(ctx context.Context) (*HspState, error) {
	return s.callHsp(ctx, encHspStateGet)
}

func (s *Session) HspCurrentTimeSet(ctx context.Context, currentTimeMs int32, filter float32) (*HspState, error) {
	return s.callHsp(ctx, func(id uint32) []byte {
		return encHspCurrentTimeSet(id, currentTimeMs, s.serverTimeNow(), filter)
	})
}

func (s *Session) HspThresholdSet(ctx context.Context, threshold uint32) (*HspState, error) {
	return s.callHsp(ctx, func(id uint32) []byte { return encHspThresholdSet(id, threshold) })
}

func (s *Session) HspRateSet(ctx context.Context, rate float32) (*HspState, error) {
	return s.callHsp(ctx, func(id uint32) []byte { return encHspRateSet(id, rate) })
}

func (s *Session) HspLoopSet(ctx context.Context, loop bool) (*HspState, error) {
	return s.callHsp(ctx, func(id uint32) []byte { return encHspLoopSet(id, loop) })
}

func (s *Session) HdspXpVp(ctx context.Context, xp, vp float32, stopOnTarget bool) error {
	_, err := s.call(ctx, func(id uint32) []byte { return encHdspXpVpSet(id, xp, vp, stopOnTarget) })
	return err
}

func (s *Session) HdspXpT(ctx context.Context, xp float32, t uint32, stopOnTarget bool) error {
	_, err := s.call(ctx, func(id uint32) []byte { return encHdspXpTSet(id, xp, t, stopOnTarget) })
	return err
}

func (s *Session) HdspStop(ctx context.Context) error {
	_, err := s.call(ctx, encHdspStop)
	return err
}

func (s *Session) HampStart(ctx context.Context) error {
	_, err := s.call(ctx, encHampStart)
	return err
}

func (s *Session) HampStop(ctx context.Context) error {
	_, err := s.call(ctx, encHampStop)
	return err
}

func (s *Session) HampVelocitySet(ctx context.Context, velocity float32) error {
	_, err := s.call(ctx, func(id uint32) []byte { return encHampVelocitySet(id, velocity) })
	return err
}

func (s *Session) HvpSet(ctx context.Context, amplitude float32, frequency uint32, position float32) error {
	_, err := s.call(ctx, func(id uint32) []byte { return encHvpSet(id, amplitude, frequency, position) })
	return err
}

func (s *Session) HvpStart(ctx context.Context) error {
	_, err := s.call(ctx, encHvpStart)
	return err
}

func (s *Session) HvpStop(ctx context.Context) error {
	_, err := s.call(ctx, encHvpStop)
	return err
}

func (s *Session) StrokeGet(ctx context.Context) (*StrokeRange, error) {
	resp, err := s.call(ctx, encSliderStrokeGet)
	if err != nil {
		return nil, err
	}
	return DecodeStrokeRange(resp.ResultBytes)
}

func (s *Session) StrokeSet(ctx context.Context, min, max float32) error {
	_, err := s.call(ctx, func(id uint32) []byte { return encSliderStrokeSet(id, min, max) })
	return err
}

// ── Clock sync ──────────────────────────────────────────────────────────────

// serverTimeNow returns the "estimated server time" parameter for timed
// commands. After ClockSync pushes our UNIX-epoch offset to the device, the
// device and this host share the same epoch, so wall clock time is correct.
func (s *Session) serverTimeNow() uint64 {
	return uint64(time.Now().UnixMilli())
}

// ClockSync measures the offset between this host's UNIX clock and the
// device's ms-since-boot clock over several samples (median-filtered, same
// approach as the vendor reference implementation), then stores it on the
// device via RequestClockOffsetSet. Timed commands (HspPlay/CurrentTimeSet)
// then get BLE-latency compensation for free.
func (s *Session) ClockSync(ctx context.Context, samples int) error {
	if samples < 3 {
		samples = 3
	}
	type sample struct {
		offset int64
		rtd    int64
	}
	all := make([]sample, 0, samples)
	for i := 0; i < samples; i++ {
		before := time.Now().UnixMilli()
		resp, err := s.call(ctx, encClockOffsetGet)
		if err != nil {
			return fmt.Errorf("clock sync sample %d: %w", i, err)
		}
		after := time.Now().UnixMilli()
		c, err := DecodeClockOffset(resp.ResultBytes)
		if err != nil {
			return err
		}
		rtd := after - before
		// device machine time was sampled ~mid-flight
		unixAtSample := before + rtd/2
		all = append(all, sample{offset: unixAtSample - int64(c.Time), rtd: rtd})
		time.Sleep(30 * time.Millisecond)
	}

	sort.Slice(all, func(i, j int) bool { return all[i].rtd < all[j].rtd })
	med := all[len(all)/2]

	if _, err := s.call(ctx, func(id uint32) []byte {
		return encClockOffsetSet(id, med.offset, int32(med.rtd))
	}); err != nil {
		return fmt.Errorf("storing clock offset: %w", err)
	}
	s.syncRtdMs = int32(med.rtd)
	s.synced = true
	logger.Infof("[handy] clock synced: offset %dms, median RTD %dms", med.offset, med.rtd)
	return nil
}
