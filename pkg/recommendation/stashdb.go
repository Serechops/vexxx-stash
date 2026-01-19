package recommendation

import (
	"context"
	"fmt"
	"sort"

	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/stashbox/graphql"
)

func (e *Engine) DiscoverFromStashDB(ctx context.Context, profile *models.ContentProfile, limit int, tagW, perfW float64) ([]models.RecommendationResult, error) {
	if e.StashBoxClient == nil {
		return nil, fmt.Errorf("stashdb client not configured")
	}

	// 1. Get top tags with StashDB IDs (scaled by weight)
	tagLimit := int(20.0 * tagW)
	if tagLimit < 0 {
		tagLimit = 0
	}
	topTags, err := e.getTopTagsWithStashIDs(ctx, profile, tagLimit)
	if err != nil {
		return nil, err
	}

	// 2. Get top performers with StashDB IDs (scaled by weight)
	perfLimit := int(15.0 * perfW) // Allow up to 15 performers if heavily weighted
	if perfLimit < 0 {
		perfLimit = 0
	}
	topPerformers, err := e.getTopPerformersWithStashIDs(ctx, profile, perfLimit)
	if err != nil {
		return nil, err
	}

	if len(topTags) == 0 && len(topPerformers) == 0 {
		return []models.RecommendationResult{}, nil
	}

	// 3. Build StashDB query
	// Using generic CriterionModifierIncludes as typical default
	modifier := graphql.CriterionModifierIncludes

	query := graphql.SceneQueryInput{
		Page:      1,
		PerPage:   50, // Get enough candidates to filter
		Sort:      graphql.SceneSortEnumDate,
		Direction: graphql.SortDirectionEnumDesc,
	}

	if len(topTags) > 0 {
		query.Tags = &graphql.MultiIDCriterionInput{
			Value:    topTags,
			Modifier: modifier,
		}
	}

	if len(topPerformers) > 0 {
		query.Performers = &graphql.MultiIDCriterionInput{
			Value:    topPerformers,
			Modifier: modifier,
		}
	}

	// 4. Execute query
	results, err := e.StashBoxClient.QueryScenes(ctx, query)
	if err != nil {
		return nil, err
	}

	if results == nil || results.GetQueryScenes() == nil {
		return []models.RecommendationResult{}, nil
	}

	// 5. Filter and Score
	var recommendations []models.RecommendationResult

	// endpoint := e.StashBoxClient.GetEndpoint()
	seen := make(map[string]bool)

	for _, sceneFragment := range results.GetQueryScenes().Scenes {
		if sceneFragment.ID == "" {
			continue
		}

		if seen[sceneFragment.ID] {
			continue
		}

		// Check if we have this scene by StashID using SceneQuery
		// Use iterative check - typically fast enough for 50 items

		existingCount, err := e.SceneRepo.QueryCount(ctx, &models.SceneFilterType{
			StashID: &models.StringCriterionInput{
				Value:    sceneFragment.ID,
				Modifier: models.CriterionModifierEquals,
			},
		}, nil)

		if err == nil && existingCount > 0 {
			continue
		}

		// Mark as seen to prevent duplicates in this batch
		seen[sceneFragment.ID] = true

		title := ""
		if sceneFragment.Title != nil {
			title = *sceneFragment.Title
		}

		stashID := sceneFragment.ID
		stashIDPtr := &stashID

		// Calculate score (Base 0.3 + logic)
		score := 0.3

		// Boost for matching tags
		if len(topTags) > 0 && len(sceneFragment.Tags) > 0 {
			matches := 0
			for _, t := range sceneFragment.Tags {
				for _, topTag := range topTags {
					if t.ID == topTag {
						matches++
						break
					}
				}
			}
			score += (float64(matches) / 10.0) * tagW
		}

		// Boost for matching performers
		if len(topPerformers) > 0 && len(sceneFragment.Performers) > 0 {
			matches := 0
			for _, p := range sceneFragment.Performers {
				if p.Performer == nil {
					continue
				}
				for _, topPerf := range topPerformers {
					if p.Performer.ID == topPerf {
						matches++
						break
					}
				}
			}
			score += (float64(matches) / 3.0) * perfW
		}

		if score > 1.0 {
			score = 1.0
		}

		// Create scraped scene object for frontend display
		scrapedScene := &models.ScrapedScene{}

		if sceneFragment.Title != nil {
			scrapedScene.Title = sceneFragment.Title
		}
		if sceneFragment.Details != nil {
			scrapedScene.Details = sceneFragment.Details
		}
		if sceneFragment.Date != nil {
			scrapedScene.Date = sceneFragment.Date
		}

		// Map URLs
		if len(sceneFragment.Urls) > 0 {
			for _, u := range sceneFragment.Urls {
				if u != nil {
					scrapedScene.URLs = append(scrapedScene.URLs, u.URL)
				}
			}
		}

		// Map Image
		if len(sceneFragment.Images) > 0 {
			imgURL := sceneFragment.Images[0].URL
			scrapedScene.Image = &imgURL
		}

		// Map Studio
		if sceneFragment.Studio != nil {
			scrapedStudio := &models.ScrapedStudio{
				Name: sceneFragment.Studio.Name,
			}
			if len(sceneFragment.Studio.Images) > 0 {
				studioImg := sceneFragment.Studio.Images[0].URL
				scrapedStudio.Image = &studioImg
			}
			scrapedScene.Studio = scrapedStudio
		}

		rec := models.RecommendationResult{
			Type:         "stashdb_scene", // Distinct type
			ID:           stashID,         // Use UUID as cache key
			StashID:      stashIDPtr,
			Name:         title,
			Score:        score,
			Reason:       fmt.Sprintf("Recommended from StashDB (Score: %.2f)", score),
			StashDBScene: scrapedScene,
		}
		recommendations = append(recommendations, rec)
	}

	// Limit results
	if limit > 0 && len(recommendations) > limit {
		recommendations = recommendations[:limit]
	}

	return recommendations, nil
}

