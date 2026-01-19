package recommendation

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/stashapp/stash/pkg/logger"
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

		// Map Performers
		if len(sceneFragment.Performers) > 0 {
			for _, p := range sceneFragment.Performers {
				if p.Performer == nil {
					continue
				}

				// Map Performer
				name := p.Performer.Name
				var gender *string
				if p.Performer.Gender != nil {
					g := p.Performer.Gender.String()
					gender = &g
				}

				scrapedPerf := &models.ScrapedPerformer{
					Name:   &name,
					Gender: gender,
				}
				if len(p.Performer.Images) > 0 {
					img := p.Performer.Images[0].URL
					scrapedPerf.Images = []string{img}
				}
				scrapedScene.Performers = append(scrapedScene.Performers, scrapedPerf)
			}
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

func (e *Engine) DiscoverPerformersFromStashDB(ctx context.Context, profile *models.ContentProfile, limit int) ([]models.RecommendationResult, error) {
	if e.StashBoxClient == nil {
		return nil, fmt.Errorf("stashdb client not configured")
	}

	logger.Infof("Starting DiscoverPerformersFromStashDB")

	// 1. Get Top Local Performers
	// We use the traits of your favorite performers to find similar ones
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

	// Limit to top 5
	if len(sorted) > 5 {
		sorted = sorted[:5]
	}

	logger.Infof("Found %d top local performers to use as seeds", len(sorted))

	var recommendations []models.RecommendationResult
	seen := make(map[string]bool)

	// Helper to build criteria from a local performer
	buildQuery := func(p *models.Performer) *graphql.PerformerQueryInput {
		q := &graphql.PerformerQueryInput{
			Page:      1,
			PerPage:   5, // Fetch small batch per performer
			Sort:      graphql.PerformerSortEnumSceneCount,
			Direction: graphql.SortDirectionEnumDesc,
		}

		validCriteria := 0

		if p.Gender != nil {
			g := graphql.GenderFilterEnum(p.Gender.String())
			q.Gender = &g
			validCriteria++
		}

		if p.HairColor != "" {
			if val, ok := mapHairColor(p.HairColor); ok {
				q.HairColor = &graphql.HairColorCriterionInput{
					Value:    &val,
					Modifier: graphql.CriterionModifierEquals,
				}
				validCriteria++
			}
		}

		if p.EyeColor != "" {
			if val, ok := mapEyeColor(p.EyeColor); ok {
				q.EyeColor = &graphql.EyeColorCriterionInput{
					Value:    &val,
					Modifier: graphql.CriterionModifierEquals,
				}
				validCriteria++
			}
		}

		if p.Ethnicity != "" {
			if val, ok := mapEthnicity(p.Ethnicity); ok {
				q.Ethnicity = &val
				validCriteria++
			}
		}

		if p.Country != "" {
			val := p.Country
			// INCLUDES is safer than EQUALS for country
			q.Country = &graphql.StringCriterionInput{
				Value:    val,
				Modifier: graphql.CriterionModifierIncludes,
			}
			validCriteria++
		}

		if p.Birthdate != nil {
			// Calculate Age
			currentYear := time.Now().Year()
			age := currentYear - p.Birthdate.Year()
			if age >= 18 {
				// Search for similar age range (+/- 3 years)
				// Or use simple buckets like user requested: < 25, etc.
				// Let's use loose range to find peers

				// Wait, the user successfully used buckets in their example query:
				// age: { value: 25, modifier: LESS_THAN }
				// Let's replicate strict bucketing if possible, or just exact age +/- deviation?
				// User's example: age: 22 matches < 25.

				// Let's bucket them to broad categories
				val := 0
				var mod graphql.CriterionModifier

				switch {
				case age < 25:
					val = 25
					mod = graphql.CriterionModifierLessThan
				case age < 35:
					val = 35
					mod = graphql.CriterionModifierLessThan
				case age < 45:
					val = 45
					mod = graphql.CriterionModifierLessThan
				default:
					val = 45
					mod = graphql.CriterionModifierGreaterThan
				}

				q.Age = &graphql.IntCriterionInput{
					Value:    val,
					Modifier: mod,
				}
				validCriteria++
			}
		}

		if validCriteria < 2 {
			return nil // Not enough info to build a meaningful query
		}
		return q
	}

	for _, item := range sorted {
		if len(recommendations) >= limit {
			break
		}

		perf, err := e.PerformerRepo.Find(ctx, item.id)
		if err != nil || perf == nil {
			continue
		}

		query := buildQuery(perf)
		if query == nil {
			continue
		}

		results, err := e.StashBoxClient.QueryPerformersByInput(ctx, *query)
		if err != nil {
			continue
		}

		for _, p := range results {
			if p.RemoteSiteID == nil || *p.RemoteSiteID == "" {
				continue
			}
			stashID := *p.RemoteSiteID

			if seen[stashID] {
				continue
			}

			// Dedupe Local check
			count, _ := e.PerformerRepo.QueryCount(ctx, &models.PerformerFilterType{
				StashID: &models.StringCriterionInput{
					Value:    stashID,
					Modifier: models.CriterionModifierEquals,
				},
			}, nil)
			if count > 0 {
				continue
			}

			seen[stashID] = true

			// Calculate Similarity Score
			simScore := 0.0
			criteriaCount := 0

			// 1. Gender (Fundamental)
			if perf.Gender != nil && p.Gender != nil && string(*perf.Gender) == string(*p.Gender) {
				simScore += 1.0 // Basic gatekeeper
				criteriaCount++
			} else if perf.Gender != nil {
				criteriaCount++
			}

			// 2. Ethnicity (High importance)
			if perf.Ethnicity != "" && p.Ethnicity != nil {
				// Simple string check, ideally map to ENUM but strings often differ slightly
				// "caucasian" vs "white", etc. But here we rely on StashDB returning consistent enums if possible
				if perf.Ethnicity == *p.Ethnicity {
					simScore += 1.0
				}
				criteriaCount++
			} else if perf.Ethnicity != "" {
				criteriaCount++
			}

			// 3. Country (Medium importance)
			if perf.Country != "" && p.Country != nil {
				if perf.Country == *p.Country {
					simScore += 1.0
				}
				criteriaCount++
			} else if perf.Country != "" {
				criteriaCount++
			}

			// 4. Hair Color
			if perf.HairColor != "" && p.HairColor != nil {
				if perf.HairColor == *p.HairColor {
					simScore += 1.0
				}
				criteriaCount++
			} else if perf.HairColor != "" {
				criteriaCount++
			}

			// 5. Eye Color
			if perf.EyeColor != "" && p.EyeColor != nil {
				if perf.EyeColor == *p.EyeColor {
					simScore += 1.0
				}
				criteriaCount++
			} else if perf.EyeColor != "" {
				criteriaCount++
			}

			// 6. Age (Approximate)
			if perf.Birthdate != nil && p.Birthdate != nil {
				// Parse StashDB date (YYYY-MM-DD or YYYY)
				localYear := perf.Birthdate.Year()
				remoteYear, _ := time.Parse("2006-01-02", *p.Birthdate) // Try full date
				if remoteYear.IsZero() {
					remoteYear, _ = time.Parse("2006", *p.Birthdate) // Try year only
				}

				if !remoteYear.IsZero() {
					diff := localYear - remoteYear.Year()
					if diff < 0 {
						diff = -diff
					}

					if diff <= 3 {
						simScore += 1.0
					} else if diff <= 5 {
						simScore += 0.5
					}
					criteriaCount++
				}
			} else if perf.Birthdate != nil {
				criteriaCount++
			}

			// Normalize Similarity Score (0.0 - 1.0)
			finalSim := 0.0
			if criteriaCount > 0 {
				finalSim = simScore / float64(criteriaCount)
			}

			// Weighted Score: 60% Similarity, 40% Seed Weight
			score := (finalSim * 0.7) + (item.w * 0.3)
			if score > 0.99 {
				score = 0.99
			} // Cap slightly below 1

			var name string
			if p.Name != nil {
				name = *p.Name
			}

			rec := models.RecommendationResult{
				Type:             "stashdb_performer",
				ID:               stashID,
				StashID:          &stashID,
				Name:             name,
				Score:            score,
				Reason:           fmt.Sprintf("Similar to %s (%.0f%% match)", perf.Name, finalSim*100),
				StashDBPerformer: p,
			}
			recommendations = append(recommendations, rec)

			if len(recommendations) >= limit {
				break
			}
		}
	}

	logger.Infof("Total unique recommendations found: %d", len(recommendations))

	return recommendations, nil
}

// Helpers to map strings to Enums
func mapHairColor(s string) (graphql.HairColorEnum, bool) {
	switch s {
	case "Blonde", "Blond":
		return graphql.HairColorEnumBlonde, true
	case "Brunette", "Brown":
		return graphql.HairColorEnumBrunette, true
	case "Black":
		return graphql.HairColorEnumBlack, true
	case "Red":
		return graphql.HairColorEnumRed, true
	case "Auburn":
		return graphql.HairColorEnumAuburn, true
	case "Grey", "Gray":
		return graphql.HairColorEnumGrey, true
	case "Bald":
		return graphql.HairColorEnumBald, true
	case "White":
		return graphql.HairColorEnumWhite, true
	}
	return "", false
}

func mapEyeColor(s string) (graphql.EyeColorEnum, bool) {
	switch s {
	case "Blue":
		return graphql.EyeColorEnumBlue, true
	case "Brown":
		return graphql.EyeColorEnumBrown, true
	case "Green":
		return graphql.EyeColorEnumGreen, true
	case "Hazel":
		return graphql.EyeColorEnumHazel, true
	case "Grey", "Gray":
		return graphql.EyeColorEnumGrey, true
	case "Red":
		return graphql.EyeColorEnumRed, true
	}
	return "", false
}

func mapEthnicity(s string) (graphql.EthnicityFilterEnum, bool) {
	switch s {
	case "white", "caucasian":
		return graphql.EthnicityFilterEnumCaucasian, true
	case "black", "african american":
		return graphql.EthnicityFilterEnumBlack, true
	case "asian":
		return graphql.EthnicityFilterEnumAsian, true
	case "hispanic", "latin", "latino", "latina":
		return graphql.EthnicityFilterEnumLatin, true
	case "middle eastern":
		return graphql.EthnicityFilterEnumMiddleEastern, true
	case "mixed":
		return graphql.EthnicityFilterEnumMixed, true
	case "indian":
		return graphql.EthnicityFilterEnumIndian, true
	case "other":
		return graphql.EthnicityFilterEnumOther, true
	}
	return "", false
}
