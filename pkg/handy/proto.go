// Package handy implements a fully local BLE client for The Handy (FW4+),
// speaking the vendor-published hdy_rpc protobuf protocol directly to the
// device. No cloud round-trip, no handyfeeling.com dependency.
//
// Protocol source of truth (vendor-published):
//
//	https://gitlab.com/sweettechas/platform/handy-public-rpc (public/proto/*.proto)
//
// The wire codec below is hand-rolled for the message subset stash needs.
// Protobuf encoding rules: https://protobuf.dev/programming-guides/encoding/
package handy

import (
	"fmt"
	"math"
)

// ── Wire types ──────────────────────────────────────────────────────────────

const (
	wtVarint  = 0
	wtFixed64 = 1
	wtBytes   = 2
	wtFixed32 = 5
)

// ── Mode constants (constants.proto enum Mode) ──────────────────────────────

const (
	ModeHamp        = 0
	ModeHssp        = 1
	ModeHdsp        = 2
	ModeMaintenance = 3
	ModeHsp         = 4
	ModeOta         = 5
	ModeButton      = 6
	ModeIdle        = 7
	ModeHvp         = 8
	ModeHrpp        = 9
	ModeDisabled    = 10
)

// HspPlayState (constants.proto)
const (
	HspStateNotInitialized = 0
	HspStatePlaying        = 1
	HspStateStopped        = 2
	HspStatePaused         = 3
	HspStateStarving       = 4
)

// Request oneof field numbers (handy_rpc.proto message Request)
const (
	reqServerTimeGet     = 300
	reqModeGet           = 700
	reqModeSet           = 701
	reqClockOffsetSet    = 709
	reqBatteryGet        = 710
	reqClockOffsetGet    = 712
	reqCapabilitiesGet   = 713
	reqStopCurrentMode   = 715
	reqHampStart         = 720
	reqHampStop          = 721
	reqHampVelocitySet   = 723
	reqHdspXpVpSet       = 742
	reqHdspXpTSet        = 744
	reqHdspStop          = 746
	reqSliderStrokeGet   = 840
	reqSliderStrokeSet   = 841
	reqHspSetup          = 860
	reqHspAdd            = 861
	reqHspFlush          = 862
	reqHspPlay           = 863
	reqHspStop           = 864
	reqHspPause          = 865
	reqHspResume         = 866
	reqHspStateGet       = 867
	reqHspCurrentTimeSet = 868
	reqHspThresholdSet   = 869
	reqHspRateSet        = 871
	reqHspLoopSet        = 872
	reqHvpSet            = 900
	reqHvpStop           = 901
	reqHvpStart          = 902
)

// Notification oneof field numbers (handy_rpc.proto message Notification)
const (
	NotifConnectedChanged    = 300
	NotifWifiStatusChanged   = 601
	NotifBleStatusChanged    = 602
	NotifModeChanged         = 700
	NotifStrokeChanged       = 701
	NotifButtonEvent         = 703
	NotifBatteryChanged      = 705
	NotifError               = 706
	NotifIdleTimeout         = 707
	NotifHampChanged         = 720
	NotifHdspChanged         = 740
	NotifHspThresholdReached = 860
	NotifHspStateChanged     = 861
	NotifHspLooping          = 862
	NotifHspStarving         = 863
	NotifHspResumedNonStarve = 864
	NotifHspPausedOnStarving = 865
	NotifTempHigh            = 1000
	NotifTempOk              = 1001
	NotifSliderBlocked       = 1002
	NotifSliderUnblocked     = 1003
	NotifSettingsChanged     = 2000
)

// ── Encoder ─────────────────────────────────────────────────────────────────

type encoder struct {
	b []byte
}

func (e *encoder) varint(v uint64) {
	for v >= 0x80 {
		e.b = append(e.b, byte(v)|0x80)
		v >>= 7
	}
	e.b = append(e.b, byte(v))
}