func (e *Engine) getTopTagsWithStashIDs(ctx context.Context, profile *models.ContentProfile, limit int) ([]string, error) {
	// Sort tags by weight
	type weighted struct {
		id int
		w  float64
	}
	var sorted []weighted

	for _, tw := range profile.TagWeights {
		sorted = append(sorted, weighted{tw.TagID, tw.Weight})
	}
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].w > sorted[j].w
	})

	var ret []string
	count := 0

	endpoint := e.StashBoxClient.GetEndpoint()

	for _, item := range sorted {
		if count >= limit {
			break
		}

		tag, err := e.TagRepo.Find(ctx, item.id)
		if err != nil || tag == nil {
			continue
		}

		if err := tag.LoadStashIDs(ctx, e.TagRepo); err != nil {
			continue
		}

		sid := tag.StashIDs.ForEndpoint(endpoint)
		if sid != nil {
			ret = append(ret, sid.StashID)
			count++
		}
	}
	return ret, nil
}

func (e *Engine) getTopPerformersWithStashIDs(ctx context.Context, profile *models.ContentProfile, limit int) ([]string, error) {
	// Sort performers by weight
	type weighted struct {
		id int
		w  float64
	}
	var sorted []weighted

	for _, pw := range profile.PerformerWeights {
		sorted = append(sorted, weighted{pw.PerformerID, pw.Weight})
	}
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].w > sorted[j].w
	})

	var ret []string
	count := 0

	endpoint := e.StashBoxClient.GetEndpoint()

	for _, item := range sorted {
		if count >= limit {
			break
		}

		performer, err := e.PerformerRepo.Find(ctx, item.id)
		if err != nil || performer == nil {
			continue
		}

		if err := performer.LoadStashIDs(ctx, e.PerformerRepo); err != nil {
			continue
		}

		sid := performer.StashIDs.ForEndpoint(endpoint)
		if sid != nil {
			ret = append(ret, sid.StashID)
			count++
		}
	}
	return ret, nil
}
