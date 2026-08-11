package videophash

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"math"
	"os/exec"
	"strings"
	"time"

	"github.com/corona10/goimagehash"
	"github.com/disintegration/imaging"

	"github.com/stashapp/stash/pkg/ffmpeg"
	"github.com/stashapp/stash/pkg/ffmpeg/transcoder"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/nativegen"
)

const (
	screenshotSize = 160
	columns        = 5
	rows           = 5
)

// The phash is the exact frame at each of the twenty-five timestamps -- the frame
// ffmpeg's accurate seek returns, and therefore the value upstream stash and
// stash-box hold for the same file. Both backends produce it, so the fingerprint
// does not depend on whether the machine that hashed it had a usable GPU.
//
// Keyframe snapping was tried here and removed. It is dramatically cheaper, and
// with -noaccurate_seek -copyts on this side and SyncAtOrBefore on the native one
// the two backends can be made to agree on it bit-for-bit, but it lands 6 bits
// from the reference on an 8K one-second-GOP file and 10 bits on a 768x432
// three-second-GOP file. That is too far to match stash-box at any usual
// distance, and the error grows with GOP length -- worst on exactly the files
// whose cost makes snapping tempting. The native path reaches the exact frame
// fast enough instead: see pkg/nativegen.PhashFrames.
//
// No path here reprojects VR footage; the raw stored frame is hashed, as upstream
// does. A phash gains nothing from reprojection -- equirect frames discriminate
// scenes just as well -- and a reprojected one would match neither stash-box nor
// this package's own ffmpeg path, and would change whenever a scene's VR mode was
// edited.

type PhashOptions struct {
	Start    float64
	Duration float64

	// FFProbePath locates ffprobe, which the native path needs in order to read
	// the source's colour tags. Empty falls back to looking on PATH, and a probe
	// that cannot be run makes the native path decline rather than guess.
	FFProbePath string

	// Native opts this hash in to decoding its frames on the GPU.
	//
	// The zero value is the ffmpeg path, which is the one every existing library
	// was hashed with, so a caller that has no opinion gets the reference
	// behaviour rather than the fast one. It is a request and not an instruction:
	// a file the native path cannot handle is hashed by ffmpeg regardless, and the
	// two agree bit-for-bit, so this changes how long a hash takes and not what it
	// comes out as.
	Native bool
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

// generateSprite builds the 5x5 montage of 25 thumbnails that the phash is
// computed from.
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

	times := make([]float64, chunkCount)
	for i := 0; i < chunkCount; i++ {
		times[i] = options.Start + offset + (float64(i) * stepSize)
	}

	// Try the native (AMF) path first when it is asked for: decode the exact frames
	// on the GPU and pipe them through one ffmpeg process, so swscale does the
	// scaling and the pixels are the ones the ffmpeg path below would produce.
	// Falls back to the batched ffmpeg path on any error.
	//
	// Which backend ran is logged either way, and at info in both cases. The two
	// produce the same hash and differ only in time, so a silent fallback is
	// indistinguishable from a slow success -- there is no wrong output to notice.
	// Not being asked is not logged as a fallback, though: that is a setting doing
	// what it says, not a file the native path could not handle.
	if options.Native {
		started := time.Now()
		images, err := tryNativePhash(encoder, videoFile, times, options.FFProbePath)
		if err == nil {
			logger.Infof("[generator] native phash decoded %d frames for %s in %v",
				len(images), videoFile.Path, time.Since(started).Round(time.Millisecond))
			return combineImages(images), nil
		}
		logger.Infof("[generator] native phash declined for %s, using ffmpeg: %v", videoFile.Path, err)
	}

	// Several seeks per ffmpeg process rather than one, which changes no pixel
	// of the result -- see phash_batch.go for why that is safe and why the batch
	// size depends on the frame size.
	images, err := generateSpriteScreenshots(encoder, videoFile.Path, times,
		batchSizeFor(videoFile.Width, videoFile.Height))
	if err != nil {
		return nil, fmt.Errorf("generating sprite screenshot: %w", err)
	}

	// Combine all of the thumbnails into a sprite image
	if len(images) == 0 {
		return nil, fmt.Errorf("images slice is empty, failed to generate phash sprite for %s", videoFile.Path)
	}

	return combineImages(images), nil
}

// tryNativePhash attempts to generate the 25 phash frames using the native AMF
// decoder, returning the frames already scaled to the phash width. It returns
// an error wrapping container.ErrUnsupported or amf.ErrUnavailable when the
// native path cannot handle this file, in which case the caller should fall back
// to the ffmpeg batch path.
func tryNativePhash(encoder *ffmpeg.FFMpeg, videoFile *models.VideoFile, times []float64, ffprobePath string) ([]image.Image, error) {
	if !nativegen.PhashAvailable(encoder.Path()) {
		return nil, fmt.Errorf("native phash not available")
	}
	if videoFile.Width <= 0 || videoFile.Height <= 0 {
		return nil, fmt.Errorf("video dimensions unknown (%dx%d)", videoFile.Width, videoFile.Height)
	}

	// The native path sends raw frames to ffmpeg, which strips them of the colour
	// tags swscale needs, so they have to be restated from the source. Declining
	// when they cannot be read is the point rather than a nuisance: guessing
	// produces a hash a fraction of a pixel value away from the reference, which
	// is invisible and still wrong, where declining produces the reference itself.
	colorspace, colorRange, err := probeColorTags(ffprobePath, videoFile.Path)
	if err != nil {
		return nil, fmt.Errorf("reading colour tags: %w", err)
	}

	return nativegen.PhashFrames(context.Background(), nativegen.PhashFrameOptions{
		Path:       videoFile.Path,
		Times:      times,
		Width:      screenshotSize,
		Colorspace: colorspace,
		ColorRange: colorRange,
	}, encoder.Path())
}

// probeColorTags reads the source's colour matrix and range in ffmpeg's naming,
// returning empty strings for footage that declares none.
//
// ffprobe is asked rather than the container parsed because the answer has to be
// ffmpeg's answer: these tags can come from the container or from the bitstream's
// VUI, and it is ffmpeg's own resolution of the two that the reference path
// converts with.
func probeColorTags(ffprobePath, path string) (colorspace, colorRange string, err error) {
	if ffprobePath == "" {
		ffprobePath = ffmpeg.LookPathFFProbe()
	}
	if ffprobePath == "" {
		return "", "", fmt.Errorf("ffprobe not found")
	}

	cmd := exec.Command(ffprobePath,
		"-loglevel", "error",
		"-select_streams", "v:0",
		"-show_entries", "stream=color_space,color_range",
		"-of", "default=noprint_wrappers=1",
		path,
	)
	out, err := cmd.Output()
	if err != nil {
		return "", "", err
	}

	for _, line := range strings.Split(string(out), "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		// ffprobe says "unknown" for an untagged stream, and the flag must then be
		// left off entirely rather than passed through.
		if value == "" || value == "unknown" || value == "N/A" {
			continue
		}
		switch key {
		case "color_space":
			colorspace = value
		case "color_range":
			colorRange = value
		}
	}

	return colorspace, colorRange, nil
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
