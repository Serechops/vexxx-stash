package recommendation

import (
	"context"
	"fmt"
	"sort"
	"strconv"
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

func (e *Engine) DiscoverPerformersFromStashDB(ctx context.Context, profile *models.ContentProfile, limit int, tagW, perfW float64) ([]models.RecommendationResult, error) {
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

	var candidates []models.RecommendationResult
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

		// Force Strictly Female Recommendations
		g := graphql.GenderFilterEnumFemale
		q.Gender = &g
		validCriteria++

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

	// Branch: If Performer Weight is 0 or low, assume "Visual Match" mode (Lookalikes)
	// If Performer Weight is high (normal), assume "Weighted" mode (Tag Match via Scenes)
	// We use 0.1 as a threshold.
	if perfW <= 0.1 {
		// VISUAL MATCH LOGIC
		// Strategy:
		// 1. Iterate through Top 5 local performers (Seeds).
		// 2. For each seed, query StashDB for lookalikes (Hair, Eye, Ethnicity, etc.).
		// 3. Collect up to 5 best matches per seed.
		// 4. Compile all candidates, sort by score, and return top N.

		for _, item := range sorted {
			// Stop if we have gathered enough candidates to sort (e.g. 3x limit) to preserve diversity
			if len(candidates) >= limit*2 {
				break
			}

			seedPerf, err := e.PerformerRepo.Find(ctx, item.id)
			if err != nil || seedPerf == nil {
				continue
			}

			perfQuery := buildQuery(seedPerf)
			if perfQuery == nil {
				continue
			}

			results, err := e.StashBoxClient.QueryPerformersByInput(ctx, *perfQuery)
			if err != nil {
				continue
			}

			seedMatches := 0
			for _, p := range results {
				// Enforce "Top 5 results from EACH performer"
				if seedMatches >= 5 {
					break
				}

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

				// 1. Gender
				if seedPerf.Gender != nil && p.Gender != nil && string(*seedPerf.Gender) == string(*p.Gender) {
					simScore += 1.0
					criteriaCount++
				} else if seedPerf.Gender != nil {
					criteriaCount++
				}

				// 2. Ethnicity
				if seedPerf.Ethnicity != "" && p.Ethnicity != nil {
					if seedPerf.Ethnicity == *p.Ethnicity {
						simScore += 1.0
					}
					criteriaCount++
				} else if seedPerf.Ethnicity != "" {
					criteriaCount++
				}

				// 3. Country
				if seedPerf.Country != "" && p.Country != nil {
					if seedPerf.Country == *p.Country {
						simScore += 1.0
					}
					criteriaCount++
				} else if seedPerf.Country != "" {
					criteriaCount++
				}

				// 4. Hair Color
				if seedPerf.HairColor != "" && p.HairColor != nil {
					if seedPerf.HairColor == *p.HairColor {
						simScore += 1.0
					}
					criteriaCount++
				} else if seedPerf.HairColor != "" {
					criteriaCount++
				}

				// 5. Eye Color
				if seedPerf.EyeColor != "" && p.EyeColor != nil {
					if seedPerf.EyeColor == *p.EyeColor {
						simScore += 1.0
					}
					criteriaCount++
				} else if seedPerf.EyeColor != "" {
					criteriaCount++
				}

				// 6. Age
				if seedPerf.Birthdate != nil && p.Birthdate != nil {
					localYear := seedPerf.Birthdate.Year()
					remoteYear, _ := time.Parse("2006-01-02", *p.Birthdate)
					if remoteYear.IsZero() {
						remoteYear, _ = time.Parse("2006", *p.Birthdate)
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
				} else if seedPerf.Birthdate != nil {
					criteriaCount++
				}

				// 7. Height (Range Check)
				if seedPerf.Height != nil && p.Height != nil {
					// StashDB returns Height as string (e.g. "165")
					remoteHeight, err := strconv.Atoi(*p.Height)
					if err == nil && remoteHeight > 0 {
						hDiff := *seedPerf.Height - remoteHeight
						if hDiff < 0 {
							hDiff = -hDiff
						}

						if hDiff <= 5 { // Within 5cm
							simScore += 1.0
						} else if hDiff <= 10 { // Within 10cm
							simScore += 0.5
						}
						criteriaCount++
					}
				} else if seedPerf.Height != nil {
					criteriaCount++
				}

				// Normalize Similarity Score
				finalSim := 0.0
				if criteriaCount > 0 {
					finalSim = simScore / float64(criteriaCount)
				}

				// Weighted Score: 70% Similarity, 30% Seed Weight
				score := (finalSim * 0.7) + (item.w * 0.3)
				if score > 0.99 {
					score = 0.99
				}

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
					Reason:           fmt.Sprintf("Visual match to %s (%.0f%%)", seedPerf.Name, finalSim*100),
					StashDBPerformer: p,
				}
				candidates = append(candidates, rec)
				seedMatches++
			}
		}
	} else {
		// WEIGHTED DISCOVERY LOGIC (Tag-based Matching via Scenes)
		// 1. Get Top Tags
		tagLimit := int(10.0 * tagW)
		if tagLimit < 1 {
			tagLimit = 1
		}
		topTags, _ := e.getTopTagsWithStashIDs(ctx, profile, tagLimit)

		if len(topTags) > 0 {
			// 2. Query StashDB for Scenes matching these tags
			sceneQueryInput := graphql.SceneQueryInput{
				Page:      1,
				PerPage:   50, // Higher per_page to collect variety of performers
				Sort:      graphql.SceneSortEnumTrending,
				Direction: graphql.SortDirectionEnumDesc,
				Tags: &graphql.MultiIDCriterionInput{
					Value:    topTags,
					Modifier: graphql.CriterionModifierIncludes,
				},
			}

			results, err := e.StashBoxClient.QueryScenes(ctx, sceneQueryInput)
			if err == nil && results != nil && results.GetQueryScenes() != nil {
				// 3. Extract Performers from Scenes
				perfFreq := make(map[string]int)
				perfData := make(map[string]*graphql.PerformerFragment)

				for _, s := range results.GetQueryScenes().Scenes {
					for _, pa := range s.Performers {
						if pa.Performer == nil || pa.Performer.ID == "" {
							continue
						}
						// Strictly Female Filter
						if pa.Performer.Gender == nil || *pa.Performer.Gender != graphql.GenderEnumFemale {
							continue
						}
						id := pa.Performer.ID
						perfFreq[id]++
						perfData[id] = pa.Performer
					}
				}

				// 4. Convert Frequencies to Recommendations
				for id, freq := range perfFreq {
					if seen[id] {
						continue
					}

					// Dedupe Local
					count, _ := e.PerformerRepo.QueryCount(ctx, &models.PerformerFilterType{
						StashID: &models.StringCriterionInput{
							Value:    id,
							Modifier: models.CriterionModifierEquals,
						},
					}, nil)
					if count > 0 {
						continue
					}

					seen[id] = true
					p := perfData[id]

					score := 0.4 + (float64(freq) / 10.0)
					if score > 0.99 {
						score = 0.99
					}

					name := p.Name
					rec := models.RecommendationResult{
						Type:             "stashdb_performer",
						ID:               id,
						StashID:          &id,
						Name:             name,
						Score:            score,
						Reason:           "Recommended based on your preferred tags",
						StashDBPerformer: mapStashDBPerformerFromFragment(p),
					}
					candidates = append(candidates, rec)
				}
			}
		}
	}

	// Sort compiled candidates by Score desc
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Score > candidates[j].Score
	})

	// Apply Limit
	var recommendations []models.RecommendationResult
	if len(candidates) > limit {
		recommendations = candidates[:limit]
	} else {
		recommendations = candidates
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

func mapStashDBPerformerFromFragment(p *graphql.PerformerFragment) *models.ScrapedPerformer {
	if p == nil {
		return nil
	}
	name := p.Name
	var gender *string
	if p.Gender != nil {
		g := string(*p.Gender)
		gender = &g
	}

	ret := &models.ScrapedPerformer{
		Name:    &name,
		Gender:  gender,
		Country: p.Country,
	}

	if len(p.Images) > 0 {
		for _, img := range p.Images {
			ret.Images = append(ret.Images, img.URL)
		}
	}

	return ret
}
