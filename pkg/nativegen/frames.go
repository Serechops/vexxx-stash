package nativegen

import (
	"context"
	"fmt"
	"image"
	"sort"

	"github.com/stashapp/stash/pkg/nativegen/amf"
	"github.com/stashapp/stash/pkg/nativegen/container"
	"github.com/stashapp/stash/pkg/nativegen/container/mp4"
)

// Sprites take whichever keyframe is nearest the time they want, because a
// scrubber thumbnail a second either side of the mark is still the right
// thumbnail. Some callers cannot make that trade.
//
// A perceptual hash is the clearest case. It is not looked at, it is stored and
// compared — against the rest of the library and against hashes computed
// elsewhere — so it is only useful if it comes out the same as the one the
// ffmpeg path would have produced. Measured on real files, substituting the
// nearest keyframe for the wanted frame moves the hash by up to four bits out of
// sixty-four, while changing the scaler that reduces the frames moves it by
// none. So the frames have to be exact, and this file decodes them exactly:
// from the keyframe that precedes each wanted frame, forward through every
// sample in between.
//
// Nothing calls this yet. It was written for perceptual hashing and is not used
// for it, because the frames it produces are the right frames but not quite the
// same pixels: the GPU's scaler and swscale filter a heavy reduction
// differently, which moved the hash by up to four bits out of sixty-four on real
// files. That is fine for a thumbnail and not fine for a value whose whole
// purpose is being compared for equality. It is kept because decoding a run of
// consecutive frames is what preview video needs, and that is the next thing to
// be built on it.
//
// Decoding consecutive frames exposed two failures the sprite path never saw,
// both since fixed, and both the same mistake: reading "not yet" as "no". The
// sprite path submits isolated keyframes with a readback and a reprojection
// between each, which leaves the GPU so much slack that it is never behind, so
// neither the converter's nor the decoder's asynchrony was visible. See
// amf.Decoder.scale and pump.submit.

// maxReorderPush bounds how many samples past a wanted frame will be fed to the
// decoder to force that frame out of its reorder window. H.264 allows a
// reference buffer of sixteen frames and HEVC likewise, so a stream needing more
// than twice that is malformed rather than merely awkward.
const maxReorderPush = 32

// FrameOptions describes frames to extract at exact times.
type FrameOptions struct {
	// Path is the video file to read.
	Path string

	// Times are the presentation times wanted, in seconds. One image is
	// returned per entry, in the order given.
	Times []float64

	// Width is the width frames are scaled to. The height follows from the
	// source's coded aspect ratio, or from the flattened view's 16:9 for VR
	// footage.
	Width int

	// VRMode names the projection the footage is stored in, as for sprites and
	// previews. Empty means the footage is already flat.
	//
	// A caller wanting a VR frame at some other size should ask for the
	// flattened view at its natural size and scale the result, rather than
	// asking for the size it wants: the reprojection builds one sample position
	// per output pixel, so a large output costs a table to match.
	VRMode string
}

