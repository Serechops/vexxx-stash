package mp4

import (
	"bytes"
	"encoding/binary"
	"testing"

	"github.com/stashapp/stash/pkg/nativegen/container"
)

// A minimal but structurally valid set of parameter sets: an SPS carrying a
// profile, compatibility and level in the three bytes after its header, and a
// PPS. The muxer copies those three bytes into the configuration record, so they
// are given distinguishable values here.
var (
	testSPS = []byte{0x67, 0x64, 0x00, 0x1e, 0xac, 0xd9}
	testPPS = []byte{0x68, 0xeb, 0xe3, 0xcb}
)

func testParameterSets() []byte {
	var b []byte
	b = append(b, 0, 0, 0, 1)
	b = append(b, testSPS...)
	b = append(b, 0, 0, 0, 1)
	b = append(b, testPPS...)
	return b
}

// annexB wraps NAL payloads in four-byte start codes, the form the encoder
// produces and AddSample expects.
func annexB(nals ...[]byte) []byte {
	var b []byte
	for _, n := range nals {
		b = append(b, 0, 0, 0, 1)
		b = append(b, n...)
	}
	return b
}

// slice returns a NAL of the given type and length, filled with a recognisable
// byte so that its contents can be located in the output.
func nal(typ byte, n int) []byte {
	out := make([]byte, n)
	out[0] = typ // nal_ref_idc zero is fine; the muxer only reads the low bits
	for i := 1; i < n; i++ {
		out[i] = 0xa5
	}
	return out
}

func newTestMuxer(t *testing.T) *Muxer {
	t.Helper()
	m, err := NewMuxer(MuxConfig{Width: 640, Height: 360, Timescale: 30, ParameterSets: testParameterSets()})
	if err != nil {
		t.Fatalf("NewMuxer: %v", err)
	}
	return m
}

func TestNewMuxerNeedsParameterSets(t *testing.T) {
	tests := []struct {
		name string
		cfg  MuxConfig
	}{
		{"no parameter sets at all", MuxConfig{Width: 640, Height: 360, Timescale: 30}},
		{"no PPS", MuxConfig{Width: 640, Height: 360, Timescale: 30, ParameterSets: annexB(testSPS)}},
		{"no SPS", MuxConfig{Width: 640, Height: 360, Timescale: 30, ParameterSets: annexB(testPPS)}},
		{"no size", MuxConfig{Timescale: 30, ParameterSets: testParameterSets()}},
		{"no timescale", MuxConfig{Width: 640, Height: 360, ParameterSets: testParameterSets()}},
		// A configuration record has to state a profile and level, which are read
		// out of the SPS, so an SPS too short to hold them cannot be described.
		{"SPS too short", MuxConfig{Width: 640, Height: 360, Timescale: 30,
			ParameterSets: annexB([]byte{0x67, 0x64}, testPPS)}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := NewMuxer(tt.cfg); err == nil {
				t.Error("NewMuxer accepted a config it cannot describe")
			}
		})
	}
}

func TestMuxerRejectsAnEmptyFile(t *testing.T) {
	m := newTestMuxer(t)
	if _, err := m.WriteTo(&bytes.Buffer{}); err == nil {
		t.Error("WriteTo produced a file with no samples in it")
	}
}

func TestAddSampleRejectsNothingToStore(t *testing.T) {
	m := newTestMuxer(t)

	if err := m.AddSample(annexB(nal(1, 16)), 0, false); err == nil {
		t.Error("AddSample accepted a sample shown for no time at all")
	}
	// Parameter sets are stripped, so a sample holding only parameter sets
	// stores nothing and would be a zero-length entry in the size table.
	if err := m.AddSample(annexB(testSPS, testPPS), 1, true); err == nil {
		t.Error("AddSample accepted a sample that holds no coded picture")
	}
}

