package handy

import (
	"context"
	"errors"
	"fmt"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"

	"github.com/stashapp/stash/pkg/logger"
)

// reconnectSettle is how long we wait after a failed attempt before re-scanning.
// An immediate retry on Windows/WinRT tends to re-grab the just-dropped (dead)
// GATT handle; a brief pause lets the OS Bluetooth stack finish tearing down.
const reconnectSettle = 750 * time.Millisecond

// relinkBackoff paces the automatic re-link attempts after an unexpected link
// loss. Each Connect scans for up to connectTimeout on top of these delays, so
// the whole sequence gives the device a couple of minutes to come back.
var relinkBackoff = []time.Duration{
	2 * time.Second,
	5 * time.Second,
	10 * time.Second,
	20 * time.Second,
}

// errDisconnectRequested aborts an in-flight connect that the user cancelled
// (by hitting Disconnect while the scan was still running).
var errDisconnectRequested = errors.New("disconnect requested")

// Manager is the process-wide owner of the (single) local Handy connection.
// All WebSocket clients share it.
type Manager struct {
	// mu guards the fields below it and is only ever held for short,
	// non-blocking sections. Connect must NOT hold it across the BLE scan:
	// Disconnect needs it, and waiting out a 30s scan (twice, with the retry)
	// is exactly how the UI's disconnect used to time out.
	mu      sync.Mutex
	session *Session
	// connectCancel cancels the scan/connect currently in flight, if any.
	connectCancel context.CancelFunc
	// lastDown is when the link last went away; Connect settles for a moment
	// after it before scanning again (see reconnectSettle).
	lastDown time.Time

	// connectMu serializes connect attempts (the long-running part) without
	// blocking state readers.
	connectMu sync.Mutex

	engine *Engine

	// relinking guards the auto-reconnect loop; userDisconnected suppresses it
	// when the link was torn down on purpose.
	relinking        atomic.Bool
	userDisconnected atomic.Bool

	subMu       sync.Mutex
	subscribers map[chan EngineStatus]struct{}
}

var defaultManager = &Manager{
	engine:      newEngine(),
	subscribers: map[chan EngineStatus]struct{}{},
}

// GetManager returns the process-wide manager.
func GetManager() *Manager {
	return defaultManager
}

// Engine exposes playback operations. Callers must Connect first.
func (m *Manager) Engine() *Engine {
	return m.engine
}

// Subscribe registers a status channel; the returned func unsubscribes.
// Sends are non-blocking — slow consumers miss intermediate snapshots.
func (m *Manager) Subscribe() (<-chan EngineStatus, func()) {
	ch := make(chan EngineStatus, 8)
	m.subMu.Lock()
	m.subscribers[ch] = struct{}{}
	m.subMu.Unlock()
	return ch, func() {
		m.subMu.Lock()
		delete(m.subscribers, ch)
		m.subMu.Unlock()
	}
}

func (m *Manager) broadcast(st EngineStatus) {
	m.subMu.Lock()
	defer m.subMu.Unlock()
	for ch := range m.subscribers {
		select {
		case ch <- st:
		default:
		}
	}
}

// Connected reports whether a device session is live.
func (m *Manager) Connected() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.session != nil && m.session.tr != nil
}

// Connect scans for, connects to, and clock-syncs a Handy. Idempotent while
// a connection is live.
//
// The scan can take up to connectTimeout, so this deliberately runs outside
// m.mu — only the short state transitions take it. Disconnect can therefore
// land (and cancel us) at any point during the scan.
func (m *Manager) Connect(ctx context.Context) error {
	m.connectMu.Lock()
	defer m.connectMu.Unlock()
	if m.Connected() {
		return nil
	}

	m.userDisconnected.Store(false)

	ctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()

	m.mu.Lock()
	m.connectCancel = cancel
	// Windows/WinRT hands back the just-dropped (dead) GATT handle if we
	// re-scan immediately after a teardown; give the stack a moment first.
	settle := reconnectSettle - time.Since(m.lastDown)
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		m.connectCancel = nil
		m.mu.Unlock()
	}()

	if settle > 0 {
		select {
		case <-time.After(settle):
		case <-ctx.Done():
			return m.connectAborted(ctx)
		}
	}

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		if m.userDisconnected.Load() {
			return errDisconnectRequested
		}
		if attempt > 0 {
			select {
			case <-time.After(reconnectSettle):
			case <-ctx.Done():
				return m.connectAborted(ctx)
			}
		}

		session := newSession(m.engine.handleNotification)

		// The disconnect callback fires on the OS Bluetooth event thread —
		// hand off to a goroutine so tearing down the engine never blocks it.
		transport, err := connectBLE(ctx, session.handleFrame, func() {
			go m.handleLinkLost()
		})
		if err != nil {
			session.close()
			if m.userDisconnected.Load() {
				return errDisconnectRequested
			}
			lastErr = err
			continue
		}
		session.tr = transport

		// ClockSync is the first real round-trip to the device. On a flaky
		// reconnect (common on Windows/WinRT) the GATT link can come up —
		// connectBLE succeeds and writes return no error — while the device
		// never actually answers. Validate the link here before publishing it
		// as connected: a zombie link would otherwise report Connected=true and
		// leave every later op to time out at 5s. On failure, tear it down and
		// retry with a settle delay (or surface the error on the last attempt).
		if err := session.ClockSync(ctx, 10); err != nil {
			transport.close()
			session.close()
			lastErr = fmt.Errorf("device connected but not responding (clock sync failed): %w", err)
			logger.Warnf("[handy] %v", lastErr)
			continue
		}

		// The user may have hit Disconnect while we were scanning. Publishing
		// now would leave a live link behind a UI that says "disconnected" —
		// and the next Connect would short-circuit on it. Drop it instead.
		if m.userDisconnected.Load() {
			transport.close()
			session.close()
			return errDisconnectRequested
		}

		// Link verified — publish the session. Assigning engine.session only on
		// success keeps concurrent ops during the sync from racing a half-built
		// session (they get a clean "not connected" instead).
		//
		// engine.playing is deliberately left alone: it carries playback intent
		// across a link loss, and ResumeAfterReconnect needs it to decide
		// whether this connect is picking a scene back up mid-play.
		m.engine.mu.Lock()
		m.engine.session = session
		m.engine.transport = transport
		m.engine.currentMode = 0
		m.engine.fedIdx = 0
		m.engine.fedAbs = 0
		m.engine.lastState = HspState{}
		m.engine.StatusFunc = m.broadcast
		m.engine.mu.Unlock()

		m.mu.Lock()
		m.session = session
		m.mu.Unlock()

		if caps, err := session.Capabilities(ctx); err == nil && caps.BleMtu > 0 {
			// FW4.2+ reports the true BLE MTU cap; prefer it if smaller than
			// what the OS negotiated.
			if int(caps.BleMtu) < transport.mtu {
				transport.mtu = int(caps.BleMtu)
			}
		}

		if b, err := session.Battery(ctx); err == nil {
			m.engine.mu.Lock()
			m.engine.battery = &b.Level
			m.engine.mu.Unlock()
		}

		m.engine.startWatchdog()
		m.broadcast(m.engine.Status())
		return nil
	}
	return lastErr
}

