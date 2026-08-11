package nativegen

import (
	"context"
	"errors"
	"fmt"
	"image"
	"io"
	"math"
	"sort"
	"sync"

	"github.com/stashapp/stash/pkg/nativegen/amf"
	"github.com/stashapp/stash/pkg/nativegen/container"
	"github.com/stashapp/stash/pkg/nativegen/container/mp4"
)

// PreviewOptions describes a preview video to produce.
//
// A preview is a handful of short segments cut from across the film and joined
// end to end. The ffmpeg path builds one by spawning a transcode per segment,
// writing each to a temporary file, and then spawning ffmpeg once more to concat
// them. This path decodes, reprojects, encodes and muxes in one pass with no
// temporary files at all.
type PreviewOptions struct {
	// Path is the video file to read.
	Path string

	// Starts are the times each segment begins at, in seconds. The caller works
	// these out, so that this backend and the ffmpeg one cut at exactly the same
	// places.
	Starts []float64

	// SegmentDuration is how long each segment runs for, in seconds.
	SegmentDuration float64

	// Width is the width of the finished preview. The height follows from the
	// source's shape, or from the flattened view's for VR footage.
	Width int

	// VRMode names the projection the footage is stored in, as for sprites.
	// Empty means the footage is already flat.
	VRMode string

	// QP is the constant quantiser to encode at.
	QP int

	// Audio controls whether the preview carries an audio track. When true and
	// the source file has a passable audio codec, the audio samples are copied
	// through verbatim alongside the re-encoded video.
	Audio bool

	// SnapToKeyframes allows each segment to begin at the keyframe nearest the
	// time asked for, rather than exactly at it.
	//
	// This is the difference between decoding a segment and decoding the whole
	// group of pictures it happens to sit inside. A frame is only reconstructible
	// from the keyframe before it, so a segment starting mid-group has to decode
	// everything from that keyframe forward and throw it away: on a file with a
	// six-second group and twelve three-quarter-second segments, that is around
	// 2,700 frames decoded to show 539. Starting at the keyframe instead makes
	// those the same number.
	//
	// What it costs is that a segment begins up to half a group away from the
	// time requested — seconds, on a film where the segments are minutes apart —
	// so it suits a preview that samples a film at arbitrary points and not an
	// asset that has to begin at a particular moment. A marker's preview must
	// start at the marker, so it leaves this off.
	SnapToKeyframes bool
}