// TestAddSampleStripsWhatTheConfigurationRecordHolds checks that parameter sets
// and access unit delimiters do not also end up stored per-frame.
func TestAddSampleStripsWhatTheConfigurationRecordHolds(t *testing.T) {
	m := newTestMuxer(t)

	picture := nal(5, 32)
	// A keyframe as the encoder emits it: parameter sets, a delimiter, then the
	// picture itself.
	if err := m.AddSample(annexB(testSPS, testPPS, nal(nalAUD, 2), picture), 1, true); err != nil {
		t.Fatalf("AddSample: %v", err)
	}

	// Only the picture should have been stored, with a four-byte length ahead of
	// it and nothing else.
	want := len(picture) + 4
	if got := len(m.mdat); got != want {
		t.Errorf("stored %d bytes for a %d-byte picture, want %d", got, len(picture), want)
	}
	if got := binary.BigEndian.Uint32(m.mdat); int(got) != len(picture) {
		t.Errorf("length prefix says %d bytes, picture is %d", got, len(picture))
	}
	if !bytes.Equal(m.mdat[4:], picture) {
		t.Error("the stored bytes are not the picture that went in")
	}
}

func TestSplitAnnexB(t *testing.T) {
	tests := []struct {
		name string
		in   []byte
		want [][]byte
	}{
		{"four-byte start codes", annexB([]byte{1, 2}, []byte{3, 4}),
			[][]byte{{1, 2}, {3, 4}}},
		{"three-byte start codes", []byte{0, 0, 1, 1, 2, 0, 0, 1, 3, 4},
			[][]byte{{1, 2}, {3, 4}}},
		// The extra zero belongs to the following start code, not to the unit
		// before it. Counting it would corrupt every NAL but the last.
		{"mixed widths", []byte{0, 0, 1, 1, 2, 0, 0, 0, 1, 3, 4},
			[][]byte{{1, 2}, {3, 4}}},
		{"nothing", nil, nil},
		{"no start code", []byte{1, 2, 3}, nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := splitAnnexB(tt.in)
			if len(got) != len(tt.want) {
				t.Fatalf("got %d units, want %d: %v", len(got), len(tt.want), got)
			}
			for i := range got {
				if !bytes.Equal(got[i], tt.want[i]) {
					t.Errorf("unit %d is %v, want %v", i, got[i], tt.want[i])
				}
			}
		})
	}
}

// TestSttsCollapsesAConstantFrameRate checks the time-to-sample table is
// run-length encoded, which is what keeps it to one entry for the constant rate
// a preview is written at.
func TestSttsCollapsesAConstantFrameRate(t *testing.T) {
	m := newTestMuxer(t)
	for i := 0; i < 10; i++ {
		if err := m.AddSample(annexB(nal(1, 8)), 1, i == 0); err != nil {
			t.Fatalf("AddSample: %v", err)
		}
	}

	stts := findTable(t, m, "stts")
	if got := binary.BigEndian.Uint32(stts[4:]); got != 1 {
		t.Fatalf("stts has %d entries for a constant frame rate, want 1", got)
	}
	if count := binary.BigEndian.Uint32(stts[8:]); count != 10 {
		t.Errorf("stts covers %d samples, want 10", count)
	}
	if delta := binary.BigEndian.Uint32(stts[12:]); delta != 1 {
		t.Errorf("stts delta is %d, want 1", delta)
	}
}

func TestSttsSplitsWhenDurationsChange(t *testing.T) {
	m := newTestMuxer(t)
	for _, d := range []uint32{1, 1, 2, 2, 2, 1} {
		if err := m.AddSample(annexB(nal(1, 8)), d, false); err != nil {
			t.Fatalf("AddSample: %v", err)
		}
	}

	stts := findTable(t, m, "stts")
	if got := binary.BigEndian.Uint32(stts[4:]); got != 3 {
		t.Errorf("stts has %d runs, want 3", got)
	}
}

