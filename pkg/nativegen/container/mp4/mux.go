package mp4

import (
	"encoding/binary"
	"fmt"
	"io"

	"github.com/stashapp/stash/pkg/nativegen/container"
)

// A Muxer writes H.264 samples into a progressive MP4.
//
// It is deliberately much narrower than the demuxer alongside it: one video
// track, at most one audio track passed through unmodified, no fragments, no
// edit lists. That is all preview generation needs, and every field this does
// not write is a field that cannot be written wrongly.
//
// Samples are accumulated in memory and the file is produced in one go by
// WriteTo. Holding a whole file in memory would be indefensible for a general
// muxer; a preview is a few seconds of 640-pixel-wide video and runs to a
// few hundred kilobytes, and buffering it is what makes the layout below
// possible.
type Muxer struct {
	cfg     MuxConfig
	sps     [][]byte
	pps     [][]byte
	samples []muxSample
	mdat    []byte

	// audio is non-nil when the file carries a second, audio track.
	audio        *AudioConfig
	audioSamples []muxSample
	audioData    []byte
}

// AudioConfig describes an audio track to be passed through beside the video.
// The samples are written verbatim — no decoding, no re-encoding — so the file
// can only carry an audio codec the source held.
type AudioConfig struct {
	// Codec identifies the coding format, which selects the sample entry and
	// configuration box written for it.
	Codec container.AudioCodec

	// SampleRate, Channels and BitDepth are the decoded-format fields of the
	// sample entry, read from the source.
	SampleRate int
	Channels   int
	BitDepth   int

	// Timescale is the audio track's time base, distinct from the video's.
	Timescale uint32

	// Config is the codec's configuration record (an esds box for AAC) as read
	// from the source, written back verbatim under the same box type.
	Config []byte
}

// MuxConfig describes the tracks to write.
type MuxConfig struct {
	Width, Height int

	// Timescale is the number of time units per second that sample durations
	// are expressed in. Choosing the frame rate's numerator lets an exact frame
	// duration be written as an integer, including for rates like 30000/1001
	// that have no exact decimal form.
	Timescale uint32

	// ParameterSets holds the encoder's SPS and PPS in Annex-B form. They are
	// moved into the codec configuration record and stripped from the samples,
	// which is where a player looks for them.
	ParameterSets []byte

	// Audio, when non-nil, adds a second, audio track to the file.
	Audio *AudioConfig
}

type muxSample struct {
	size     uint32
	duration uint32
	sync     bool
}

// NewMuxer starts a file, taking the parameter sets that describe the track.
func NewMuxer(cfg MuxConfig) (*Muxer, error) {
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return nil, fmt.Errorf("mp4: invalid track size %dx%d", cfg.Width, cfg.Height)
	}
	if cfg.Timescale == 0 {
		return nil, fmt.Errorf("mp4: track needs a timescale")
	}

	m := &Muxer{cfg: cfg}
	for _, nal := range splitAnnexB(cfg.ParameterSets) {
		switch nal[0] & 0x1f {
		case nalSPS:
			m.sps = append(m.sps, nal)
		case nalPPS:
			m.pps = append(m.pps, nal)
		}
	}
	if len(m.sps) == 0 || len(m.pps) == 0 {
		return nil, fmt.Errorf("%w: parameter sets hold %d SPS and %d PPS, need at least one of each",
			container.ErrUnsupported, len(m.sps), len(m.pps))
	}
	// The configuration record copies the profile and level out of the first
	// SPS, so it has to be long enough to hold them.
	if len(m.sps[0]) < 4 {
		return nil, fmt.Errorf("%w: SPS is %d bytes, too short to describe a profile",
			container.ErrUnsupported, len(m.sps[0]))
	}

	if cfg.Audio != nil {
		if cfg.Audio.Codec == container.AudioCodecUnknown {
			return nil, fmt.Errorf("mp4: audio track has no codec")
		}
		if cfg.Audio.Timescale == 0 {
			return nil, fmt.Errorf("mp4: audio track needs a timescale")
		}
		if len(cfg.Audio.Config) == 0 {
			return nil, fmt.Errorf("mp4: audio track has no configuration record")
		}
		m.audio = cfg.Audio
	}
	return m, nil
}

// H.264 NAL unit types, from the values the standard assigns to nal_unit_type.
const (
	nalSPS = 7
	nalPPS = 8
	nalAUD = 9
)