// Preview writes a preview video to w.
//
// As with Sprite, any error at all means the caller should fall back to ffmpeg:
// a partially written preview is worse than none.
func Preview(ctx context.Context, opts PreviewOptions, w io.Writer) error {
	if len(opts.Starts) == 0 {
		return fmt.Errorf("nativegen: preview needs at least one segment")
	}
	if opts.SegmentDuration <= 0 {
		return fmt.Errorf("nativegen: invalid segment duration %v", opts.SegmentDuration)
	}
	if opts.Width <= 0 {
		return fmt.Errorf("nativegen: invalid preview width %d", opts.Width)
	}

	f, err := mp4.Open(opts.Path)
	if err != nil {
		return err
	}
	defer f.Close()

	track := f.Video()
	if track == nil {
		return container.ErrNoVideoTrack
	}
	if track.Rotation != 0 {
		return fmt.Errorf("%w: track carries a display matrix (rotation %d)",
			container.ErrUnsupported, track.Rotation)
	}
	if len(track.SyncSamples()) == 0 {
		return fmt.Errorf("%w: track has no keyframes to decode from", container.ErrUnsupported)
	}

	rateNum, rateDen, err := frameRate(track)
	if err != nil {
		return err
	}

	// For flat footage the decoder scales straight to the finished size. VR
	// footage is decoded larger and reprojected down to it, exactly as for
	// sprites.
	outW, outH := tileSize(opts.Width, track.Width, track.Height)
	decW, decH := outW, outH
	transform := func(img *image.RGBA) (*image.RGBA, error) { return img, nil }

	if opts.VRMode != "" {
		outW, outH = vrTileSize(opts.Width)
		rm, err := newRemapper(opts.VRMode, track.Width, track.Height, outW, outH)
		if err != nil {
			return err
		}
		decW, decH = rm.srcSize()
		transform = rm.remap
	}

	// Where the segments actually begin, which is not always where they were
	// asked to. Everything downstream — the samples decoded, the audio copied —
	// works from these rather than from the request, so the two tracks stay
	// aligned however the starts moved.
	starts := snapStarts(track, opts)

	segments, err := segmentSamples(track, starts, opts.SegmentDuration)
	if err != nil {
		return err
	}

	decCfg := amf.Config{
		Codec:     track.Codec,
		Width:     track.Width,
		Height:    track.Height,
		ExtraData: track.ParameterSets,
		OutWidth:  decW,
		OutHeight: decH,
		// Segments are runs of consecutive frames, so the decoder needs its
		// reorder window to hand them back in the order they are shown.
		LowLatency: false,
	}

	enc, err := amf.NewEncoder(amf.EncoderConfig{
		Width: outW, Height: outH,
		FrameRateNum: rateNum, FrameRateDen: rateDen,
		QP: opts.QP,
		// A keyframe at the head of every segment, and none forced in between.
		// A segment is a cut to unrelated footage, so the encoder would spend a
		// keyframe there whatever it was told.
		GOP: int(math.Round(opts.SegmentDuration * float64(rateNum) / float64(rateDen))),
	})
	if err != nil {
		return err
	}
	defer enc.Close()

	// Build the audio track configuration when the source carries one and the
	// caller wants it.
	audioCfg := buildAudioConfig(f, opts)

	mux, err := mp4.NewMuxer(mp4.MuxConfig{
		Width: outW, Height: outH,
		// The track's time unit is one frame period, so a frame's duration is
		// exactly one tick and rates like 30000/1001 stay exact.
		Timescale:     uint32(rateNum),
		ParameterSets: enc.ExtraData(),
		Audio:         audioCfg,
	})
	if err != nil {
		return err
	}

	// The reprojection builds a new image for every frame it is given, so the
	// decoder may hand back the same buffer each time. Flat footage keeps the
	// decoder's own image as the frame, which outlives the loop that collected
	// it, so there the buffer has to be a fresh one — and it is small anyway,
	// since the decoder has scaled straight to preview size.
	sink := &packetSink{enc: enc, mux: mux, duration: uint32(rateDen)}
	if err := encodeSegments(ctx, f, decCfg, opts.VRMode != "", segments, starts, sink, transform); err != nil {
		return err
	}
	if err := sink.finish(); err != nil {
		return err
	}

	if mux.Samples() == 0 {
		return fmt.Errorf("%w: no frames fell inside any segment", container.ErrUnsupported)
	}

	// Copy the audio from the source's segments, placed at the same cumulative
	// offsets as the video so the two stay aligned.
	if audioCfg != nil {
		if err := copyPreviewAudio(f, mux, starts, opts.SegmentDuration, f.Audio()); err != nil {
			return err
		}
	}

	_, err = mux.WriteTo(w)
	return err
}

// buildAudioConfig prepares the audio track to be passed through, or returns
// nil when the source has no audio the native path can copy.
//
// Only the first audio track is used, matching how the ffmpeg path treats a
// file with several (the first is the one a player hears by default).
func buildAudioConfig(f *mp4.File, _ PreviewOptions) *mp4.AudioConfig {
	track := f.Audio()
	if track == nil || track.Codec == container.AudioCodecUnknown || track.SampleRate == 0 || track.Channels == 0 {
		return nil
	}
	return &mp4.AudioConfig{
		Codec:      track.Codec,
		SampleRate: track.SampleRate,
		Channels:   track.Channels,
		BitDepth:   track.BitDepth,
		Timescale:  track.Timescale,
		Config:     track.Config,
	}
}