// TestStssIsOmittedWhenEveryFrameIsAKeyframe checks the format's own idiom for
// "all samples are sync samples", which is a missing box rather than a table
// listing every one of them.
func TestStssIsOmittedWhenEveryFrameIsAKeyframe(t *testing.T) {
	m := newTestMuxer(t)
	for i := 0; i < 5; i++ {
		if err := m.AddSample(annexB(nal(5, 8)), 1, true); err != nil {
			t.Fatalf("AddSample: %v", err)
		}
	}

	if _, ok := findInMoov(m, "trak", "mdia", "minf", "stbl", "stss"); ok {
		t.Error("stss was written even though every sample is a sync sample")
	}
}

func TestStssListsTheKeyframes(t *testing.T) {
	m := newTestMuxer(t)
	sync := []bool{true, false, false, true, false}
	for _, s := range sync {
		if err := m.AddSample(annexB(nal(1, 8)), 1, s); err != nil {
			t.Fatalf("AddSample: %v", err)
		}
	}

	stss := findTable(t, m, "stss")
	if got := binary.BigEndian.Uint32(stss[4:]); got != 2 {
		t.Fatalf("stss lists %d keyframes, want 2", got)
	}
	// Sample numbers are 1-based, so the keyframes at index 0 and 3 are 1 and 4.
	for i, want := range []uint32{1, 4} {
		if got := binary.BigEndian.Uint32(stss[8+i*4:]); got != want {
			t.Errorf("keyframe %d is sample %d, want %d", i, got, want)
		}
	}
}

// TestAvcCCarriesTheParameterSets checks the configuration record, which is the
// one thing a player must read correctly before it can decode anything at all.
func TestAvcCCarriesTheParameterSets(t *testing.T) {
	m := newTestMuxer(t)
	if err := m.AddSample(annexB(nal(5, 8)), 1, true); err != nil {
		t.Fatalf("AddSample: %v", err)
	}

	avcc, ok := findInMoov(m, "trak", "mdia", "minf", "stbl", "stsd")
	if !ok {
		t.Fatal("no stsd box")
	}
	// stsd is a full box with an entry count ahead of its children.
	avcc, ok = findPath(avcc[8:], "avc1")
	if !ok {
		t.Fatal("no avc1 sample entry")
	}
	// avc1's fixed fields run to 78 bytes before its child boxes begin.
	avcc, ok = findPath(avcc[78:], "avcC")
	if !ok {
		t.Fatal("no avcC configuration record")
	}

	if avcc[0] != 1 {
		t.Errorf("configuration version is %d, want 1", avcc[0])
	}
	// The profile, compatibility and level are copied out of the SPS.
	if got := avcc[1:4]; !bytes.Equal(got, testSPS[1:4]) {
		t.Errorf("profile/compat/level are %x, want %x", got, testSPS[1:4])
	}
	// Samples are written with four-byte length prefixes, so the low two bits
	// of this field must be three.
	if got := avcc[4] & 0x03; got != 3 {
		t.Errorf("lengthSizeMinusOne is %d, want 3 for four-byte prefixes", got)
	}
	if got := avcc[5] & 0x1f; got != 1 {
		t.Fatalf("record holds %d SPS, want 1", got)
	}
	if got := int(binary.BigEndian.Uint16(avcc[6:])); got != len(testSPS) {
		t.Fatalf("SPS length is %d, want %d", got, len(testSPS))
	}
	if got := avcc[8 : 8+len(testSPS)]; !bytes.Equal(got, testSPS) {
		t.Errorf("SPS is %x, want %x", got, testSPS)
	}

	pos := 8 + len(testSPS)
	if got := avcc[pos]; got != 1 {
		t.Fatalf("record holds %d PPS, want 1", got)
	}
	if got := avcc[pos+3 : pos+3+len(testPPS)]; !bytes.Equal(got, testPPS) {
		t.Errorf("PPS is %x, want %x", got, testPPS)
	}
}

