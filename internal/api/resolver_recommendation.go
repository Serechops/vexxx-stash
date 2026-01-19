package api

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/recommendation"
	"github.com/stashapp/stash/pkg/stashbox"
)

// --- Helper Functions ---

func toTagWeightMap(slice []models.TagWeight) map[int]float64 {
	ret := make(map[int]float64)
	for _, item := range slice {
		ret[item.TagID] = item.Weight
	}
	return ret
}

func toPerformerWeightMap(slice []models.PerformerWeight) map[int]float64 {
	ret := make(map[int]float64)
	for _, item := range slice {
		ret[item.PerformerID] = item.Weight
	}
	return ret
}

func toStudioWeightMap(slice []models.StudioWeight) map[int]float64 {
	ret := make(map[int]float64)
	for _, item := range slice {
		ret[item.StudioID] = item.Weight
	}
	return ret
}

func toAttributeWeightMap(slice []models.AttributeWeight) map[string]map[string]float64 {
	ret := make(map[string]map[string]float64)
	for _, item := range slice {
		if _, ok := ret[item.AttributeName]; !ok {
			ret[item.AttributeName] = make(map[string]float64)
		}
		ret[item.AttributeName][item.AttributeValue] = item.Weight
	}
	return ret
}

func toTagWeightSlice(profileID int, m map[int]float64) []models.TagWeight {
	var ret []models.TagWeight
	for id, w := range m {
		ret = append(ret, models.TagWeight{ProfileID: profileID, TagID: id, Weight: w})
	}
	return ret
}

func toPerformerWeightSlice(profileID int, m map[int]float64) []models.PerformerWeight {
	var ret []models.PerformerWeight
	for id, w := range m {
		ret = append(ret, models.PerformerWeight{ProfileID: profileID, PerformerID: id, Weight: w})
	}
	return ret
}

func toStudioWeightSlice(profileID int, m map[int]float64) []models.StudioWeight {
	var ret []models.StudioWeight
	for id, w := range m {
		ret = append(ret, models.StudioWeight{ProfileID: profileID, StudioID: id, Weight: w})
	}
	return ret
}

func toAttributeWeightSlice(profileID int, m map[string]map[string]float64) []models.AttributeWeight {
	var ret []models.AttributeWeight
	for name, valMap := range m {
		for val, w := range valMap {
			ret = append(ret, models.AttributeWeight{
				ProfileID:      profileID,
				AttributeName:  name,
				AttributeValue: val,
				Weight:         w,
			})
		}
	}
	return ret
}

// --- ContentProfileResolver implementation ---

func (r *contentProfileResolver) TopTags(ctx context.Context, obj *models.ContentProfile, limit *int) ([]*models.WeightedTag, error) {
	if obj == nil || len(obj.TagWeights) == 0 {
		return []*models.WeightedTag{}, nil
	}

	profileData := &recommendation.ProfileData{
		TagWeights: toTagWeightMap(obj.TagWeights),
	}

	l := 10
	if limit != nil {
		l = *limit
	}

	topTags := profileData.TopTags(l)
	var ret []*models.WeightedTag

	err := r.withReadTxn(ctx, func(ctx context.Context) error {
		for _, item := range topTags {
			tag, err := r.repository.Tag.Find(ctx, item.ID)
			if err != nil {
				continue // Skip if not found
			}
			ret = append(ret, &models.WeightedTag{
				Tag:    tag,
				Weight: item.Weight,
			})
		}
		return nil
	})

	return ret, err
}

