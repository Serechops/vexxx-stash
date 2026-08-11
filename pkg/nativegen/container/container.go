// Package container provides pure-Go demuxing of media containers for the
// native (non-ffmpeg) generation pipeline.
//
// The demuxers here deliberately do no decoding. Their job is to produce a
// complete sample index for a video track — byte offsets, sizes, timestamps
// and, critically, which samples are sync samples — so that a hardware decoder
// can be fed only the frames that are actually needed.
//
// This is what makes the native sprite path cheap: sprite generation needs
// roughly 81 frames out of a file that may contain hundreds of thousands, and
// every one of those 81 is a keyframe. With a sample index in hand we read only
// those keyframes' bytes and skip the rest of the file entirely, rather than
// paying for an open/seek/decode cycle per thumbnail.
package container

import (
	"errors"
	"sort"
)

// ErrUnsupported indicates the file is a valid container of this type but uses
// a feature the demuxer does not implement. Callers should fall back to ffmpeg.
var ErrUnsupported = errors.New("container: unsupported file structure")

// ErrNoVideoTrack indicates the container holds no decodable video track.
var ErrNoVideoTrack = errors.New("container: no video track")

// ErrNoAudioTrack indicates the container holds no audio track.
var ErrNoAudioTrack = errors.New("container: no audio track")

// Codec identifies the coding format of a track.
type Codec string

const (
	CodecUnknown Codec = ""
	CodecH264    Codec = "h264"
	CodecHEVC    Codec = "hevc"
	CodecAV1     Codec = "av1"
	CodecVP9     Codec = "vp9"
)

// AudioCodec identifies the coding format of an audio track.
type AudioCodec string

const (
	AudioCodecUnknown AudioCodec = ""
	AudioCodecAAC     AudioCodec = "aac"
	AudioCodecMP3     AudioCodec = "mp3"
	AudioCodecAC3     AudioCodec = "ac3"
	AudioCodecEAC3    AudioCodec = "eac3"
	AudioCodecOpus    AudioCodec = "opus"
	AudioCodecFLAC    AudioCodec = "flac"
	AudioCodecALAC    AudioCodec = "alac"
)

// Sample describes one coded frame within a track.
//
// Offset and Size locate the frame's bytes in the file. DTS and PTS are
// expressed in the track's timescale.
type Sample struct {
	Offset int64
	Size   uint32
	DTS    int64
	PTS    int64
	Sync   bool
}

// AudioTrack is a demuxed audio track with a fully built sample index.
//
// The native pipeline passes audio through unmodified rather than re-encoding
// it, so what is needed here is the codec configuration (enough to write a
// sample entry a player can decode from) and the sample index, not the raw
// decoded samples.
type AudioTrack struct {
	ID        uint32
	Codec     AudioCodec
	Timescale uint32
	Duration  uint64 // in Timescale units

	// SampleRate, Channels and BitDepth describe the decoded audio format.
	SampleRate int
	Channels   int
	BitDepth   int

	// Config is the codec's out-of-band configuration record (an esds box for
	// AAC, for example) in raw bytes, ready to be copied into the muxer's
	// output.
	Config []byte

	Samples []Sample
}

// DurationSeconds returns the track duration in seconds.
func (t *AudioTrack) DurationSeconds() float64 {
	if t.Timescale == 0 {
		return 0
	}
	return float64(t.Duration) / float64(t.Timescale)
}

// VideoTrack is a demuxed video track with a fully built sample index.
type VideoTrack struct {
	ID        uint32
	Codec     Codec
	Timescale uint32
	Duration  uint64 // in Timescale units
	Width     int
	Height    int

	// Rotation is the clockwise rotation in degrees that the container's display
	// matrix applies to the coded frames: 0, 90, 180 or 270. It is -1 when the
	// matrix is something other than a plain right-angle rotation — a flip, a
	// shear or a scale — which cannot be expressed as a rotation at all.
	//
	// A decoder returns coded frames, so anything non-zero here has to be
	// applied afterwards by whoever consumes them. ffmpeg does this on its own;
	// a caller that does not must decline the file rather than silently emit
	// sideways frames.
	Rotation int

	// ParameterSets holds the codec's out-of-band configuration (SPS/PPS for
	// H.264, VPS/SPS/PPS for HEVC) already converted to Annex-B form, ready to
	// be prepended to a keyframe before submission to a hardware decoder.
	// Empty for codecs that carry configuration in-band.
	ParameterSets []byte

	// NALLengthSize is the width in bytes of the length prefix on each NAL unit
	// in a sample (1, 2 or 4). Zero for codecs that are not NAL-based.
	NALLengthSize int

	Samples []Sample

	// syncIdx caches the indices of sync samples, built lazily.
	syncIdx []int
}