// TestWriteToPointsTheChunkOffsetAtTheMedia is the check that the file's one
// piece of circular arithmetic came out right. An offset that is wrong by any
// amount produces a file that parses and plays nothing.
func TestWriteToPointsTheChunkOffsetAtTheMedia(t *testing.T) {
	m := newTestMuxer(t)
	picture := nal(5, 64)
	if err := m.AddSample(annexB(picture), 1, true); err != nil {
		t.Fatalf("AddSample: %v", err)
	}

	var buf bytes.Buffer
	n, err := m.WriteTo(&buf)
	if err != nil {
		t.Fatalf("WriteTo: %v", err)
	}
	if n != int64(buf.Len()) {
		t.Errorf("WriteTo reported %d bytes but wrote %d", n, buf.Len())
	}

	file := buf.Bytes()
	stco, ok := findPath(file, "moov", "trak", "mdia", "minf", "stbl", "stco")
	if !ok {
		t.Fatal("no stco box")
	}
	offset := int(binary.BigEndian.Uint32(stco[8:]))

	// The offset must land on the first sample's length prefix, which for this
	// one sample is the size of the picture that follows it.
	if offset+4 > len(file) {
		t.Fatalf("chunk offset %d is past the end of a %d-byte file", offset, len(file))
	}
	if got := int(binary.BigEndian.Uint32(file[offset:])); got != len(picture) {
		t.Errorf("the chunk offset points at %d, which is not the %d-byte picture", got, len(picture))
	}
	if got := file[offset+4 : offset+4+len(picture)]; !bytes.Equal(got, picture) {
		t.Error("the chunk offset does not point at the sample data")
	}
}

// TestWriteToPutsMetadataFirst checks the layout a player needs in order to
// start without having fetched the whole file.
func TestWriteToPutsMetadataFirst(t *testing.T) {
	m := newTestMuxer(t)
	if err := m.AddSample(annexB(nal(5, 64)), 1, true); err != nil {
		t.Fatalf("AddSample: %v", err)
	}

	var buf bytes.Buffer
	if _, err := m.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo: %v", err)
	}

	var order []string
	if err := walkBoxes(buf.Bytes(), func(b box) error {
		order = append(order, b.typ)
		return nil
	}); err != nil {
		t.Fatalf("the file does not parse as a box tree: %v", err)
	}

	want := []string{"ftyp", "moov", "mdat"}
	if len(order) != len(want) {
		t.Fatalf("file holds boxes %v, want %v", order, want)
	}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("file holds boxes %v, want %v", order, want)
		}
	}
}

// TestWrittenFileParsesWithOurOwnDemuxer closes the loop: the demuxer alongside
// this muxer was written first and against real files, so agreeing with it is
// evidence about the muxer rather than about a shared assumption.
func TestWrittenFileParsesWithOurOwnDemuxer(t *testing.T) {
	m := newTestMuxer(t)

	const frames = 10
	for i := 0; i < frames; i++ {
		if err := m.AddSample(annexB(nal(5, 32+i)), 1, i%5 == 0); err != nil {
			t.Fatalf("AddSample: %v", err)
		}
	}

	var buf bytes.Buffer
	if _, err := m.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo: %v", err)
	}

	f, err := New(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("our demuxer cannot read what our muxer wrote: %v", err)
	}

	track := f.Video()
	if track == nil {
		t.Fatal("the written file has no video track")
	}
	if track.Codec != "h264" {
		t.Errorf("codec is %q, want h264", track.Codec)
	}
	if track.Width != 640 || track.Height != 360 {
		t.Errorf("track is %dx%d, want 640x360", track.Width, track.Height)
	}
	if track.Timescale != 30 {
		t.Errorf("timescale is %d, want 30", track.Timescale)
	}
	if len(track.Samples) != frames {
		t.Fatalf("track holds %d samples, want %d", len(track.Samples), frames)
	}
	if got := len(track.SyncSamples()); got != 2 {
		t.Errorf("track has %d sync samples, want 2", got)
	}

	// Sample sizes and offsets have to describe the bytes actually stored: each
	// sample here is one NAL of a different length behind a four-byte prefix.
	for i, s := range track.Samples {
		if want := uint32(32 + i + 4); s.Size != want {
			t.Errorf("sample %d is %d bytes, want %d", i, s.Size, want)
		}
		if s.PTS != int64(i) {
			t.Errorf("sample %d is shown at %d, want %d", i, s.PTS, i)
		}
	}
}

