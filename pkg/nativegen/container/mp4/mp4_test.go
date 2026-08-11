package mp4

import (
	"encoding/binary"
	"os"
	"testing"

	"github.com/stashapp/stash/pkg/nativegen/container"
)

// mkbox builds a box with the given type and payload.
func mkbox(typ string, payload ...[]byte) []byte {
	var body []byte
	for _, p := range payload {
		body = append(body, p...)
	}
	b := make([]byte, 8, 8+len(body))
	binary.BigEndian.PutUint32(b, uint32(8+len(body)))
	copy(b[4:], typ)
	return append(b, body...)
}

func u16b(v uint16) []byte { return []byte{byte(v >> 8), byte(v)} }

func u32b(v uint32) []byte {
	return []byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)}
}

func fullBoxHeader() []byte { return []byte{0, 0, 0, 0} }

// testSTBL builds a sample table describing five samples spread over three
// chunks, with samples 1 and 4 (1-based) marked as sync samples.
func testSTBL(extra ...[]byte) []byte {
	stts := mkbox("stts", fullBoxHeader(), u32b(1), u32b(5), u32b(100))

	// chunk 1 and 2 hold two samples each; chunk 3 holds one
	stsc := mkbox("stsc", fullBoxHeader(), u32b(2),
		u32b(1), u32b(2), u32b(1),
		u32b(3), u32b(1), u32b(1))

	stsz := mkbox("stsz", fullBoxHeader(), u32b(0), u32b(5),
		u32b(10), u32b(20), u32b(30), u32b(40), u32b(50))

	stco := mkbox("stco", fullBoxHeader(), u32b(3),
		u32b(1000), u32b(2000), u32b(3000))

	stss := mkbox("stss", fullBoxHeader(), u32b(2), u32b(1), u32b(4))

	out := append([]byte{}, stts...)
	out = append(out, stsc...)
	out = append(out, stsz...)
	out = append(out, stco...)
	out = append(out, stss...)
	for _, e := range extra {
		out = append(out, e...)
	}
	return out
}

func TestBuildSampleIndex(t *testing.T) {
	samples, err := buildSampleIndex(testSTBL())
	if err != nil {
		t.Fatalf("buildSampleIndex: %v", err)
	}
	if len(samples) != 5 {
		t.Fatalf("got %d samples, want 5", len(samples))
	}

	// Samples are laid out contiguously within each chunk, so offsets accumulate
	// from the chunk offset and reset at each chunk boundary.
	want := []struct {
		offset int64
		size   uint32
		dts    int64
		sync   bool
	}{
		{1000, 10, 0, true},
		{1010, 20, 100, false},
		{2000, 30, 200, false},
		{2030, 40, 300, true},
		{3000, 50, 400, false},
	}

	for i, w := range want {
		got := samples[i]
		if got.Offset != w.offset || got.Size != w.size || got.DTS != w.dts || got.Sync != w.sync {
			t.Errorf("sample %d = {offset:%d size:%d dts:%d sync:%v}, want {offset:%d size:%d dts:%d sync:%v}",
				i, got.Offset, got.Size, got.DTS, got.Sync, w.offset, w.size, w.dts, w.sync)
		}
		if got.PTS != got.DTS {
			t.Errorf("sample %d: PTS %d != DTS %d with no ctts box", i, got.PTS, got.DTS)
		}
	}
}

func TestBuildSampleIndexCompositionOffsets(t *testing.T) {
	// version 1 ctts, with a negative offset on the second run
	ctts := mkbox("ctts", []byte{1, 0, 0, 0}, u32b(2),
		u32b(2), u32b(200),
		u32b(3), u32b(0xffffffff-99)) // -100

	samples, err := buildSampleIndex(testSTBL(ctts))
	if err != nil {
		t.Fatalf("buildSampleIndex: %v", err)
	}

	want := []int64{200, 300, 100, 200, 300}
	for i, w := range want {
		if samples[i].PTS != w {
			t.Errorf("sample %d PTS = %d, want %d", i, samples[i].PTS, w)
		}
	}
}

