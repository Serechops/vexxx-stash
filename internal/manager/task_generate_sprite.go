package manager

import (
	"context"
	"fmt"

	"github.com/stashapp/stash/pkg/fsutil"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
)

type GenerateSpriteTask struct {
	Scene               models.Scene
	Overwrite           bool
	fileNamingAlgorithm models.HashAlgorithm
}

func (t *GenerateSpriteTask) GetDescription() string {
	return fmt.Sprintf("Generating sprites for %s", t.Scene.Path)
}

func (t *GenerateSpriteTask) Start(ctx context.Context) {
	if !t.required() {
		return
	}

	ffprobe := instance.FFProbe
	videoFile, err := ffprobe.NewVideoFile(t.Scene.Path)
	if err != nil {
		logger.Errorf("error reading video file: %s", err.Error())
		return
	}

	sceneHash := t.Scene.GetHash(t.fileNamingAlgorithm)
	imagePath := instance.Paths.Scene.GetSpriteImageFilePath(sceneHash)
	vttPath := instance.Paths.Scene.GetSpriteVttFilePath(sceneHash)
	generator, err := NewSpriteGenerator(*videoFile, sceneHash, imagePath, vttPath, 9, 9)

	if err != nil {
		logger.Errorf("error creating sprite generator: %s", err.Error())
		return
	}
	generator.Overwrite = t.Overwrite

	logger.Infof("GenerateSpriteTask for Scene %d. Start: %v, End: %v", t.Scene.ID, t.Scene.StartPoint, t.Scene.EndPoint)

	if t.Scene.StartPoint != nil && t.Scene.EndPoint != nil && *t.Scene.EndPoint > *t.Scene.StartPoint {
		generator.StartOffset = *t.Scene.StartPoint
		generator.Duration = *t.Scene.EndPoint - *t.Scene.StartPoint
		logger.Infof("Setting sprite generator offset: %f, duration: %f", generator.StartOffset, generator.Duration)
	}

	if err := generator.Generate(); err != nil {
		logger.Errorf("error generating sprite: %s", err.Error())
		logErrorOutput(err)
		return
	}
}

// required returns true if the sprite needs to be generated
func (t GenerateSpriteTask) required() bool {
	if t.Scene.Path == "" {
		return false
	}

	if t.Overwrite {
		return true
	}

	sceneHash := t.Scene.GetHash(t.fileNamingAlgorithm)
	return !t.doesSpriteExist(sceneHash)
}

func (t *GenerateSpriteTask) doesSpriteExist(sceneChecksum string) bool {
	if sceneChecksum == "" {
		return false
	}

	imagePath := instance.Paths.Scene.GetSpriteImageFilePath(sceneChecksum)
	vttPath := instance.Paths.Scene.GetSpriteVttFilePath(sceneChecksum)

	imageExists, _ := fsutil.FileExists(imagePath)
	vttExists, _ := fsutil.FileExists(vttPath)

	return imageExists && vttExists
}
