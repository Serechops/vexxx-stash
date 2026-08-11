// Package mp4 implements a pure-Go demuxer for ISO base media files
// (MP4/M4V/MOV).
//
// It parses the moov box into a complete sample index and does not decode
// anything. Fragmented files (those carrying an mvex box or moof fragments) are
// rejected with container.ErrUnsupported so the caller can fall back.
package mp4

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/stashapp/stash/pkg/nativegen/container"
)

// maxMoovSize bounds how much of a malformed file we are willing to allocate
// for the header. Real moov boxes are a few MB even for very long files.
const maxMoovSize = 256 << 20

// File is an opened ISO base media file with demuxed video and audio tracks.
type File struct {
	ra     io.ReaderAt
	size   int64
	closer io.Closer

	video *container.VideoTrack
	audio *container.AudioTrack
}

// Open opens the named file and demuxes its video track.
func Open(path string) (*File, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}

	fi, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, err
	}

	mf, err := New(f, fi.Size())
	if err != nil {
		_ = f.Close()
		return nil, err
	}

	mf.closer = f
	return mf, nil
}

// New demuxes an ISO base media file from ra, which must hold size bytes.
func New(ra io.ReaderAt, size int64) (*File, error) {
	moov, err := scanTopLevel(ra, size)
	if err != nil {
		return nil, err
	}

	// An mvex box declares that sample data lives in movie fragments, so the
	// moov sample tables are empty and there is nothing for us to index.
	if _, ok := findBox(moov, "mvex"); ok {
		return nil, fmt.Errorf("%w: fragmented mp4 (mvex present)", container.ErrUnsupported)
	}

	f := &File{ra: ra, size: size}

	// The movie timescale is the unit an empty edit is measured in, so it has to
	// be in hand before any track's edit list can be read.
	movieTimescale := movieTimescaleOf(moov)

	err = walkBoxes(moov, func(b box) error {
		if b.typ != "trak" {
			return nil
		}
		video, audio, err := parseTrak(b.payload, movieTimescale)
		if err != nil {
			return err
		}
		if video != nil && f.video == nil {
			f.video = video
		}
		if audio != nil && f.audio == nil {
			f.audio = audio
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	if f.video == nil {
		return nil, container.ErrNoVideoTrack
	}
	return f, nil
}

// Video returns the demuxed video track.
func (f *File) Video() *container.VideoTrack { return f.video }

// Audio returns the demuxed audio track, or nil if the file carries none.
func (f *File) Audio() *container.AudioTrack { return f.audio }

// Close releases the underlying file, if this File owns one.
func (f *File) Close() error {
	if f.closer != nil {
		return f.closer.Close()
	}
	return nil
}

// ReadSample reads the raw coded bytes of a single sample.
func (f *File) ReadSample(s container.Sample) ([]byte, error) {
	if s.Offset < 0 || s.Size == 0 || s.Offset+int64(s.Size) > f.size {
		return nil, fmt.Errorf("mp4: sample at %d+%d lies outside the file", s.Offset, s.Size)
	}
	buf := make([]byte, s.Size)
	if _, err := io.ReadFull(io.NewSectionReader(f.ra, s.Offset, int64(s.Size)), buf); err != nil {
		return nil, fmt.Errorf("mp4: reading sample at %d: %w", s.Offset, err)
	}
	return buf, nil
}

// topLevelBoxTypes are the box types legitimately found at the start of an ISO
// base media file. Checking against this set lets us reject files of other
// formats immediately, instead of chasing coincidental box headers through
// gigabytes of unrelated data.
var topLevelBoxTypes = map[string]bool{
	"ftyp": true, "styp": true, "moov": true, "mdat": true,
	"free": true, "skip": true, "wide": true, "pnot": true,
	"uuid": true, "junk": true, "pict": true,
}

// maxTopLevelBoxes bounds the scan for pathological or corrupt files.
const maxTopLevelBoxes = 4096

// scanTopLevel hops through the file's top-level boxes and returns the moov
// payload. Only box headers are read, so this is cheap even when moov sits
// after a multi-gigabyte mdat.
func scanTopLevel(ra io.ReaderAt, size int64) ([]byte, error) {
	// Verify the very first box before trusting any offset in this file.
	var sig [8]byte
	if _, err := ra.ReadAt(sig[:], 0); err != nil {
		return nil, fmt.Errorf("mp4: reading file signature: %w", err)
	}
	if typ := string(sig[4:8]); !topLevelBoxTypes[typ] {
		return nil, fmt.Errorf("%w: not an ISO base media file (leading box %q)",
			container.ErrUnsupported, typ)
	}

	var hdr [16]byte
	for pos, n := int64(0), 0; pos+8 <= size; n++ {
		if n >= maxTopLevelBoxes {
			return nil, fmt.Errorf("%w: more than %d top-level boxes",
				container.ErrUnsupported, maxTopLevelBoxes)
		}
		if _, err := ra.ReadAt(hdr[:8], pos); err != nil {
			return nil, fmt.Errorf("mp4: reading box header at %d: %w", pos, err)
		}

		bsize := int64(binary.BigEndian.Uint32(hdr[:4]))
		typ := string(hdr[4:8])
		hlen := int64(8)

		switch bsize {
		case 0:
			bsize = size - pos
		case 1:
			if _, err := ra.ReadAt(hdr[8:16], pos+8); err != nil {
				return nil, fmt.Errorf("mp4: reading largesize at %d: %w", pos, err)
			}
			bsize = int64(binary.BigEndian.Uint64(hdr[8:16]))
			hlen = 16
		}

		if bsize < hlen || pos+bsize > size {
			return nil, fmt.Errorf("mp4: top-level box %q at %d has invalid size %d", typ, pos, bsize)
		}

		switch typ {
		case "moof":
			return nil, fmt.Errorf("%w: fragmented mp4 (moof present)", container.ErrUnsupported)

		case "moov":
			plen := bsize - hlen
			if plen > maxMoovSize {
				return nil, fmt.Errorf("%w: moov box is %d bytes", container.ErrUnsupported, plen)
			}
			buf := make([]byte, plen)
			if _, err := ra.ReadAt(buf, pos+hlen); err != nil {
				return nil, fmt.Errorf("mp4: reading moov: %w", err)
			}
			return buf, nil
		}

		pos += bsize
	}
	return nil, errors.New("mp4: no moov box found")
}

// parseTrak parses one trak box, returning a video track, audio track, or nil
// for tracks whose type is neither (or whose codec is not supported).
func parseTrak(trak []byte, movieTimescale uint32) (*container.VideoTrack, *container.AudioTrack, error) {
	mdia, ok := findBox(trak, "mdia")
	if !ok {
		return nil, nil, nil
	}

	// hdlr tells us whether this is a video or audio track
	hdlr, ok := findBox(mdia, "hdlr")
	if !ok {
		return nil, nil, nil
	}
	r := reader{buf: hdlr}
	r.fullBox()
	r.skip(4) // pre_defined
	handler := string(r.take(4))
	if r.err != nil {
		return nil, nil, nil
	}

	switch handler {
	case "vide":
		video, err := parseVideoTrak(trak, mdia, movieTimescale)
		return video, nil, err
	case "soun":
		audio, err := parseAudioTrak(trak, mdia, movieTimescale)
		return nil, audio, err
	default:
		return nil, nil, nil
	}
}

// parseVideoTrak extracts a video track from a trak whose handler is "vide".
func parseVideoTrak(trak, mdia []byte, movieTimescale uint32) (*container.VideoTrack, error) {
	track := &container.VideoTrack{}

	// tkhd gives us the track ID and display dimensions
	if tkhd, ok := findBox(trak, "tkhd"); ok {
		r := reader{buf: tkhd}
		version, _ := r.fullBox()
		if version == 1 {
			r.skip(16) // creation, modification (64-bit)
			track.ID = r.u32()
			r.skip(4 + 8) // reserved, duration (64-bit)
		} else {
			r.skip(8) // creation, modification (32-bit)
			track.ID = r.u32()
			r.skip(4 + 4) // reserved, duration (32-bit)
		}
		r.skip(8 + 2 + 2 + 2 + 2) // reserved, layer, alternate_group, volume, reserved

		// The display matrix is stored as {a,b,u, c,d,v, x,y,w}; only the a,b,c,d
		// quartet carries rotation, the rest being perspective and translation.
		a, b := int32(r.u32()), int32(r.u32())
		r.skip(4) // u
		c, d := int32(r.u32()), int32(r.u32())
		r.skip(4 + 4 + 4 + 4) // v, x, y, w
		track.Rotation = displayRotation(a, b, c, d)

		// width and height are 16.16 fixed point
		track.Width = int(r.u32() >> 16)
		track.Height = int(r.u32() >> 16)
	}

	// mdhd gives us the media timescale and duration
	if mdhd, ok := findBox(mdia, "mdhd"); ok {
		r := reader{buf: mdhd}
		version, _ := r.fullBox()
		if version == 1 {
			r.skip(16)
			track.Timescale = r.u32()
			track.Duration = r.u64()
		} else {
			r.skip(8)
			track.Timescale = r.u32()
			d := r.u32()
			if d != 0xffffffff { // sentinel for "unknown"
				track.Duration = uint64(d)
			}
		}
	}
	if track.Timescale == 0 {
		return nil, fmt.Errorf("%w: track has no timescale", container.ErrUnsupported)
	}

	stbl, ok := findPath(mdia, "minf", "stbl")
	if !ok {
		return nil, fmt.Errorf("%w: track has no sample table", container.ErrUnsupported)
	}

	if err := parseVideoSampleDescription(stbl, track); err != nil {
		return nil, err
	}
	if track.Codec == container.CodecUnknown {
		return nil, nil // not a codec we can hand to a hardware decoder
	}

	samples, err := buildSampleIndex(stbl)
	if err != nil {
		return nil, err
	}
	track.Samples = samples

	// Fall back to the sample table when mdhd carried no usable duration.
	if track.Duration == 0 && len(samples) > 0 {
		last := samples[len(samples)-1]
		if last.DTS > 0 {
			d := last.DTS
			if len(samples) > 1 {
				d += last.DTS - samples[len(samples)-2].DTS
			}
			track.Duration = uint64(d)
		}
	}

	// Last, because the fallback above measures the media and the edit list
	// describes how the media is presented.
	edits, err := parseEditList(trak, track.Timescale, movieTimescale)
	if err != nil {
		return nil, err
	}
	edits.apply(track.Samples)

	return track, nil
}

// parseAudioTrak extracts an audio track from a trak whose handler is "soun".
func parseAudioTrak(trak, mdia []byte, movieTimescale uint32) (*container.AudioTrack, error) {
	track := &container.AudioTrack{}

	// tkhd gives us the track ID
	if tkhd, ok := findBox(trak, "tkhd"); ok {
		r := reader{buf: tkhd}
		version, _ := r.fullBox()
		if version == 1 {
			r.skip(16)
			track.ID = r.u32()
		} else {
			r.skip(8)
			track.ID = r.u32()
		}
	}

	// mdhd gives us the media timescale and duration
	if mdhd, ok := findBox(mdia, "mdhd"); ok {
		r := reader{buf: mdhd}
		version, _ := r.fullBox()
		if version == 1 {
			r.skip(16)
			track.Timescale = r.u32()
			track.Duration = r.u64()
		} else {
			r.skip(8)
			track.Timescale = r.u32()
			d := r.u32()
			if d != 0xffffffff {
				track.Duration = uint64(d)
			}
		}
	}
	if track.Timescale == 0 {
		return nil, fmt.Errorf("%w: audio track has no timescale", container.ErrUnsupported)
	}

	stbl, ok := findPath(mdia, "minf", "stbl")
	if !ok {
		return nil, fmt.Errorf("%w: audio track has no sample table", container.ErrUnsupported)
	}

	if err := parseAudioSampleDescription(stbl, track); err != nil {
		return nil, err
	}
	// A track whose codec cannot be passed through is kept with Codec Unknown
	// rather than dropped, so callers can tell "no audio in the file" apart
	// from "audio the native path cannot copy".
	samples, err := buildSampleIndex(stbl)
	if err != nil {
		return nil, err
	}
	track.Samples = samples

	// Fall back to the sample table when mdhd carried no usable duration.
	if track.Duration == 0 && len(samples) > 0 {
		last := samples[len(samples)-1]
		if last.DTS > 0 {
			d := last.DTS
			if len(samples) > 1 {
				d += last.DTS - samples[len(samples)-2].DTS
			}
			track.Duration = uint64(d)
		}
	}

	// As for video: the audio track carries its own edit list, usually trimming
	// the encoder's priming samples, and the two are different lengths in
	// seconds. Applying both is what leaves the tracks aligned with each other.
	edits, err := parseEditList(trak, track.Timescale, movieTimescale)
	if err != nil {
		return nil, err
	}
	edits.apply(track.Samples)

	return track, nil
}

// buildSampleIndex assembles a flat sample index from the stbl sub-boxes.
//
// The sample tables are stored in run-length form and split across five boxes;
// this expands them into one entry per coded frame.
func buildSampleIndex(stbl []byte) ([]container.Sample, error) {
	sizes, err := parseSampleSizes(stbl)
	if err != nil {
		return nil, err
	}
	if len(sizes) == 0 {
		return nil, fmt.Errorf("%w: sample table is empty", container.ErrUnsupported)
	}

	chunkOffsets, err := parseChunkOffsets(stbl)
	if err != nil {
		return nil, err
	}

	stscEntries, err := parseSampleToChunk(stbl)
	if err != nil {
		return nil, err
	}

	samples := make([]container.Sample, len(sizes))
	for i := range samples {
		samples[i].Size = sizes[i]
	}

	// Walk the chunks, laying samples out contiguously within each one.
	si := 0
	ei := 0
	for c := 0; c < len(chunkOffsets) && si < len(samples); c++ {
		// advance to the stsc entry covering this chunk (first_chunk is 1-based)
		for ei+1 < len(stscEntries) && uint32(c+1) >= stscEntries[ei+1].firstChunk {
			ei++
		}
		perChunk := stscEntries[ei].samplesPerChunk

		off := chunkOffsets[c]
		for k := uint32(0); k < perChunk && si < len(samples); k++ {
			samples[si].Offset = off
			off += int64(samples[si].Size)
			si++
		}
	}
	if si < len(samples) {
		return nil, fmt.Errorf("%w: chunk table covers %d of %d samples", container.ErrUnsupported, si, len(samples))
	}

	if err := applyTimestamps(stbl, samples); err != nil {
		return nil, err
	}
	applySyncSamples(stbl, samples)

	return samples, nil
}

// parseSampleSizes reads stsz, or stz2 for files using compact sizes.
func parseSampleSizes(stbl []byte) ([]uint32, error) {
	if stsz, ok := findBox(stbl, "stsz"); ok {
		r := reader{buf: stsz}
		r.fullBox()
		uniform := r.u32()
		count := r.u32()
		if r.err != nil {
			return nil, r.err
		}

		if uniform != 0 {
			// every sample is the same size; no per-sample table follows
			if int(count) > r.remaining()+int(count) { // overflow guard
				return nil, errTruncated
			}
			sizes := make([]uint32, count)
			for i := range sizes {
				sizes[i] = uniform
			}
			return sizes, nil
		}

		if int(count) > r.remaining()/4 {
			return nil, fmt.Errorf("mp4: stsz declares %d samples but is too short", count)
		}
		sizes := make([]uint32, count)
		for i := range sizes {
			sizes[i] = r.u32()
		}
		return sizes, r.err
	}

	if stz2, ok := findBox(stbl, "stz2"); ok {
		r := reader{buf: stz2}
		r.fullBox()
		r.skip(3) // reserved
		fieldSize := r.u8()
		count := r.u32()
		if r.err != nil {
			return nil, r.err
		}

		sizes := make([]uint32, count)
		switch fieldSize {
		case 4:
			for i := 0; i < int(count); i += 2 {
				b := r.u8()
				sizes[i] = uint32(b >> 4)
				if i+1 < int(count) {
					sizes[i+1] = uint32(b & 0x0f)
				}
			}
		case 8:
			for i := range sizes {
				sizes[i] = uint32(r.u8())
			}
		case 16:
			for i := range sizes {
				sizes[i] = uint32(r.u16())
			}
		default:
			return nil, fmt.Errorf("%w: stz2 field size %d", container.ErrUnsupported, fieldSize)
		}
		return sizes, r.err
	}

	return nil, errors.New("mp4: no stsz or stz2 box")
}

// parseChunkOffsets reads stco, or co64 for files larger than 4 GiB.
func parseChunkOffsets(stbl []byte) ([]int64, error) {
	if co64, ok := findBox(stbl, "co64"); ok {
		r := reader{buf: co64}
		count := r.entries(8)
		offsets := make([]int64, count)
		for i := range offsets {
			offsets[i] = int64(r.u64())
		}
		return offsets, r.err
	}

	stco, ok := findBox(stbl, "stco")
	if !ok {
		return nil, errors.New("mp4: no stco or co64 box")
	}
	r := reader{buf: stco}
	count := r.entries(4)
	offsets := make([]int64, count)
	for i := range offsets {
		offsets[i] = int64(r.u32())
	}
	return offsets, r.err
}

type stscEntry struct {
	firstChunk      uint32
	samplesPerChunk uint32
}

func parseSampleToChunk(stbl []byte) ([]stscEntry, error) {
	stsc, ok := findBox(stbl, "stsc")
	if !ok {
		return nil, errors.New("mp4: no stsc box")
	}

	r := reader{buf: stsc}
	count := r.entries(12)
	entries := make([]stscEntry, count)
	for i := range entries {
		entries[i].firstChunk = r.u32()
		entries[i].samplesPerChunk = r.u32()
		r.skip(4) // sample_description_index
	}
	if r.err != nil {
		return nil, r.err
	}
	if len(entries) == 0 {
		return nil, errors.New("mp4: stsc box is empty")
	}
	return entries, nil
}

// applyTimestamps fills in DTS from stts and PTS from ctts.
func applyTimestamps(stbl []byte, samples []container.Sample) error {
	stts, ok := findBox(stbl, "stts")
	if !ok {
		return errors.New("mp4: no stts box")
	}

	r := reader{buf: stts}
	count := r.entries(8)
	dts := int64(0)
	si := 0
	for i := uint32(0); i < count && si < len(samples); i++ {
		n := r.u32()
		delta := r.u32()
		for k := uint32(0); k < n && si < len(samples); k++ {
			samples[si].DTS = dts
			samples[si].PTS = dts // provisional; ctts may shift it
			dts += int64(delta)
			si++
		}
	}
	if r.err != nil {
		return r.err
	}

	// ctts carries the composition offset for streams with B-frames.
	ctts, ok := findBox(stbl, "ctts")
	if !ok {
		return nil
	}
	r = reader{buf: ctts}
	_, _ = r.fullBox()
	n := r.u32()
	if r.err != nil || int(n) > r.remaining()/8 {
		return nil // malformed ctts: keep PTS == DTS rather than fail the file
	}
	si = 0
	for i := uint32(0); i < n && si < len(samples); i++ {
		cnt := r.u32()

		// The offset is declared unsigned in version 0 and signed in version 1,
		// and it is read as signed either way.
		//
		// Muxers have always written negative offsets into a version 0 box —
		// this is not an exotic case, it is what a stereo VR file straight off a
		// studio's encoder does — and reading those as unsigned puts half the
		// frames of the stream four billion ticks into the future. What that
		// looks like downstream is not a decode failure but a plausible,
		// entirely wrong answer: the frames sort into a different order, the
		// spacing between them reads as two ticks rather than one, and a preview
		// comes out at half the source's frame rate showing every second frame.
		// A genuinely unsigned offset near 2^32 would be a composition shift of
		// hours, so nothing is lost by treating the top bit as a sign.
		off := int64(r.i32())

		for k := uint32(0); k < cnt && si < len(samples); k++ {
			samples[si].PTS = samples[si].DTS + off
			si++
		}
	}
	return nil
}

// applySyncSamples marks keyframes from stss. When stss is absent every sample
// is a sync sample, which is the case for all-intra codecs.
func applySyncSamples(stbl []byte, samples []container.Sample) {
	stss, ok := findBox(stbl, "stss")
	if !ok {
		for i := range samples {
			samples[i].Sync = true
		}
		return
	}

	r := reader{buf: stss}
	count := r.entries(4)
	for i := uint32(0); i < count; i++ {
		n := r.u32() // sample numbers are 1-based
		if n >= 1 && int(n) <= len(samples) {
			samples[n-1].Sync = true
		}
	}
}

// displayRotation derives the clockwise rotation a tkhd display matrix applies,
// from its a, b, c, d coefficients in 16.16 fixed point.
//
// It returns 0, 90, 180 or 270 for the plain rotations, and -1 for any other
// matrix. Anything but 0 means a decoder's coded frames are not what the file
// says should be shown.
func displayRotation(a, b, c, d int32) int {
	const one = 1 << 16

	switch {
	case a == one && b == 0 && c == 0 && d == one:
		return 0
	case a == 0 && b == one && c == -one && d == 0:
		return 90
	case a == -one && b == 0 && c == 0 && d == -one:
		return 180
	case a == 0 && b == -one && c == one && d == 0:
		return 270
	case a == 0 && b == 0 && c == 0 && d == 0:
		// A degenerate all-zero matrix is written by more than one muxer and
		// describes no transform at all. ffmpeg ignores it rather than treating
		// the file as unplayable, so treat it as unrotated here too.
		return 0
	}
	return -1
}
