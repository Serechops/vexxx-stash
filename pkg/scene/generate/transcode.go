package generate

import (
	"context"

	"github.com/stashapp/stash/pkg/ffmpeg"
	"github.com/stashapp/stash/pkg/ffmpeg/transcoder"
	"github.com/stashapp/stash/pkg/fsutil"
	"github.com/stashapp/stash/pkg/logger"
)

type TranscodeOptions struct {
	Width  int
	Height int
}

func (g Generator) Transcode(ctx context.Context, input string, hash string, options TranscodeOptions) error {
	lockCtx := g.LockManager.ReadLock(ctx, input)
	defer lockCtx.Cancel()

	return g.makeTranscode(lockCtx, hash, g.transcode(input, options))
}

// TranscodeVideo transcodes the video, and removes the audio.
// In some videos where the audio codec is not supported by ffmpeg,
// ffmpeg fails if you try to transcode the audio
func (g Generator) TranscodeVideo(ctx context.Context, input string, hash string, options TranscodeOptions) error {
	lockCtx := g.LockManager.ReadLock(ctx, input)
	defer lockCtx.Cancel()

	return g.makeTranscode(lockCtx, hash, g.transcodeVideo(input, options))
}

// TranscodeAudio will copy the video stream as is, and transcode audio.
func (g Generator) TranscodeAudio(ctx context.Context, input string, hash string) error {
	lockCtx := g.LockManager.ReadLock(ctx, input)
	defer lockCtx.Cancel()

	return g.makeTranscode(lockCtx, hash, g.transcodeAudio(input))
}

// TranscodeCopyVideo will copy the video stream as is, and drop the audio stream.
func (g Generator) TranscodeCopyVideo(ctx context.Context, input string, hash string) error {
	lockCtx := g.LockManager.ReadLock(ctx, input)
	defer lockCtx.Cancel()

	return g.makeTranscode(lockCtx, hash, g.transcodeCopyVideo(input))
}

func (g Generator) makeTranscode(lockCtx *fsutil.LockContext, hash string, generateFn generateFn) error {
	output := g.ScenePaths.GetTranscodePath(hash)
	if !g.Overwrite {
		if exists, _ := fsutil.FileExists(output); exists {
			return nil
		}
	}

	if err := g.generateFile(lockCtx, g.ScenePaths, mp4Pattern, output, generateFn); err != nil {
		return err
	}

	logger.Debug("created transcode: ", output)

	return nil
}

func (g Generator) transcode(input string, options TranscodeOptions) generateFn {
	return func(lockCtx *fsutil.LockContext, tmpFn string) error {
		var videoFilter ffmpeg.VideoFilter
		if options.Width != 0 && options.Height != 0 {
			videoFilter = videoFilter.ScaleDimensions(options.Width, options.Height)
		}

		// Determine codec and args based on hardware encoding availability
		videoCodec := ffmpeg.VideoCodecLibX264
		var videoArgs ffmpeg.Args

		if g.UseHardwareEncoding {
			if hwCodec := g.Encoder.GetHWCodecForMP4(); hwCodec != nil {
				videoCodec = *hwCodec
				// Use hardware codec init settings
				videoArgs = append(videoArgs, ffmpeg.CodecInit(videoCodec)...)
				// Apply hardware-specific video filter
				videoFilter = g.Encoder.HWFilterForCodec(videoFilter, videoCodec)
				logger.Debugf("[Transcode] Using hardware encoder: %s", videoCodec.Name)
			} else {
				logger.Debug("[Transcode] Hardware encoding enabled but no compatible codec found, falling back to libx264")
				videoArgs = g.softwareTranscodeArgs()
			}
		} else {
			videoArgs = g.softwareTranscodeArgs()
		}

		if videoFilter != "" {
			videoArgs = videoArgs.VideoFilter(videoFilter)
		}

		args := transcoder.Transcode(input, transcoder.TranscodeOptions{
			OutputPath: tmpFn,
			VideoCodec: videoCodec,
			VideoArgs:  videoArgs,
			AudioCodec: ffmpeg.AudioCodecAAC,

			ExtraInputArgs:  g.FFMpegConfig.GetTranscodeInputArgs(),
			ExtraOutputArgs: g.FFMpegConfig.GetTranscodeOutputArgs(),
		})

		return g.generate(lockCtx, args)
	}
}

// softwareTranscodeArgs returns the video args for software (libx264) encoding
func (g Generator) softwareTranscodeArgs() ffmpeg.Args {
	return ffmpeg.Args{
		"-pix_fmt", "yuv420p",
		"-profile:v", "high",
		"-level", "4.2",
		"-preset", "superfast",
		"-crf", "23",
	}
}

func (g Generator) transcodeVideo(input string, options TranscodeOptions) generateFn {
	return func(lockCtx *fsutil.LockContext, tmpFn string) error {
		var videoFilter ffmpeg.VideoFilter
		if options.Width != 0 && options.Height != 0 {
			videoFilter = videoFilter.ScaleDimensions(options.Width, options.Height)
		}

		// Determine codec and args based on hardware encoding availability
		videoCodec := ffmpeg.VideoCodecLibX264
		var videoArgs ffmpeg.Args

		if g.UseHardwareEncoding {
			if hwCodec := g.Encoder.GetHWCodecForMP4(); hwCodec != nil {
				videoCodec = *hwCodec
				videoArgs = append(videoArgs, ffmpeg.CodecInit(videoCodec)...)
				videoFilter = g.Encoder.HWFilterForCodec(videoFilter, videoCodec)
				logger.Debugf("[TranscodeVideo] Using hardware encoder: %s", videoCodec.Name)
			} else {
				videoArgs = g.softwareTranscodeArgs()
			}
		} else {
			videoArgs = g.softwareTranscodeArgs()
		}

		if videoFilter != "" {
			videoArgs = videoArgs.VideoFilter(videoFilter)
		}

		var audioArgs ffmpeg.Args
		audioArgs = audioArgs.SkipAudio()

		args := transcoder.Transcode(input, transcoder.TranscodeOptions{
			OutputPath: tmpFn,
			VideoCodec: videoCodec,
			VideoArgs:  videoArgs,
			AudioArgs:  audioArgs,

			ExtraInputArgs:  g.FFMpegConfig.GetTranscodeInputArgs(),
			ExtraOutputArgs: g.FFMpegConfig.GetTranscodeOutputArgs(),
		})

		return g.generate(lockCtx, args)
	}
}

func (g Generator) transcodeAudio(input string) generateFn {
	return func(lockCtx *fsutil.LockContext, tmpFn string) error {
		args := transcoder.Transcode(input, transcoder.TranscodeOptions{
			OutputPath: tmpFn,
			VideoCodec: ffmpeg.VideoCodecCopy,
			AudioCodec: ffmpeg.AudioCodecAAC,
		})

		return g.generate(lockCtx, args)
	}
}

func (g Generator) transcodeCopyVideo(input string) generateFn {
	return func(lockCtx *fsutil.LockContext, tmpFn string) error {

		var audioArgs ffmpeg.Args
		audioArgs = audioArgs.SkipAudio()

		args := transcoder.Transcode(input, transcoder.TranscodeOptions{
			OutputPath: tmpFn,
			VideoCodec: ffmpeg.VideoCodecCopy,
			AudioArgs:  audioArgs,
		})

		return g.generate(lockCtx, args)
	}
}
