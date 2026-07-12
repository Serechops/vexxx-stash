package handy

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/stashapp/stash/pkg/logger"
	"tinygo.org/x/bluetooth"
)

// FW4 BLE RPC GATT identifiers. Source: the vendor's public BLE control doc
// and the reference debugger app (Pokerface704/Simple-theHandy-BLE-v4-HSP-Debugger,
// verified against a first-gen Handy on FW 4.1.1).
var (
	serviceUUID = mustUUID("77834d26-40f7-11ee-be56-0242ac120002")
	txCharUUID  = mustUUID("77835032-40f7-11ee-be56-0242ac120002") // host → device (write)
	rxCharUUID  = mustUUID("77835410-40f7-11ee-be56-0242ac120002") // device → host (notify)
)

// deviceNamePrefix matches FW4 advertisements ("OHD..."). Older firmware
// advertised "The Handy"; FW4 is required for the RPC protocol, but we match
// both so we can give a useful error for un-updated devices.
const (
	deviceNamePrefix       = "OHD"
	legacyDeviceNamePrefix = "The Handy"
)

func mustUUID(s string) bluetooth.UUID {
	u, err := bluetooth.ParseUUID(s)
	if err != nil {
		panic(err)
	}
	return u
}

var (
	adapterOnce sync.Once
	adapterErr  error
)

// enableAdapter initialises the OS Bluetooth stack exactly once.
func enableAdapter() (*bluetooth.Adapter, error) {
	adapterOnce.Do(func() {
		adapterErr = bluetooth.DefaultAdapter.Enable()
	})
	if adapterErr != nil {
		return nil, fmt.Errorf("enabling bluetooth adapter: %w", adapterErr)
	}
	return bluetooth.DefaultAdapter, nil
}

// bleTransport owns the GATT connection to one Handy device.
type bleTransport struct {
	device     bluetooth.Device
	tx         bluetooth.DeviceCharacteristic
	mtu        int
	deviceName string

	writeMu sync.Mutex

	onFrame      func([]byte)
	onDisconnect func()

	closed   bool
	closedMu sync.Mutex
}

// scanForHandy scans until a Handy advertisement is seen or ctx expires.
func scanForHandy(ctx context.Context, adapter *bluetooth.Adapter) (bluetooth.ScanResult, error) {
	type scanHit struct {
		result bluetooth.ScanResult
		legacy bool
	}
	found := make(chan scanHit, 1)

	// tinygo's Scan blocks until StopScan; run it in a goroutine.
	scanErr := make(chan error, 1)
	go func() {
		err := adapter.Scan(func(a *bluetooth.Adapter, res bluetooth.ScanResult) {
			name := res.LocalName()
			isRPC := strings.HasPrefix(name, deviceNamePrefix)
			isLegacy := strings.HasPrefix(name, legacyDeviceNamePrefix)
			if !isRPC && !isLegacy {
				// also accept devices advertising the RPC service UUID
				for _, u := range res.AdvertisementPayload.ServiceUUIDs() {
					if u == serviceUUID {
						isRPC = true
						break
					}
				}
			}
			if isRPC || isLegacy {
				select {
				case found <- scanHit{res, isLegacy && !isRPC}:
				default:
				}
			}
		})
		scanErr <- err
	}()

	defer func() {
		_ = adapter.StopScan()
	}()

	select {
	case hit := <-found:
		if hit.legacy {
			return hit.result, fmt.Errorf(
				"found %q, which advertises the pre-FW4 legacy BLE service; update the device to firmware 4+ for local control",
				hit.result.LocalName())
		}
		logger.Infof("[handy] found device %q (%s, RSSI %d)", hit.result.LocalName(), hit.result.Address.String(), hit.result.RSSI)
		return hit.result, nil
	case err := <-scanErr:
		if err != nil {
			return bluetooth.ScanResult{}, fmt.Errorf("BLE scan failed: %w", err)
		}
		return bluetooth.ScanResult{}, fmt.Errorf("BLE scan stopped unexpectedly")
	case <-ctx.Done():
		return bluetooth.ScanResult{}, fmt.Errorf("no Handy found: ensure the device is powered on with Bluetooth mode enabled (%w)", ctx.Err())
	}
}

