// Package nativegen generates sprite sheets from video files without ffmpeg.
//
// The existing ffmpeg path spawns one process per tile, and each of those
// processes opens the file, seeks, decodes and exits. For a 9x9 sheet that is 81
// spawns and 81 independent seeks. This package instead demuxes the file once,
// picks the keyframes nearest the wanted times out of the sample index, and
// feeds only those to a hardware decoder that scales them to tile size on the
// GPU before they cross PCIe.
//
// Every entry point here is allowed to decline. Files this pipeline does not
// handle — fragmented MP4, Matroska, rotated video, codecs the GPU has no engine
// for — come back as an error wrapping container.ErrUnsupported or
// amf.ErrUnavailable, and the caller falls back to ffmpeg. Declining is cheap;
// producing a subtly wrong sprite sheet is not.
package nativegen

import (
	"context"
	"fmt"
	"image"
	"math"

	"github.com/stashapp/stash/pkg/nativegen/amf"
	"github.com/stashapp/stash/pkg/nativegen/container"
	"github.com/stashapp/stash/pkg/nativegen/container/mp4"
)

// SpriteOptions describes a sheet of tiles to produce.
type SpriteOptions struct {
	// Path is the video file to read.
	Path string

	// Count is how many tiles are wanted, evenly spaced across the covered
	// span of the file.
	Count int

	// Width is the width of each tile in pixels. The height follows from the
	// source's coded aspect ratio.
	Width int

	// StartOffset and Duration restrict the tiles to a section of the file, for
	// scenes with a marked start and end point. A zero Duration means the span
	// covered is the file's own duration.
	StartOffset float64
	Duration    float64

	// StreamDuration is the video's duration as the caller already measured it,
	// used when Duration is zero. Passing it makes this backend divide up
	// exactly the same span as the ffmpeg one and so place tiles at identical
	// times; without it the container's own duration is used, which can differ
	// from what ffprobe reports by a frame or two.
	StreamDuration float64

	// VRMode names the projection the footage is stored in, for scenes tagged
	// as VR. Frames are flattened into a rectilinear view before they become
	// tiles. Empty means the footage is already flat and is scaled directly.
	VRMode string
}

// Available reports whether the native pipeline has a hardware decoder it can
// use on this machine. It says nothing about any particular file.
func Available() bool {
	return amf.Available()
}

// Describe names the hardware backend in use, for logging. It returns an empty
// string when nothing is available.
func Describe() string {
	if !amf.Available() {
		return ""
	}
	v, err := amf.Version()
	if err != nil {
		return "AMD AMF"
	}
	return "AMD AMF " + v
}

// Sprite decodes Count keyframes spread across the file and returns them as
// tiles in timeline order.
//
// It returns an error wrapping container.ErrUnsupported when the file's
// structure is out of scope, or amf.ErrUnavailable when no hardware decoder can
// take it. Callers should fall back to ffmpeg on any error at all, not just
// those two: a partial or failed native run must never produce a sheet.
func Sprite(ctx context.Context, opts SpriteOptions) ([]image.Image, error) {
	if opts.Count <= 0 {
		return nil, fmt.Errorf("nativegen: sprite needs at least one tile, got %d", opts.Count)
	}
	if opts.Width <= 0 {
		return nil, fmt.Errorf("nativegen: invalid tile width %d", opts.Width)
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
		// ffmpeg applies the display matrix on its own, so a rotated file
		// generated natively would disagree with every other thumbnail in the
		// library. Hand it back rather than emit sideways tiles.
		return nil, fmt.Errorf("%w: track carries a display matrix (rotation %d)",
			container.ErrUnsupported, track.Rotation)
	}

	times, err := tileTimes(track, opts)
	if err != nil {
		return nil, err
	}

	samples := track.KeyframesAt(times)
	for i, s := range samples {
		if s < 0 {
			return nil, fmt.Errorf("%w: no keyframe available for tile %d", container.ErrUnsupported, i)
		}
	}

	// This pipeline only ever decodes keyframes, so a file with fewer keyframes
	// than tiles has to repeat some — a 20-second clip with five keyframes would
	// yield a sheet of five images shown sixteen times each. ffmpeg decodes
	// forward to the exact time and would produce a genuinely different frame
	// for every tile, so on those files it is not merely the fallback, it is the
	// better answer. Hand them over.
	if distinct := distinctSamples(samples); distinct < opts.Count {
		return nil, fmt.Errorf("%w: only %d keyframes for %d tiles",
			container.ErrUnsupported, distinct, opts.Count)
	}

	// For flat footage the decoder scales straight to tile size and the frames
	// it returns are the tiles. VR footage has to be reprojected on the way,
	// which needs more pixels than a tile holds, so there the decoder is asked
	// for an intermediate size and the remapper produces the tile from it.
	decW, decH := tileSize(opts.Width, track.Width, track.Height)
	transform := func(img *image.RGBA) (image.Image, error) { return img, nil }

	if opts.VRMode != "" {
		tileW, tileH := vrTileSize(opts.Width)
		rm, err := newRemapper(opts.VRMode, track.Width, track.Height, tileW, tileH)
		if err != nil {
			return nil, err
		}
		decW, decH = rm.srcSize()
		transform = func(img *image.RGBA) (image.Image, error) { return rm.remap(img) }
	}

	// One kept device, so that two sheets generating side by side get an engine
	// each instead of whichever the driver picks twice. See devices.go.
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
		// Only keyframes are submitted, and keyframes carry no reordering
		// dependencies, so the decoder can hand each one back immediately
		// instead of holding it for a reorder window.
		LowLatency: true,
	})
	if err != nil {
		return nil, err
	}
	defer dec.Close()

	// The reprojection copies every frame it is given into a tile, so the
	// decoder may hand the same buffer back each time. Flat footage keeps the
	// decoder's image as the tile itself, which has to be its own.
	dec.Reuse(opts.VRMode != "")

	return decodeTiles(ctx, f, dec, samples, opts.Count, transform)
}