// connectAborted distinguishes "the user cancelled us" from "the scan timed
// out", both of which surface as a cancelled context.
func (m *Manager) connectAborted(ctx context.Context) error {
	if m.userDisconnected.Load() {
		return errDisconnectRequested
	}
	return ctx.Err()
}

// dropConnection tears down state after a link loss (or explicit disconnect).
// Playback intent (engine.playing) and the loaded script survive: a dropped
// link is not a decision to stop, and the reconnect path replays from them.
func (m *Manager) dropConnection() {
	m.mu.Lock()
	session := m.session
	m.session = nil
	m.lastDown = time.Now()
	m.mu.Unlock()

	if session != nil {
		session.close()
	}
	m.engine.stopWatchdog()

	m.engine.mu.Lock()
	m.engine.session = nil
	m.engine.transport = nil
	m.engine.fedIdx = 0
	m.engine.fedAbs = 0
	m.engine.lastState = HspState{}
	m.engine.mu.Unlock()

	m.broadcast(m.engine.Status())
}

// handleLinkLost runs when the OS reports the GATT link gone without us asking.
// The scene is almost certainly still playing, so re-link and pick the script
// back up rather than leaving the user to reconnect and re-sync by hand.
//
// It runs on its own goroutine (spawned from the BLE event thread), so nothing
// up the stack can recover a panic here — contain it or lose the server.
func (m *Manager) handleLinkLost() {
	defer func() {
		if r := recover(); r != nil {
			logger.Errorf("[handy] panic while re-linking: %v\n%s", r, debug.Stack())
		}
	}()

	logger.Warnf("[handy] BLE link lost")
	m.dropConnection()

	if m.userDisconnected.Load() {
		return
	}
	if !m.relinking.CompareAndSwap(false, true) {
		return
	}
	defer m.relinking.Store(false)

	for i, delay := range relinkBackoff {
		time.Sleep(delay)
		if m.userDisconnected.Load() || m.Connected() {
			return
		}

		logger.Infof("[handy] re-link attempt %d/%d", i+1, len(relinkBackoff))
		if err := m.Connect(context.Background()); err != nil {
			logger.Warnf("[handy] re-link attempt %d/%d failed: %v", i+1, len(relinkBackoff), err)
			continue
		}

		logger.Infof("[handy] re-linked to device")
		m.engine.ResumeAfterReconnect(context.Background())
		return
	}
	logger.Warnf("[handy] could not re-establish the BLE link; reconnect from the UI once the device is available")
}

// Disconnect closes the BLE link on purpose, suppressing auto-reconnect. It is
// idempotent, and returns promptly whatever the link is doing — mid-scan,
// mid-feed, or already gone.
//
// Order matters. The intent flag goes first (so nothing re-links behind us),
// then any in-flight scan is cancelled, then the session is closed — which
// fails every outstanding BLE call immediately. Only then do we reach for the
// engine lock, which by that point no dying round-trip is still holding.
func (m *Manager) Disconnect() {
	m.userDisconnected.Store(true)

	m.mu.Lock()
	cancel := m.connectCancel
	session := m.session
	m.mu.Unlock()

	if cancel != nil {
		// A scan is running (user hit Connect, then Disconnect, or the
		// auto-relink loop is mid-attempt). Stop it rather than waiting the
		// remaining ~30s for it to give up on its own.
		cancel()
	}

	if session != nil {
		if session.tr != nil {
			session.tr.close()
		}
		session.close()
	}

	m.engine.mu.Lock()
	m.engine.playing = false
	m.engine.mu.Unlock()

	m.dropConnection()

	if session != nil || cancel != nil {
		logger.Infof("[handy] disconnected on request")
	}
}
