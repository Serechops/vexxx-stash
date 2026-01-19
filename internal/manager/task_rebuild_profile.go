package manager

import (
	"context"
	"fmt"
	"time"

	"github.com/stashapp/stash/pkg/job"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/recommendation"
)

type RebuildContentProfileJob struct {
	Repository models.Repository
}

func (j *RebuildContentProfileJob) Execute(ctx context.Context, progress *job.Progress) error {
	logger.Info("Starting content profile rebuild")
	progress.SetTotal(100)

	start := time.Now()

	// Initialize builder
	builder := recommendation.NewProfileBuilder(
		j.Repository.Scene,
		j.Repository.Performer,
		j.Repository.Tag,
		j.Repository.Studio,
	)

	// Step 1: Calculate profile (90%)
	// Currently BuildUserProfile does everything in one go.
	// For better progress reporting, we might want to split it up in the builder,
	// but for now we'll just wrap the whole thing.
	progress.ExecuteTask("Calculating preferences", func() {
		// This is the heavy lifting
	})

	// We can't really report progress nicely unless we modify the builder to accept a callback
	// or split the text.
	// Let's just run it.

	data, err := builder.BuildUserProfile(ctx)
	if err != nil {
		return fmt.Errorf("error building profile: %w", err)
	}
	progress.SetPercent(0.9) // Jump to 90%

	if job.IsCancelled(ctx) {
		return nil
	}

	// Step 2: Save to DB (10%)
	progress.ExecuteTask("Saving profile", func() {
		// Force ID 1
		profileID := 1

		// Convert maps to slices (duplicating logic from resolver - maybe explicitly depend on resolver helpers? No, cyclic dependency potential)
		// We'll reimplement or (better) move helpers to a shared utility or method on ProfileData?
		// For now, inline.

		profile := &models.ContentProfile{
			ID:               profileID,
			ProfileType:      "user",
			TagWeights:       make([]models.TagWeight, 0, len(data.TagWeights)),
			PerformerWeights: make([]models.PerformerWeight, 0, len(data.PerformerWeights)),
			StudioWeights:    make([]models.StudioWeight, 0, len(data.StudioWeights)),
			AttributeWeights: make([]models.AttributeWeight, 0), // Count is complex
		}

		for id, w := range data.TagWeights {
			profile.TagWeights = append(profile.TagWeights, models.TagWeight{ProfileID: profileID, TagID: id, Weight: w})
		}
		for id, w := range data.PerformerWeights {
			profile.PerformerWeights = append(profile.PerformerWeights, models.PerformerWeight{ProfileID: profileID, PerformerID: id, Weight: w})
		}
		for id, w := range data.StudioWeights {
			profile.StudioWeights = append(profile.StudioWeights, models.StudioWeight{ProfileID: profileID, StudioID: id, Weight: w})
		}
		for name, valMap := range data.AttributeWeights {
			for val, w := range valMap {
				profile.AttributeWeights = append(profile.AttributeWeights, models.AttributeWeight{
					ProfileID:      profileID,
					AttributeName:  name,
					AttributeValue: val,
					Weight:         w,
				})
			}
		}

		store := j.Repository.ContentProfile

		// Create or Update
		existing, _ := store.Find(ctx, profileID)
		if existing != nil {
			profile.CreatedAt = existing.CreatedAt
			if err := store.Update(ctx, profile); err != nil {
				logger.Errorf("error updating profile: %v", err)
				return
			}
		} else {
			if err := store.Create(ctx, profile); err != nil {
				logger.Errorf("error creating profile: %v", err)
				return
			}
		}

		if err := store.SaveWeights(ctx, profile); err != nil {
			logger.Errorf("error saving weights: %v", err)
			return
		}
	})

	progress.SetPercent(1.0)
	logger.Infof("Finished rebuilding content profile in %s", time.Since(start))

	return nil
}

func (j *RebuildContentProfileJob) GetDescription() string {
	return "Rebuild Content Profile"
}
