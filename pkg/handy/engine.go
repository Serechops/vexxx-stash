package handy

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/stashapp/stash/pkg/logger"
)

// Feeding tuning. The device buffer size (max_points) is reported by the
// firmware; these bound how much of it we use and when we top it up.
//
// Feeding is two-stage: every HspAdd is a BLE round-trip carrying ~18 points,
// so preloading the full window costs seconds during which the device is not
// moving. Load just enough to start (startupFeedTarget — still tens of seconds
// of script), start playback, then let the background feeder take the buffer up
// to initialFeedTarget.
const (
	initialFeedTarget = 900  // points to hold in the device buffer while playing
	startupFeedTarget = 150  // points to preload *before* starting playback
	topUpMargin       = 60   // ask for a threshold notification this many points before the feed tail
	maxPointsPerAdd   = 100  // protocol limit per HspAdd
	seekRefeedSlackMs = 1000 // required headroom before buffer end for an in-buffer seek
	driftSeekMs       = 2500 // drift beyond this triggers a full seek/refeed
	driftCorrectMs    = 120  // drift beyond this (≤ driftSeekMs) sends a CurrentTimeSet
	syncMinInterval   = time.Second

	// watchdogInterval is how often we re-poll device state while playing.
	// Buffer top-ups are otherwise driven purely by BLE notifications, which
	// are unacknowledged: a single dropped threshold notify would leave the
	// device to drain its buffer and stop mid-scene, with our cached state
	// stale-high so the feeder never notices.
	watchdogInterval = 750 * time.Millisecond

	// stallTicks is how many consecutive watchdog polls the device's script
	// clock may sit frozen (while it claims to be playing) before we call the
	// playback stalled in the log.
	stallTicks = 4

	// telemetryEvery throttles the periodic playback-telemetry debug line to
	// one per this many watchdog ticks.
	telemetryEvery = 10
)

// playStateName renders an HspState.PlayState for log lines.
func playStateName(s uint32) string {
	switch s {
	case HspStatePlaying:
		return "playing"
	case HspStateStopped:
		return "stopped"
	case HspStatePaused:
		return "paused"
	case HspStateStarving:
		return "starving"
	default:
		return fmt.Sprintf("state-%d", s)
	}
}

// EngineStatus is a snapshot pushed to the UI over the WebSocket.
type EngineStatus struct {
	Connected    bool    `json:"connected"`
	DeviceName   string  `json:"deviceName,omitempty"`
	Battery      *uint32 `json:"battery,omitempty"`
	ScriptPoints int     `json:"scriptPoints"`
	Playing      bool    `json:"playing"`
	PlayState    uint32  `json:"playState"`
	BufferPoints uint32  `json:"bufferPoints"`
	MaxPoints    uint32  `json:"maxPoints"`
	CurrentTime  int32   `json:"currentTime"`
	SyncRtdMs    int32   `json:"syncRtdMs"`
	Mtu          int     `json:"mtu"`
}

