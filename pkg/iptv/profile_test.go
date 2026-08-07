package iptv

import "testing"

func TestChooseModeCopiesCommonLibraryFiles(t *testing.T) {
	// What the overwhelming majority of a local library looks like. If any of
	// these ever needs an encoder, the feature has stopped being cheap.
	cases := []struct{ video, audio string }{
		{"h264", "aac"},
		{"h264", "ac3"},
		{"h264", "mp3"},
		{"hevc", "aac"},
		{"hevc", "eac3"},
		{"mpeg4", "mp2"},
		{"h264", ""}, // no audio track at all
	}

	for _, c := range cases {
		if got := ChooseMode(c.video, c.audio); got != ModeCopy {
			t.Errorf("ChooseMode(%q, %q) = %v, want copy", c.video, c.audio, got)
		}
	}
}

func TestChooseModeTranscodesAudioOnly(t *testing.T) {
	// Video MPEG-TS can carry, audio it cannot: re-encode the cheap stream and
	// leave the expensive one alone.
	for _, audio := range []string{"opus", "vorbis", "flac", "pcm_s16le"} {
		if got := ChooseMode("h264", audio); got != ModeTranscodeAudio {
			t.Errorf("ChooseMode(h264, %q) = %v, want transcode-audio", audio, got)
		}
	}
}

func TestChooseModeTranscodesUnsupportedVideo(t *testing.T) {
	for _, video := range []string{"vp8", "vp9", "av1", "theora"} {
		if got := ChooseMode(video, "aac"); got != ModeTranscodeAll {
			t.Errorf("ChooseMode(%q, aac) = %v, want transcode", video, got)
		}
	}
}

// Unsupported video wins even when the audio is also unsupported — a full
// transcode already covers the audio, so it must not be misreported as
// audio-only work.
func TestChooseModeUnsupportedVideoWinsOverAudio(t *testing.T) {
	if got := ChooseMode("vp9", "opus"); got != ModeTranscodeAll {
		t.Errorf("ChooseMode(vp9, opus) = %v, want transcode", got)
	}
}

func TestChooseModeIgnoresCaseAndWhitespace(t *testing.T) {
	if got := ChooseMode("  H264 ", "AAC"); got != ModeCopy {
		t.Errorf("codec names from ffprobe should normalise, got %v", got)
	}
}

// An unknown/blank video codec must not be assumed copyable — guessing wrong
// produces a channel that emits an unplayable stream rather than a slow one.
func TestChooseModeUnknownVideoTranscodes(t *testing.T) {
	for _, video := range []string{"", "something-new"} {
		if got := ChooseMode(video, "aac"); got != ModeTranscodeAll {
			t.Errorf("ChooseMode(%q, aac) = %v, want transcode", video, got)
		}
	}
}

func TestStreamModeString(t *testing.T) {
	for mode, want := range map[StreamMode]string{
		ModeCopy:           "copy",
		ModeTranscodeAudio: "transcode-audio",
		ModeTranscodeAll:   "transcode",
	} {
		if got := mode.String(); got != want {
			t.Errorf("StreamMode(%d).String() = %q, want %q", mode, got, want)
		}
	}
}
