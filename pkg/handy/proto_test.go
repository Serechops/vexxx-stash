package handy

import (
	"encoding/hex"
	"fmt"
	"reflect"
	"sort"
	"testing"
)

// Golden vectors produced by the vendor-published protobufjs bundle
// (gitlab.com/sweettechas/platform/handy-public-rpc public/js/bundle.js).
// Each entry is the full RpcMessage frame hex. Comparison is semantic
// (field-order independent), since protobuf field order is not significant
// and the official encoder emits Request.id before the oneof body.

var goldenRequests = map[string]struct {
	golden string
	mine   func() []byte
}{
	"modeSet":         {"080112071007ea2b020804", func() []byte { return encModeSet(7, ModeHsp) }},
	"hspSetup":        {"080112091008e2350408c0c407", func() []byte { return encHspSetup(8, 123456) }},
	"hspAdd":          {"0801121f1009ea351a0a040800100a0a0508f403105a0a0508e807100a100118022864", func() []byte { return encHspAdd(9, []Point{{0, 10}, {500, 90}, {1000, 10}}, true, 2, 100) }},
	"hspPlay":         {"08011220100afa351b0886feffffffffffffff01108080b3c19c331d0000c03f20012801", func() []byte { return encHspPlay(10, -250, 1760000000000, 1.5, true, true) }},
	"hspCurrentTime":  {"08011215100ba236100890bf0510fb80b3c19c331d0000003f", func() []byte { return encHspCurrentTimeSet(11, 90000, 1760000000123, 0.5) }},
	"clockOffsetSet":  {"0801120d100caa2c0808e1a2f3ad071017", func() []byte { return encClockOffsetSet(12, -987654321, 23) }},
	"sliderStrokeSet": {"0801120f100dca340a0dcdcccc3d153333733f", func() []byte { return encSliderStrokeSet(13, 0.1, 0.95) }},
	"hdspXpVpSet":     {"08011211100eb22e0c0d00002a42159a99ae421801", func() []byte { return encHdspXpVpSet(14, 42.5, 87.3, true) }},
	"hampVelocitySet": {"0801120a100f9a2d050d33338542", func() []byte { return encHampVelocitySet(15, 66.6) }},
	"hvpSet":          {"080112111010a2380c0dcdcc4c3f103c1d0000c841", func() []byte { return encHvpSet(16, 0.8, 60, 25) }},
	"hspStop":         {"080112051011823600", func() []byte { return encHspStop(17) }},
	"batteryGet":      {"080112051012b22c00", func() []byte { return encBatteryGet(18) }},
	"hspResume":       {"0801120710139236020801", func() []byte { return encHspResume(19, true) }},
	"hspThresholdSet": {"080112081014aa360308d402", func() []byte { return encHspThresholdSet(20, 340) }},
	"hspLoopSet":      {"080112071015c236020801", func() []byte { return encHspLoopSet(21, true) }},
	"hspRateSet":      {"0801120a1016ba36050d0000a03f", func() []byte { return encHspRateSet(22, 1.25) }},
	"capabilitiesGet": {"080112051017ca2c00", func() []byte { return encCapabilitiesGet(23) }},
	"stopCurrentMode": {"080112051018da2c00", func() []byte { return encStopCurrentMode(24) }},
	"clockOffsetGet":  {"080112051019c22c00", func() []byte { return encClockOffsetGet(25) }},
}

// canonicalize turns a protobuf message into a field-order-independent
// representation. Length-delimited payloads are recursively parsed when they
// look like valid submessages; otherwise kept as raw hex. Both sides of a
// comparison use identical rules, so string/submessage ambiguity is harmless.
func canonicalize(buf []byte) (map[string][]string, error) {
	fields, err := parseMessage(buf)
	if err != nil {
		return nil, err
	}
	out := map[string][]string{}
	for _, f := range fields {
		// proto3: scalar zero is indistinguishable from absent — drop it so
		// encoders that write explicit zeros (protobufjs) compare equal to
		// ones that omit them (ours). Empty bytes fields are kept: oneof
		// submessage presence is significant.
		if f.wt != wtBytes && f.u == 0 {
			continue
		}
		key := fmt.Sprintf("%d/%d", f.num, f.wt)
		var val string
		if f.wt == wtBytes {
			if len(f.b) == 0 {
				val = "empty"
			} else if sub, err := canonicalize(f.b); err == nil {
				val = fmt.Sprintf("%v", sortedRepr(sub))
			} else {
				val = hex.EncodeToString(f.b)
			}
		} else {
			val = fmt.Sprintf("%d", f.u)
		}
		out[key] = append(out[key], val)
	}
	return out, nil
}

