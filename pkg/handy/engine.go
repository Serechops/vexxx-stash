package handy

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/stashapp/stash/pkg/logger"
)

// Feeding tuning. The device buffer size (max_points) is reported by the
// firmware; these bound how much of it we use and when we top it up.
const (
	initialFeedTarget = 900  // points to preload before starting playback
	topUpMargin       = 60   // ask for a threshold notification this many points before the feed tail
	maxPointsPerAdd   = 100  // protocol limit per HspAdd
	seekRefeedSlackMs = 1000 // required headroom before buffer end for an in-buffer seek
	driftSeekMs       = 2500 // drift beyond this triggers a full seek/refeed
	driftCorrectMs    = 120  // drift beyond this (≤ driftSeekMs) sends a CurrentTimeSet
	syncMinInterval   = time.Second
)

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

	// wall-clock playback tracking for drift decisions
	playPosMs   int32
	playStarted time.Time
	lastSyncAt  time.Time

	lastState  HspState
	battery    *uint32
	topUpBusy  atomic.Bool
	feedNotify chan struct{}

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
		// wake the feeder
		select {
		case e.feedNotify <- struct{}{}:
		default:
		}
	case NotifHspStateChanged, NotifHspLooping, NotifHspPausedOnStarving, NotifHspResumedNonStarve:
		if s, err := DecodeHspState(n.Bytes); err == nil {
			e.mu.Lock()
			e.lastState = *s
			e.mu.Unlock()
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

	if e.topUpBusy.CompareAndSwap(false, true) {
		go e.topUpLoop()
	}
}

// topUpLoop drains feedNotify wake-ups, feeding the device buffer.
func (e *Engine) topUpLoop() {
	defer e.topUpBusy.Store(false)
	for {
		select {
		case <-e.feedNotify:
			if err := e.feed(context.Background(), 0); err != nil {
				logger.Warnf("[handy] buffer top-up failed: %v", err)
				return
			}
		default:
			return
		}
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

// feed pushes script points to the device buffer until the high-water target
// is met (or the script is exhausted). startTarget of 0 means "top up".
func (e *Engine) feed(ctx context.Context, startTarget int) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.feedLocked(ctx, startTarget)
}

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
	for e.fedIdx < len(e.script) && int(e.lastState.Points) < target {
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

// Play starts (or seeks) playback at posMs. When the position is already
// inside the device buffer it seeks without refeeding; otherwise the buffer
// is rebuilt from the new position.
func (e *Engine) Play(ctx context.Context, posMs int32, rate float32, loop bool) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.session == nil {
		return fmt.Errorf("not connected")
	}
	if len(e.script) == 0 {
		return fmt.Errorf("no script loaded")
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
		if err := e.feedLocked(ctx, initialFeedTarget); err != nil {
			return fmt.Errorf("feeding script: %w", err)
		}
	}

	// Device-side looping only works when the whole script fits in the
	// buffer; otherwise the UI's own loop handling re-plays from 0 and we
	// refeed then.
	deviceLoop := loop && e.fedIdx >= len(e.script) && e.fedAbs <= e.lastState.MaxPoints

	st, err := e.session.HspPlay(ctx, posMs, rate, deviceLoop, true)
	if err != nil {
		return fmt.Errorf("HSP play: %w", err)
	}
	e.lastState = *st
	e.playing = true
	e.playPosMs = posMs
	e.playStarted = time.Now()
	e.pushStatusLockedAsync()
	return nil
}

// Pause halts motion, keeping the buffer for resume.
func (e *Engine) Pause(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.session == nil || !e.playing {
		return nil
	}
	st, err := e.session.HspPause(ctx)
	if err != nil {
		return err
	}
	e.lastState = *st
	e.playing = false
	e.pushStatusLockedAsync()
	return nil
}

// Stop ends playback and discards position.
func (e *Engine) Stop(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.session == nil {
		return nil
	}
	st, err := e.session.HspStop(ctx)
	if err == nil {
		e.lastState = *st
	}
	e.playing = false
	e.pushStatusLockedAsync()
	return err
}

// SyncTime nudges the device's script clock towards posMs. Large drift
// triggers a real seek. No-op while paused.
func (e *Engine) SyncTime(ctx context.Context, posMs int32) error {
	e.mu.Lock()
	if e.session == nil || !e.playing {
		e.mu.Unlock()
		return nil
	}
	expected := e.playPosMs + int32(float64(time.Since(e.playStarted).Milliseconds())*float64(e.rate))
	drift := posMs - expected
	if drift < 0 {
		drift = -drift
	}
	throttled := time.Since(e.lastSyncAt) < syncMinInterval
	rate, loop := e.rate, e.loop
	e.mu.Unlock()

	switch {
	case drift > driftSeekMs:
		return e.Play(ctx, posMs, rate, loop)
	case drift > driftCorrectMs && !throttled:
		e.mu.Lock()
		st, err := e.session.HspCurrentTimeSet(ctx, posMs, 0.5)
		if err == nil {
			e.lastState = *st
			e.lastSyncAt = time.Now()
			// re-anchor local tracking
			e.playPosMs = posMs
			e.playStarted = time.Now()
		}
		e.mu.Unlock()
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