func (e *encoder) tag(field int, wt int) {
	e.varint(uint64(field)<<3 | uint64(wt))
}

// uintField encodes a uint32/uint64/enum field; zero values are omitted
// (proto3 default semantics).
func (e *encoder) uintField(field int, v uint64) {
	if v == 0 {
		return
	}
	e.tag(field, wtVarint)
	e.varint(v)
}

// int32Field encodes a signed int32 as standard protobuf varint
// (sign-extended to 64 bits, per proto3 `int32` rules).
func (e *encoder) int32Field(field int, v int32) {
	if v == 0 {
		return
	}
	e.tag(field, wtVarint)
	e.varint(uint64(int64(v)))
}

// sint64Field encodes with zigzag (proto3 `sint64`).
func (e *encoder) sint64Field(field int, v int64) {
	if v == 0 {
		return
	}
	e.tag(field, wtVarint)
	e.varint(uint64((v << 1) ^ (v >> 63)))
}

func (e *encoder) boolField(field int, v bool) {
	if !v {
		return
	}
	e.tag(field, wtVarint)
	e.varint(1)
}

func (e *encoder) floatField(field int, v float32) {
	if v == 0 {
		return
	}
	e.tag(field, wtFixed32)
	bits := math.Float32bits(v)
	e.b = append(e.b, byte(bits), byte(bits>>8), byte(bits>>16), byte(bits>>24))
}

func (e *encoder) bytesField(field int, b []byte) {
	e.tag(field, wtBytes)
	e.varint(uint64(len(b)))
	e.b = append(e.b, b...)
}

// ── Request building ────────────────────────────────────────────────────────

// MessageType enum (handy_rpc.proto)
const (
	msgTypeRequest      = 1
	msgTypeResponse     = 3
	msgTypeNotification = 4
)

// encodeRequest wraps a request-body submessage into the full RpcMessage
// frame written to the BLE tx characteristic:
//
//	RpcMessage{ type: MESSAGE_TYPE_REQUEST, request: Request{ <oneof field>: body, id: id } }
func encodeRequest(id uint32, oneofField int, body []byte) []byte {
	var req encoder
	// Empty-body requests still need the oneof field present (zero-length
	// submessage) so the firmware knows which command was invoked.
	req.bytesField(oneofField, body)
	req.uintField(2, uint64(id))

	var msg encoder
	msg.uintField(1, msgTypeRequest)
	msg.bytesField(2, req.b)
	return msg.b
}

// Point is a single HSP script point. T is milliseconds from script start,
// X is position 0–100 (the BLE schema allows up to 255; the vendor reference
// implementation uses the 0–100 percentage convention, matching funscript).
type Point struct {
	T uint32
	X uint32
}

// Request encoders. Each returns the complete RpcMessage frame.

func encModeSet(id uint32, mode uint64) []byte {
	var e encoder
	e.uintField(1, mode)
	return encodeRequest(id, reqModeSet, e.b)
}

func encModeGet(id uint32) []byte { return encodeRequest(id, reqModeGet, nil) }
func encBatteryGet(id uint32) []byte {
	return encodeRequest(id, reqBatteryGet, nil)
}
func encCapabilitiesGet(id uint32) []byte {
	return encodeRequest(id, reqCapabilitiesGet, nil)
}
func encStopCurrentMode(id uint32) []byte {
	return encodeRequest(id, reqStopCurrentMode, nil)
}
func encClockOffsetGet(id uint32) []byte {
	return encodeRequest(id, reqClockOffsetGet, nil)
}

func encClockOffsetSet(id uint32, offsetMs int64, rtdMs int32) []byte {
	var e encoder
	e.sint64Field(1, offsetMs)
	e.int32Field(2, rtdMs)
	return encodeRequest(id, reqClockOffsetSet, e.b)
}

func encSliderStrokeGet(id uint32) []byte {
	return encodeRequest(id, reqSliderStrokeGet, nil)
}