func sortedRepr(m map[string][]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var out []string
	for _, k := range keys {
		out = append(out, k+"="+fmt.Sprintf("%v", m[k]))
	}
	return out
}

func TestEncodeAgainstOfficialCodec(t *testing.T) {
	for name, tc := range goldenRequests {
		t.Run(name, func(t *testing.T) {
			golden, err := hex.DecodeString(tc.golden)
			if err != nil {
				t.Fatalf("bad golden hex: %v", err)
			}
			want, err := canonicalize(golden)
			if err != nil {
				t.Fatalf("canonicalize golden: %v", err)
			}
			got, err := canonicalize(tc.mine())
			if err != nil {
				t.Fatalf("canonicalize mine: %v", err)
			}
			if !reflect.DeepEqual(want, got) {
				t.Errorf("semantic mismatch\n golden: %v\n mine:   %v\n (golden hex %s, mine hex %s)",
					sortedRepr(want), sortedRepr(got), tc.golden, hex.EncodeToString(tc.mine()))
			}
		})
	}
}

func mustDecodeFrame(t *testing.T, h string) (*Response, *Notification) {
	t.Helper()
	buf, err := hex.DecodeString(h)
	if err != nil {
		t.Fatalf("bad hex: %v", err)
	}
	resp, notif, err := DecodeRpcMessage(buf)
	if err != nil {
		t.Fatalf("DecodeRpcMessage: %v", err)
	}
	return resp, notif
}

func TestDecodeHspAddResponse(t *testing.T) {
	resp, _ := mustDecodeFrame(t, "080322370809ea35320a30080110d40218d00f20ffffffffffffffffff012884c30530013d0000c03f406448c0cf2450c0c40758d30260f0016801")
	if resp == nil {
		t.Fatal("expected response")
	}
	if resp.ID != 9 {
		t.Errorf("id = %d, want 9", resp.ID)
	}
	if resp.ResultField != reqHspAdd {
		t.Errorf("result field = %d, want %d", resp.ResultField, reqHspAdd)
	}
	if resp.Err != nil {
		t.Errorf("unexpected error: %v", resp.Err)
	}
	s, err := DecodeHspState(resp.ResultBytes)
	if err != nil {
		t.Fatalf("DecodeHspState: %v", err)
	}
	want := HspState{
		PlayState: HspStatePlaying, Points: 340, MaxPoints: 2000,
		CurrentPoint: -1, CurrentTime: 90500, Loop: true, PlaybackRate: 1.5,
		FirstPointTime: 100, LastPointTime: 600000, StreamID: 123456,
		TailPointIndex: 339, TailThreshold: 240, PauseOnStarving: true,
	}
	if *s != want {
		t.Errorf("state = %+v, want %+v", *s, want)
	}
}

func TestDecodeClockOffsetResponse(t *testing.T) {
	resp, _ := mustDecodeFrame(t, "08032211080cc22c0c08d5f01b10e1a2f3ad071817")
	if resp == nil || resp.ResultField != reqClockOffsetGet {
		t.Fatalf("expected clock offset response, got %+v", resp)
	}
	c, err := DecodeClockOffset(resp.ResultBytes)
	if err != nil {
		t.Fatalf("DecodeClockOffset: %v", err)
	}
	if c.Time != 456789 || c.ClockOffset != -987654321 || c.Rtd != 23 {
		t.Errorf("got %+v", *c)
	}
}

