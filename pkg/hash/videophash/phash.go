package videophash

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"math"
	"runtime"
	"sync"

	"github.com/corona10/goimagehash"
	"github.com/disintegration/imaging"

	"github.com/stashapp/stash/pkg/ffmpeg"
	"github.com/stashapp/stash/pkg/ffmpeg/transcoder"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
)

// screenshotSem limits the number of concurrent FFmpeg screenshot processes
// across all phash generation tasks to avoid overwhelming the system.
var screenshotSem = make(chan struct{}, runtime.NumCPU())

const (
	screenshotSize = 160
	columns        = 5
	rows           = 5
)

type PhashOptions struct {
	Start    float64
	Duration float64
}

func Generate(encoder *ffmpeg.FFMpeg, videoFile *models.VideoFile, options PhashOptions) (*uint64, error) {
	sprite, err := generateSprite(encoder, videoFile, options)
	if err != nil {
		return nil, err
	}

	hash, err := goimagehash.PerceptionHash(sprite)
	if err != nil {
		return nil, fmt.Errorf("computing phash from sprite: %w", err)
	}
	hashValue := hash.GetHash()
	return &hashValue, nil
}

func generateSpriteScreenshot(encoder *ffmpeg.FFMpeg, input string, t float64) (image.Image, error) {
	options := transcoder.ScreenshotOptions{
		Width:      screenshotSize,
		OutputPath: "-",
		OutputType: transcoder.ScreenshotOutputTypeBMP,
	}

	args := transcoder.ScreenshotTime(input, t, options)
	data, err := encoder.GenerateOutput(context.Background(), args, nil)
	if err != nil {
		return nil, err
	}

	reader := bytes.NewReader(data)

	img, _, err := image.Decode(reader)
	if err != nil {
		return nil, fmt.Errorf("decoding image: %w", err)
	}

	return img, nil
}

func combineImages(images []image.Image) image.Image {
	width := images[0].Bounds().Size().X
	height := images[0].Bounds().Size().Y
	canvasWidth := width * columns
	canvasHeight := height * rows
	montage := imaging.New(canvasWidth, canvasHeight, color.NRGBA{})
	for index := 0; index < len(images); index++ {
		x := width * (index % columns)
		y := height * int(math.Floor(float64(index)/float64(rows)))
		img := images[index]
		montage = imaging.Paste(montage, img, image.Pt(x, y))
	}

	return montage
}

func generateSprite(encoder *ffmpeg.FFMpeg, videoFile *models.VideoFile, options PhashOptions) (image.Image, error) {
	logger.Infof("[generator] generating phash sprite for %s", videoFile.Path)

	duration := options.Duration
	if duration == 0 {
		duration = videoFile.Duration
	}

	// Generate sprite image offset by 5% on each end to avoid intro/outros
	chunkCount := columns * rows
	offset := 0.05 * duration
	stepSize := (0.9 * duration) / float64(chunkCount)

	// Pre-allocate the images slice so goroutines can write to their own index
	images := make([]image.Image, chunkCount)

	// Run all 25 FFmpeg screenshot processes in parallel.
	// Each goroutine extracts one frame at its specific timestamp —
	// same frames, same timestamps as the sequential approach.
	var wg sync.WaitGroup
	var mu sync.Mutex
	var firstErr error

	for i := 0; i < chunkCount; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()

			// Acquire semaphore slot to limit total concurrent FFmpeg processes
			screenshotSem <- struct{}{}
			defer func() { <-screenshotSem }()

			time := options.Start + offset + (float64(idx) * stepSize)

			img, err := generateSpriteScreenshot(encoder, videoFile.Path, time)
			if err != nil {
				mu.Lock()
				if firstErr == nil {
					firstErr = fmt.Errorf("generating sprite screenshot at index %d: %w", idx, err)
				}
				mu.Unlock()
				return
			}

			images[idx] = img
		}(i)
	}

	wg.Wait()

	if firstErr != nil {
		return nil, firstErr
	}

	// Verify all images were captured
	for i, img := range images {
		if img == nil {
			return nil, fmt.Errorf("missing image at index %d for %s", i, videoFile.Path)
		}
	}

	return combineImages(images), nil
}