func encSliderStrokeSet(id uint32, min, max float32) []byte {
	var e encoder
	e.floatField(1, min)
	e.floatField(2, max)
	return encodeRequest(id, reqSliderStrokeSet, e.b)
}

func encHspSetup(id uint32, streamID uint32) []byte {
	var e encoder
	e.uintField(1, uint64(streamID))
	return encodeRequest(id, reqHspSetup, e.b)
}

func encHspAdd(id uint32, points []Point, flush bool, tailIndex uint32, tailThreshold uint32) []byte {
	var e encoder
	for _, p := range points {
		var pe encoder
		pe.uintField(1, uint64(p.T))
		pe.uintField(2, uint64(p.X))
		e.bytesField(1, pe.b)
	}
	e.boolField(2, flush)
	e.uintField(3, uint64(tailIndex))
	e.uintField(5, uint64(tailThreshold))
	return encodeRequest(id, reqHspAdd, e.b)
}

func encHspFlush(id uint32) []byte { return encodeRequest(id, reqHspFlush, nil) }

func encHspPlay(id uint32, startTimeMs int32, serverTimeMs uint64, rate float32, loop bool, pauseOnStarving bool) []byte {
	var e encoder
	e.int32Field(1, startTimeMs)
	e.uintField(2, serverTimeMs)
	e.floatField(3, rate)
	e.boolField(4, loop)
	e.boolField(5, pauseOnStarving)
	return encodeRequest(id, reqHspPlay, e.b)
}

func encHspStop(id uint32) []byte  { return encodeRequest(id, reqHspStop, nil) }
func encHspPause(id uint32) []byte { return encodeRequest(id, reqHspPause, nil) }

func encHspResume(id uint32, pickUp bool) []byte {
	var e encoder
	e.boolField(1, pickUp)
	return encodeRequest(id, reqHspResume, e.b)
}

func encHspStateGet(id uint32) []byte {
	return encodeRequest(id, reqHspStateGet, nil)
}

func encHspCurrentTimeSet(id uint32, currentTimeMs int32, serverTimeMs uint64, filter float32) []byte {
	var e encoder
	e.int32Field(1, currentTimeMs)
	e.uintField(2, serverTimeMs)
	e.floatField(3, filter)
	return encodeRequest(id, reqHspCurrentTimeSet, e.b)
}

func encHspThresholdSet(id uint32, threshold uint32) []byte {
	var e encoder
	e.uintField(1, uint64(threshold))
	return encodeRequest(id, reqHspThresholdSet, e.b)
}

func encHspRateSet(id uint32, rate float32) []byte {
	var e encoder
	e.floatField(1, rate)
	return encodeRequest(id, reqHspRateSet, e.b)
}

func encHspLoopSet(id uint32, loop bool) []byte {
	var e encoder
	e.boolField(1, loop)
	return encodeRequest(id, reqHspLoopSet, e.b)
}

func encHdspXpVpSet(id uint32, xp, vp float32, stopOnTarget bool) []byte {
	var e encoder
	e.floatField(1, xp)
	e.floatField(2, vp)
	e.boolField(3, stopOnTarget)
	return encodeRequest(id, reqHdspXpVpSet, e.b)
}

func encHdspXpTSet(id uint32, xp float32, t uint32, stopOnTarget bool) []byte {
	var e encoder
	e.floatField(1, xp)
	e.uintField(2, uint64(t))
	e.boolField(3, stopOnTarget)
	return encodeRequest(id, reqHdspXpTSet, e.b)
}

func encHdspStop(id uint32) []byte { return encodeRequest(id, reqHdspStop, nil) }

func encHampStart(id uint32) []byte { return encodeRequest(id, reqHampStart, nil) }
func encHampStop(id uint32) []byte  { return encodeRequest(id, reqHampStop, nil) }