func (r *contentProfileResolver) TopPerformers(ctx context.Context, obj *models.ContentProfile, limit *int) ([]*models.WeightedPerformer, error) {
	if obj == nil || len(obj.PerformerWeights) == 0 {
		return []*models.WeightedPerformer{}, nil
	}

	profileData := &recommendation.ProfileData{
		PerformerWeights: toPerformerWeightMap(obj.PerformerWeights),
	}

	l := 10
	if limit != nil {
		l = *limit
	}

	topInfo := profileData.TopPerformers(l)
	var ret []*models.WeightedPerformer

	err := r.withReadTxn(ctx, func(ctx context.Context) error {
		for _, item := range topInfo {
			perf, err := r.repository.Performer.Find(ctx, item.ID)
			if err != nil {
				continue
			}
			ret = append(ret, &models.WeightedPerformer{
				Performer: perf,
				Weight:    item.Weight,
			})
		}
		return nil
	})

	return ret, err
}

func (r *contentProfileResolver) TopStudios(ctx context.Context, obj *models.ContentProfile, limit *int) ([]*models.WeightedStudio, error) {
	if obj == nil || len(obj.StudioWeights) == 0 {
		return []*models.WeightedStudio{}, nil
	}

	profileData := &recommendation.ProfileData{
		StudioWeights: toStudioWeightMap(obj.StudioWeights),
	}

	l := 10
	if limit != nil {
		l = *limit
	}

	topInfo := profileData.TopStudios(l)
	var ret []*models.WeightedStudio

	err := r.withReadTxn(ctx, func(ctx context.Context) error {
		for _, item := range topInfo {
			studio, err := r.repository.Studio.Find(ctx, item.ID)
			if err != nil {
				continue
			}
			ret = append(ret, &models.WeightedStudio{
				Studio: studio,
				Weight: item.Weight,
			})
		}
		return nil
	})

	return ret, err
}

func (r *contentProfileResolver) TopAttributes(ctx context.Context, obj *models.ContentProfile, limit *int) ([]*models.WeightedAttribute, error) {
	if obj == nil || len(obj.AttributeWeights) == 0 {
		return []*models.WeightedAttribute{}, nil
	}

	profileData := &recommendation.ProfileData{
		AttributeWeights: toAttributeWeightMap(obj.AttributeWeights),
	}

	l := 5
	if limit != nil {
		l = *limit
	}

	var ret []*models.WeightedAttribute

	type weightedAttr struct {
		Name   string
		Value  string
		Weight float64
	}
	var allAttrs []weightedAttr

	for name, valMap := range profileData.AttributeWeights {
		for val, w := range valMap {
			allAttrs = append(allAttrs, weightedAttr{Name: name, Value: val, Weight: w})
		}
	}

	// Limit
	count := 0
	for _, attr := range allAttrs {
		if count >= l {
			break
		}
		ret = append(ret, &models.WeightedAttribute{
			Name:   attr.Name,
			Value:  attr.Value,
			Weight: attr.Weight,
		})
		count++
	}

	return ret, nil
}

// --- RecommendationResolver implementation ---

func (r *recommendationResolver) Scene(ctx context.Context, obj *models.RecommendationResult) (*models.Scene, error) {
	if obj.Type != "scene" || obj.ID == "" {
		return nil, nil
	}

	// Return pre-populated scene if available
	if obj.Scene != nil {
		return obj.Scene, nil
	}

	id, err := strconv.Atoi(obj.ID)
	if err != nil {
		return nil, nil // Not a local ID
	}
	var ret *models.Scene
	err = r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		ret, err = r.repository.Scene.Find(ctx, id)
		return err
	})
	return ret, err
}

func (r *recommendationResolver) Performer(ctx context.Context, obj *models.RecommendationResult) (*models.Performer, error) {
	if obj.Type != "performer" || obj.ID == "" {
		return nil, nil
	}
	id, err := strconv.Atoi(obj.ID)
	if err != nil {
		return nil, nil
	}
	var ret *models.Performer
	err = r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		ret, err = r.repository.Performer.Find(ctx, id)
		return err
	})
	return ret, err
}

func (r *recommendationResolver) StashDbID(ctx context.Context, obj *models.RecommendationResult) (*string, error) {
	return obj.StashID, nil
}

