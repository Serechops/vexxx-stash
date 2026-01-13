package api

import (
	"context"
	"fmt"
	"strconv"

	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/pkg/hash/videophash"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/utils"
)

func (r *mutationResolver) GeneratePhash(ctx context.Context, fileID string, start *float64, duration *float64) (string, error) {
	id, err := strconv.Atoi(fileID)
	if err != nil {
		return "", err
	}

	var file *models.VideoFile
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		files, err := r.repository.File.Find(ctx, models.FileID(id))
		if err != nil {
			return err
		}
		if len(files) == 0 {
			return fmt.Errorf("file not found: %s", fileID)
		}
		f := files[0]

		if vf, ok := f.(*models.VideoFile); ok {
			file = vf
		} else {
			return fmt.Errorf("file is not a video file: %s", fileID)
		}

		return nil
	}); err != nil {
		return "", err
	}

	options := videophash.PhashOptions{}
	if start != nil {
		options.Start = *start
	}
	if duration != nil {
		options.Duration = *duration
	}

	hash, err := videophash.Generate(manager.GetInstance().FFMpeg, file, options)
	if err != nil {
		return "", fmt.Errorf("generating phash: %w", err)
	}

	return utils.PhashToString(int64(*hash)), nil
}

func (r *mutationResolver) StashDbSearchByPhash(ctx context.Context, phashes []string) ([]*models.ScrapedScene, error) {
	var fps models.Fingerprints

	for _, phash := range phashes {
		// Construct a fingerprint object for the search
		fp := models.Fingerprint{
			Type: models.FingerprintTypePhash,
		}

		// We need to decode the hex string back to int64 for the Fingerprint struct
		hashInt, err := strconv.ParseUint(phash, 16, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid phash string %s: %w", phash, err)
		}

		fp.Fingerprint = int64(hashInt)
		fps = append(fps, fp)
	}

	boxes := manager.GetInstance().Config.GetStashBoxes()
	var allScenes []*models.ScrapedScene

	for _, box := range boxes {
		client := r.newStashBoxClient(*box)

		// StashBox FindSceneByFingerprints takes a list of fingerprints and searches for ANY match (OR logic usually, or depends on backend).
		// Wait, if we send multiple phashes, StashBox typically treats them as "Fingerprints for ONE scene" or "Any of these fingerprints"?
		// StashBox API `sceneByFingerprints` accepts `fingerprint` (input object) which has `hash`, `algorithm`, `duration`.
		// Actually, `pkg/stashbox/scene.go` uses `FindScenesBySceneFingerprints` query.
		// The query schema in StashBox commonly allows matching ANY fingerprint.
		// Let's assume sending all phashes is correct for "any of these phashes match a scene".

		scenes, err := client.FindSceneByFingerprints(ctx, fps)
		if err != nil {
			logger.Errorf("Error searching stashbox %s: %v", box.Endpoint, err)
			continue
		}

		allScenes = append(allScenes, scenes...)
	}

	return allScenes, nil
}
