package generate

import (
	"context"

	"fmt"
	"os"
	"path/filepath"

	"github.com/stashapp/stash/pkg/ffmpeg/transcoder"
	"github.com/stashapp/stash/pkg/fsutil"
	"github.com/stashapp/stash/pkg/logger"
)

const (
	// thumbnailWidth   = 320
	// thumbnailQuality = 5

	screenshotQuality = 2

	screenshotDurationProportion = 0.2
)

type ScreenshotOptions struct {
	At *float64
}

func (g Generator) Screenshot(ctx context.Context, input string, videoWidth int, videoDuration float64, options ScreenshotOptions) ([]byte, error) {
	lockCtx := g.LockManager.ReadLock(ctx, input)
	defer lockCtx.Cancel()

	logger.Infof("Creating screenshot for %s", input)

	at := screenshotDurationProportion * videoDuration
	if options.At != nil {
		at = *options.At
	}

	ret, err := g.generateBytes(lockCtx, g.ScenePaths, jpgPattern, g.screenshot(input, screenshotOptions{
		Time:    at,
		Quality: screenshotQuality,
		// default Width is video width
	}))
	if err != nil {
		return nil, err
	}

	return ret, nil
}

func (g Generator) GalleryImages(ctx context.Context, input string, timestamps []float64, outputDir string, imagePrefix string) ([]string, error) {
	lockCtx := g.LockManager.ReadLock(ctx, input)
	defer lockCtx.Cancel()

	logger.Infof("Creating gallery images for %s", input)

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create output directory: %w", err)
	}

	var filenames []string
	for i, t := range timestamps {
		// Use index-based formatting for order preservation: "001.jpg" or "prefix_001.jpg"
		var filename string
		if imagePrefix != "" {
			filename = fmt.Sprintf("%s_%03d.jpg", imagePrefix, i+1)
		} else {
			filename = fmt.Sprintf("%03d.jpg", i+1)
		}
		outputPath := filepath.Join(outputDir, filename)

		ssOptions := transcoder.ScreenshotOptions{
			OutputPath: outputPath,
			OutputType: transcoder.ScreenshotOutputTypeImage2,
			Quality:    screenshotQuality,
		}

		args := transcoder.ScreenshotTime(input, t, ssOptions)

		if err := g.generate(lockCtx, args); err != nil {
			return filenames, fmt.Errorf("generating image at %f: %w", t, err)
		}

		filenames = append(filenames, filename)
	}

	return filenames, nil
}

type screenshotOptions struct {
	Time    float64
	Width   int
	Quality int
}

func (g Generator) screenshot(input string, options screenshotOptions) generateFn {
	return func(lockCtx *fsutil.LockContext, tmpFn string) error {
		ssOptions := transcoder.ScreenshotOptions{
			OutputPath: tmpFn,
			OutputType: transcoder.ScreenshotOutputTypeImage2,
			Quality:    options.Quality,
			Width:      options.Width,
		}

		args := transcoder.ScreenshotTime(input, options.Time, ssOptions)

		return g.generate(lockCtx, args)
	}
}