// A version 0 ctts declares its offsets unsigned, and muxers write negative
// ones into it anyway. Reading those as unsigned does not fail: it puts half a
// stream's frames 2^32 ticks into the future, where they sort into a different
// order and the spacing between the rest reads as double the frame period. A
// real 59.94fps stereo file demuxed as 29.97 that way, and its preview showed
// every second frame.
func TestBuildSampleIndexNegativeOffsetsInVersionZeroCtts(t *testing.T) {
	ctts := mkbox("ctts", fullBoxHeader(), u32b(2),
		u32b(2), u32b(200),
		u32b(3), u32b(0xffffffff-99)) // -100, written into a version 0 box

	samples, err := buildSampleIndex(testSTBL(ctts))
	if err != nil {
		t.Fatalf("buildSampleIndex: %v", err)
	}

	want := []int64{200, 300, 100, 200, 300}
	for i, w := range want {
		if samples[i].PTS != w {
			t.Errorf("sample %d PTS = %d, want %d", i, samples[i].PTS, w)
		}
	}
}

func TestBuildSampleIndexNoSyncTable(t *testing.T) {
	// Drop stss: an all-intra codec has no sync sample table and every sample
	// must be treated as a keyframe.
	stbl := mkbox("stts", fullBoxHeader(), u32b(1), u32b(2), u32b(100))
	stbl = append(stbl, mkbox("stsc", fullBoxHeader(), u32b(1), u32b(1), u32b(2), u32b(1))...)
	stbl = append(stbl, mkbox("stsz", fullBoxHeader(), u32b(0), u32b(2), u32b(10), u32b(20))...)
	stbl = append(stbl, mkbox("stco", fullBoxHeader(), u32b(1), u32b(500))...)

	samples, err := buildSampleIndex(stbl)
	if err != nil {
		t.Fatalf("buildSampleIndex: %v", err)
	}
	for i, s := range samples {
		if !s.Sync {
			t.Errorf("sample %d is not marked sync but the file has no stss box", i)
		}
	}
}

func TestBuildSampleIndexUniformSizes(t *testing.T) {
	// A non-zero sample_size in stsz means every sample shares that size and no
	// per-sample table follows.
	stbl := mkbox("stts", fullBoxHeader(), u32b(1), u32b(3), u32b(50))
	stbl = append(stbl, mkbox("stsc", fullBoxHeader(), u32b(1), u32b(1), u32b(3), u32b(1))...)
	stbl = append(stbl, mkbox("stsz", fullBoxHeader(), u32b(64), u32b(3))...)
	stbl = append(stbl, mkbox("stco", fullBoxHeader(), u32b(1), u32b(100))...)

	samples, err := buildSampleIndex(stbl)
	if err != nil {
		t.Fatalf("buildSampleIndex: %v", err)
	}
	for i, s := range samples {
		if s.Size != 64 {
			t.Errorf("sample %d size = %d, want 64", i, s.Size)
		}
		if want := int64(100 + i*64); s.Offset != want {
			t.Errorf("sample %d offset = %d, want %d", i, s.Offset, want)
		}
	}
}

func TestBuildSampleIndexRejectsShortChunkTable(t *testing.T) {
	// stsz declares five samples but stco only provides one chunk holding one,
	// so the tables disagree and the file must be rejected rather than
	// silently producing samples with bogus offsets.
	stbl := mkbox("stts", fullBoxHeader(), u32b(1), u32b(5), u32b(100))
	stbl = append(stbl, mkbox("stsc", fullBoxHeader(), u32b(1), u32b(1), u32b(1), u32b(1))...)
	stbl = append(stbl, mkbox("stsz", fullBoxHeader(), u32b(10), u32b(5))...)
	stbl = append(stbl, mkbox("stco", fullBoxHeader(), u32b(1), u32b(100))...)

	if _, err := buildSampleIndex(stbl); err == nil {
		t.Fatal("expected an error when the chunk table covers fewer samples than stsz declares")
	}
}

func TestParseAVCC(t *testing.T) {
	sps := []byte{0x67, 0x64, 0x00, 0x28}
	pps := []byte{0x68, 0xee, 0x3c}

	var cfg []byte
	cfg = append(cfg, 0x01, 0x64, 0x00, 0x28) // version, profile, compat, level
	cfg = append(cfg, 0xff)                   // lengthSizeMinusOne = 3
	cfg = append(cfg, 0xe1)                   // numSPS = 1
	cfg = append(cfg, u16b(uint16(len(sps)))...)
	cfg = append(cfg, sps...)
	cfg = append(cfg, 0x01) // numPPS = 1
	cfg = append(cfg, u16b(uint16(len(pps)))...)
	cfg = append(cfg, pps...)

	sets, nalLen, err := parseAVCC(cfg)
	if err != nil {
		t.Fatalf("parseAVCC: %v", err)
	}
	if nalLen != 4 {
		t.Errorf("NAL length size = %d, want 4", nalLen)
	}

	var want []byte
	want = append(want, startCode...)
	want = append(want, sps...)
	want = append(want, startCode...)
	want = append(want, pps...)

	if string(sets) != string(want) {
		t.Errorf("parameter sets = % x, want % x", sets, want)
	}
}