func encHampVelocitySet(id uint32, velocity float32) []byte {
	var e encoder
	e.floatField(1, velocity)
	return encodeRequest(id, reqHampVelocitySet, e.b)
}

func encHvpSet(id uint32, amplitude float32, frequency uint32, position float32) []byte {
	var e encoder
	e.floatField(1, amplitude)
	e.uintField(2, uint64(frequency))
	e.floatField(3, position)
	return encodeRequest(id, reqHvpSet, e.b)
}

func encHvpStart(id uint32) []byte { return encodeRequest(id, reqHvpStart, nil) }
func encHvpStop(id uint32) []byte  { return encodeRequest(id, reqHvpStop, nil) }

// ── Decoder ─────────────────────────────────────────────────────────────────

type wireField struct {
	num uint32
	wt  uint8
	u   uint64 // varint / fixed values
	b   []byte // wtBytes payload (sub-slice of input)
}

func decodeVarint(buf []byte, i int) (uint64, int, error) {
	var v uint64
	var shift uint
	for {
		if i >= len(buf) {
			return 0, 0, fmt.Errorf("truncated varint")
		}
		c := buf[i]
		i++
		v |= uint64(c&0x7f) << shift
		if c < 0x80 {
			return v, i, nil
		}
		shift += 7
		if shift >= 64 {
			return 0, 0, fmt.Errorf("varint overflow")
		}
	}
}

// parseMessage scans all fields of a protobuf message. Unknown fields are
// retained (caller filters by number); unsupported wire types are skipped.
func parseMessage(buf []byte) ([]wireField, error) {
	var out []wireField
	i := 0
	for i < len(buf) {
		key, ni, err := decodeVarint(buf, i)
		if err != nil {
			return nil, err
		}
		i = ni
		f := wireField{num: uint32(key >> 3), wt: uint8(key & 7)}
		switch f.wt {
		case wtVarint:
			f.u, i, err = decodeVarint(buf, i)
			if err != nil {
				return nil, err
			}
		case wtFixed64:
			if i+8 > len(buf) {
				return nil, fmt.Errorf("truncated fixed64")
			}
			f.u = uint64(buf[i]) | uint64(buf[i+1])<<8 | uint64(buf[i+2])<<16 | uint64(buf[i+3])<<24 |
				uint64(buf[i+4])<<32 | uint64(buf[i+5])<<40 | uint64(buf[i+6])<<48 | uint64(buf[i+7])<<56
			i += 8
		case wtBytes:
			l, ni2, err := decodeVarint(buf, i)
			if err != nil {
				return nil, err
			}
			i = ni2
			if uint64(len(buf)-i) < l {
				return nil, fmt.Errorf("truncated bytes field")
			}
			f.b = buf[i : i+int(l)]
			i += int(l)
		case wtFixed32:
			if i+4 > len(buf) {
				return nil, fmt.Errorf("truncated fixed32")
			}
			f.u = uint64(buf[i]) | uint64(buf[i+1])<<8 | uint64(buf[i+2])<<16 | uint64(buf[i+3])<<24
			i += 4
		default:
			return nil, fmt.Errorf("unsupported wire type %d", f.wt)
		}
		out = append(out, f)
	}
	return out, nil
}

func fieldFloat(f wireField) float32 { return math.Float32frombits(uint32(f.u)) }
func fieldInt32(f wireField) int32   { return int32(int64(f.u)) }
func fieldSint64(f wireField) int64  { return int64(f.u>>1) ^ -int64(f.u&1) }

// ── Decoded message types ───────────────────────────────────────────────────

// RpcError is the Error message attached to failed responses.
type RpcError struct {
	Code    int32
	Message string
	Data    string
}

func (e *RpcError) Error() string {
	return fmt.Sprintf("handy rpc error %d: %s", e.Code, e.Message)
}

