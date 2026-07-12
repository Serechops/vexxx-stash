//go:build !linux && !darwin && !windows

package handy

import (
	"context"
	"fmt"
	"time"
)

// connectTimeout bounds the scan+connect sequence.
const connectTimeout = 30 * time.Second

// bleTransport is a stand-in for platforms tinygo.org/x/bluetooth has no
// Adapter implementation for (e.g. freebsd). connectBLE always errors, so
// none of these methods are ever invoked on a real value; they exist only
// to satisfy the *bleTransport method set used by session.go/engine.go.
type bleTransport struct {
	deviceName string
	mtu        int
}

func connectBLE(ctx context.Context, onFrame func([]byte), onDisconnect func()) (*bleTransport, error) {
	return nil, fmt.Errorf("BLE control is not supported on this platform")
}

func (t *bleTransport) write(p []byte) error {
	return fmt.Errorf("BLE control is not supported on this platform")
}

func (t *bleTransport) maxFrame() int { return 0 }

func (t *bleTransport) close() {}