// findTable returns the payload of a table inside the sample table box.
func findTable(t *testing.T, m *Muxer, typ string) []byte {
	t.Helper()
	b, ok := findInMoov(m, "trak", "mdia", "minf", "stbl", typ)
	if !ok {
		t.Fatalf("no %s box", typ)
	}
	return b
}

// findInMoov walks a path inside the movie box. The path starts with "moov"
// because moov(0, 0) returns the whole box, header and all, and walking has to
// begin by stepping over that header rather than assuming it is not there.
func findInMoov(m *Muxer, path ...string) ([]byte, bool) {
	return findPath(m.moov(0, 0), append([]string{"moov"}, path...)...)
}

// findAudioInMoov walks a path inside the second (audio) track of the movie
// box. It finds the second trak and then follows the remaining path.
func findAudioInMoov(m *Muxer, path ...string) ([]byte, bool) {
	moov := m.moov(0, 0)
	moovPayload := moov[8:] // skip box header (size + type)
	var traks []box
	if err := walkBoxes(moovPayload, func(b box) error {
		if b.typ == "trak" {
			traks = append(traks, b)
		}
		return nil
	}); err != nil {
		return nil, false
	}
	if len(traks) < 2 {
		return nil, false
	}
	return findPath(traks[1].payload, path...)
}

// TestNewMuxerAcceptsAudioConfig checks that an audio config is accepted.
func TestNewMuxerAcceptsAudioConfig(t *testing.T) {
	cfg := MuxConfig{
		Width: 640, Height: 360, Timescale: 30,
		ParameterSets: testParameterSets(),
		Audio: &AudioConfig{
			Codec:      container.AudioCodecAAC,
			SampleRate: 44100,
			Channels:   2,
			BitDepth:   16,
			Timescale:  44100,
			Config:     esdsConfig(),
		},
	}
	m, err := NewMuxer(cfg)
	if err != nil {
		t.Fatalf("NewMuxer: %v", err)
	}
	if m.audio == nil {
		t.Fatal("audio config was not stored")
	}
}

func TestNewMuxerRejectsBadAudioConfig(t *testing.T) {
	tests := []struct {
		name string
		cfg  AudioConfig
	}{
		{"unknown codec", AudioConfig{Codec: container.AudioCodecUnknown, Timescale: 44100, Config: esdsConfig()}},
		{"no timescale", AudioConfig{Codec: container.AudioCodecAAC, Timescale: 0, Config: esdsConfig()}},
		{"no config", AudioConfig{Codec: container.AudioCodecAAC, Timescale: 44100}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewMuxer(MuxConfig{
				Width: 640, Height: 360, Timescale: 30,
				ParameterSets: testParameterSets(),
				Audio:         &tt.cfg,
			})
			if err == nil {
				t.Error("NewMuxer accepted a bad audio config")
			}
		})
	}
}

// esdsConfig returns a minimal structurally valid esds box payload for AAC.
func esdsConfig() []byte {
	// A minimal esds box: full box header + ES_Descriptor(0x03) +
	// DecoderConfigDescriptor(0x04) + DecoderSpecificInfo(0x05) with a
	// one-byte AudioSpecificConfig (AAC-LC).
	w := &boxWriter{}
	w.fullBox("esds", 0, 0, func() {
		w.u8(0x03) // ES_Descriptor tag
		w.u8(0x13) // length (19 bytes)
		w.u8(0)    // ES_ID
		w.u8(0)    // ES_ID
		w.u8(0)    // flags
		w.u8(0x04) // DecoderConfigDescriptor tag
		w.u8(0x11) // length (17 bytes)
		w.u8(0x40) // objectTypeIndication (AAC-LC)
		w.u8(0x15) // streamType (Audio)
		w.u32(0)   // bufferSizeDB
		w.u32(0)   // maxBitrate
		w.u32(0)   // avgBitrate
		w.u8(0x05) // DecoderSpecificInfo tag
		w.u8(0x02) // length (2 bytes)
		w.u8(0x12) // AudioSpecificConfig: AAC-LC, 44.1kHz, 2ch
		w.u8(0x10)
	})
	return w.buf
}