// Engine drives HSP playback of a loaded script over one connected session.
type Engine struct {
	mu sync.Mutex

	session   *Session
	transport *bleTransport

	script   []Point
	fedIdx   int    // next script index to feed
	fedAbs   uint32 // absolute stream index of the next point (== count fed this stream)
	streamID uint32

	currentMode uint64
	playing     bool
	rate        float32
	loop        bool

	// Play and SyncTime are issued by the player on video events (`playing`,
	// `seeking`, `timeupdate`) and run as concurrent ops, but they serialize on
	// e.mu behind whatever BLE work is already in flight — a fresh stream feeds
	// the device for seconds. Ops that queued up in the meantime carry positions
	// the video has long since passed; replaying them would tear the stream down
	// and refeed it once per queued op. Each op takes a ticket on entry and drops
	// itself once it has the lock if a newer one has arrived.
	playGen atomic.Uint64
	syncGen atomic.Uint64

	// wall-clock playback tracking for drift decisions
	playPosMs   int32
	playStarted time.Time
	lastSyncAt  time.Time

	lastState  HspState
	battery    *uint32
	topUpBusy  atomic.Bool
	feedNotify chan struct{}

	// Watchdog-driven playback health tracking (all guarded by e.mu). The
	// device clock freezing, or the device stopping while we still expect
	// motion, are exactly the "playback silently died" cases that used to go
	// unlogged — track them so they surface in the log the moment they happen.
	stallClockMs  int32 // last CurrentTime observed by the watchdog
	stallCount    int   // consecutive ticks the clock sat frozen while playing
	stallLogged   bool  // suppresses repeat stall warnings for one stall
	stoppedLogged bool  // suppresses repeat unexpected-stop warnings
	tickCount     uint64

	// Watchdog lifecycle is guarded by its own mutex, not e.mu: it is stopped
	// from the BLE disconnect path, which must not wait on an engine op that is
	// itself blocked on a dying link.
	wdMu         sync.Mutex
	watchdogStop chan struct{}

	// StatusFunc, when set, receives a status snapshot after notable changes.
	StatusFunc func(EngineStatus)
}

func newEngine() *Engine {
	return &Engine{rate: 1.0, feedNotify: make(chan struct{}, 1)}
}

// Status returns a snapshot of engine state.
func (e *Engine) Status() EngineStatus {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.statusLocked()
}

func (e *Engine) statusLocked() EngineStatus {
	st := EngineStatus{
		Connected:    e.session != nil && e.transport != nil,
		ScriptPoints: len(e.script),
		Playing:      e.playing,
		PlayState:    e.lastState.PlayState,
		BufferPoints: e.lastState.Points,
		MaxPoints:    e.lastState.MaxPoints,
		CurrentTime:  e.lastState.CurrentTime,
		Battery:      e.battery,
	}
	if e.transport != nil {
		st.DeviceName = e.transport.deviceName
		st.Mtu = e.transport.mtu
	}
	if e.session != nil {
		st.SyncRtdMs = e.session.syncRtdMs
	}
	return st
}

func (e *Engine) pushStatus() {
	if e.StatusFunc != nil {
		e.StatusFunc(e.Status())
	}
}

// handleNotification runs on the BLE notify goroutine — must not block.
func (e *Engine) handleNotification(n *Notification) {
	switch n.Field {
	case NotifHspThresholdReached, NotifHspStarving:
		if s, err := DecodeHspState(n.Bytes); err == nil {
			e.mu.Lock()
			e.lastState = *s
			e.mu.Unlock()
		}
		e.requestTopUp()
	case NotifHspStateChanged, NotifHspLooping, NotifHspPausedOnStarving, NotifHspResumedNonStarve:
		if s, err := DecodeHspState(n.Bytes); err == nil {
			e.mu.Lock()
			e.lastState = *s
			playing := e.playing
			unplayed := e.unplayedLocked()
			scriptDone := e.fedIdx >= len(e.script)
			e.mu.Unlock()
			if n.Field == NotifHspPausedOnStarving && playing {
				if !scriptDone {
					// A starve with script left to feed means the feeder fell behind
					// the device — the precursor of a playback drop-off.
					logger.Warnf("[handy] device starved mid-script: ct=%dms unplayed=%d buffer=%d/%d stream=%d",
						s.CurrentTime, unplayed, s.Points, s.MaxPoints, s.StreamID)
				}
				// A parked device needs refilling *and* resuming; don't wait for
				// the watchdog's next tick to notice.
				e.requestTopUp()
			}
			e.pushStatus()
		}
	case NotifBatteryChanged:
		if b, err := DecodeBatteryState(n.Bytes); err == nil {
			e.mu.Lock()
			e.battery = &b.Level
			e.mu.Unlock()
			e.pushStatus()
		}
	case NotifError:
		if rpcErr, err := DecodeRpcErrorNotification(n.Bytes); err == nil {
			logger.Warnf("[handy] device error notification: %v", rpcErr)
		}
	case NotifTempHigh:
		logger.Warnf("[handy] device reports high temperature")
	case NotifSliderBlocked:
		logger.Warnf("[handy] device reports slider blocked")
	}
}