// Frames decodes the frame shown at each of the given times.
//
// The frame chosen for a time is the first one presented at or after it, which
// is what ffmpeg's own accurate seek settles on, so the two agree on which
// frame a time names.
func Frames(ctx context.Context, opts FrameOptions) ([]image.Image, error) {
	if len(opts.Times) == 0 {
		return nil, fmt.Errorf("nativegen: no times requested")
	}
	if opts.Width <= 0 {
		return nil, fmt.Errorf("nativegen: invalid frame width %d", opts.Width)
	}

	f, err := mp4.Open(opts.Path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	track := f.Video()
	if track == nil {
		return nil, container.ErrNoVideoTrack
	}
	if track.Rotation != 0 {
		return nil, fmt.Errorf("%w: track carries a display matrix (rotation %d)",
			container.ErrUnsupported, track.Rotation)
	}
	if len(track.SyncSamples()) == 0 {
		return nil, fmt.Errorf("%w: track has no keyframes to decode from", container.ErrUnsupported)
	}

	wanted, err := samplesAt(track, opts.Times)
	if err != nil {
		return nil, err
	}

	// For flat footage the decoder scales straight to the finished size. VR
	// footage is decoded larger and reprojected down to it, exactly as for
	// sprites.
	outW, outH := tileSize(opts.Width, track.Width, track.Height)
	decW, decH := outW, outH
	transform := func(img *image.RGBA) (image.Image, error) { return img, nil }

	if opts.VRMode != "" {
		outW, outH = vrTileSize(opts.Width)
		rm, err := newRemapper(opts.VRMode, track.Width, track.Height, outW, outH)
		if err != nil {
			return nil, err
		}
		decW, decH = rm.srcSize()
		transform = func(img *image.RGBA) (image.Image, error) { return rm.remap(img) }
	}

	// A kept device where one is free, as for every other generator here.
	devs, release := decodeDevices.acquire(1)
	if release != nil {
		defer release()
	}

	dec, err := decoderOn(devs, 0, amf.Config{
		Codec:     track.Codec,
		Width:     track.Width,
		Height:    track.Height,
		ExtraData: track.ParameterSets,
		OutWidth:  decW,
		OutHeight: decH,
		// Unlike the sprite path, this decodes runs of consecutive frames, and
		// a stream with B-frames presents them in a different order from the one
		// it codes them in. The decoder has to be allowed its reorder window or
		// it would hand back the wrong frame for a time.
		LowLatency: false,
	})
	if err != nil {
		return nil, err
	}
	defer dec.Close()

	// As for sprites: the reprojection copies each frame into a new image, so
	// the decoder's buffer can be reused, while flat frames are returned to the
	// caller as they are and must each be their own.
	dec.Reuse(opts.VRMode != "")

	return decodeExact(ctx, f, dec, wanted, len(opts.Times), transform)
}

// A wantedFrame is one output slot and the sample that fills it.
type wantedFrame struct {
	sample int
	slot   int
}

// samplesAt resolves times to samples, in the order they must be decoded.
func samplesAt(track *container.VideoTrack, times []float64) ([]wantedFrame, error) {
	if track.Timescale == 0 {
		return nil, fmt.Errorf("%w: track has no timescale", container.ErrUnsupported)
	}

	order := presentationOrder(track)

	wanted := make([]wantedFrame, len(times))
	for i, t := range times {
		// A time is compared against the sample's presentation timestamp as it
		// stands, without the track's own start time added to it first.
		//
		// That is worth stating because the opposite is the more natural
		// reading, and it is wrong. Measured against ffmpeg on a file whose
		// video starts at 0.066s: asked for 105.40s it returns the frame at
		// 105.4327, the first at or after 105.40 outright, not the first at or
		// after 105.466. Anchoring on the first sample instead put every frame
		// two later than ffmpeg's and quietly changed the hashes computed from
		// them.
		//
		// What makes that safe is that the timestamps arrive here already on the
		// presentation timeline: the demuxer applies the track's edit list, which
		// is where a start time genuinely does have to be taken off. Files that
		// need it and files that do not are therefore both handled, and neither
		// is handled twice. See container/mp4/edits.go.
		target := int64(t * float64(track.Timescale))

		// The first frame presented at or after the wanted time.
		n := sort.Search(len(order), func(j int) bool {
			return track.Samples[order[j]].PTS >= target
		})
		if n >= len(order) {
			n = len(order) - 1
		}
		wanted[i] = wantedFrame{sample: order[n], slot: i}
	}

	// Decoding runs forward through the file once, so the samples are visited
	// in file order however the caller asked for them.
	sort.Slice(wanted, func(a, b int) bool { return wanted[a].sample < wanted[b].sample })
	return wanted, nil
}

// presentationOrder returns sample indices sorted by presentation time.
//
// Samples are stored in the order they must be decoded, which for a stream with
// B-frames is not the order they are shown in, so the two have to be
// distinguished before a time can be turned into a frame.
func presentationOrder(track *container.VideoTrack) []int {
	order := make([]int, len(track.Samples))
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool {
		return track.Samples[order[a]].PTS < track.Samples[order[b]].PTS
	})
	return order
}

// syncBefore returns the last keyframe at or before a sample, which is the
// earliest point a decoder can be started from and still reconstruct it.
func syncBefore(track *container.VideoTrack, sample int) int {
	sync := track.SyncSamples()
	n := sort.Search(len(sync), func(i int) bool { return sync[i] > sample })
	if n == 0 {
		return sync[0]
	}
	return sync[n-1]
}