// AddSample appends one encoded frame.
//
// data is the frame in Annex-B form as the encoder produced it. duration is how
// long the frame is shown, in the configured timescale.
func (m *Muxer) AddSample(data []byte, duration uint32, sync bool) error {
	if duration == 0 {
		return fmt.Errorf("mp4: sample %d has zero duration", len(m.samples))
	}

	start := len(m.mdat)
	for _, nal := range splitAnnexB(data) {
		// Parameter sets live in the configuration record, and access unit
		// delimiters carry nothing a player needs. Both are dropped rather than
		// stored per-frame, which is what ffmpeg's muxer does too.
		switch nal[0] & 0x1f {
		case nalSPS, nalPPS, nalAUD:
			continue
		}
		m.mdat = binary.BigEndian.AppendUint32(m.mdat, uint32(len(nal)))
		m.mdat = append(m.mdat, nal...)
	}

	size := len(m.mdat) - start
	if size == 0 {
		return fmt.Errorf("mp4: sample %d holds no NAL units", len(m.samples))
	}

	m.samples = append(m.samples, muxSample{
		size:     uint32(size),
		duration: duration,
		sync:     sync,
	})
	return nil
}

// AddAudioSample appends one audio sample, passed through verbatim.
//
// Unlike AddSample, the data is written exactly as given: audio has no NAL
// units to strip or re-prefix, and any transformation would risk corrupting
// the stream. duration is how long the sample plays, in the audio track's
// timescale.
func (m *Muxer) AddAudioSample(data []byte, duration uint32) error {
	if m.audio == nil {
		return fmt.Errorf("mp4: no audio track to add a sample to")
	}
	if duration == 0 {
		return fmt.Errorf("mp4: audio sample %d has zero duration", len(m.audioSamples))
	}
	if len(data) == 0 {
		return fmt.Errorf("mp4: audio sample %d holds no data", len(m.audioSamples))
	}

	start := len(m.audioData)
	m.audioData = append(m.audioData, data...)
	m.audioSamples = append(m.audioSamples, muxSample{
		size:     uint32(len(m.audioData) - start),
		duration: duration,
	})
	return nil
}

// Samples reports how many frames have been added.
func (m *Muxer) Samples() int { return len(m.samples) }

// WriteTo produces the finished file.
//
// The layout is ftyp, moov, mdat — metadata ahead of the media, so a player can
// start without having read to the end. That ordering is what makes the chunk
// offsets circular: they point into mdat, whose position depends on the size of
// the moov that holds them. Writing every sample as one chunk (per track)
// removes the circularity outright, because then there are exactly two offsets
// and the table holding them is a fixed size whatever their values.
func (m *Muxer) WriteTo(w io.Writer) (int64, error) {
	if len(m.samples) == 0 {
		return 0, fmt.Errorf("mp4: nothing to write, no samples were added")
	}

	ftyp := m.ftyp()

	// The first pass exists only to measure moov. Its chunk offsets are wrong by
	// construction and nothing reads them.
	sized := len(ftyp) + len(m.moov(0, 0)) + 8
	videoOff := uint32(sized)
	audioOff := videoOff + uint32(len(m.mdat))
	moov := m.moov(videoOff, audioOff)

	// A second pass could in principle come out a different length and move the
	// offset again. It cannot here — every table is fixed-width and none of them
	// depends on the offset's value — but the whole file is wrong if that ever
	// stops being true, so it is checked rather than assumed.
	if got := len(ftyp) + len(moov) + 8; got != int(sized) {
		return 0, fmt.Errorf("mp4: moov changed size when the chunk offset was filled in (%d then %d)", sized, got)
	}

	var n int64
	for _, part := range [][]byte{ftyp, moov, m.mdatHeader()} {
		written, err := w.Write(part)
		n += int64(written)
		if err != nil {
			return n, err
		}
	}
	written, err := w.Write(m.mdat)
	n += int64(written)
	if err != nil {
		return n, err
	}

	if m.audio != nil {
		written, err = w.Write(m.audioData)
		n += int64(written)
		if err != nil {
			return n, err
		}
	}
	return n, nil
}

func (m *Muxer) mdatHeader() []byte {
	// The mdat box holds the video samples followed by the audio samples, so
	// its declared size is the sum of the two.
	size := len(m.mdat) + len(m.audioData) + 8
	h := make([]byte, 8)
	binary.BigEndian.PutUint32(h, uint32(size))
	copy(h[4:], "mdat")
	return h
}