// requestTopUp wakes the background feeder. It never blocks: callers may hold
// e.mu, which the feeder itself needs.
func (e *Engine) requestTopUp() {
	select {
	case e.feedNotify <- struct{}{}:
	default:
	}
	if e.topUpBusy.CompareAndSwap(false, true) {
		go e.topUpLoop()
	}
}

// topUpLoop drains feedNotify wake-ups, servicing the device buffer.
func (e *Engine) topUpLoop() {
	defer e.topUpBusy.Store(false)
	for {
		select {
		case <-e.feedNotify:
			e.mu.Lock()
			err := e.serviceBufferLocked(context.Background())
			e.mu.Unlock()
			if err != nil && !errors.Is(err, errSessionClosed) {
				// Never abandon the stream on a single failure — that used to
				// end playback for the rest of the scene. The watchdog re-polls
				// device state and retries the top-up.
				//
				// A closed session is not a failure: it's a disconnect racing
				// this feed, and it's already logged as one.
				logger.Warnf("[handy] buffer top-up failed: %v", err)
			}
		default:
			return
		}
	}
}

// serviceBufferLocked tops the device buffer back up and, if the device paused
// itself on starvation, resumes it. Caller holds e.mu.
func (e *Engine) serviceBufferLocked(ctx context.Context) error {
	if e.session == nil || !e.playing {
		return nil
	}
	if err := e.feedLocked(ctx, 0); err != nil {
		return err
	}

	state := e.lastState.PlayState
	if state != HspStateStarving && state != HspStatePaused {
		return nil
	}

	// Everything fed and everything played: the script has genuinely played
	// out, so let it end rather than resuming into silence.
	if e.fedIdx >= len(e.script) && e.unplayedLocked() == 0 {
		e.playing = false
		logger.Infof("[handy] script playback completed (%d points, ct=%dms, stream=%d)",
			len(e.script), e.lastState.CurrentTime, e.lastState.StreamID)
		e.pushStatusLockedAsync()
		return nil
	}

	// Playback is started with pauseOnStarving, so the device parks itself when
	// it runs dry. Refilling alone restarts it "without time adjustments", i.e.
	// behind the video by however long the starve lasted — resume with pickUp
	// to jump to where the script clock should be now.
	st, err := e.session.HspResume(ctx, true)
	if err != nil {
		// The device auto-resumes when points are added while paused on
		// starving, and a resume sent while it is already playing is rejected
		// with ESP_ERR_INVALID_STATE (259). Re-read the truth before treating
		// the rejection as a failure; the drift sync catches the position up.
		if cur, serr := e.session.HspState(ctx); serr == nil {
			e.lastState = *cur
			if cur.PlayState == HspStatePlaying {
				return nil
			}
		}
		return fmt.Errorf("resuming after buffer starve: %w", err)
	}
	e.lastState = *st
	logger.Infof("[handy] resumed playback after buffer starve (ct=%dms unplayed=%d fed=%d/%d)",
		st.CurrentTime, e.unplayedLocked(), e.fedIdx, len(e.script))
	return nil
}

// startWatchdog runs a periodic device-state poll for the life of a connection.
func (e *Engine) startWatchdog() {
	e.wdMu.Lock()
	defer e.wdMu.Unlock()
	if e.watchdogStop != nil {
		return
	}
	stop := make(chan struct{})
	e.watchdogStop = stop

	go func() {
		t := time.NewTicker(watchdogInterval)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				e.watchdogTick(context.Background())
			case <-stop:
				return
			}
		}
	}()
}

func (e *Engine) stopWatchdog() {
	e.wdMu.Lock()
	stop := e.watchdogStop
	e.watchdogStop = nil
	e.wdMu.Unlock()
	if stop != nil {
		close(stop)
	}
}