func TestDecodeErrorResponse(t *testing.T) {
	resp, _ := mustDecodeFrame(t, "0803221d0814121908fbffffffffffffffff01120c6d6f6465206e6f7420736574")
	if resp == nil {
		t.Fatal("expected response")
	}
	if resp.ID != 20 {
		t.Errorf("id = %d, want 20", resp.ID)
	}
	if resp.Err == nil {
		t.Fatal("expected error")
	}
	if resp.Err.Code != -5 || resp.Err.Message != "mode not set" {
		t.Errorf("err = %+v", *resp.Err)
	}
}

func TestDecodeCapabilitiesResponse(t *testing.T) {
	resp, _ := mustDecodeFrame(t, "0803220c0815ca2c0710011801788004")
	if resp == nil || resp.ResultField != reqCapabilitiesGet {
		t.Fatalf("expected capabilities response, got %+v", resp)
	}
	c, err := DecodeCapabilities(resp.ResultBytes)
	if err != nil {
		t.Fatalf("DecodeCapabilities: %v", err)
	}
	if c.BleMtu != 512 {
		t.Errorf("bleMtu = %d, want 512", c.BleMtu)
	}
}

func TestDecodeStrokeResponse(t *testing.T) {
	resp, _ := mustDecodeFrame(t, "080322190816c234140dcdcccc3d153333733f1d0000a040250000d242")
	if resp == nil || resp.ResultField != reqSliderStrokeGet {
		t.Fatalf("expected stroke response, got %+v", resp)
	}
	s, err := DecodeStrokeRange(resp.ResultBytes)
	if err != nil {
		t.Fatalf("DecodeStrokeRange: %v", err)
	}
	if s.Min != 0.1 || s.Max != 0.95 {
		t.Errorf("got %+v", *s)
	}
}

func TestDecodeStarvingNotification(t *testing.T) {
	_, notif := mustDecodeFrame(t, "08042a161003fa35110a0f0804100018d00f28e0a71250c0c407")
	if notif == nil {
		t.Fatal("expected notification")
	}
	if notif.Field != NotifHspStarving {
		t.Errorf("field = %d, want %d", notif.Field, NotifHspStarving)
	}
	s, err := DecodeHspState(notif.Bytes)
	if err != nil {
		t.Fatalf("DecodeHspState: %v", err)
	}
	if s.PlayState != HspStateStarving || s.Points != 0 || s.MaxPoints != 2000 ||
		s.CurrentTime != 300000 || s.StreamID != 123456 {
		t.Errorf("state = %+v", *s)
	}
}

func TestDecodeBatteryNotification(t *testing.T) {
	_, notif := mustDecodeFrame(t, "08042a0c10048a2c070a05084d900101")
	if notif == nil || notif.Field != NotifBatteryChanged {
		t.Fatalf("expected battery notification, got %+v", notif)
	}
	b, err := DecodeBatteryState(notif.Bytes)
	if err != nil {
		t.Fatalf("DecodeBatteryState: %v", err)
	}
	if b.Level != 77 || !b.Charging {
		t.Errorf("got %+v", *b)
	}
}

func TestDecodeErrorNotification(t *testing.T) {
	_, notif := mustDecodeFrame(t, "08042a0d1005922c0808031204626f6f6d")
	if notif == nil || notif.Field != NotifError {
		t.Fatalf("expected error notification, got %+v", notif)
	}
	e, err := DecodeRpcErrorNotification(notif.Bytes)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if e.Code != 3 || e.Message != "boom" {
		t.Errorf("got %+v", *e)
	}
}

func TestDecodeThresholdNotification(t *testing.T) {
	_, notif := mustDecodeFrame(t, "08042a371006e235320a30080110d40218d00f20ffffffffffffffffff012884c30530013d0000c03f406448c0cf2450c0c40758d30260f0016801")
	if notif == nil || notif.Field != NotifHspThresholdReached {
		t.Fatalf("expected threshold notification, got %+v", notif)
	}
	s, err := DecodeHspState(notif.Bytes)
	if err != nil {
		t.Fatalf("DecodeHspState: %v", err)
	}
	if s.Points != 340 || s.TailPointIndex != 339 {
		t.Errorf("state = %+v", *s)
	}
}
