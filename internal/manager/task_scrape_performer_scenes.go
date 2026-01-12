package manager

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/stashapp/stash/pkg/job"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/stashbox"
)

type ScrapePerformerScenesTask struct {
	StashBoxEndpoint string
	PerformerStashID string
}

func (t *ScrapePerformerScenesTask) Execute(ctx context.Context, progress *job.Progress) error {
	// 1. Resolve StashBox client
	box, err := t.resolveStashBox()
	if err != nil {
		logger.Errorf("ScrapePerformerScenesTask: %v", err)
		return err
	}

	client := stashbox.NewClient(*box, stashbox.ExcludeTagPatterns(instance.Config.GetScraperExcludeTagPatterns()))

	// 2. Fetch scenes (paginated)
	logger.Infof("ScrapePerformerScenesTask: fetching scenes for performer %s from %s", t.PerformerStashID, t.StashBoxEndpoint)
	scrapedPerformer, err := client.FindPerformerByID(ctx, t.PerformerStashID)
	if err != nil {
		logger.Errorf("ScrapePerformerScenesTask: error fetching performer %s: %v", t.PerformerStashID, err)
		return err
	}

	if scrapedPerformer == nil || len(scrapedPerformer.Scenes) == 0 {
		logger.Infof("ScrapePerformerScenesTask: no scenes found for %s", t.PerformerStashID)
		return nil
	}

	// 3. Save to PotentialScenes
	r := instance.Repository
	count := 0

	err = r.WithTxn(ctx, func(ctx context.Context) error {
		qb := r.PotentialScene

		for _, scene := range scrapedPerformer.Scenes {
			if scene.RemoteSiteID == nil {
				continue
			}

			// Check existence to avoid duplicate work (though Create handles insertion, we might want to update or skip)
			existing, _ := qb.FindByStashID(ctx, *scene.RemoteSiteID)
			if existing != nil {
				continue
			}

			data, err := json.Marshal(scene)
			if err != nil {
				logger.Errorf("Failed to marshal scene data: %v", err)
				continue
			}

			newScene := models.PotentialScene{
				StashID:   *scene.RemoteSiteID,
				Data:      string(data),
				CreatedAt: time.Now(),
			}

			if _, err := qb.Create(ctx, newScene); err != nil {
				logger.Errorf("Failed to create potential scene: %v", err)
			} else {
				count++
			}
		}
		return nil
	})

	if err != nil {
		logger.Errorf("ScrapePerformerScenesTask: transaction error: %v", err)
		return err
	} else {
		logger.Infof("ScrapePerformerScenesTask: Imported %d potential scenes for performer %s", count, t.PerformerStashID)
	}

	return nil
}

func (t *ScrapePerformerScenesTask) GetDescription() string {
	return fmt.Sprintf("Scraping scenes for performer %s from %s", t.PerformerStashID, t.StashBoxEndpoint)
}

func (t *ScrapePerformerScenesTask) resolveStashBox() (*models.StashBox, error) {
	for _, box := range instance.Config.GetStashBoxes() {
		if box.Endpoint == t.StashBoxEndpoint {
			return box, nil
		}
	}
	return nil, fmt.Errorf("stash box with endpoint %s not found", t.StashBoxEndpoint)
}