func TestParseVideoSampleDescription(t *testing.T) {
	avcC := mkbox("avcC", []byte{
		0x01, 0x64, 0x00, 0x28,
		0xff,
		0xe1, 0x00, 0x04, 0x67, 0x64, 0x00, 0x28,
		0x01, 0x00, 0x03, 0x68, 0xee, 0x3c,
	})

	entry := make([]byte, videoSampleEntryHeader)
	copy(entry[24:], u16b(1920))
	copy(entry[26:], u16b(1080))

	stsd := mkbox("stsd", fullBoxHeader(), u32b(1), mkbox("avc1", entry, avcC))
	stbl := append([]byte{}, stsd...)

	var track container.VideoTrack
	if err := parseVideoSampleDescription(stbl, &track); err != nil {
		t.Fatalf("parseVideoSampleDescription: %v", err)
	}

	if track.Codec != container.CodecH264 {
		t.Errorf("codec = %q, want %q", track.Codec, container.CodecH264)
	}
	if track.Width != 1920 || track.Height != 1080 {
		t.Errorf("dimensions = %dx%d, want 1920x1080", track.Width, track.Height)
	}
	if track.NALLengthSize != 4 {
		t.Errorf("NAL length size = %d, want 4", track.NALLengthSize)
	}
	if len(track.ParameterSets) != 15 { // 2 start codes + 4-byte SPS + 3-byte PPS
		t.Errorf("parameter sets are %d bytes, want 15", len(track.ParameterSets))
	}
}

func TestToAnnexB(t *testing.T) {
	// two NAL units, 4-byte length prefixes
	sample := []byte{
		0x00, 0x00, 0x00, 0x03, 0xaa, 0xbb, 0xcc,
		0x00, 0x00, 0x00, 0x02, 0xdd, 0xee,
	}

	got, err := ToAnnexB(sample, 4, []byte{0xff})
	if err != nil {
		t.Fatalf("ToAnnexB: %v", err)
	}

	want := []byte{
		0xff,
		0x00, 0x00, 0x00, 0x01, 0xaa, 0xbb, 0xcc,
		0x00, 0x00, 0x00, 0x01, 0xdd, 0xee,
	}
	if string(got) != string(want) {
		t.Errorf("ToAnnexB = % x, want % x", got, want)
	}
}

func TestToAnnexBRejectsOverrun(t *testing.T) {
	// declares a 16-byte NAL but only supplies two bytes
	sample := []byte{0x00, 0x00, 0x00, 0x10, 0xaa, 0xbb}
	if _, err := ToAnnexB(sample, 4, nil); err == nil {
		t.Fatal("expected an error when a NAL unit overruns the sample")
	}
}

func TestToAnnexBTwoByteLengths(t *testing.T) {
	sample := []byte{0x00, 0x02, 0xaa, 0xbb, 0x00, 0x01, 0xcc}
	got, err := ToAnnexB(sample, 2, nil)
	if err != nil {
		t.Fatalf("ToAnnexB: %v", err)
	}
	want := []byte{
		0x00, 0x00, 0x00, 0x01, 0xaa, 0xbb,
		0x00, 0x00, 0x00, 0x01, 0xcc,
	}
	if string(got) != string(want) {
		t.Errorf("ToAnnexB = % x, want % x", got, want)
	}
}

func TestWalkBoxesRejectsBadSize(t *testing.T) {
	// a box claiming to be larger than the buffer that contains it
	buf := []byte{0x00, 0x00, 0xff, 0x00, 'j', 'u', 'n', 'k'}
	err := walkBoxes(buf, func(box) error { return nil })
	if err == nil {
		t.Fatal("expected an error for a box larger than its container")
	}
}