// duration is the track's total length in the media timescale.
func (m *Muxer) duration() uint64 {
	var total uint64
	for _, s := range m.samples {
		total += uint64(s.duration)
	}
	return total
}

// audioDuration is the audio track's total length in its own timescale.
func (m *Muxer) audioDuration() uint64 {
	var total uint64
	for _, s := range m.audioSamples {
		total += uint64(s.duration)
	}
	return total
}

// movieTimescale is the timescale of the presentation as a whole, as opposed to
// the track's own. A thousand ticks a second is the conventional choice and
// makes the duration readable in milliseconds.
const movieTimescale = 1000

func (m *Muxer) movieDuration() uint64 {
	d := m.duration() * movieTimescale / uint64(m.cfg.Timescale)
	if m.audio != nil {
		ad := m.audioDuration() * movieTimescale / uint64(m.audio.Timescale)
		if ad > d {
			d = ad
		}
	}
	return d
}

func (m *Muxer) ftyp() []byte {
	w := &boxWriter{}
	w.box("ftyp", func() {
		w.str("isom")
		w.u32(0x200)
		// The brands a player checks to decide whether it can handle the file.
		w.str("iso2")
		w.str("avc1")
		w.str("mp41")
		// mp42 signals the file may carry an audio track alongside the video.
		w.str("mp42")
	})
	return w.buf
}

func (m *Muxer) moov(videoOff, audioOff uint32) []byte {
	w := &boxWriter{}
	w.box("moov", func() {
		m.mvhd(w)
		m.trak(w, videoOff)
		if m.audio != nil {
			m.audioTrak(w, audioOff)
		}
	})
	return w.buf
}

func (m *Muxer) mvhd(w *boxWriter) {
	nextTrack := uint32(2)
	if m.audio != nil {
		nextTrack = 3
	}

	w.fullBox("mvhd", 0, 0, func() {
		w.u32(0) // creation time
		w.u32(0) // modification time
		w.u32(movieTimescale)
		w.u32(uint32(m.movieDuration()))
		w.u32(0x00010000) // rate, 1.0
		w.u16(0x0100)     // volume, 1.0
		w.u16(0)          // reserved
		w.u32(0)
		w.u32(0)
		w.matrix()
		for i := 0; i < 6; i++ {
			w.u32(0) // pre_defined
		}
		w.u32(nextTrack) // next track ID
	})
}

func (m *Muxer) trak(w *boxWriter, chunkOffset uint32) {
	w.box("trak", func() {
		// flags 7: the track is enabled, and is used in both the presentation
		// and the preview. A track without these is legal and invisible.
		w.fullBox("tkhd", 0, 7, func() {
			w.u32(0) // creation time
			w.u32(0) // modification time
			w.u32(1) // track ID
			w.u32(0) // reserved
			w.u32(uint32(m.movieDuration()))
			w.u32(0)
			w.u32(0)
			w.u16(0) // layer
			w.u16(0) // alternate group
			w.u16(0) // volume, zero for video
			w.u16(0) // reserved
			w.matrix()
			w.u32(uint32(m.cfg.Width) << 16)
			w.u32(uint32(m.cfg.Height) << 16)
		})
		m.mdia(w, chunkOffset)
	})
}

func (m *Muxer) audioTrak(w *boxWriter, chunkOffset uint32) {
	w.box("trak", func() {
		// flags 7: enabled, in-preview, in-movie.
		w.fullBox("tkhd", 0, 7, func() {
			w.u32(0) // creation time
			w.u32(0) // modification time
			w.u32(2) // track ID
			w.u32(0) // reserved
			w.u32(uint32(m.movieDuration()))
			w.u32(0)
			w.u32(0)
			w.u16(0)      // layer
			w.u16(0)      // alternate group
			w.u16(0x0100) // volume, 1.0 for audio
			w.u16(0)      // reserved
			w.matrix()
			w.u32(0) // width, zero for audio
			w.u32(0) // height, zero for audio
		})
		m.audioMdia(w, chunkOffset)
	})
}