// watchdogTick re-reads device state from the device itself and services the
// buffer. This is the safety net that makes a missed or dropped notification
// survivable instead of terminal.
func (e *Engine) watchdogTick(ctx context.Context) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.session == nil || !e.playing {
		return
	}

	st, err := e.session.HspState(ctx)
	if err != nil {
		// A closed session means a disconnect landed between the nil check and
		// the poll; that's expected teardown, not a device fault.
		if !errors.Is(err, errSessionClosed) {
			logger.Warnf("[handy] watchdog: device state poll failed: %v", err)
		}
		return
	}
	e.lastState = *st
	e.trackPlaybackHealthLocked(st)

	if err := e.serviceBufferLocked(ctx); err != nil {
		if !errors.Is(err, errSessionClosed) {
			logger.Warnf("[handy] watchdog: %v", err)
		}
		return
	}
	e.pushStatusLockedAsync()
}

// trackPlaybackHealthLocked watches for the two silent-death signatures the
// buffer servicing itself can't see: the device claiming to play while its
// script clock is frozen, and the device sitting stopped while we still expect
// motion. Both warn once per incident instead of once per tick. It also emits
// a throttled telemetry line so a debug-level log reconstructs the feed state
// around any incident. Caller holds e.mu and has just refreshed e.lastState.
func (e *Engine) trackPlaybackHealthLocked(st *HspState) {
	e.tickCount++

	if st.PlayState == HspStatePlaying {
		if st.CurrentTime == e.stallClockMs {
			e.stallCount++
			if e.stallCount >= stallTicks && !e.stallLogged {
				e.stallLogged = true
				logger.Warnf("[handy] playback stalled: script clock frozen at %dms for %v (state=%s unplayed=%d fed=%d/%d stream=%d)",
					st.CurrentTime, time.Duration(e.stallCount)*watchdogInterval,
					playStateName(st.PlayState), e.unplayedLocked(), e.fedIdx, len(e.script), st.StreamID)
			}
		} else {
			if e.stallLogged {
				logger.Infof("[handy] playback recovered: script clock moving again (ct=%dms)", st.CurrentTime)
			}
			e.stallClockMs = st.CurrentTime
			e.stallCount = 0
			e.stallLogged = false
		}
		e.stoppedLogged = false
	} else {
		e.stallCount = 0
		e.stallLogged = false
		// serviceBufferLocked recovers paused/starving states; a hard "stopped"
		// while playback intent is set means the stream died under us.
		if st.PlayState == HspStateStopped && !e.stoppedLogged {
			e.stoppedLogged = true
			logger.Warnf("[handy] device reports stopped while playback expected (ct=%dms unplayed=%d fed=%d/%d stream=%d)",
				st.CurrentTime, e.unplayedLocked(), e.fedIdx, len(e.script), st.StreamID)
		}
	}

	if e.tickCount%telemetryEvery == 0 {
		logger.Debugf("[handy] playback: state=%s ct=%dms unplayed=%d fed=%d/%d buffer=%d/%d stream=%d est=%dms",
			playStateName(st.PlayState), st.CurrentTime, e.unplayedLocked(),
			e.fedIdx, len(e.script), st.Points, st.MaxPoints, st.StreamID, e.estimatedPosLocked())
	}
}

// batchSize computes points per HspAdd bounded by the ATT frame size.
// Encoded point ≈ (1 tag + 1 len + ≤6 t + ≤3 x) ≤ 11 bytes; envelope ≈ 40.
func (e *Engine) batchSize() int {
	if e.transport == nil {
		return 10
	}
	n := (e.transport.maxFrame() - 40) / 11
	if n < 10 {
		n = 10
	}
	if n > maxPointsPerAdd {
		n = maxPointsPerAdd
	}
	return n
}