func TestWalkBoxesLargeSize(t *testing.T) {
	// size == 1 selects the 64-bit largesize field
	buf := make([]byte, 0, 17)
	buf = append(buf, u32b(1)...)
	buf = append(buf, []byte("free")...)
	buf = append(buf, 0, 0, 0, 0, 0, 0, 0, 17)
	buf = append(buf, 0x42)

	var seen []box
	if err := walkBoxes(buf, func(b box) error {
		seen = append(seen, b)
		return nil
	}); err != nil {
		t.Fatalf("walkBoxes: %v", err)
	}

	if len(seen) != 1 || seen[0].typ != "free" {
		t.Fatalf("got %d boxes, want one 'free' box", len(seen))
	}
	if len(seen[0].payload) != 1 || seen[0].payload[0] != 0x42 {
		t.Errorf("payload = % x, want 42", seen[0].payload)
	}
}

// TestRealFile demuxes an actual video file when one is supplied, which is the
// only way to exercise the top-level scan and real-world sample tables.
//
//	go test ./pkg/nativegen/... -run TestRealFile -v \
//	  -args -test.v  # STASH_NATIVEGEN_TEST_MP4=/path/to/scene.mp4
func TestRealFile(t *testing.T) {
	path := os.Getenv("STASH_NATIVEGEN_TEST_MP4")
	if path == "" {
		t.Skip("set STASH_NATIVEGEN_TEST_MP4 to a video file to run this test")
	}

	f, err := Open(path)
	if err != nil {
		t.Fatalf("Open(%s): %v", path, err)
	}
	defer f.Close()

	v := f.Video()
	sync := v.SyncSamples()

	t.Logf("codec=%s %dx%d duration=%.2fs timescale=%d samples=%d keyframes=%d paramsets=%dB",
		v.Codec, v.Width, v.Height, v.DurationSeconds(), v.Timescale,
		len(v.Samples), len(sync), len(v.ParameterSets))

	if len(v.Samples) == 0 {
		t.Fatal("no samples were indexed")
	}
	if len(sync) == 0 {
		t.Fatal("no keyframes were found")
	}

	// Offsets must be monotonic and lie within the file.
	for i := 1; i < len(v.Samples); i++ {
		if v.Samples[i].Offset < v.Samples[i-1].Offset {
			t.Fatalf("sample %d offset %d precedes sample %d offset %d",
				i, v.Samples[i].Offset, i-1, v.Samples[i-1].Offset)
		}
	}

	// Read the 81 keyframes a sprite sheet would need and confirm each one
	// converts to a plausible Annex-B access unit.
	const tiles = 81
	times := make([]float64, tiles)
	step := v.DurationSeconds() / tiles
	for i := range times {
		times[i] = float64(i) * step
	}

	picked := v.KeyframesAt(times)
	var total int
	for n, idx := range picked {
		if idx < 0 {
			t.Fatalf("tile %d resolved to no keyframe", n)
		}
		au, err := f.SampleAnnexB(idx)
		if err != nil {
			t.Fatalf("tile %d (sample %d): %v", n, idx, err)
		}
		if len(au) < 4 || string(au[:4]) != string(startCode) {
			t.Fatalf("tile %d does not begin with a start code: % x", n, au[:min(8, len(au))])
		}
		total += len(au)
	}

	t.Logf("read %d keyframes totalling %.1f MiB (%.4f%% of the file)",
		len(picked), float64(total)/(1<<20),
		float64(total)/float64(fileSize(t, path))*100)
}

func fileSize(t *testing.T, path string) int64 {
	t.Helper()
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	return fi.Size()
}

func TestDisplayRotation(t *testing.T) {
	const one = 1 << 16

	tests := []struct {
		name       string
		a, b, c, d int32
		want       int
	}{
		{"identity", one, 0, 0, one, 0},
		{"90 clockwise", 0, one, -one, 0, 90},
		{"180", -one, 0, 0, -one, 180},
		{"270", 0, -one, one, 0, 270},
		// Written by more than one muxer and meaning no transform at all.
		{"degenerate all-zero", 0, 0, 0, 0, 0},
		// A horizontal flip is not expressible as a rotation, so it has to be
		// reported as unhandled rather than rounded to the nearest rotation.
		{"horizontal flip", -one, 0, 0, one, -1},
		// Half scale: same aspect, but not a rotation.
		{"scaled", one / 2, 0, 0, one / 2, -1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := displayRotation(tt.a, tt.b, tt.c, tt.d); got != tt.want {
				t.Errorf("displayRotation(%d, %d, %d, %d) = %d, want %d",
					tt.a, tt.b, tt.c, tt.d, got, tt.want)
			}
		})
	}
}