// Response is a decoded hdy_rpc.Response.
type Response struct {
	ID          uint32
	ResultField uint32 // oneof field number of the result (0 = blank response)
	ResultBytes []byte
	Err         *RpcError
}

// Notification is a decoded hdy_rpc.Notification.
type Notification struct {
	Field uint32 // oneof field number identifying the notification kind
	Bytes []byte
}

// HspState mirrors constants.proto message HspState.
type HspState struct {
	PlayState       uint32
	Points          uint32
	MaxPoints       uint32
	CurrentPoint    int32
	CurrentTime     int32
	Loop            bool
	PlaybackRate    float32
	FirstPointTime  uint32
	LastPointTime   uint32
	StreamID        uint32
	TailPointIndex  int32
	TailThreshold   uint32
	PauseOnStarving bool
}

// BatteryState carries the subset of battery info the UI shows.
type BatteryState struct {
	Level    uint32
	Charging bool
}

// ClockOffset mirrors ResponseClockOffsetGet.
type ClockOffset struct {
	Time        uint32 // device machine time, ms since boot
	ClockOffset int64  // stored offset (UNIX ms - machine ms)
	Rtd         int32
}

// Capabilities carries the subset of ResponseCapabilitiesGet we use.
type Capabilities struct {
	BleMtu uint32 // 0 when firmware predates FW4.2
}

// StrokeRange mirrors ResponseSliderStrokeGet (relative 0–1 floats).
type StrokeRange struct {
	Min float32
	Max float32
}

// DecodeRpcMessage splits an incoming BLE frame into response / notification.
func DecodeRpcMessage(buf []byte) (*Response, *Notification, error) {
	fields, err := parseMessage(buf)
	if err != nil {
		return nil, nil, err
	}
	var resp *Response
	var notif *Notification
	for _, f := range fields {
		switch f.num {
		case 4: // response
			if f.wt != wtBytes {
				continue
			}
			r, err := decodeResponse(f.b)
			if err != nil {
				return nil, nil, err
			}
			resp = r
		case 5: // notification
			if f.wt != wtBytes {
				continue
			}
			n, err := decodeNotification(f.b)
			if err != nil {
				return nil, nil, err
			}
			notif = n
		}
	}
	return resp, notif, nil
}

func decodeResponse(buf []byte) (*Response, error) {
	fields, err := parseMessage(buf)
	if err != nil {
		return nil, err
	}
	r := &Response{}
	for _, f := range fields {
		switch {
		case f.num == 1 && f.wt == wtVarint:
			r.ID = uint32(f.u)
		case f.num == 2 && f.wt == wtBytes:
			e, err := decodeError(f.b)
			if err != nil {
				return nil, err
			}
			r.Err = e
		case f.wt == wtBytes:
			r.ResultField = f.num
			r.ResultBytes = f.b
		}
	}
	return r, nil
}

func decodeError(buf []byte) (*RpcError, error) {
	fields, err := parseMessage(buf)
	if err != nil {
		return nil, err
	}
	e := &RpcError{}
	empty := true
	for _, f := range fields {
		switch f.num {
		case 1:
			e.Code = fieldInt32(f)
			empty = false
		case 2:
			e.Message = string(f.b)
			empty = false
		case 3:
			e.Data = string(f.b)
			empty = false
		}
	}
	if empty {
		// proto3 zero-value Error submessage present but blank → treat as no error
		return nil, nil
	}
	return e, nil
}

func decodeNotification(buf []byte) (*Notification, error) {
	fields, err := parseMessage(buf)
	if err != nil {
		return nil, err
	}
	n := &Notification{}
	for _, f := range fields {
		if f.num == 2 && f.wt == wtVarint {
			continue // notification id, unused
		}
		if f.wt == wtBytes {
			n.Field = f.num
			n.Bytes = f.b
		}
	}
	return n, nil
}