// unplayedLocked estimates how many fed points the device has not yet played,
// from its script clock and our copy of the script.
//
// The device cannot answer this directly: HspState's points/first_point_time/
// last_point_time describe buffer *contents* and, per the vendor proto, update
// only when points are added or cleared — they never drop as playback consumes
// points — and current_point is documented as non-monotonic and approximate.
// The proto's own advice is to derive playback position from current_time and
// the client's point list, which is what this does.
func (e *Engine) unplayedLocked() int {
	// points fed this stream are script[fedIdx-fedAbs : fedIdx]
	feedStart := e.fedIdx - int(e.fedAbs)
	if feedStart < 0 {
		feedStart = 0
	}
	ct := int64(e.lastState.CurrentTime)
	// first fed point strictly after the script clock
	lo, hi := feedStart, e.fedIdx
	for lo < hi {
		mid := (lo + hi) / 2
		if int64(e.script[mid].T) > ct {
			hi = mid
		} else {
			lo = mid + 1
		}
	}
	return e.fedIdx - lo
}

// feedLocked pushes script points to the device buffer until the high-water
// target of unplayed points is met (or the script is exhausted). startTarget
// of 0 means "top up".
func (e *Engine) feedLocked(ctx context.Context, startTarget int) error {
	if e.session == nil {
		return fmt.Errorf("not connected")
	}
	target := startTarget
	if target == 0 {
		target = initialFeedTarget
	}
	if max := int(e.lastState.MaxPoints); max > 0 && target > max-topUpMargin {
		target = max - topUpMargin
	}

	batch := e.batchSize()
	for e.fedIdx < len(e.script) && e.unplayedLocked() < target {
		end := e.fedIdx + batch
		if end > len(e.script) {
			end = len(e.script)
		}
		pts := e.script[e.fedIdx:end]
		newAbs := e.fedAbs + uint32(len(pts))

		// Ask the device to notify us shortly before it plays out what we've
		// fed, unless the whole script is already in flight.
		threshold := uint32(0)
		if end < len(e.script) {
			if newAbs > topUpMargin {
				threshold = newAbs - topUpMargin
			} else {
				threshold = 1
			}
		}

		st, err := e.session.HspAdd(ctx, pts, false, newAbs-1, threshold)
		if err != nil {
			return err
		}
		e.lastState = *st
		e.fedIdx = end
		e.fedAbs = newAbs
	}
	return nil
}

// LoadScript replaces the current script. Playback is stopped.
func (e *Engine) LoadScript(ctx context.Context, points []Point) error {
	e.playGen.Add(1) // a play for the outgoing script must not land after this
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.session != nil && e.playing {
		if st, err := e.session.HspStop(ctx); err == nil {
			e.lastState = *st
		}
	}
	e.script = points
	e.fedIdx = 0
	e.fedAbs = 0
	e.playing = false
	if n := len(points); n > 0 {
		logger.Infof("[handy] script loaded: %d points, %dms long", n, points[n-1].T)
	} else {
		logger.Infof("[handy] script cleared")
	}
	e.pushStatusLockedAsync()
	return nil
}

// pushStatusLockedAsync schedules a status push without holding the lock in
// the callback.
func (e *Engine) pushStatusLockedAsync() {
	if e.StatusFunc == nil {
		return
	}
	st := e.statusLocked()
	go e.StatusFunc(st)
}

func (e *Engine) ensureModeLocked(ctx context.Context, mode uint64) error {
	if e.currentMode == mode {
		return nil
	}
	if err := e.session.ModeSet(ctx, mode); err != nil {
		return err
	}
	e.currentMode = mode
	return nil
}

