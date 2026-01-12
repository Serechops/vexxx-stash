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

type ScrapeStudioScenesTask struct {
	StashBoxEndpoint string
	StudioStashID    string
}

func (t *ScrapeStudioScenesTask) Execute(ctx context.Context, progress *job.Progress) error {
	// 1. Resolve StashBox client
	box, err := t.resolveStashBox()
	if err != nil {
		logger.Errorf("ScrapeStudioScenesTask: %v", err)
		return err
	}

	client := stashbox.NewClient(*box, stashbox.ExcludeTagPatterns(instance.Config.GetScraperExcludeTagPatterns()))

	// 2. Fetch scenes (paginated)
	logger.Infof("ScrapeStudioScenesTask: fetching scenes for studio %s from %s", t.StudioStashID, t.StashBoxEndpoint)
	scrapedStudio, err := client.FindStudioByID(ctx, t.StudioStashID)
	if err != nil {
		logger.Errorf("ScrapeStudioScenesTask: error fetching studio %s: %v", t.StudioStashID, err)
		return err
	}

	if scrapedStudio == nil || len(scrapedStudio.Scenes) == 0 {
		logger.Infof("ScrapeStudioScenesTask: no scenes found for %s", t.StudioStashID)
		return nil
	}

	// 3. Save to PotentialScenes
	r := instance.Repository
	count := 0

	err = r.WithTxn(ctx, func(ctx context.Context) error {
		qb := r.PotentialScene

		for _, scene := range scrapedStudio.Scenes {
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
		logger.Errorf("ScrapeStudioScenesTask: transaction error: %v", err)
		return err
	} else {
		logger.Infof("ScrapeStudioScenesTask: Imported %d potential scenes for studio %s", count, t.StudioStashID)
	}

	return nil
}

func (t *ScrapeStudioScenesTask) GetDescription() string {
	return fmt.Sprintf("Scraping scenes for studio %s from %s", t.StudioStashID, t.StashBoxEndpoint)
}

func (t *ScrapeStudioScenesTask) resolveStashBox() (*models.StashBox, error) {
	for _, box := range instance.Config.GetStashBoxes() {
		if box.Endpoint == t.StashBoxEndpoint {
			return box, nil
		}
	}
	return nil, fmt.Errorf("stash box with endpoint %s not found", t.StashBoxEndpoint)
}