func (r *recommendationResolver) Studio(ctx context.Context, obj *models.RecommendationResult) (*models.Studio, error) {
	if obj.Type != "studio" || obj.ID == "" {
		return nil, nil
	}
	id, err := strconv.Atoi(obj.ID)
	if err != nil {
		return nil, nil
	}
	var ret *models.Studio
	err = r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		ret, err = r.repository.Studio.Find(ctx, id)
		return err
	})
	return ret, err
}

// --- QueryResolver implementation ---

func (r *queryResolver) UserContentProfile(ctx context.Context) (*models.ContentProfile, error) {
	// For now, always return the single user profile (ID 1) or create/calculate if missing
	// TODO: Multi-user support later

	// Helper to get or build profile
	// NOTE: Accessed as FIELD now
	store := r.repository.ContentProfile

	var profile *models.ContentProfile
	err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		profile, err = store.Find(ctx, 1)
		if err == nil && profile != nil {
			// Load weights
			return store.LoadWeights(ctx, profile)
		}
		return err
	})

	if err != nil {
		return nil, err
	}

	if profile != nil {
		return profile, nil
	}

	// If missing, rebuild it
	// Note: RebuildContentProfile handles its own Write transaction
	return r.Mutation().RebuildContentProfile(ctx)
}

func (r *queryResolver) RecommendScenes(ctx context.Context, options *models.RecommendationOptions) ([]*models.RecommendationResult, error) {
	// Get profile (this handles its own transactions)
	profile, err := r.UserContentProfile(ctx)
	if err != nil {
		return nil, err
	}

	profileData := &recommendation.ProfileData{
		TagWeights:       toTagWeightMap(profile.TagWeights),
		PerformerWeights: toPerformerWeightMap(profile.PerformerWeights),
		StudioWeights:    toStudioWeightMap(profile.StudioWeights),
		AttributeWeights: toAttributeWeightMap(profile.AttributeWeights),
	}

	scorer := recommendation.NewScorer(
		profileData,
		r.repository.Scene,
		r.repository.Performer,
		r.repository.Studio,
		r.repository.Tag,
	)

	// Recommend
	limit := 20
	if options != nil && options.Limit != nil {
		limit = *options.Limit
	}

	minScore := 0.2 // Default threshold
	if options != nil && options.MinScore != nil {
		minScore = *options.MinScore
	}

	var searchResults []*models.RecommendationResult

	var stashBoxClient *stashbox.Client
	boxes := manager.GetInstance().Config.GetStashBoxes()
	if len(boxes) > 0 {
		stashBoxClient = r.newStashBoxClient(*boxes[0])
	}

	// Initialize Engine for StashDB support
	engine := recommendation.NewEngine(
		r.repository.Scene,
		r.repository.Performer,
		r.repository.Studio,
		r.repository.Tag,
		r.repository.Gallery,
		r.repository.Image,
		r.repository.ContentProfile,
		stashBoxClient,
	)

	// Determine source
	source := models.RecommendationSourceLocal
	if options != nil && options.Source != nil {
		source = *options.Source
	}

	// Determine weights (defaults: Tags=0.5, Performers=0.3, Studio=0.2)
	tagW := 0.5
	if options != nil && options.TagWeight != nil {
		tagW = *options.TagWeight
	}
	perfW := 0.3
	if options != nil && options.PerformerWeight != nil {
		perfW = *options.PerformerWeight
	}
	studioW := 0.2
	if options != nil && options.StudioWeight != nil {
		studioW = *options.StudioWeight
	}

	seen := make(map[string]bool)

	// 1. Local Recommendations
	if source == models.RecommendationSourceLocal || source == models.RecommendationSourceBoth {
		err = r.withReadTxn(ctx, func(ctx context.Context) error {
			// Check ExcludeOwned option (default false for local usually, but let's respect the flag)
			// For local scenes, "ExcludeOwned" loosely translates to "Exclude Watched"
			// because "Owned" isn't really a concept for local files, but "Watched" is.
			// However, in the UI "Local Scenes (Rediscover)" explicitly wants to show watched stuff.
			// The UI passes excludeOwned={false}.
			includeWatched := true
			if options != nil && options.ExcludeOwned != nil && *options.ExcludeOwned {
				includeWatched = false
			}

			results, err := scorer.RecommendScenes(ctx, limit, minScore, includeWatched, tagW, perfW, studioW)
			if err != nil {
				return err
			}

			// Deduping and converting
			for i := range results {
				item := &results[i]
				key := fmt.Sprintf("local:%s", item.ID)
				if seen[key] {
					continue
				}
				seen[key] = true
				searchResults = append(searchResults, item)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}

	// 2. StashDB Recommendations
	if source == models.RecommendationSourceStashDB || source == models.RecommendationSourceBoth {
		// Read-only txn for profile/tag lookups inside discovery
		err = r.withReadTxn(ctx, func(ctx context.Context) error {
			// If no client, we simply skip StashDB results without error
			if engine.StashBoxClient == nil {
				return nil
			}

			results, err := engine.DiscoverFromStashDB(ctx, profile, limit, tagW, perfW)
			if err != nil {
				return err
			}

			for i := range results {
				// Use &results[i] directly to avoid loop variable memory reuse issues
				item := &results[i]
				key := fmt.Sprintf("stashdb:%s", *item.StashID)

				if seen[key] {
					continue
				}
				seen[key] = true
				searchResults = append(searchResults, item)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}

	// Sort combined results by Score descending
	sort.Slice(searchResults, func(i, j int) bool {
		return searchResults[i].Score > searchResults[j].Score
	})

	return searchResults, nil
}

func (r *queryResolver) RecommendPerformers(ctx context.Context, options *models.RecommendationOptions) ([]*models.RecommendationResult, error) {
	// Get profile
	profile, err := r.UserContentProfile(ctx)
	if err != nil {
		return nil, err
	}

	limit := 20
	if options != nil && options.Limit != nil {
		limit = *options.Limit
	}

	// Determine weights
	// (Reusing tag/perf/studio weights from options if needed for filtering/sorting)
	// For Performers, we mainly use AttributeMatch or direct Performer Weight?
	// Currently DiscoverPerformersFromStashDB uses AttributeWeights internally.

	// Initialize Engine
	var stashBoxClient *stashbox.Client
	boxes := manager.GetInstance().Config.GetStashBoxes()
	if len(boxes) > 0 {
		stashBoxClient = r.newStashBoxClient(*boxes[0])
	}

	engine := recommendation.NewEngine(
		r.repository.Scene,
		r.repository.Performer,
		r.repository.Studio,
		r.repository.Tag,
		r.repository.Gallery,
		r.repository.Image,
		r.repository.ContentProfile,
		stashBoxClient,
	)

	// Determine source
	source := models.RecommendationSourceLocal
	if options != nil && options.Source != nil {
		source = *options.Source
	}

	var searchResults []*models.RecommendationResult
	seen := make(map[string]bool)

	// 1. Local Recommendations (Profile based)
	if source == models.RecommendationSourceLocal || source == models.RecommendationSourceBoth {
		err = r.withReadTxn(ctx, func(ctx context.Context) error {
			profileData := &recommendation.ProfileData{
				TagWeights:       toTagWeightMap(profile.TagWeights),
				PerformerWeights: toPerformerWeightMap(profile.PerformerWeights),
				StudioWeights:    toStudioWeightMap(profile.StudioWeights),
				AttributeWeights: toAttributeWeightMap(profile.AttributeWeights),
			}

			scorer := recommendation.NewScorer(
				profileData,
				r.repository.Scene,
				r.repository.Performer,
				r.repository.Studio,
				r.repository.Tag,
			)

			results, err := scorer.RecommendPerformers(ctx, limit, 0.1) // 0.1 min score
			if err != nil {
				return err
			}

			for i := range results {
				item := &results[i]
				key := fmt.Sprintf("local:%s", item.ID)
				if seen[key] {
					continue
				}
				seen[key] = true
				searchResults = append(searchResults, item)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}

	// 2. StashDB Recommendations
	if source == models.RecommendationSourceStashDB || source == models.RecommendationSourceBoth {
		err = r.withReadTxn(ctx, func(ctx context.Context) error {
			if engine.StashBoxClient == nil {
				return nil
			}

			results, err := engine.DiscoverPerformersFromStashDB(ctx, profile, limit)
			if err != nil {
				return err
			}

			for i := range results {
				item := &results[i]
				var key string
				if item.StashID != nil {
					key = fmt.Sprintf("stashdb:%s", *item.StashID)
				} else {
					key = fmt.Sprintf("stashdb:%s", item.Name)
				}

				if seen[key] {
					continue
				}
				seen[key] = true
				searchResults = append(searchResults, item)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}

	// Sort combined results by Score descending
	sort.Slice(searchResults, func(i, j int) bool {
		return searchResults[i].Score > searchResults[j].Score
	})

	return searchResults, nil
}

func (r *queryResolver) SimilarScenes(ctx context.Context, sceneID string, limit *int) ([]*models.RecommendationResult, error) {
	id, _ := strconv.Atoi(sceneID)
	l := 20
	if limit != nil {
		l = *limit
	}

	// Create scorer with nil profile just to access SimilarScenes logic using readers
	scorer := recommendation.NewScorer(
		nil,
		r.repository.Scene,
		r.repository.Performer,
		r.repository.Studio,
		r.repository.Tag,
	)

	var searchResults []*models.RecommendationResult
	err := r.withReadTxn(ctx, func(ctx context.Context) error {
		results, err := scorer.SimilarScenes(ctx, id, l)
		if err != nil {
			return err
		}

		// Convert to pointers
		for i := range results {
			item := results[i]
			searchResults = append(searchResults, &item)
		}
		return nil
	})

	return searchResults, err
}

func (r *queryResolver) SimilarPerformers(ctx context.Context, performerID string, limit *int) ([]*models.RecommendationResult, error) {
	return []*models.RecommendationResult{}, nil
}

// --- MutationResolver implementation ---

func (r *mutationResolver) RebuildContentProfile(ctx context.Context) (*models.ContentProfile, error) {
	var profile *models.ContentProfile

	err := r.withTxn(ctx, func(ctx context.Context) error {
		// Initialize builder
		builder := recommendation.NewProfileBuilder(
			r.repository.Scene,
			r.repository.Performer,
			r.repository.Tag,
			r.repository.Studio,
		)

		// Build profile data
		data, err := builder.BuildUserProfile(ctx)
		if err != nil {
			return err
		}

		// Force ID 1
		profileID := 1

		// Save to DB
		profile = &models.ContentProfile{
			ID:               profileID,
			ProfileType:      "user",
			TagWeights:       toTagWeightSlice(profileID, data.TagWeights),
			PerformerWeights: toPerformerWeightSlice(profileID, data.PerformerWeights),
			StudioWeights:    toStudioWeightSlice(profileID, data.StudioWeights),
			AttributeWeights: toAttributeWeightSlice(profileID, data.AttributeWeights),
		}

		// Save using repository
		store := r.repository.ContentProfile

		// Check if exists first
		existing, _ := store.Find(ctx, profileID)
		currentTime := time.Now()
		profile.UpdatedAt = currentTime

		if existing != nil {
			profile.CreatedAt = existing.CreatedAt
			if err := store.Update(ctx, profile); err != nil {
				return err
			}
		} else {
			profile.CreatedAt = currentTime
			if err := store.Create(ctx, profile); err != nil {
				return err
			}
		}

		// Save weights
		if err := store.SaveWeights(ctx, profile); err != nil {
			return err
		}

		return nil
	})

	return profile, err
}