func (m *Muxer) audioMdia(w *boxWriter, chunkOffset uint32) {
	w.box("mdia", func() {
		w.fullBox("mdhd", 0, 0, func() {
			w.u32(0) // creation time
			w.u32(0) // modification time
			w.u32(m.audio.Timescale)
			w.u32(uint32(m.audioDuration()))
			// Language, as three five-bit letters offset from 0x60: "und".
			w.u16(0x55c4)
			w.u16(0) // pre_defined
		})
		w.fullBox("hdlr", 0, 0, func() {
			w.u32(0) // pre_defined
			w.str("soun")
			w.u32(0) // reserved
			w.u32(0)
			w.u32(0)
			w.cstr("SoundHandler")
		})
		m.audioMinf(w, chunkOffset)
	})
}

func (m *Muxer) audioMinf(w *boxWriter, chunkOffset uint32) {
	w.box("minf", func() {
		// smhd is the audio media header, with flags 0.
		w.fullBox("smhd", 0, 0, func() {
			w.u16(0) // balance
			w.u16(0) // reserved
		})
		w.box("dinf", func() {
			w.fullBox("dref", 0, 0, func() {
				w.u32(1)
				w.fullBox("url ", 0, 1, func() {})
			})
		})
		m.audioStbl(w, chunkOffset)
	})
}

func (m *Muxer) audioStbl(w *boxWriter, chunkOffset uint32) {
	w.box("stbl", func() {
		m.audioStsd(w)
		m.audioStts(w)
		// Audio has no sync sample table — every audio sample is independently
		// decodable in the sense the stss box describes, and the box is omitted
		// to signal that.

		w.fullBox("stsc", 0, 0, func() {
			w.u32(1)
			w.u32(1)                           // first chunk
			w.u32(uint32(len(m.audioSamples))) // samples in it: all of them
			w.u32(1)                           // sample description index
		})

		w.fullBox("stsz", 0, 0, func() {
			w.u32(0) // a zero common size means the sizes are listed per sample
			w.u32(uint32(len(m.audioSamples)))
			for _, s := range m.audioSamples {
				w.u32(s.size)
			}
		})

		w.fullBox("stco", 0, 0, func() {
			w.u32(1)
			w.u32(chunkOffset)
		})
	})
}

func (m *Muxer) audioStsd(w *boxWriter) {
	w.fullBox("stsd", 0, 0, func() {
		w.u32(1) // one entry
		m.audioSampleEntry(w)
	})
}

// audioSampleEntry writes the codec-specific sample entry for the audio track.
func (m *Muxer) audioSampleEntry(w *boxWriter) {
	// The sample entry type comes from the codec.
	typ := m.audioCodecBoxType()
	w.box(typ, func() {
		// AudioSampleEntry fixed fields (28 bytes).
		w.u32(0) // reserved[6]
		w.u16(0)
		w.u16(1) // data reference index
		w.u32(0) // reserved[8]
		w.u32(0)
		w.u16(uint16(m.audio.Channels)) // channelcount
		w.u16(uint16(m.audio.BitDepth)) // samplesize
		w.u16(0)                        // pre_defined
		w.u16(0)                        // reserved
		// samplerate is 16.16 fixed point.
		w.u32(uint32(m.audio.SampleRate) << 16)

		// The configuration record is written back under the box type it was
		// read from. Config holds the payload only; the header is recreated
		// here so the finished file has a proper esds/dac3/... child box.
		w.box(m.audioConfigBoxType(), func() {
			w.bytes(m.audio.Config)
		})
	})
}

// audioCodecBoxType returns the four-letter box type for the audio track's
// sample entry, based on the codec.
func (m *Muxer) audioCodecBoxType() string {
	switch m.audio.Codec {
	case container.AudioCodecAAC:
		return "mp4a"
	case container.AudioCodecAC3:
		return "ac-3"
	case container.AudioCodecEAC3:
		return "ec-3"
	case container.AudioCodecOpus:
		return "Opus"
	case container.AudioCodecFLAC:
		return "fLaC"
	case container.AudioCodecALAC:
		return "alac"
	default:
		return "mp4a"
	}
}

// audioConfigBoxType returns the box type under which the codec's configuration
// record is stored, matching what the demuxer read it from.
func (m *Muxer) audioConfigBoxType() string {
	switch m.audio.Codec {
	case container.AudioCodecAAC:
		return "esds"
	case container.AudioCodecAC3:
		return "dac3"
	case container.AudioCodecEAC3:
		return "dec3"
	case container.AudioCodecOpus:
		return "dOps"
	case container.AudioCodecFLAC:
		return "dfLa"
	case container.AudioCodecALAC:
		return "alac"
	default:
		return "esds"
	}
}

