package iptv

import "strings"

// StreamMode says how much work a programme needs before its frames can join
// the channel's MPEG-TS stream.
//
// The overwhelmingly common case is ModeCopy: local library files are almost
// always H.264 or HEVC with AAC or AC-3, all of which MPEG-TS carries natively.
// Remuxing those costs a few percent of one core, against roughly a whole core
// to re-encode them — so the mode chosen here is the difference between a
// channel being nearly free and being expensive.
type StreamMode int

const (
	// ModeCopy repackages existing frames into MPEG-TS without touching them.
	ModeCopy StreamMode = iota
	// ModeTranscodeAudio re-encodes only the audio track, leaving video frames
	// untouched. Cheap — audio is a rounding error next to video.
	ModeTranscodeAudio
	// ModeTranscodeAll re-encodes video too. Reserved for codecs MPEG-TS cannot
	// carry at all, such as VP9 or AV1 in a WebM container.
	ModeTranscodeAll
)

func (m StreamMode) String() string {
	switch m {
	case ModeCopy:
		return "copy"
	case ModeTranscodeAudio:
		return "transcode-audio"
	default:
		return "transcode"
	}
}

// tsVideoCodecs are the video codecs MPEG-TS carries and consumer TV decoders
// reliably play. AV1 is deliberately absent: carriage in TS is specified but
// support in the set-top boxes this feature targets is not there yet.
var tsVideoCodecs = map[string]bool{
	"h264":       true,
	"avc1":       true,
	"hevc":       true,
	"h265":       true,
	"mpeg1video": true,
	"mpeg2video": true,
	"mpeg4":      true,
	"vc1":        true,
}

// tsAudioCodecs are the audio codecs MPEG-TS carries natively. Opus, Vorbis and
// FLAC are absent — all three are common in WebM/MKV and none survives a remux.
var tsAudioCodecs = map[string]bool{
	"aac":  true,
	"ac3":  true,
	"eac3": true,
	"mp2":  true,
	"mp3":  true,
	"dts":  true,
}

// ChooseMode decides how a source file can reach the channel's TS stream.
//
// Both codec names come from what ffprobe recorded at scan time and are already
// stored on the file, so this needs no probing and can be called while building
// a schedule.
func ChooseMode(videoCodec, audioCodec string) StreamMode {
	v := normaliseCodec(videoCodec)
	a := normaliseCodec(audioCodec)

	if !tsVideoCodecs[v] {
		return ModeTranscodeAll
	}

	// An empty audio codec means the file simply has no audio track, which
	// remuxes fine — only a codec that is present and unsupported needs work.
	if a != "" && !tsAudioCodecs[a] {
		return ModeTranscodeAudio
	}

	return ModeCopy
}

func normaliseCodec(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}
