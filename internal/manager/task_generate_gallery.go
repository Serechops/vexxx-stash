package manager

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/scene/generate"
	"github.com/stashapp/stash/pkg/utils"
)

type GenerateGalleryTask struct {
	repository models.Repository
	Scene      models.Scene
	Overwrite  bool
	ImageCount int

	generator *generate.Generator
}

func (t *GenerateGalleryTask) GetDescription() string {
	return fmt.Sprintf("Generating gallery for scene #%d", t.Scene.ID)
}

func (t *GenerateGalleryTask) Start(ctx context.Context) {
	if !t.required(ctx) {
		return
	}

	logger.Debugf("Generating gallery for scene %d", t.Scene.ID)

	// Defaults
	imageCount := t.ImageCount
	if imageCount <= 0 {
		imageCount = 20 // Default count
	}

	// Determine Output Directory
	sceneDir := filepath.Dir(t.Scene.Path)
	title := t.Scene.Title
	if title == "" {
		title = strconv.Itoa(t.Scene.ID)
	}

	// Sanitize
	replacer := strings.NewReplacer(
		"<", "", ">", "", ":", "", "\"", "", "/", "", "\\", "", "|", "", "?", "", "*", "",
	)
	cleanTitle := replacer.Replace(title)
	cleanTitle = strings.TrimSpace(cleanTitle)

	galleryName := fmt.Sprintf("%s Gallery", cleanTitle)

	// Append timestamp to zip name for uniqueness
	timestamp := time.Now().Format("20060102-150405")
	zipBasename := fmt.Sprintf("%s_%s.zip", galleryName, timestamp)

	// Create zip path and temp directory
	zipPath := filepath.Join(sceneDir, zipBasename)
	// Temp dir can just be unique
	tempDir := filepath.Join(sceneDir, fmt.Sprintf("%s_%s_temp", galleryName, timestamp))

	// Generate Timestamps
	files := t.Scene.Files.List()
	if len(files) == 0 {
		logger.Warnf("Scene %d has no files, skipping gallery generation", t.Scene.ID)
		return
	}
	file := files[0]
	duration := file.Duration
	if duration <= 0 {
		logger.Warnf("Scene %d has no duration, skipping gallery generation", t.Scene.ID)
		return
	}

	timestamps := make([]float64, imageCount)
	step := duration / float64(imageCount+1)
	for i := 0; i < imageCount; i++ {
		timestamps[i] = step * float64(i+1)
	}

	if t.generator == nil {
		t.generator = &generate.Generator{
			Encoder:      instance.FFMpeg,
			FFMpegConfig: instance.Config,
			LockManager:  instance.ReadLockManager,
			ScenePaths:   instance.Paths.Scene,
			Overwrite:    t.Overwrite,
		}
	}

	// Run Generation to Temp Dir (Pass cleanTitle + timestamp as prefix)
	imagePrefix := fmt.Sprintf("%s_%s", cleanTitle, timestamp)
	_, err := t.generator.GalleryImages(ctx, t.Scene.Path, timestamps, tempDir, imagePrefix)
	if err != nil {
		logger.Errorf("Failed to generate gallery images for scene %d: %v", t.Scene.ID, err)
		os.RemoveAll(tempDir) // clean up on failure
		return
	}

	// Zip contents
	if err := utils.Zip(tempDir, zipPath); err != nil {
		logger.Errorf("Failed to zip gallery for scene %d: %v", t.Scene.ID, err)
		os.RemoveAll(tempDir)
		return
	}

	// Clean up temp dir
	os.RemoveAll(tempDir)

	// Create Gallery Entity
	newGallery := models.NewGallery()
	newGallery.Title = galleryName
	newGallery.Path = zipPath
	// Organized = false by default on NewGallery? usually empty/false.

	now := time.Now()
	newGallery.Date = &models.Date{Time: now, Precision: models.DatePrecisionDay}
	newGallery.SceneIDs = models.NewRelatedIDs([]int{t.Scene.ID})

	// Transaction to create
	err = t.repository.WithTxn(ctx, func(ctx context.Context) error {
		return t.repository.Gallery.Create(ctx, &newGallery, nil)
	})

	if err != nil {
		logger.Errorf("Failed to create gallery entity for scene %d: %v", t.Scene.ID, err)
		return
	}

	// Trigger Scan for this gallery to populate images
	instance.Scan(ctx, ScanMetadataInput{
		Paths: []string{zipPath},
	})
}

func (t *GenerateGalleryTask) required(_ context.Context) bool {
	// Basic check: always true if requested via generate task logic
	return true
}