// decodeExact runs the decoder forward over the file, collecting the wanted
// frames as they come past.
//
// Only the gaps between a wanted frame and the keyframe before it are decoded;
// the rest of the file is never read. Where two wanted frames share a keyframe
// the run continues rather than restarting, so no sample is decoded twice.
func decodeExact(ctx context.Context, f *mp4.File, dec *amf.Decoder, wanted []wantedFrame, count int, transform func(*image.RGBA) (image.Image, error)) ([]image.Image, error) {
	track := f.Video()

	// One sample can fill more than one slot: nothing stops a caller asking for
	// two times that fall within the same frame, and a time past the end of the
	// track resolves to the last frame however many ask for it. Keying slots by
	// sample without allowing for that silently drops all but the last of them.
	slots := make(map[int][]int, len(wanted))
	for _, w := range wanted {
		slots[w.sample] = append(slots[w.sample], w.slot)
	}

	// Everything between a keyframe and the frame wanted after it is reference,
	// not content, and there is a lot of it: a run is as long as the file's
	// keyframe interval. Saying so up front keeps those frames from being scaled
	// and copied back off the GPU only to be dropped here, which is the whole
	// cost of extracting a VR still — the reprojection wants the source at very
	// nearly its coded size, so a discarded 8K frame is a hundred megabytes over
	// the bus for nothing.
	dec.SetWanted(func(pts int64) bool {
		_, ok := slots[int(pts)]
		return ok
	})

	frames := make([]image.Image, count)
	filled := 0

	p := &pump{ctx: ctx, dec: dec, place: func(fr *amf.Frame) error {
		// The transform runs once per frame however many slots it fills, and its
		// result is shared between them: it is the same picture, and nothing
		// downstream writes to what it is given.
		var img image.Image
		for _, slot := range slots[int(fr.PTS)] {
			if frames[slot] != nil {
				continue
			}
			if img == nil {
				var err error
				if img, err = transform(fr.Image); err != nil {
					return err
				}
			}
			frames[slot] = img
			filled++
		}
		return nil
	}}

	// The same halving the phash walk gets: about half of what a run-up decodes is
	// pictures nothing is predicted from, and leaving those out cannot change the
	// target's pixels. See disposable.go.
	var skippable disposableTest
	if disposableSkipEnabled {
		skippable = newDisposableTest(track, f.SampleAnnexB)
	}

	step := func(i int, mayskip bool) error {
		data, err := f.SampleAnnexB(i)
		if err != nil {
			return err
		}
		if mayskip && skippable != nil && skippable(data) {
			return nil
		}
		if err := p.submit(data, int64(i)); err != nil {
			return fmt.Errorf("nativegen: sample %d: %w", i, err)
		}
		return nil
	}

	next := -1
	for _, w := range wanted {
		if from := syncBefore(track, w.sample); from > next {
			// A new run: the previous one ended before this frame's keyframe, so
			// there is nothing in flight that helps and the decoder restarts here.
			next = from
		}

		for i := next; i <= w.sample; i++ {
			// The target is always decoded; only what precedes it is a candidate.
			if err := step(i, i != w.sample); err != nil {
				return nil, err
			}
		}
		next = w.sample + 1

		// A wanted frame is by construction the last one of its run, which makes
		// it the one most likely to still be inside the decoder's reorder window
		// — a stream with B-frames does not present a frame until the frames it
		// was predicted from have been decoded. Restarting at the next keyframe
		// with it still in there loses it, so it is pushed out first by feeding
		// the samples that follow it. There are only ever a handful: the window
		// is bounded by the stream's own buffer.
		for pushed := 0; frames[w.slot] == nil && pushed < maxReorderPush; pushed++ {
			if next >= len(track.Samples) {
				break
			}
			// Not skipped: these are submitted to move the decoder's output along,
			// which a disposable picture still does.
			if err := step(next, false); err != nil {
				return nil, err
			}
			next++
		}
	}

	if err := p.finish(func() bool { return filled == count }); err != nil {
		return nil, err
	}

	if filled != count {
		return nil, fmt.Errorf("nativegen: decoded %d of %d frames", filled, count)
	}
	return frames, nil
}