func (m *Muxer) audioStts(w *boxWriter) {
	// Audio is passed through, so the sample durations from the source are
	// preserved. Run-length encoding is applied the same way as for video.
	type run struct{ count, delta uint32 }
	var runs []run
	for _, s := range m.audioSamples {
		if n := len(runs); n > 0 && runs[n-1].delta == s.duration {
			runs[n-1].count++
			continue
		}
		runs = append(runs, run{count: 1, delta: s.duration})
	}

	w.fullBox("stts", 0, 0, func() {
		w.u32(uint32(len(runs)))
		for _, r := range runs {
			w.u32(r.count)
			w.u32(r.delta)
		}
	})
}

func (m *Muxer) mdia(w *boxWriter, chunkOffset uint32) {
	w.box("mdia", func() {
		w.fullBox("mdhd", 0, 0, func() {
			w.u32(0) // creation time
			w.u32(0) // modification time
			w.u32(m.cfg.Timescale)
			w.u32(uint32(m.duration()))
			// Language, as three five-bit letters offset from 0x60: "und".
			w.u16(0x55c4)
			w.u16(0) // pre_defined
		})
		w.fullBox("hdlr", 0, 0, func() {
			w.u32(0) // pre_defined
			w.str("vide")
			w.u32(0) // reserved
			w.u32(0)
			w.u32(0)
			w.cstr("VideoHandler")
		})
		m.minf(w, chunkOffset)
	})
}

func (m *Muxer) minf(w *boxWriter, chunkOffset uint32) {
	w.box("minf", func() {
		// flags 1 is the required value for vmhd, not a choice.
		w.fullBox("vmhd", 0, 1, func() {
			w.u16(0) // graphics mode
			w.u16(0) // opcolor
			w.u16(0)
			w.u16(0)
		})
		w.box("dinf", func() {
			w.fullBox("dref", 0, 0, func() {
				w.u32(1)
				// An empty url box with flags 1 means the media is in this same
				// file, which is the only arrangement this muxer produces.
				w.fullBox("url ", 0, 1, func() {})
			})
		})
		m.stbl(w, chunkOffset)
	})
}

func (m *Muxer) stbl(w *boxWriter, chunkOffset uint32) {
	w.box("stbl", func() {
		m.stsd(w)
		m.stts(w)
		m.stss(w)

		w.fullBox("stsc", 0, 0, func() {
			w.u32(1)
			w.u32(1)                      // first chunk
			w.u32(uint32(len(m.samples))) // samples in it: all of them
			w.u32(1)                      // sample description index
		})

		w.fullBox("stsz", 0, 0, func() {
			w.u32(0) // a zero common size means the sizes are listed per sample
			w.u32(uint32(len(m.samples)))
			for _, s := range m.samples {
				w.u32(s.size)
			}
		})

		w.fullBox("stco", 0, 0, func() {
			w.u32(1)
			w.u32(chunkOffset)
		})
	})
}

func (m *Muxer) stsd(w *boxWriter) {
	w.fullBox("stsd", 0, 0, func() {
		w.u32(1)
		w.box("avc1", func() {
			w.u32(0) // reserved
			w.u16(0) // reserved
			w.u16(1) // data reference index
			w.u16(0) // pre_defined
			w.u16(0) // reserved
			w.u32(0) // pre_defined
			w.u32(0)
			w.u32(0)
			w.u16(uint16(m.cfg.Width))
			w.u16(uint16(m.cfg.Height))
			w.u32(0x00480000) // horizontal resolution, 72 dpi
			w.u32(0x00480000) // vertical resolution, 72 dpi
			w.u32(0)          // reserved
			w.u16(1)          // frame count
			// A fixed 32-byte field holding a length-prefixed name. Leaving it
			// blank is allowed and is what most muxers write.
			w.bytes(make([]byte, 32))
			w.u16(0x0018) // depth, 24-bit colour
			w.u16(0xffff) // pre_defined, -1
			m.avcC(w)
		})
	})
}