// Play starts (or seeks) playback at posMs — the script position as of the
// moment the op arrived. When the position is already inside the device buffer
// it seeks without refeeding; otherwise the buffer is rebuilt from the new
// position.
//
// posMs is treated as a position *sampled at `at`*, not as a position to start
// at whenever we get around to it. Filling a fresh stream takes a BLE round-trip
// per batch of points, so seconds can pass between the op arriving and HspPlay
// landing — and the video plays throughout. Starting at the raw posMs would put
// the device that far behind the video before it moved a millimetre, which the
// drift sync would then have to seek back out of.
func (e *Engine) Play(ctx context.Context, posMs int32, rate float32, loop bool) error {
	at := time.Now()
	gen := e.playGen.Add(1)

	e.mu.Lock()
	defer e.mu.Unlock()
	if e.playGen.Load() != gen {
		// Superseded while we waited for the lock: a newer play (a seek, or the
		// player's follow-up play event) is already queued behind us. Running
		// this one would set up and refeed a whole stream just to have the next
		// one tear it down again.
		return nil
	}
	if e.session == nil {
		return fmt.Errorf("not connected")
	}
	if len(e.script) == 0 {
		return fmt.Errorf("no script loaded")
	}
	if !loop && posMs > int32(e.script[len(e.script)-1].T) {
		// Past the end of the script. The player goes on calling play (the video
		// is still running, it's just longer than the funscript), and each call
		// would build a stream the device instantly starves out of. Stop instead.
		e.playing = false
		return nil
	}
	if rate <= 0 {
		rate = 1.0
	}
	e.rate = rate
	e.loop = loop

	if err := e.ensureModeLocked(ctx, ModeHsp); err != nil {
		return fmt.Errorf("switching to HSP mode: %w", err)
	}

	inBuffer := e.fedAbs > 0 &&
		e.lastState.StreamID == e.streamID &&
		uint32(posMs) >= e.lastState.FirstPointTime &&
		(e.fedIdx >= len(e.script) || uint32(posMs)+seekRefeedSlackMs <= e.lastState.LastPointTime)

	if !inBuffer {
		// fresh stream from the new position
		e.streamID++
		st, err := e.session.HspSetup(ctx, e.streamID)
		if err != nil {
			return fmt.Errorf("HSP setup: %w", err)
		}
		e.lastState = *st
		// The stream clock only starts meaning anything once HspPlay lands.
		// Pin it to the intended start position so the unplayed-count math in
		// feedLocked below measures against posMs, not against a leftover
		// clock value from the setup response or the previous stream.
		e.lastState.CurrentTime = posMs

		// start from the point at or before posMs
		idx := 0
		for i, p := range e.script {
			if int32(p.T) > posMs {
				break
			}
			idx = i
		}
		e.fedIdx = idx
		e.fedAbs = 0
		// Only enough to start moving — the background feeder takes it the rest
		// of the way once the device is playing.
		if err := e.feedLocked(ctx, startupFeedTarget); err != nil {
			return fmt.Errorf("feeding script: %w", err)
		}
	}

	// Device-side looping only works when the whole script fits in the
	// buffer; otherwise the UI's own loop handling re-plays from 0 and we
	// refeed then.
	deviceLoop := loop && e.fedIdx >= len(e.script) && e.fedAbs <= e.lastState.MaxPoints

	// The video has moved on by however long the setup above took.
	startMs := e.projectLocked(posMs, at)

	st, err := e.session.HspPlay(ctx, startMs, rate, deviceLoop, true)
	if err != nil {
		return fmt.Errorf("HSP play: %w", err)
	}
	e.lastState = *st
	e.playing = true
	e.playPosMs = startMs
	e.playStarted = time.Now()
	// A (re)play starts a fresh health-tracking window.
	e.stallClockMs = st.CurrentTime
	e.stallCount = 0
	e.stallLogged = false
	e.stoppedLogged = false
	logger.Infof("[handy] playback started at %dms (rate %.2f, loop %v, stream %d, fed %d/%d, refeed=%v, setup %dms)",
		startMs, rate, loop, e.streamID, e.fedIdx, len(e.script), !inBuffer, startMs-posMs)
	e.pushStatusLockedAsync()

	// Now that the device is moving, fill the buffer out to the full window.
	e.requestTopUp()
	return nil
}

// projectLocked advances a position sampled at `at` to where it should be now,
// at the current playback rate. Caller holds e.mu.
func (e *Engine) projectLocked(posMs int32, at time.Time) int32 {
	return posMs + int32(float64(time.Since(at).Milliseconds())*float64(e.rate))
}