// TestAudioTrackIsWritten verifies the audio track boxes are present in
// the output and contain the correct metadata.
func TestAudioTrackIsWritten(t *testing.T) {
	m, err := NewMuxer(MuxConfig{
		Width: 640, Height: 360, Timescale: 30,
		ParameterSets: testParameterSets(),
		Audio: &AudioConfig{
			Codec:      container.AudioCodecAAC,
			SampleRate: 44100,
			Channels:   2,
			BitDepth:   16,
			Timescale:  44100,
			Config:     esdsConfig(),
		},
	})
	if err != nil {
		t.Fatalf("NewMuxer: %v", err)
	}
	if err := m.AddSample(annexB(nal(5, 32)), 1, true); err != nil {
		t.Fatalf("AddSample: %v", err)
	}
	if err := m.AddAudioSample([]byte{0x12, 0x34, 0x56, 0x78}, 1024); err != nil {
		t.Fatalf("AddAudioSample: %v", err)
	}
	if err := m.AddAudioSample([]byte{0x9a, 0xbc, 0xde, 0xf0}, 1024); err != nil {
		t.Fatalf("AddAudioSample: %v", err)
	}

	// Check the audio track's hdlr is "soun". The hdlr payload is: version/flags
	// (4) + pre_defined (4) + handler type (4).
	hdlr, ok := findAudioInMoov(m, "mdia", "hdlr")
	if !ok {
		t.Fatal("no hdlr in audio track")
	}
	if len(hdlr) < 12 {
		t.Fatal("hdlr is too short")
	}
	if string(hdlr[8:12]) != "soun" {
		t.Errorf("audio handler is %q, want soun", string(hdlr[8:12]))
	}

	// Check the audio track's stsd has an mp4a entry. The stsd payload is:
	// version/flags (4) + entry_count (4) + sample entries. The first entry is
	// a box with its own header (8), so the type is at offset 8+4 = 12 within
	// the stsd payload.
	stsd, ok := findAudioInMoov(m, "mdia", "minf", "stbl", "stsd")
	if !ok {
		t.Fatal("no stsd in audio track")
	}
	if len(stsd) < 16 {
		t.Fatal("stsd is too short")
	}
	entryType := string(stsd[12:16])
	if entryType != "mp4a" {
		t.Errorf("audio sample entry is %q, want mp4a", entryType)
	}

	// Check the audio track's stsc box references the right sample count.
	stsc, ok := findAudioInMoov(m, "mdia", "minf", "stbl", "stsc")
	if !ok {
		t.Fatal("no stsc in audio track")
	}
	if len(stsc) < 20 {
		t.Fatal("stsc is too short")
	}
	// entry_count is at offset 4; first entry's samples_per_chunk is at offset 12.
	samplesPerChunk := binary.BigEndian.Uint32(stsc[12:])
	if samplesPerChunk != 2 {
		t.Errorf("audio stsc samples per chunk = %d, want 2", samplesPerChunk)
	}
}