// DurationSeconds returns the track duration in seconds.
func (t *VideoTrack) DurationSeconds() float64 {
	if t.Timescale == 0 {
		return 0
	}
	return float64(t.Duration) / float64(t.Timescale)
}

// SampleTime returns the presentation time of sample i in seconds.
func (t *VideoTrack) SampleTime(i int) float64 {
	if t.Timescale == 0 || i < 0 || i >= len(t.Samples) {
		return 0
	}
	return float64(t.Samples[i].PTS) / float64(t.Timescale)
}

// SyncSamples returns the indices of all sync samples, in presentation order.
func (t *VideoTrack) SyncSamples() []int {
	if t.syncIdx == nil {
		idx := make([]int, 0, len(t.Samples)/30+1)
		for i := range t.Samples {
			if t.Samples[i].Sync {
				idx = append(idx, i)
			}
		}
		t.syncIdx = idx
	}
	return t.syncIdx
}

// SyncAtOrBefore returns the index of the last sync sample whose presentation
// time is at or before seconds, or -1 if the track has no sync samples.
//
// This is the sample to seek to when you must decode forward to reach an exact
// time. For thumbnails, prefer NearestSync.
func (t *VideoTrack) SyncAtOrBefore(seconds float64) int {
	sync := t.SyncSamples()
	if len(sync) == 0 {
		return -1
	}

	// sync is ordered by index; PTS is monotonic for sync samples in practice,
	// so a binary search over presentation time is safe here.
	n := sort.Search(len(sync), func(i int) bool {
		return t.SampleTime(sync[i]) > seconds
	})
	if n == 0 {
		return sync[0]
	}
	return sync[n-1]
}

// NearestSync returns the index of the sync sample closest in presentation time
// to seconds, or -1 if the track has no sync samples.
//
// Sprite thumbnails do not need frame-exact timing, so picking whichever
// keyframe is nearest avoids decoding any non-keyframe data at all.
func (t *VideoTrack) NearestSync(seconds float64) int {
	sync := t.SyncSamples()
	if len(sync) == 0 {
		return -1
	}

	n := sort.Search(len(sync), func(i int) bool {
		return t.SampleTime(sync[i]) > seconds
	})
	switch {
	case n == 0:
		return sync[0]
	case n == len(sync):
		return sync[n-1]
	}

	before, after := sync[n-1], sync[n]
	if seconds-t.SampleTime(before) <= t.SampleTime(after)-seconds {
		return before
	}
	return after
}

// KeyframesAt maps an ascending list of target times to sync sample indices,
// one per requested time and in the same order.
//
// When the track has at least as many keyframes as there are targets, every
// returned index is distinct — a sprite sheet should never show the same tile
// twice. Achieving that needs more than picking the nearest keyframe per
// target: in files with long GOPs, consecutive targets often land on the same
// keyframe, and naively nudging the duplicate forward lets early targets
// consume keyframes that later ones need, starving the end of the timeline.
//
// Instead, each target is assigned the nearest keyframe within a window that is
// bounded below by the previous assignment and above by the need to leave one
// keyframe for every target still to come. That keeps the assignment strictly
// increasing and guaranteed to complete.
//
// When keyframes are scarcer than targets, repeats are unavoidable; they are
// then spread proportionally rather than clustered at the end.
func (t *VideoTrack) KeyframesAt(times []float64) []int {
	sync := t.SyncSamples()
	out := make([]int, len(times))

	if len(sync) == 0 {
		for i := range out {
			out[i] = -1
		}
		return out
	}

	if len(sync) < len(times) {
		for i := range times {
			out[i] = sync[i*len(sync)/len(times)]
		}
		return out
	}

	next := 0
	for i, tm := range times {
		// reserve one keyframe for each target after this one
		hi := len(sync) - 1 - (len(times) - i - 1)
		p := t.nearestSyncInRange(sync, next, hi, tm)
		out[i] = sync[p]
		next = p + 1
	}
	return out
}

// nearestSyncInRange returns the position in sync[lo:hi+1] whose presentation
// time is closest to seconds. lo and hi must be valid positions with lo <= hi.
func (t *VideoTrack) nearestSyncInRange(sync []int, lo, hi int, seconds float64) int {
	if lo >= hi {
		return lo
	}

	// first position in the window strictly after seconds
	n := lo + sort.Search(hi-lo+1, func(i int) bool {
		return t.SampleTime(sync[lo+i]) > seconds
	})

	switch {
	case n == lo:
		return lo
	case n > hi:
		return hi
	}

	if seconds-t.SampleTime(sync[n-1]) <= t.SampleTime(sync[n])-seconds {
		return n - 1
	}
	return n
}
