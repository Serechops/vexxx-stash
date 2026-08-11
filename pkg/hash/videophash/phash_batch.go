package videophash

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/draw"
	"strings"

	"github.com/stashapp/stash/pkg/ffmpeg"
	"github.com/stashapp/stash/pkg/ffmpeg/transcoder"
)

// The phash sprite is twenty-five 160px-wide frames taken from across the file.
// Upstream takes them with twenty-five separate ffmpeg processes, one per frame.
// On anything but a very large file most of that time is not spent decoding: on
// a 640x358 36-minute file, twenty-five bare `ffmpeg -h` invocations account for
// 2.1s of the 2.9s the whole sprite takes.
//
// This packs several seeks into one invocation instead. Each input is scaled by
// exactly the filter the per-frame path applies and the results are stacked into
// one tall strip, which is sliced back apart here. Nothing about the frames
// changes -- same seek, same swscale call, same 160px width -- so the montage,
// and therefore the hash, is what the per-frame path produces. That is not a
// claim to take on trust; TestBatchedSpriteMatchesPerFrame checks it on real
// files, and a phash that moved would be worse than useless.
//
// Batching is bounded rather than unlimited because each extra input in one
// process is another live decoder holding its own reference frames. Twenty-five
// of those at 4320x2160 is slower than the per-frame path it replaces.

// batchPixelBudget is roughly how many source pixels may be decoded
// concurrently within one ffmpeg process, and sets the batch size.
//
// It is a budget rather than a fixed count because the cost being spread
// (process startup) is per-process while the cost being incurred (concurrent
// decoders) is per-pixel, so the right batch size falls as the source grows.
// 52M is twenty-five 1080p frames. Measured at the two ends of that range: a
// 640x358 file wants all 25 in one process (2.9s -> 0.9s), and a 4320x2160 file
// wants 5 (7.0s -> 5.3s, where 25-in-one is 9.9s).
const batchPixelBudget = 52 << 20

// batchSizeFor returns how many seeks to pack into one ffmpeg process for a
// source of the given dimensions, between 1 and chunkCount.
func batchSizeFor(width, height int) int {
	area := width * height
	if area <= 0 {
		// Dimensions come from the database and are occasionally missing.
		// Fall back to a batch that is safe at any size rather than to none.
		return 4
	}

	n := batchPixelBudget / area
	if n < 1 {
		return 1
	}
	if n > columns*rows {
		return columns * rows
	}
	return n
}

// generateSpriteScreenshots returns one image per timestamp, taking them in as
// few ffmpeg invocations as batch allows.
//
// A batch that fails for any reason falls back to taking its frames one at a
// time, so a file whose filter graph ffmpeg will not build still gets a phash
// rather than an error. The fallback is per batch, not per file, so one awkward
// stretch does not cost the rest their batching.
func generateSpriteScreenshots(encoder *ffmpeg.FFMpeg, input string, times []float64, batch int) ([]image.Image, error) {
	images := make([]image.Image, 0, len(times))

	for start := 0; start < len(times); start += batch {
		end := start + batch
		if end > len(times) {
			end = len(times)
		}
		chunk := times[start:end]

		got, err := spriteBatch(encoder, input, chunk)
		if err != nil {
			for _, t := range chunk {
				img, err := generateSpriteScreenshot(encoder, input, t)
				if err != nil {
					return nil, err
				}
				images = append(images, img)
			}
			continue
		}

		images = append(images, got...)
	}

	return images, nil
}

// spriteBatch takes every frame in times with a single ffmpeg process.
//
// The frames come back stacked vertically as one image because ffmpeg writes a
// single output stream to stdout; splitting them apart here is a plain copy, so
// each tile is the standalone screenshot of its timestamp.
func spriteBatch(encoder *ffmpeg.FFMpeg, input string, times []float64) ([]image.Image, error) {
	switch len(times) {
	case 0:
		return nil, nil
	case 1:
		// vstack needs two inputs, and a single seek has nothing to batch.
		img, err := generateSpriteScreenshot(encoder, input, times[0])
		if err != nil {
			return nil, err
		}
		return []image.Image{img}, nil
	}

	var args ffmpeg.Args
	args = args.LogLevel(ffmpeg.LogLevelError)
	args = args.Overwrite()

	for _, t := range times {
		args = args.Seek(t)
		args = args.Input(input)
	}

	// vstack rather than hstack so that slicing the result is a row range:
	// tiles stay contiguous and every tile is the full width of the strip.
	var graph strings.Builder
	for i := range times {
		fmt.Fprintf(&graph, "[%d:v]scale=%d:-2[s%d];", i, screenshotSize, i)
	}
	for i := range times {
		fmt.Fprintf(&graph, "[s%d]", i)
	}
	fmt.Fprintf(&graph, "vstack=inputs=%d[out]", len(times))

	args = append(args, "-filter_complex", graph.String(), "-map", "[out]")
	args = args.VideoFrames(1)
	args = args.AppendArgs(transcoder.ScreenshotOutputTypeBMP)
	args = args.Output("-")

	data, err := encoder.GenerateOutput(context.Background(), args, nil)
	if err != nil {
		return nil, err
	}

	strip, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decoding sprite strip: %w", err)
	}

	return sliceStrip(strip, len(times))
}

// sliceStrip cuts a vertically stacked strip back into n equal tiles.
//
// The tiles are copied out rather than returned as sub-images so that each one
// has its origin at (0,0) and its own backing array, matching what decoding a
// standalone screenshot yields. A sub-image would leave combineImages pasting
// from a non-zero origin.
func sliceStrip(strip image.Image, n int) ([]image.Image, error) {
	b := strip.Bounds()
	if b.Dy()%n != 0 {
		return nil, fmt.Errorf("sprite strip is %dpx tall, not divisible into %d tiles", b.Dy(), n)
	}
	h := b.Dy() / n

	images := make([]image.Image, 0, n)
	for i := 0; i < n; i++ {
		tile := image.NewRGBA(image.Rect(0, 0, b.Dx(), h))
		draw.Draw(tile, tile.Bounds(), strip, image.Pt(b.Min.X, b.Min.Y+i*h), draw.Src)
		images = append(images, tile)
	}

	return images, nil
}