// copyPreviewAudio copies the audio samples that fall inside each segment's
// time range, placing them at cumulative offsets that match the video so the
// two tracks stay aligned.
//
// AAC frames are independently decodable at the packet level, so concatenating
// the per-segment ranges produces a valid stream. The cumulative duration of
// the audio track is set to match the video's total duration through the same
// segment boundaries.
func copyPreviewAudio(f *mp4.File, mux *mp4.Muxer, starts []float64, duration float64, track *container.AudioTrack) error {
	if len(starts) == 0 || track == nil || len(track.Samples) == 0 {
		return nil
	}

	samples := track.Samples
	for _, segStart := range starts {
		segEnd := segStart + duration
		audioFrom := int64(segStart * float64(track.Timescale))
		audioTo := int64(segEnd * float64(track.Timescale))

		lo := sort.Search(len(samples), func(j int) bool {
			return samples[j].PTS >= audioFrom
		})
		hi := sort.Search(len(samples), func(j int) bool {
			return samples[j].PTS >= audioTo
		})

		for i := lo; i < hi; i++ {
			data, err := f.ReadSample(samples[i])
			if err != nil {
				return fmt.Errorf("nativegen: audio sample %d: %w", i, err)
			}

			// Each sample's duration is the gap to the next one's PTS.
			duration := uint32(1)
			if i+1 < len(samples) && samples[i+1].PTS > samples[i].PTS {
				duration = uint32(samples[i+1].PTS - samples[i].PTS)
			} else if len(samples) > 1 {
				avg := (samples[len(samples)-1].PTS - samples[0].PTS) / int64(len(samples)-1)
				if avg > 0 {
					duration = uint32(avg)
				}
			}

			if err := mux.AddAudioSample(data, duration); err != nil {
				return fmt.Errorf("nativegen: muxing audio sample %d: %w", i, err)
			}
		}
	}
	return nil
}

// snapStarts moves each segment start onto the keyframe nearest it.
//
// See PreviewOptions.SnapToKeyframes for why this is worth doing. The rules are
// what keeps it safe: a start moves only as far as half the gap to its
// neighbours, so the segments cannot reorder, and only if the segment it begins
// still clears the one before it, so they cannot overlap and show the same
// footage twice. A start with no keyframe near enough stays where it is and
// pays for its run-up, which is the behaviour of the whole function when the
// option is off.
func snapStarts(track *container.VideoTrack, opts PreviewOptions) []float64 {
	// A single segment is a marker's preview, which means a particular moment
	// and has no neighbour to bound a move against.
	if !opts.SnapToKeyframes || len(opts.Starts) < 2 || track.Timescale == 0 {
		return opts.Starts
	}
	sync := track.SyncSamples()
	if len(sync) == 0 {
		return opts.Starts
	}

	ts := float64(track.Timescale)
	keys := make([]float64, len(sync))
	for i, s := range sync {
		keys[i] = float64(track.Samples[s].PTS) / ts
	}

	maxSnap := math.Inf(1)
	for i := 1; i < len(opts.Starts); i++ {
		if gap := opts.Starts[i] - opts.Starts[i-1]; gap < maxSnap {
			maxSnap = gap
		}
	}
	maxSnap /= 2

	out := make([]float64, len(opts.Starts))
	prevEnd := math.Inf(-1)
	for i, want := range opts.Starts {
		out[i] = want

		// The keyframe before the wanted time and the one after it; whichever is
		// closer wins.
		j := sort.SearchFloat64s(keys, want)
		best, found := 0.0, false
		for _, k := range []int{j - 1, j} {
			if k < 0 || k >= len(keys) {
				continue
			}
			if !found || math.Abs(keys[k]-want) < math.Abs(best-want) {
				best, found = keys[k], true
			}
		}

		if found && math.Abs(best-want) <= maxSnap && best >= prevEnd {
			out[i] = best
		}
		prevEnd = out[i] + opts.SegmentDuration
	}
	return out
}

// A segment is the run of samples one piece of the preview is built from.
type segment struct {
	// from is the keyframe the decoder has to start at.
	from int

	// show lists the samples that are actually part of the preview, in the order
	// they are shown.
	show []int
}

// last returns the highest sample index the segment needs decoded.
func (s segment) last() int {
	last := s.from
	for _, i := range s.show {
		if i > last {
			last = i
		}
	}
	return last
}