// Pause halts motion, keeping the buffer for resume.
func (e *Engine) Pause(ctx context.Context) error {
	// Invalidate any play that is still waiting for the lock. Ops are handled
	// concurrently, so a play issued just before the pause could otherwise land
	// after it and leave the device stroking to a paused video.
	e.playGen.Add(1)
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.playing {
		return nil
	}
	// Clear the intent before touching the device. e.playing doubles as "the
	// user wants motion", which the reconnect path consults — a pause that
	// lands during a BLE outage must not be undone by the auto-resume.
	e.playing = false
	if e.session == nil {
		e.pushStatusLockedAsync()
		return nil
	}
	st, err := e.session.HspPause(ctx)
	if err != nil {
		return err
	}
	e.lastState = *st
	e.pushStatusLockedAsync()
	return nil
}

// Stop ends playback and discards position.
func (e *Engine) Stop(ctx context.Context) error {
	e.playGen.Add(1) // same race as Pause
	e.mu.Lock()
	defer e.mu.Unlock()
	e.playing = false
	if e.session == nil {
		e.pushStatusLockedAsync()
		return nil
	}
	st, err := e.session.HspStop(ctx)
	if err == nil {
		e.lastState = *st
	}
	e.pushStatusLockedAsync()
	return err
}

// ResumeAfterReconnect restarts script playback if the link dropped mid-scene.
// The video never stopped, so the position to resume at is the pre-drop anchor
// advanced by the wall-clock time the outage took.
func (e *Engine) ResumeAfterReconnect(ctx context.Context) {
	e.mu.Lock()
	if e.session == nil || !e.playing || len(e.script) == 0 {
		e.mu.Unlock()
		return
	}
	pos := e.estimatedPosLocked()
	rate, loop := e.rate, e.loop
	e.mu.Unlock()

	if err := e.Play(ctx, pos, rate, loop); err != nil {
		logger.Warnf("[handy] resuming playback after reconnect failed: %v", err)
		return
	}
	logger.Infof("[handy] resumed script playback at %dms after reconnect", pos)
}

// estimatedPosLocked projects the script position from the last play anchor.
func (e *Engine) estimatedPosLocked() int32 {
	return e.playPosMs + int32(float64(time.Since(e.playStarted).Milliseconds())*float64(e.rate))
}

// SyncTime nudges the device's script clock towards posMs — the video position
// as of the moment the op arrived. Large drift triggers a real seek. No-op while
// paused.
func (e *Engine) SyncTime(ctx context.Context, posMs int32) error {
	at := time.Now()
	gen := e.syncGen.Add(1)

	e.mu.Lock()
	if e.session == nil || !e.playing || e.syncGen.Load() != gen {
		// Superseded syncs are dropped rather than applied: they queue behind
		// whatever BLE work holds the lock and then arrive in a burst, each
		// carrying a position the video passed seconds ago. Acting on the older
		// ones would seek the device *backwards* out of sync.
		e.mu.Unlock()
		return nil
	}
	target := e.projectLocked(posMs, at)
	signedDrift := target - e.estimatedPosLocked()
	drift := signedDrift
	if drift < 0 {
		drift = -drift
	}
	throttled := time.Since(e.lastSyncAt) < syncMinInterval
	rate, loop := e.rate, e.loop
	e.mu.Unlock()

	switch {
	case drift > driftSeekMs:
		// This is the "forced sync" path: something let the script clock and
		// the video diverge far enough that a nudge can't close it. Warn with
		// the signed drift (negative = device behind the video) so log readers
		// can tell a starve-induced lag from a user seek.
		logger.Warnf("[handy] sync: drift %+dms exceeds %dms — reseeking to %dms", signedDrift, int32(driftSeekMs), target)
		return e.Play(ctx, target, rate, loop)
	case drift > driftCorrectMs && !throttled:
		e.mu.Lock()
		defer e.mu.Unlock()
		if e.session == nil {
			return nil
		}
		set := e.projectLocked(posMs, at)
		st, err := e.session.HspCurrentTimeSet(ctx, set, 0.5)
		if err == nil {
			e.lastState = *st
			e.lastSyncAt = time.Now()
			logger.Debugf("[handy] sync: corrected %+dms drift to %dms (device ct=%dms)", signedDrift, set, st.CurrentTime)
			// re-anchor local tracking
			e.playPosMs = e.projectLocked(posMs, at)
			e.playStarted = time.Now()
		}
		return err
	default:
		return nil
	}
}

