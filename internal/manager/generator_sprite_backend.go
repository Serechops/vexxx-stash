package manager

import (
	"context"
	"errors"
	"fmt"
	"image"
	"math"

	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/nativegen"
	"github.com/stashapp/stash/pkg/scene/generate"
)

// A spriteBackend produces the tiles of a sprite sheet.
//
// There are two: the original one, which shells out to ffmpeg once per tile,
// and the native one in pkg/nativegen, which demuxes the file once and decodes
// its keyframes on the GPU. They are interchangeable by construction — same
// tile count, same tile size, same timeline positions — so the sheet and the
// VTT that indexes it do not care which produced them.
//
// The native backend is allowed to decline, and does so for whole classes of
// file. A backend that returns an error is not a failure to report to the user;
// it is a signal to try the next one.
type spriteBackend interface {
	// name identifies the backend in log messages.
	name() string

	// tiles returns exactly req.count images, in timeline order.
	tiles(ctx context.Context, req spriteRequest) ([]image.Image, error)
}

// spriteRequest describes one sprite sheet completely, so that a backend needs
// nothing from the generator beyond it.
type spriteRequest struct {
	path string

	// count is the number of tiles, and width the width of each; heights follow
	// from the source's aspect ratio.
	count int
	width int

	// startOffset and duration restrict the sheet to a section of the file, for
	// scenes with marked start and end points. A zero duration means the file
	// is covered from startOffset to its end.
	startOffset float64
	duration    float64

	// slowSeek marks a file short enough that the generator seeks by frame
	// number rather than by time, because its duration cannot be trusted.
	// frameCount is then what the tiles are spaced across.
	slowSeek   bool
	frameCount int64

	// streamDuration is the video stream's own duration, used when the request
	// covers the whole file.
	streamDuration float64

	// vrMode names a projection that has to be flattened into a rectilinear
	// view before a tile is legible. Empty for flat footage.
	vrMode string
}

func (g *SpriteGenerator) spriteRequest() spriteRequest {
	return spriteRequest{
		path:           g.Info.VideoFile.Path,
		count:          g.Info.ChunkCount,
		width:          generate.SpriteTileWidth(g.VRMode),
		startOffset:    g.StartOffset,
		duration:       g.Duration,
		slowSeek:       g.SlowSeek,
		frameCount:     g.Info.VideoFile.FrameCount,
		streamDuration: g.Info.VideoFile.VideoStreamDuration,
		vrMode:         g.VRMode,
	}
}

// spriteTiles produces the sheet's tiles, preferring the native pipeline when
// it is enabled and can take the file.
func (g *SpriteGenerator) spriteTiles(ctx context.Context) ([]image.Image, error) {
	req := g.spriteRequest()

	if b := nativeSpriteBackend(); b != nil {
		images, err := b.tiles(ctx, req)
		if err == nil {
			logger.Debugf("[generator] %s produced %d sprite tiles for %s", b.name(), len(images), req.path)
			return images, nil
		}

		// A cancelled job is not a file the native path cannot handle, and
		// re-running it through ffmpeg would only cancel again more slowly.
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}

		// Declining is the designed behaviour, not an incident, so this is
		// logged at info: the reason should be visible without reading like a
		// failure.
		logger.Infof("[generator] native sprite generation declined %s, using ffmpeg: %v", req.path, err)
	}

	return ffmpegSprites{gen: g.g}.tiles(ctx, req)
}

// nativeSpriteBackend returns the native backend when it is both enabled and
// usable on this machine, and nil otherwise, so the caller does not have to
// distinguish "turned off" from "no supported hardware".
func nativeSpriteBackend() spriteBackend {
	if !nativeGenerationEnabled() {
		return nil
	}
	return nativeSprites{}
}

// ffmpegSprites is the original path: one ffmpeg invocation per tile, each of
// which opens the file and seeks independently.
type ffmpegSprites struct {
	gen *generate.Generator
}

func (ffmpegSprites) name() string { return "ffmpeg" }

func (f ffmpegSprites) tiles(ctx context.Context, req spriteRequest) ([]image.Image, error) {
	images := make([]image.Image, 0, req.count)

	if req.slowSeek {
		logger.Infof("[generator] generating sprite image for %s (%d frames)", req.path, req.frameCount)

		stepFrame := float64(req.frameCount-1) / float64(req.count)

		for i := 0; i < req.count; i++ {
			frame := math.Round(float64(i) * stepFrame)
			if frame >= math.MaxInt || frame <= math.MinInt {
				return nil, errors.New("invalid frame number conversion")
			}

			img, err := f.gen.SpriteScreenshotSlow(ctx, req.path, int(frame), req.vrMode)
			if err != nil {
				return nil, fmt.Errorf("sprite screenshot (slow) at index %d: %w", i, err)
			}
			images = append(images, img)
		}

		return images, nil
	}

	logger.Infof("[generator] generating sprite image for %s", req.path)

	duration := req.streamDuration
	if req.duration > 0 {
		duration = req.duration
	}
	stepSize := duration / float64(req.count)

	for i := 0; i < req.count; i++ {
		at := req.startOffset + (float64(i) * stepSize)
		img, err := f.gen.SpriteScreenshot(ctx, req.path, at, req.vrMode)
		if err != nil {
			return nil, fmt.Errorf("sprite screenshot at index %d: %w", i, err)
		}
		images = append(images, img)
	}

	return images, nil
}

// nativeSprites decodes the file's keyframes on the GPU, in one pass.
type nativeSprites struct{}

func (nativeSprites) name() string {
	if d := nativegen.Describe(); d != "" {
		return "native (" + d + ")"
	}
	return "native"
}

func (nativeSprites) tiles(ctx context.Context, req spriteRequest) ([]image.Image, error) {
	// VR footage is reprojected from equirectangular or fisheye into a flat view
	// before it is scaled. The native pipeline implements the projections the
	// ffmpeg path does, but a mode outside that set has to go back: a tile
	// rendered with the wrong projection is not obviously wrong, it just shows
	// the wrong part of the scene.
	if req.vrMode != "" && !nativegen.IsVRProjection(req.vrMode) {
		return nil, fmt.Errorf("no native reprojection for VR mode %q", req.vrMode)
	}

	// Slow seek exists for files whose duration or frame count the container
	// reports unreliably, which is exactly the metadata the native path picks
	// its keyframes from.
	if req.slowSeek {
		return nil, fmt.Errorf("file is too short for time-based seeking")
	}

	return nativegen.Sprite(ctx, nativegen.SpriteOptions{
		Path:           req.path,
		Count:          req.count,
		Width:          req.width,
		StartOffset:    req.startOffset,
		Duration:       req.duration,
		StreamDuration: req.streamDuration,
		VRMode:         req.vrMode,
	})
}