// segmentSamples turns segment start times into the samples that make them up.
//
// A segment is every frame shown between its start and the end of its duration.
// Which frames those are is a question about presentation order, not storage
// order, so it is answered against the presentation-sorted index for the same
// reason exact-frame extraction is.
func segmentSamples(track *container.VideoTrack, starts []float64, duration float64) ([]segment, error) {
	if track.Timescale == 0 {
		return nil, fmt.Errorf("%w: track has no timescale", container.ErrUnsupported)
	}
	order := presentationOrder(track)

	segments := make([]segment, 0, len(starts))
	for _, start := range starts {
		from := int64(start * float64(track.Timescale))
		to := int64((start + duration) * float64(track.Timescale))

		lo := sort.Search(len(order), func(j int) bool {
			return track.Samples[order[j]].PTS >= from
		})
		hi := sort.Search(len(order), func(j int) bool {
			return track.Samples[order[j]].PTS >= to
		})
		if lo >= hi {
			// The segment falls past the end of the track, or between two
			// frames of a very low frame rate. Either way there is nothing to
			// show and the preview would be short by a segment.
			return nil, fmt.Errorf("%w: no frames between %.2fs and %.2fs",
				container.ErrUnsupported, start, start+duration)
		}

		seg := segment{show: append([]int(nil), order[lo:hi]...)}
		seg.from = seg.show[0]
		for _, i := range seg.show {
			if i < seg.from {
				seg.from = i
			}
		}
		seg.from = syncBefore(track, seg.from)
		segments = append(segments, seg)
	}
	return segments, nil
}

// previewDecoders is how many decoders a preview's segments are spread across.
//
// Segments are independent — each starts at its own keyframe — so nothing stops
// them being decoded at once, and measurably they should be: this GPU has more
// than one media engine, and one decoder driven from one goroutine leaves the
// rest of them idle while it waits for a frame to come back over the bus.
// Measured on a 5400x2700 stereo file, twelve segments took 18.7s through one
// decoder, 12.5s through two and 11.7s through three. Two is where the return
// is, and a third decoder's VRAM and buffered frames buy seven percent.
//
// Those figures were taken before the decoders were placed on kept devices, so
// the two-decoder one was a draw of the coin flip devices.go describes and the
// three-decoder one was three draws. Two decoders on two devices is the case that
// number is now reliably measuring.
const previewDecoders = 2