// distinctSamples counts how many different samples a tile assignment draws on.
func distinctSamples(samples []int) int {
	seen := make(map[int]struct{}, len(samples))
	for _, s := range samples {
		seen[s] = struct{}{}
	}
	return len(seen)
}

// tileTimes returns the presentation times the tiles should be taken from,
// matching the spacing the ffmpeg path uses so that the two backends produce
// interchangeable sheets and a VTT written for one describes the other.
func tileTimes(track *container.VideoTrack, opts SpriteOptions) ([]float64, error) {
	// Note that StartOffset is not subtracted here. The ffmpeg path spreads its
	// tiles across the full duration and then adds the offset to each, and these
	// two must agree: the VTT that indexes the sheet is written once, from the
	// same arithmetic, whichever backend produced the tiles.
	duration := opts.Duration
	if duration <= 0 {
		duration = opts.StreamDuration
	}
	if duration <= 0 {
		duration = track.DurationSeconds()
	}
	if duration <= 0 {
		return nil, fmt.Errorf("%w: track has no usable duration", container.ErrUnsupported)
	}

	step := duration / float64(opts.Count)
	times := make([]float64, opts.Count)
	for i := range times {
		times[i] = opts.StartOffset + float64(i)*step
	}
	return times, nil
}

// tileSize scales a source down to the requested width, preserving aspect and
// rounding the height to an even number.
//
// This reproduces ffmpeg's "scale=w:-2", which the existing path uses, so tiles
// from the two backends are the same shape. Even heights also matter to the
// decoder: its NV12 intermediate has a half-height chroma plane, so an odd
// height has no exact representation.
func tileSize(width, srcW, srcH int) (int, int) {
	if srcW <= 0 || srcH <= 0 {
		return width, width
	}
	h := int(math.Round(float64(width)*float64(srcH)/float64(srcW)/2)) * 2
	if h < 2 {
		h = 2
	}
	return width, h
}

// vrTileSize returns the size of a tile made from VR footage.
//
// A VR tile does not inherit the source's shape. The flat view rendered out of
// the projection has a fixed field of view and so a fixed aspect ratio, and an
// 8000x4000 equirectangular frame and a 5760x2880 fisheye one both end up as
// the same 16:9 window onto the scene. That is the ffmpeg path's behaviour too,
// which matters here for the usual reason: one VTT indexes whichever sheet was
// produced, and it derives tile geometry by dividing up the sheet.
func vrTileSize(width int) (int, int) {
	return tileSize(width, vrFlatWidth, vrFlatHeight)
}

// decodeTiles runs the submit/receive pump until every tile has an image.
//
// Each sample is submitted with its tile index as the timestamp, which the
// decoder carries through to the output. Outputs therefore identify themselves
// and nothing here depends on frames coming back in the order they went in.
// transform is applied to each decoded frame to turn it into a tile. It is the
// identity for flat footage and the VR reprojection otherwise. Doing it here,
// rather than after every frame has been collected, means the intermediate is
// released as soon as its tile exists instead of eighty-one of them being held
// at once.
func decodeTiles(ctx context.Context, f *mp4.File, dec *amf.Decoder, samples []int, count int, transform func(*image.RGBA) (image.Image, error)) ([]image.Image, error) {
	tiles := make([]image.Image, count)
	filled := 0

	p := &pump{ctx: ctx, dec: dec, place: func(fr *amf.Frame) error {
		i := int(fr.PTS)
		if i < 0 || i >= len(tiles) || tiles[i] != nil {
			return nil
		}
		img, err := transform(fr.Image)
		if err != nil {
			return err
		}
		tiles[i] = img
		filled++
		return nil
	}}

	for i, s := range samples {
		data, err := f.SampleAnnexB(s)
		if err != nil {
			return nil, err
		}
		if err := p.submit(data, int64(i)); err != nil {
			return nil, fmt.Errorf("nativegen: tile %d: %w", i, err)
		}
	}

	if err := p.finish(func() bool { return filled == count }); err != nil {
		return nil, err
	}

	if filled != count {
		return nil, fmt.Errorf("nativegen: decoded %d of %d tiles", filled, count)
	}
	return tiles, nil
}