// DecodeHspState parses an HspState submessage. Most HSP responses and
// notifications wrap it as field 1.
func DecodeHspState(buf []byte) (*HspState, error) {
	// unwrap `HspState state = 1`
	outer, err := parseMessage(buf)
	if err != nil {
		return nil, err
	}
	var inner []byte
	for _, f := range outer {
		if f.num == 1 && f.wt == wtBytes {
			inner = f.b
		}
	}
	if inner == nil {
		// blank state (all defaults)
		return &HspState{}, nil
	}
	fields, err := parseMessage(inner)
	if err != nil {
		return nil, err
	}
	s := &HspState{}
	for _, f := range fields {
		switch f.num {
		case 1:
			s.PlayState = uint32(f.u)
		case 2:
			s.Points = uint32(f.u)
		case 3:
			s.MaxPoints = uint32(f.u)
		case 4:
			s.CurrentPoint = fieldInt32(f)
		case 5:
			s.CurrentTime = fieldInt32(f)
		case 6:
			s.Loop = f.u != 0
		case 7:
			s.PlaybackRate = fieldFloat(f)
		case 8:
			s.FirstPointTime = uint32(f.u)
		case 9:
			s.LastPointTime = uint32(f.u)
		case 10:
			s.StreamID = uint32(f.u)
		case 11:
			s.TailPointIndex = fieldInt32(f)
		case 12:
			s.TailThreshold = uint32(f.u)
		case 13:
			s.PauseOnStarving = f.u != 0
		}
	}
	return s, nil
}

// DecodeClockOffset parses ResponseClockOffsetGet.
func DecodeClockOffset(buf []byte) (*ClockOffset, error) {
	fields, err := parseMessage(buf)
	if err != nil {
		return nil, err
	}
	c := &ClockOffset{}
	for _, f := range fields {
		switch f.num {
		case 1:
			c.Time = uint32(f.u)
		case 2:
			c.ClockOffset = fieldSint64(f)
		case 3:
			c.Rtd = fieldInt32(f)
		}
	}
	return c, nil
}

// DecodeBatteryState parses `BatteryState state = 1` wrappers
// (ResponseBatteryGet / NotificationBatteryChanged).
func DecodeBatteryState(buf []byte) (*BatteryState, error) {
	outer, err := parseMessage(buf)
	if err != nil {
		return nil, err
	}
	var inner []byte
	for _, f := range outer {
		if f.num == 1 && f.wt == wtBytes {
			inner = f.b
		}
	}
	b := &BatteryState{}
	if inner == nil {
		return b, nil
	}
	fields, err := parseMessage(inner)
	if err != nil {
		return nil, err
	}
	for _, f := range fields {
		switch f.num {
		case 1:
			b.Level = uint32(f.u)
		case 18:
			b.Charging = f.u != 0
		}
	}
	return b, nil
}

// DecodeCapabilities parses ResponseCapabilitiesGet.
func DecodeCapabilities(buf []byte) (*Capabilities, error) {
	fields, err := parseMessage(buf)
	if err != nil {
		return nil, err
	}
	c := &Capabilities{}
	for _, f := range fields {
		if f.num == 15 {
			c.BleMtu = uint32(f.u)
		}
	}
	return c, nil
}

// DecodeStrokeRange parses ResponseSliderStrokeGet.
func DecodeStrokeRange(buf []byte) (*StrokeRange, error) {
	fields, err := parseMessage(buf)
	if err != nil {
		return nil, err
	}
	s := &StrokeRange{}
	for _, f := range fields {
		switch f.num {
		case 1:
			s.Min = fieldFloat(f)
		case 2:
			s.Max = fieldFloat(f)
		}
	}
	return s, nil
}

// DecodeRpcErrorNotification parses NotificationError payloads.
func DecodeRpcErrorNotification(buf []byte) (*RpcError, error) {
	e, err := decodeError(buf)
	if err != nil {
		return nil, err
	}
	if e == nil {
		e = &RpcError{}
	}
	return e, nil
}