// encodeSegments decodes every segment and feeds the encoder in order.
//
// Decoding runs across several decoders at once while encoding stays on this
// goroutine, which is what keeps the finished file deterministic: the encoder
// sees segments in the order the preview shows them however they were decoded.
// At most one segment per decoder is held decoded-but-not-encoded, so the
// memory this costs is bounded by the worker count rather than by the number of
// segments.
func encodeSegments(ctx context.Context, f *mp4.File, cfg amf.Config, reuse bool, segments []segment, starts []float64, sink *packetSink, transform func(*image.RGBA) (*image.RGBA, error)) error {
	workers := previewDecoders
	if workers > len(segments) {
		workers = len(segments)
	}
	if workers < 1 {
		workers = 1
	}

	// A decoder per engine is the whole reason the segments are split, and which
	// engine a decoder lands on follows its device — so the devices come from the
	// kept set rather than being created here, where two of them landing on one
	// engine would silently cost the split its gain. See devices.go.
	devs, release := decodeDevices.acquire(workers)
	if release != nil {
		defer release()
	}

	// Every decoder is created before any work starts. A decoder that fails to
	// come up part-way through would leave the segments assigned to it with
	// nobody to decode them, and the consumer waiting on a result that is never
	// coming.
	decoders := make([]*amf.Decoder, 0, workers)
	defer func() {
		for _, dec := range decoders {
			dec.Close()
		}
	}()
	for i := 0; i < workers; i++ {
		dec, err := decoderOn(devs, i, cfg)
		if err != nil {
			return err
		}
		dec.Reuse(reuse)
		decoders = append(decoders, dec)
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	type result struct {
		frames []*image.RGBA
		err    error
	}
	results := make([]chan result, len(segments))
	for i := range results {
		results[i] = make(chan result, 1)
	}

	// A worker takes a slot before decoding and the consumer returns it after
	// encoding, which is what bounds how far decoding may run ahead.
	slots := make(chan struct{}, workers)
	for i := 0; i < workers; i++ {
		slots <- struct{}{}
	}

	jobs := make(chan int)
	go func() {
		defer close(jobs)
		for i := range segments {
			select {
			case jobs <- i:
			case <-ctx.Done():
				return
			}
		}
	}()

	var wg sync.WaitGroup
	for w := range decoders {
		wg.Add(1)
		go func(dec *amf.Decoder) {
			defer wg.Done()
			for i := range jobs {
				select {
				case <-slots:
				case <-ctx.Done():
					return
				}
				frames, err := decodeSegment(ctx, f, dec, segments[i], transform)
				results[i] <- result{frames, err}
			}
		}(decoders[w])
	}
	// The workers are stopped, and their decoders are then closed by the defer
	// above, before this function's caller sees an error.
	defer wg.Wait()
	defer cancel()

	for i := range segments {
		var res result
		select {
		case res = <-results[i]:
		case <-ctx.Done():
			return ctx.Err()
		}
		if res.err != nil {
			return fmt.Errorf("nativegen: segment %d at %.2fs: %w", i, starts[i], res.err)
		}

		for _, img := range res.frames {
			if err := sink.push(img); err != nil {
				return fmt.Errorf("nativegen: segment %d at %.2fs: %w", i, starts[i], err)
			}
		}

		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

// decodeSegment decodes one segment and returns its frames in the order they
// are shown.
//
// Frames are collected before any are encoded rather than being encoded as they
// arrive. A stream with B-frames does not decode in the order it presents, and
// the encoder has to be fed a timeline; buffering a segment is what turns one
// order into the other. It costs a segment's worth of frames at preview size,
// which is a few tens of megabytes and is released once the segment has been
// encoded.
func decodeSegment(ctx context.Context, f *mp4.File, dec *amf.Decoder, seg segment, transform func(*image.RGBA) (*image.RGBA, error)) ([]*image.RGBA, error) {
	wanted := make(map[int]bool, len(seg.show))
	for _, i := range seg.show {
		wanted[i] = true
	}

	// Everything between the keyframe and the segment's start is reference, not
	// content, and on a file with keyframes seconds apart that is most of what
	// gets decoded. Saying so up front keeps those frames from being scaled and
	// copied back only to be discarded here.
	dec.SetWanted(func(pts int64) bool { return wanted[int(pts)] })

	frames := make(map[int]*image.RGBA, len(seg.show))
	p := &pump{ctx: ctx, dec: dec, place: func(fr *amf.Frame) error {
		i := int(fr.PTS)
		if frames[i] != nil {
			return nil
		}
		img, err := transform(fr.Image)
		if err != nil {
			return err
		}
		frames[i] = img
		return nil
	}}

	track := f.Video()
	done := func() bool { return len(frames) == len(seg.show) }

	submit := func(i int) error {
		data, err := f.SampleAnnexB(i)
		if err != nil {
			return err
		}
		if err := p.submit(data, int64(i)); err != nil {
			return fmt.Errorf("sample %d: %w", i, err)
		}
		return nil
	}

	last := seg.last()
	for i := seg.from; i <= last; i++ {
		if err := submit(i); err != nil {
			return nil, err
		}
	}

	// The frames at the end of a segment are the ones most likely to still be
	// inside the decoder's reorder window: a stream with B-frames does not
	// present a frame until everything it was predicted from has been decoded.
	// Draining ought to push them out and measurably does not — on a 60fps file
	// the last four frames of every segment stayed inside. Feeding the samples
	// that follow does, because it gives the decoder the very thing it is
	// waiting for. They are decoded and discarded; there are only ever a handful,
	// bounded by the stream's own buffer.
	for pushed := 0; !done() && pushed < maxReorderPush; pushed++ {
		next := last + 1 + pushed
		if next >= len(track.Samples) {
			break
		}
		if err := submit(next); err != nil {
			return nil, err
		}
	}

	// Anything still held after that is at the very end of the track, where
	// there are no following samples to push with and only end-of-stream will do.
	if !done() {
		if err := p.finish(done); err != nil {
			return nil, err
		}
	}
	if !done() {
		var missing []int
		for _, i := range seg.show {
			if frames[i] == nil {
				missing = append(missing, i)
			}
		}
		return nil, fmt.Errorf("decoded %d of %d frames (submitted %d..%d, missing %v)",
			len(frames), len(seg.show), seg.from, last, missing)
	}

	// Segments come from unrelated parts of the film, so nothing the decoder is
	// holding is of any use to the next one. Flushing resets it, including out of
	// the end-of-stream state a drain may have left it in.
	if err := dec.Flush(); err != nil {
		return nil, err
	}

	shown := make([]*image.RGBA, 0, len(seg.show))
	for _, i := range seg.show {
		shown = append(shown, frames[i])
	}
	return shown, nil
}

// packetSink drives the encoder and files what comes out into the muxer.
type packetSink struct {
	enc      *amf.Encoder
	mux      *mp4.Muxer
	duration uint32
}

// collect files whatever the encoder has ready, returning how many packets it
// took.
func (s *packetSink) collect() (int, error) {
	n := 0
	for {
		pkt, err := s.enc.Receive()
		switch {
		case errors.Is(err, amf.ErrNeedMoreInput), errors.Is(err, amf.ErrDrained):
			return n, nil
		case err != nil:
			return n, err
		}
		if err := s.mux.AddSample(pkt.Data, s.duration, pkt.Keyframe); err != nil {
			return n, err
		}
		n++
	}
}

// push encodes one frame, with the same conditional back-off the decoder's pump
// uses and for the same reason: a full queue means the GPU is busy, and only
// waiting fixes that.
func (s *packetSink) push(img *image.RGBA) error {
	for attempt := 0; ; attempt++ {
		err := s.enc.Submit(img)
		if err == nil {
			_, err := s.collect()
			return err
		}
		if !errors.Is(err, amf.ErrInputFull) {
			return err
		}
		if attempt >= maxSubmitRetries {
			return errors.New("encoder input stayed full")
		}
		taken, err := s.collect()
		if err != nil {
			return err
		}
		if taken == 0 {
			sleepBackoff()
		}
	}
}

// finish drains the encoder and files the packets it was still holding.
func (s *packetSink) finish() error {
	if err := s.enc.Drain(); err != nil {
		return err
	}
	for i := 0; i < maxDrainPolls; i++ {
		taken, err := s.collect()
		if err != nil {
			return err
		}
		if taken == 0 {
			sleepBackoff()
		}
	}
	return nil
}

// frameRate works out the track's frame rate as an exact ratio.
//
// It is taken from how long frames are actually shown for rather than from
// dividing the duration by the frame count, so that a rate like 30000/1001
// comes back exactly rather than as something very close to 29.97. The most
// common gap between consecutive frames is used, which is robust to a file whose
// first or last frame is held slightly longer.
func frameRate(track *container.VideoTrack) (num, den int, err error) {
	if track.Timescale == 0 {
		return 0, 0, fmt.Errorf("%w: track has no timescale", container.ErrUnsupported)
	}
	if len(track.Samples) < 2 {
		return 0, 0, fmt.Errorf("%w: track holds %d samples, too few to have a frame rate",
			container.ErrUnsupported, len(track.Samples))
	}

	order := presentationOrder(track)
	counts := make(map[int64]int, 8)
	for i := 1; i < len(order); i++ {
		if d := track.Samples[order[i]].PTS - track.Samples[order[i-1]].PTS; d > 0 {
			counts[d]++
		}
	}

	var delta int64
	best := 0
	for d, n := range counts {
		// Ties go to the shorter gap, so the answer does not depend on map
		// iteration order.
		if n > best || (n == best && d < delta) {
			delta, best = d, n
		}
	}
	if delta <= 0 {
		return 0, 0, fmt.Errorf("%w: track's frames have no measurable spacing", container.ErrUnsupported)
	}

	// A frame period longer than a second means either a slideshow or a
	// misparsed timescale, and either way the preview would be unwatchable.
	if delta > int64(track.Timescale) {
		return 0, 0, fmt.Errorf("%w: frames are %v apart, which is not a video frame rate",
			container.ErrUnsupported, float64(delta)/float64(track.Timescale))
	}
	return int(track.Timescale), int(delta), nil
}