// avcC writes the codec configuration record: the parameter sets a decoder needs
// before it can make sense of any sample, plus the length of the size prefix
// this file's samples use.
func (m *Muxer) avcC(w *boxWriter) {
	w.box("avcC", func() {
		w.u8(1)           // configuration version
		w.u8(m.sps[0][1]) // profile
		w.u8(m.sps[0][2]) // profile compatibility
		w.u8(m.sps[0][3]) // level
		// Six reserved bits set, then lengthSizeMinusOne. Samples are written
		// with four-byte length prefixes, so the value is three.
		w.u8(0xfc | 3)
		// Three reserved bits set, then the SPS count in the low five.
		w.u8(0xe0 | uint8(len(m.sps)))
		for _, s := range m.sps {
			w.u16(uint16(len(s)))
			w.bytes(s)
		}
		w.u8(uint8(len(m.pps)))
		for _, p := range m.pps {
			w.u16(uint16(len(p)))
			w.bytes(p)
		}
	})
}

// stts writes the time-to-sample table, run-length encoded over runs of samples
// that are shown for the same length of time. A constant frame rate collapses to
// a single entry.
func (m *Muxer) stts(w *boxWriter) {
	type run struct{ count, delta uint32 }
	var runs []run
	for _, s := range m.samples {
		if n := len(runs); n > 0 && runs[n-1].delta == s.duration {
			runs[n-1].count++
			continue
		}
		runs = append(runs, run{count: 1, delta: s.duration})
	}

	w.fullBox("stts", 0, 0, func() {
		w.u32(uint32(len(runs)))
		for _, r := range runs {
			w.u32(r.count)
			w.u32(r.delta)
		}
	})
}

// stss writes the sync sample table, listing the frames a player may seek to.
//
// The box is omitted when every sample is a sync sample, which is how the format
// says "all of them" — an all-inclusive table would mean the same thing but a
// missing box is the conventional spelling.
func (m *Muxer) stss(w *boxWriter) {
	var syncs []uint32
	for i, s := range m.samples {
		if s.sync {
			syncs = append(syncs, uint32(i+1)) // sample numbers are 1-based
		}
	}
	if len(syncs) == len(m.samples) {
		return
	}

	w.fullBox("stss", 0, 0, func() {
		w.u32(uint32(len(syncs)))
		for _, s := range syncs {
			w.u32(s)
		}
	})
}

// splitAnnexB cuts a byte stream into NAL unit payloads, accepting both the
// three- and four-byte start codes, and dropping the trailing zero that a
// four-byte code contributes to the preceding unit.
func splitAnnexB(b []byte) [][]byte {
	var starts []int
	for i := 0; i+3 <= len(b); i++ {
		if b[i] == 0 && b[i+1] == 0 && b[i+2] == 1 {
			starts = append(starts, i+3)
			i += 2
		}
	}

	out := make([][]byte, 0, len(starts))
	for i, s := range starts {
		end := len(b)
		if i+1 < len(starts) {
			end = starts[i+1] - 3
			// A four-byte start code is a three-byte one with an extra leading
			// zero, which would otherwise be counted as part of this unit.
			if end > s && b[end-1] == 0 {
				end--
			}
		}
		if s < end {
			out = append(out, b[s:end])
		}
	}
	return out
}

// boxWriter builds a box tree, filling in each box's length once its contents
// are known.
type boxWriter struct {
	buf []byte
}

func (w *boxWriter) u8(v uint8)     { w.buf = append(w.buf, v) }
func (w *boxWriter) u16(v uint16)   { w.buf = binary.BigEndian.AppendUint16(w.buf, v) }
func (w *boxWriter) u32(v uint32)   { w.buf = binary.BigEndian.AppendUint32(w.buf, v) }
func (w *boxWriter) bytes(b []byte) { w.buf = append(w.buf, b...) }
func (w *boxWriter) str(s string)   { w.buf = append(w.buf, s...) }
func (w *boxWriter) cstr(s string)  { w.str(s); w.u8(0) }

// matrix writes the identity transform, in the 16.16 fixed-point form the format
// uses everywhere except the bottom row, which is 2.30.
func (w *boxWriter) matrix() {
	for _, v := range [9]uint32{0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000} {
		w.u32(v)
	}
}

// box writes a box of the given type around whatever fn appends.
func (w *boxWriter) box(typ string, fn func()) {
	start := len(w.buf)
	w.u32(0) // length, filled in below
	w.str(typ)
	fn()
	binary.BigEndian.PutUint32(w.buf[start:], uint32(len(w.buf)-start))
}

// fullBox writes a box carrying the version and flags header that the format
// calls a full box.
func (w *boxWriter) fullBox(typ string, version uint8, flags uint32, fn func()) {
	w.box(typ, func() {
		w.u32(uint32(version)<<24 | flags&0x00ffffff)
		fn()
	})
}
