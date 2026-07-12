package handy

import (
	"context"
	"sync"

	"github.com/stashapp/stash/pkg/logger"
)

// Manager is the process-wide owner of the (single) local Handy connection.
// All WebSocket clients share it.
type Manager struct {
	mu      sync.Mutex
	engine  *Engine
	session *Session

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
func (m *Manager) Connect(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.session != nil && m.session.tr != nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()

	session := newSession()
	session.NotifyFunc = m.engine.handleNotification

	transport, err := connectBLE(ctx, session.handleFrame, func() {
		logger.Warnf("[handy] BLE link lost")
		m.dropConnection()
	})
	if err != nil {
		return err
	}
	session.tr = transport

	m.engine.mu.Lock()
	m.engine.session = session
	m.engine.transport = transport
	m.engine.currentMode = 0
	m.engine.StatusFunc = m.broadcast
	m.engine.mu.Unlock()
	m.session = session

	if err := session.ClockSync(ctx, 10); err != nil {
		logger.Warnf("[handy] clock sync failed (timed commands may be less accurate): %v", err)
	}

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

	m.broadcast(m.engine.Status())
	return nil
}

// dropConnection tears down state after a link loss (or explicit disconnect).
func (m *Manager) dropConnection() {
	m.mu.Lock()
	m.session = nil
	m.mu.Unlock()

	m.engine.mu.Lock()
	m.engine.session = nil
	m.engine.transport = nil
	m.engine.playing = false
	m.engine.fedIdx = 0
	m.engine.fedAbs = 0
	m.engine.lastState = HspState{}
	m.engine.mu.Unlock()

	m.broadcast(m.engine.Status())
}

// Disconnect closes the BLE link.
func (m *Manager) Disconnect() {
	m.mu.Lock()
	session := m.session
	m.mu.Unlock()
	if session != nil && session.tr != nil {
		session.tr.close()
	}
	m.dropConnection()
}