// connectBLE scans for and connects to a Handy, wiring incoming notification
// frames to onFrame. onDisconnect fires when the link drops.
func connectBLE(ctx context.Context, onFrame func([]byte), onDisconnect func()) (*bleTransport, error) {
	adapter, err := enableAdapter()
	if err != nil {
		return nil, err
	}

	res, err := scanForHandy(ctx, adapter)
	if err != nil {
		return nil, err
	}

	t := &bleTransport{
		onFrame:      onFrame,
		onDisconnect: onDisconnect,
		deviceName:   res.LocalName(),
		mtu:          185, // conservative default until GetMTU succeeds
	}

	// Disconnect detection. The handler is adapter-global in tinygo; the
	// manager only ever holds one device connection, so this is safe.
	adapter.SetConnectHandler(func(dev bluetooth.Device, connected bool) {
		if !connected {
			t.closedMu.Lock()
			alreadyClosed := t.closed
			t.closed = true
			t.closedMu.Unlock()
			if !alreadyClosed && t.onDisconnect != nil {
				t.onDisconnect()
			}
		}
	})

	dev, err := adapter.Connect(res.Address, bluetooth.ConnectionParams{})
	if err != nil {
		return nil, fmt.Errorf("connecting to %q: %w", t.deviceName, err)
	}
	t.device = dev

	svcs, err := dev.DiscoverServices([]bluetooth.UUID{serviceUUID})
	if err != nil || len(svcs) == 0 {
		// help debugging: list what the device does expose
		if all, derr := dev.DiscoverServices(nil); derr == nil {
			var uuids []string
			for _, s := range all {
				uuids = append(uuids, s.UUID().String())
			}
			logger.Warnf("[handy] RPC service not found; device %q exposes: %s", t.deviceName, strings.Join(uuids, ", "))
		}
		_ = dev.Disconnect()
		if err == nil {
			err = fmt.Errorf("service not present")
		}
		return nil, fmt.Errorf("Handy RPC GATT service not found on %q (firmware 4+ required): %w", t.deviceName, err)
	}

	chars, err := svcs[0].DiscoverCharacteristics([]bluetooth.UUID{txCharUUID, rxCharUUID})
	if err != nil {
		_ = dev.Disconnect()
		return nil, fmt.Errorf("discovering characteristics: %w", err)
	}
	var haveTx, haveRx bool
	var rx bluetooth.DeviceCharacteristic
	for _, c := range chars {
		switch c.UUID() {
		case txCharUUID:
			t.tx = c
			haveTx = true
		case rxCharUUID:
			rx = c
			haveRx = true
		}
	}
	if !haveTx || !haveRx {
		_ = dev.Disconnect()
		return nil, fmt.Errorf("required characteristics missing (tx=%v rx=%v)", haveTx, haveRx)
	}

	if mtu, err := t.tx.GetMTU(); err == nil && mtu > 0 {
		t.mtu = int(mtu)
	}

	if err := rx.EnableNotifications(func(buf []byte) {
		// tinygo may reuse the buffer; copy before handing off.
		frame := make([]byte, len(buf))
		copy(frame, buf)
		t.onFrame(frame)
	}); err != nil {
		_ = dev.Disconnect()
		return nil, fmt.Errorf("enabling notifications: %w", err)
	}

	logger.Infof("[handy] connected to %q (MTU %d)", t.deviceName, t.mtu)
	return t, nil
}

// write sends one RpcMessage frame (write-with-response, serialized).
func (t *bleTransport) write(p []byte) error {
	t.closedMu.Lock()
	if t.closed {
		t.closedMu.Unlock()
		return fmt.Errorf("BLE transport closed")
	}
	t.closedMu.Unlock()

	t.writeMu.Lock()
	defer t.writeMu.Unlock()
	_, err := t.tx.Write(p)
	return err
}

// maxFrame returns the largest frame that fits a single ATT write.
func (t *bleTransport) maxFrame() int {
	return t.mtu - 3
}

func (t *bleTransport) close() {
	t.closedMu.Lock()
	if t.closed {
		t.closedMu.Unlock()
		return
	}
	t.closed = true
	t.closedMu.Unlock()
	_ = t.device.Disconnect()
}

// connectTimeout bounds the scan+connect sequence.
const connectTimeout = 30 * time.Second