// SetRate changes playback rate mid-stream.
func (e *Engine) SetRate(ctx context.Context, rate float32) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if rate <= 0 || e.session == nil {
		return nil
	}
	// re-anchor before the rate change so drift math stays honest
	elapsed := int32(float64(time.Since(e.playStarted).Milliseconds()) * float64(e.rate))
	e.playPosMs += elapsed
	e.playStarted = time.Now()
	e.rate = rate
	st, err := e.session.HspRateSet(ctx, rate)
	if err == nil {
		e.lastState = *st
	}
	return err
}

// SetLoop toggles device-side looping (only honored when the whole script is
// buffered; see Play).
func (e *Engine) SetLoop(ctx context.Context, loop bool) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.loop = loop
	if e.session == nil || !e.playing {
		return nil
	}
	deviceLoop := loop && e.fedIdx >= len(e.script) && e.fedAbs <= e.lastState.MaxPoints
	st, err := e.session.HspLoopSet(ctx, deviceLoop)
	if err == nil {
		e.lastState = *st
	}
	return err
}

// SetStroke sets the slider range (0–1 relative).
func (e *Engine) SetStroke(ctx context.Context, min, max float32) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.session == nil {
		return fmt.Errorf("not connected")
	}
	return e.session.StrokeSet(ctx, min, max)
}

// ── Pattern / manual passthroughs (HDSP, HAMP, HVP) ─────────────────────────

// HdspPosition moves to position (0–100) at velocity percent (0–100).
func (e *Engine) HdspPosition(ctx context.Context, position, velocity float32) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.session == nil {
		return fmt.Errorf("not connected")
	}
	if err := e.ensureModeLocked(ctx, ModeHdsp); err != nil {
		return err
	}
	e.playing = false
	return e.session.HdspXpVp(ctx, position, velocity, true)
}

func (e *Engine) HampStart(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.session == nil {
		return fmt.Errorf("not connected")
	}
	if err := e.ensureModeLocked(ctx, ModeHamp); err != nil {
		return err
	}
	e.playing = false
	return e.session.HampStart(ctx)
}

func (e *Engine) HampStop(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.session == nil {
		return nil
	}
	return e.session.HampStop(ctx)
}

// HampVelocity sets HAMP speed 0–100 (converted to the 0–1 the RPC expects).
func (e *Engine) HampVelocity(ctx context.Context, velocity float32) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.session == nil {
		return fmt.Errorf("not connected")
	}
	return e.session.HampVelocitySet(ctx, velocity/100)
}

func (e *Engine) HvpStart(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.session == nil {
		return fmt.Errorf("not connected")
	}
	if err := e.ensureModeLocked(ctx, ModeHvp); err != nil {
		return err
	}
	return e.session.HvpStart(ctx)
}

func (e *Engine) HvpStop(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.session == nil {
		return nil
	}
	return e.session.HvpStop(ctx)
}

func (e *Engine) HvpState(ctx context.Context, amplitude float32, frequency uint32, position float32) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.session == nil {
		return fmt.Errorf("not connected")
	}
	return e.session.HvpSet(ctx, amplitude, frequency, position)
}

// EmergencyStop halts everything best-effort.
func (e *Engine) EmergencyStop(ctx context.Context) error {
	e.playGen.Add(1) // nothing queued may restart motion behind our back
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.session == nil {
		return nil
	}
	e.playing = false
	_, _ = e.session.HspStop(ctx)
	_ = e.session.HdspStop(ctx)
	_ = e.session.HampStop(ctx)
	_ = e.session.HvpStop(ctx)
	err := e.session.StopCurrentMode(ctx)
	e.pushStatusLockedAsync()
	return err
}