// TestWrittenFileWithAudioParsesWithOurOwnDemuxer closes the loop for
// video+audio files: the demuxer alongside this muxer should read what the
// muxer writes.
func TestWrittenFileWithAudioParsesWithOurOwnDemuxer(t *testing.T) {
	cfg := MuxConfig{
		Width: 640, Height: 360, Timescale: 30,
		ParameterSets: testParameterSets(),
		Audio: &AudioConfig{
			Codec:      container.AudioCodecAAC,
			SampleRate: 44100,
			Channels:   2,
			BitDepth:   16,
			Timescale:  44100,
			Config:     esdsConfig(),
		},
	}
	m, err := NewMuxer(cfg)
	if err != nil {
		t.Fatalf("NewMuxer: %v", err)
	}

	const frames = 5
	for i := 0; i < frames; i++ {
		if err := m.AddSample(annexB(nal(5, 32)), 1, true); err != nil {
			t.Fatalf("AddSample: %v", err)
		}
	}
	if err := m.AddAudioSample([]byte{0x12, 0x34}, 1024); err != nil {
		t.Fatalf("AddAudioSample: %v", err)
	}

	var buf bytes.Buffer
	if _, err := m.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo: %v", err)
	}

	f, err := New(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("our demuxer cannot read what our muxer wrote: %v", err)
	}

	video := f.Video()
	if video == nil {
		t.Fatal("the written file has no video track")
	}
	if len(video.Samples) != frames {
		t.Errorf("video track has %d samples, want %d", len(video.Samples), frames)
	}

	audio := f.Audio()
	if audio == nil {
		t.Fatal("the written file has no audio track")
	}
	if audio.Codec != container.AudioCodecAAC {
		t.Errorf("audio codec is %q, want AAC", audio.Codec)
	}
	if audio.SampleRate != 44100 {
		t.Errorf("audio sample rate is %d, want 44100", audio.SampleRate)
	}
	if audio.Channels != 2 {
		t.Errorf("audio channels is %d, want 2", audio.Channels)
	}
	if len(audio.Samples) != 1 {
		t.Errorf("audio track has %d samples, want 1", len(audio.Samples))
	}
	// The audio esds config should be present.
	if len(audio.Config) == 0 {
		t.Error("audio track has no configuration record")
	}
}

// TestWrittenFileWithFLACAudioParsesWithOurOwnDemuxer verifies the round-trip
// for a non-AAC codec (FLAC), exercising the alternate box-type paths.
func TestWrittenFileWithFLACAudioParsesWithOurOwnDemuxer(t *testing.T) {
	// A minimal dfLa box payload (FLAC decoder configuration metadata).
	dfLa := mkbox("dfLa", []byte{
		0, 0, 0, 0, // version + flags
		0x01,        // last metadata block flag + block type
		0, 0, 0, 34, // metadata block length
		0x66, 0x4C, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22, // "fLaC" + STREAMINFO
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // various zeros
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	})

	cfg := MuxConfig{
		Width: 640, Height: 360, Timescale: 30,
		ParameterSets: testParameterSets(),
		Audio: &AudioConfig{
			Codec:      container.AudioCodecFLAC,
			SampleRate: 48000,
			Channels:   2,
			BitDepth:   16,
			Timescale:  48000,
			Config:     dfLa,
		},
	}
	m, err := NewMuxer(cfg)
	if err != nil {
		t.Fatalf("NewMuxer: %v", err)
	}
	if err := m.AddSample(annexB(nal(5, 32)), 1, true); err != nil {
		t.Fatalf("AddSample: %v", err)
	}
	if err := m.AddAudioSample([]byte{0x12, 0x34}, 4800); err != nil {
		t.Fatalf("AddAudioSample: %v", err)
	}

	var buf bytes.Buffer
	if _, err := m.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo: %v", err)
	}

	f, err := New(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("our demuxer cannot read what our muxer wrote: %v", err)
	}

	audio := f.Audio()
	if audio == nil {
		t.Fatal("the written file has no audio track")
	}
	if audio.Codec != container.AudioCodecFLAC {
		t.Errorf("audio codec is %q, want FLAC", audio.Codec)
	}
	if audio.SampleRate != 48000 {
		t.Errorf("audio sample rate is %d, want 48000", audio.SampleRate)
	}
	if audio.Channels != 2 {
		t.Errorf("audio channels is %d, want 2", audio.Channels)
	}
	if len(audio.Config) == 0 {
		t.Error("audio track has no configuration record")
	}
}
