package manager

import (
	"context"
	"fmt"

	"github.com/stashapp/stash/pkg/fsutil"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/scene/generate"
)

type GeneratePreviewTask struct {
	repository   models.Repository
	Scene        models.Scene
	ImagePreview bool

	Options generate.PreviewOptions

	Overwrite           bool
	fileNamingAlgorithm models.HashAlgorithm

	generator *generate.Generator

	videoPreviewExists *bool
	imagePreviewExists *bool
}

func (t *GeneratePreviewTask) GetDescription() string {
	return fmt.Sprintf("Generating preview for %s", t.Scene.Path)
}

func (t *GeneratePreviewTask) Start(ctx context.Context) error {
	videoChecksum := t.Scene.GetHash(t.fileNamingAlgorithm)

	previewValid := false

	if t.videoPreviewRequired() {
		if t.Scene.StartPoint != nil && t.Scene.EndPoint != nil && *t.Scene.EndPoint > *t.Scene.StartPoint {
			t.Options.LimitStart = t.Scene.StartPoint
			t.Options.LimitEnd = t.Scene.EndPoint
		}

		ffprobe := instance.FFProbe
		videoFile, err := ffprobe.NewVideoFile(t.Scene.Path)
		if err != nil {
			logger.Errorf("error reading video file: %v", err)
			return nil
		}

		duration := videoFile.VideoStreamDuration
		if t.Options.LimitStart != nil && t.Options.LimitEnd != nil {
			duration = *t.Options.LimitEnd - *t.Options.LimitStart
		}

		if err := t.generateVideo(ctx, videoChecksum, duration, videoFile.FrameRate); err != nil {
			logger.Errorf("error generating preview: %v", err)
			logErrorOutput(err)
			return nil
		}
		previewValid = true
	} else if t.videoPreviewExists != nil && *t.videoPreviewExists {
		previewValid = true
	}

	if previewValid && !t.Scene.HasPreview {
		// Update scene HasPreview flag
		partial := models.NewScenePartial()
		partial.HasPreview = models.NewOptionalBool(true)

		if err := t.repository.WithTxn(ctx, func(ctx context.Context) error {
			_, err := t.repository.Scene.UpdatePartial(ctx, t.Scene.ID, partial)
			return err
		}); err != nil {
			logger.Errorf("Failed to update scene has_preview flag: %v", err)
		}
	}

	if t.imagePreviewRequired() {
		if err := t.generateWebp(ctx, videoChecksum); err != nil {
			logger.Errorf("error generating preview webp: %v", err)
			logErrorOutput(err)
		}
	}
	return nil
}

func (t *GeneratePreviewTask) generateVideo(ctx context.Context, videoChecksum string, videoDuration float64, videoFrameRate float64) error {
	videoFilename := t.Scene.Path
	useVsync2 := false

	if videoFrameRate <= 0.01 {
		logger.Errorf("[generator] Video framerate very low/high (%f) most likely vfr so using -vsync 2", videoFrameRate)
		useVsync2 = true
	}

	vrModeStr := ""
	if t.Scene.VRMode != nil {
		vrModeStr = string(*t.Scene.VRMode)
	}

	if err := t.generator.PreviewVideo(ctx, videoFilename, videoDuration, videoChecksum, t.Options, vrModeStr, false, useVsync2); err != nil {
		logger.Warnf("[generator] failed generating scene preview, trying fallback")
		if err := t.generator.PreviewVideo(ctx, videoFilename, videoDuration, videoChecksum, t.Options, vrModeStr, true, useVsync2); err != nil {
			return err
		}
	}

	return nil
}

func (t *GeneratePreviewTask) generateWebp(ctx context.Context, videoChecksum string) error {
	videoFilename := t.Scene.Path
	return t.generator.PreviewWebp(ctx, videoFilename, videoChecksum)
}

func (t *GeneratePreviewTask) required() bool {
	return t.videoPreviewRequired() || t.imagePreviewRequired()
}

func (t *GeneratePreviewTask) videoPreviewRequired() bool {
	if t.Scene.Path == "" {
		return false
	}

	if t.Overwrite {
		return true
	}

	sceneChecksum := t.Scene.GetHash(t.fileNamingAlgorithm)
	if sceneChecksum == "" {
		return false
	}

	if t.videoPreviewExists == nil {
		videoExists, _ := fsutil.FileExists(instance.Paths.Scene.GetVideoPreviewPath(sceneChecksum))
		t.videoPreviewExists = &videoExists
	}

	return !*t.videoPreviewExists
}

func (t *GeneratePreviewTask) imagePreviewRequired() bool {
	if !t.ImagePreview {
		return false
	}

	if t.Scene.Path == "" {
		return false
	}

	if t.Overwrite {
		return true
	}

	sceneChecksum := t.Scene.GetHash(t.fileNamingAlgorithm)
	if sceneChecksum == "" {
		return false
	}

	if t.imagePreviewExists == nil {
		imageExists, _ := fsutil.FileExists(instance.Paths.Scene.GetWebpPreviewPath(sceneChecksum))
		t.imagePreviewExists = &imageExists
	}

	return !*t.imagePreviewExists
}
