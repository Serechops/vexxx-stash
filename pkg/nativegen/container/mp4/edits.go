package mp4

import (
	"fmt"

	"github.com/stashapp/stash/pkg/nativegen/container"
)

// An edit list is the difference between the timeline a file stores and the
// timeline a player shows, and ignoring one silently changes which frame a time
// resolves to.
//
// The usual reason a file has one is the reorder delay a B-frame stream needs.
// Composition offsets can only be written non-negative in a version 0 ctts, so
// a muxer shifts every composition time forward by the reorder depth and then
// writes an edit list saying "start the presentation this far in". A 25 fps
// H.264 file measured here declares media_time 1024 at timescale 12800 — exactly
// two frames — and its audio track separately declares 2048 at 48 kHz, the AAC
// priming samples. ffmpeg applies both, so its timeline starts at zero (ffprobe
// reports start_pts=0) while the stored composition times start two frames in.
//
// Reading the stored times as though they were presentation times therefore put
// every frame this package chose two frames later than the frame ffmpeg chose
// for the same time, which moved the perceptual hash off the one ffmpeg computes
// and so off what stash-box holds. That the two shifts above are different
// lengths in seconds — 0.080s of video against 0.043s of audio — is the other
// half of why they must be applied: the raw tracks are not aligned with each
// other, and the edit lists are what aligns them.
//
// Only the shift is honoured here. An edit list that genuinely edits — several
// segments of media joined, or one played at a rate other than 1.0 — cannot be
// expressed by a sample index at all, and those files are declined so the
// ffmpeg path handles them rather than this one hashing the wrong frames.
type editList struct {
	// shift is subtracted from every timestamp in the track, in media
	// timescale units. It can be negative, when an empty edit delays the media
	// by more than the composition offset brings it forward.
	shift int64
}

// parseEditList reads a track's edts/elst.
//
// A track with no edit list gets a zero shift, which is the common case and the
// one where stored times already are presentation times.
func parseEditList(trak []byte, mediaTimescale, movieTimescale uint32) (editList, error) {
	edts, ok := findBox(trak, "edts")
	if !ok {
		return editList{}, nil
	}
	elst, ok := findBox(edts, "elst")
	if !ok {
		return editList{}, nil
	}

	r := reader{buf: elst}
	version, _ := r.fullBox()
	count := r.u32()

	var (
		// Empty edits are in movie timescale units, unlike media_time.
		empty int64
		// The one segment of media this track presents, if it has one.
		mediaTime int64
		segments  int
	)

	for i := uint32(0); i < count; i++ {
		var duration, mt int64
		if version == 1 {
			duration = int64(r.u64())
			mt = int64(r.u64())
		} else {
			duration = int64(r.u32())
			mt = int64(r.i32())
		}
		rateInteger := int16(r.u16())
		rateFraction := r.u16()
		if r.err != nil {
			// The timeline is what decides which frame a time resolves to, so a
			// header we cannot read all of is a file to decline rather than one
			// to guess at.
			return editList{}, fmt.Errorf("%w: unreadable edit list", container.ErrUnsupported)
		}

		// media_time -1 marks an empty edit: a gap that delays the media rather
		// than a piece of it.
		if mt < 0 {
			empty += duration
			continue
		}

		segments++
		if segments > 1 {
			return editList{}, fmt.Errorf("%w: edit list joins %d segments of media", container.ErrUnsupported, segments)
		}
		if rateInteger != 1 || rateFraction != 0 {
			return editList{}, fmt.Errorf("%w: edit list plays media at rate %d.%d", container.ErrUnsupported, rateInteger, rateFraction)
		}
		mediaTime = mt
	}

	shift := mediaTime
	if empty != 0 {
		if movieTimescale == 0 {
			return editList{}, fmt.Errorf("%w: edit list has an empty edit but the file has no movie timescale", container.ErrUnsupported)
		}
		shift -= empty * int64(mediaTimescale) / int64(movieTimescale)
	}
	return editList{shift: shift}, nil
}

// apply moves a track's samples onto the presentation timeline.
//
// Both timestamps move together, so the gap between them — the reorder delay
// the decoder needs — is untouched. Timestamps before the edit's start go
// negative rather than being dropped: they are still needed to decode the frames
// that follow, and a caller resolving a time at or after zero will not choose
// one, which is the same frame ffmpeg arrives at by discarding them.
func (e editList) apply(samples []container.Sample) {
	if e.shift == 0 {
		return
	}
	for i := range samples {
		samples[i].DTS -= e.shift
		samples[i].PTS -= e.shift
	}
}

// movieTimescaleOf reads the timescale from a moov's mvhd, which is the unit
// empty edits are measured in. It returns 0 when there is no readable mvhd.
func movieTimescaleOf(moov []byte) uint32 {
	mvhd, ok := findBox(moov, "mvhd")
	if !ok {
		return 0
	}
	r := reader{buf: mvhd}
	version, _ := r.fullBox()
	if version == 1 {
		r.skip(16) // creation, modification (64-bit)
	} else {
		r.skip(8) // creation, modification (32-bit)
	}
	ts := r.u32()
	if r.err != nil {
		return 0
	}
	return ts
}
