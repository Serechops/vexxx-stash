package api

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/recommendation"
	"github.com/stashapp/stash/pkg/recommendation/embedding"
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

	// Pre-populate seen map with dismissed items and caller-supplied exclude IDs.
	seen := make(map[string]bool)
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		dismissed, dErr := r.repository.DismissedRecommendation.ListDismissed(ctx, "scene")
		if dErr != nil {
			return dErr
		}
		for k := range dismissed {
			seen[k] = true
		}
		return nil
	}); err != nil {
		return nil, err
	}
	if options != nil {
		for _, id := range options.ExcludeIds {
			seen[id] = true
		}
	}

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

	// Enrich reason strings for local scene results with actual entity names.
	// Only runs for items that have a populated Scene (local results); StashDB
	// results already carry their own description.
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		for _, result := range searchResults {
			if result.Type != "scene" || result.Scene == nil {
				continue
			}
			scene := result.Scene
			var parts []string

			// Top matching tags from the user profile (highest weight first, ≤3)
			if scene.TagIDs.Loaded() {
				type tagW struct {
					id int
					w  float64
				}
				var matches []tagW
				for _, tagID := range scene.TagIDs.List() {
					if w, ok := profileData.TagWeights[tagID]; ok && w > 0 {
						matches = append(matches, tagW{tagID, w})
					}
				}
				sort.Slice(matches, func(i, j int) bool { return matches[i].w > matches[j].w })
				var names []string
				for _, m := range matches {
					if len(names) >= 3 {
						break
					}
					tag, err := r.repository.Tag.Find(ctx, m.id)
					if err == nil && tag != nil {
						names = append(names, tag.Name)
					}
				}
				if len(names) > 0 {
					parts = append(parts, strings.Join(names, ", "))
				}
			}

			// Top matching performers (≤2)
			if scene.PerformerIDs.Loaded() {
				type perfW struct {
					id int
					w  float64
				}
				var matches []perfW
				for _, perfID := range scene.PerformerIDs.List() {
					if w, ok := profileData.PerformerWeights[perfID]; ok && w > 0 {
						matches = append(matches, perfW{perfID, w})
					}
				}
				sort.Slice(matches, func(i, j int) bool { return matches[i].w > matches[j].w })
				var names []string
				for _, m := range matches {
					if len(names) >= 2 {
						break
					}
					perf, err := r.repository.Performer.Find(ctx, m.id)
					if err == nil && perf != nil {
						names = append(names, perf.Name)
					}
				}
				if len(names) > 0 {
					parts = append(parts, strings.Join(names, ", "))
				}
			}

			// Studio (if in profile)
			if scene.StudioID != nil {
				if _, ok := profileData.StudioWeights[*scene.StudioID]; ok {
					studio, err := r.repository.Studio.Find(ctx, *scene.StudioID)
					if err == nil && studio != nil {
						parts = append(parts, studio.Name)
					}
				}
			}

			if len(parts) > 0 {
				result.Reason = strings.Join(parts, " · ")
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}

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

	// Pre-populate seen map with dismissed items and caller-supplied exclude IDs.
	seen := make(map[string]bool)
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		dismissed, dErr := r.repository.DismissedRecommendation.ListDismissed(ctx, "performer")
		if dErr != nil {
			return dErr
		}
		for k := range dismissed {
			seen[k] = true
		}
		return nil
	}); err != nil {
		return nil, err
	}
	if options != nil {
		for _, id := range options.ExcludeIds {
			seen[id] = true
		}
	}

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

			// Determine weights (Default 0.5/0.5)
			// Use PerformerWeight to balance History vs Attributes
			// PerformerWeight 1.0 = 100% History, 0% Attributes
			// PerformerWeight 0.0 = 0% History, 100% Attributes
			histW := 0.5
			appW := 0.5
			if options != nil && options.PerformerWeight != nil {
				histW = *options.PerformerWeight
				// Ensure simple complementary weight, capped at 1.0
				if histW > 1.0 {
					histW = 1.0
				}
				if histW < 0.0 {
					histW = 0.0
				}
				appW = 1.0 - histW
			}

			results, err := scorer.RecommendPerformers(ctx, limit, 0.1, appW, histW) // 0.1 min score
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

			tagW := 0.5
			perfW := 0.5
			if options != nil {
				if options.TagWeight != nil {
					tagW = *options.TagWeight
				}
				if options.PerformerWeight != nil {
					perfW = *options.PerformerWeight
				}
			}

			results, err := engine.DiscoverPerformersFromStashDB(ctx, profile, limit, tagW, perfW)
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
	// Signal weights — must sum to 1.0
	const (
		wMeta           = 0.40 // tag / performer / studio co-occurrence
		wPhash          = 0.35 // perceptual-hash Hamming distance
		wVisual         = 0.25 // HSV colour-histogram cosine similarity
		phashMaxDist    = 10   // max Hamming bits to consider a pHash match
		visualFullThr   = 0.80 // stored-signature cosine threshold (full visual search)
		visualEnrichThr = 0.50 // on-the-fly cosine threshold (candidate enrichment)
		scoreFloor      = 0.05 // discard anything below this blended score
	)

	id, err := strconv.Atoi(sceneID)
	if err != nil {
		return nil, fmt.Errorf("invalid scene ID: %s", sceneID)
	}
	l := 20
	if limit != nil {
		l = *limit
	}

	scorer := recommendation.NewScorer(
		nil,
		r.repository.Scene,
		r.repository.Performer,
		r.repository.Studio,
		r.repository.Tag,
	)

	// Per-scene accumulator for the three signals.
	type signals struct {
		meta   float64
		phash  float64
		visual float64
		scene  *models.Scene // populated once the scene object is known
		labels []string      // human-readable reason fragments
	}
	acc := make(map[int]*signals)
	entry := func(sid int) *signals {
		if s, ok := acc[sid]; ok {
			return s
		}
		s := &signals{}
		acc[sid] = s
		return s
	}

	var searchResults []*models.RecommendationResult
	err = r.withReadTxn(ctx, func(ctx context.Context) error {
		// ── Signal 1: metadata similarity (tags / performers / studio) ─────────
		metaResults, metaErr := scorer.SimilarScenes(ctx, id, 0 /* no internal limit */)
		if metaErr != nil {
			return metaErr
		}
		for i := range metaResults {
			res := &metaResults[i]
			sid, _ := strconv.Atoi(res.ID)
			e := entry(sid)
			e.meta = res.Score
			e.scene = res.Scene
			if res.Reason != "" {
				e.labels = append(e.labels, res.Reason)
			}
		}

		// ── Signal 2: pHash Hamming similarity ─────────────────────────────────
		phashMatches, phashErr := r.repository.Scene.FindSimilarByPhash(ctx, id, phashMaxDist)
		if phashErr != nil {
			logger.Warnf("[SimilarScenes] pHash search error for scene %d: %v", id, phashErr)
		}
		for _, pm := range phashMatches {
			e := entry(pm.SceneID)
			e.phash = float64(64-pm.Distance) / 64.0
			if pm.Distance == 0 {
				e.labels = append(e.labels, "exact pHash match")
			} else {
				e.labels = append(e.labels, fmt.Sprintf("pHash dist %d", pm.Distance))
			}
		}

		// ── Signal 3: visual colour-histogram similarity ────────────────────────
		srcCover, coverErr := r.repository.Scene.GetCover(ctx, id)
		if coverErr == nil && len(srcCover) > 0 {
			srcSig := embedding.ComputeFromImage(srcCover)
			if len(srcSig) > 0 {
				// 3a – full visual search across all pre-computed stored signatures
				if r.repository.VisualSignature != nil {
					allSigs, sigErr := r.repository.VisualSignature.GetAll(ctx)
					if sigErr != nil {
						logger.Warnf("[SimilarScenes] visual signature DB error: %v", sigErr)
					} else {
						for candID, candSig := range allSigs {
							if candID == id {
								continue
							}
							cos := embedding.Cosine(srcSig, candSig)
							if cos < visualFullThr {
								continue
							}
							e := entry(candID)
							if cos > e.visual {
								e.visual = cos
							}
							e.labels = append(e.labels, fmt.Sprintf("visual %.0f%%", cos*100))
						}
					}
				}

				// 3b – on-the-fly enrichment for candidates already identified
				for candID, e := range acc {
					if e.visual > 0 {
						continue // already scored from stored sigs
					}
					candCover, err := r.repository.Scene.GetCover(ctx, candID)
					if err != nil || len(candCover) == 0 {
						continue
					}
					candSig := embedding.ComputeFromImage(candCover)
					if len(candSig) == 0 {
						continue
					}
					cos := embedding.Cosine(srcSig, candSig)
					if cos >= visualEnrichThr {
						e.visual = cos
						if cos >= 0.85 {
							e.labels = append(e.labels, fmt.Sprintf("visual %.0f%%", cos*100))
						}
					}
				}
			}
		}

		// ── Fetch scene objects for candidates without one yet ─────────────────
		var missing []int
		for sid, e := range acc {
			if e.scene == nil {
				missing = append(missing, sid)
			}
		}
		if len(missing) > 0 {
			fetched, fetchErr := r.repository.Scene.FindMany(ctx, missing)
			if fetchErr != nil {
				return fetchErr
			}
			for _, s := range fetched {
				acc[s.ID].scene = s
			}
		}

		// ── Blend signals → final results ──────────────────────────────────────
		for sid, e := range acc {
			blended := e.meta*wMeta + e.phash*wPhash + e.visual*wVisual
			if blended < scoreFloor || e.scene == nil {
				continue
			}
			reason := strings.Join(dedupStrings(e.labels), " · ")
			searchResults = append(searchResults, &models.RecommendationResult{
				Type:   "scene",
				ID:     strconv.Itoa(sid),
				Name:   e.scene.GetTitle(),
				Score:  blended,
				Reason: reason,
				Scene:  e.scene,
			})
		}

		sort.Slice(searchResults, func(i, j int) bool {
			return searchResults[i].Score > searchResults[j].Score
		})
		if l > 0 && len(searchResults) > l {
			searchResults = searchResults[:l]
		}
		return nil
	})

	return searchResults, err
}

// dedupStrings returns a new slice with consecutive duplicate strings removed.
func dedupStrings(in []string) []string {
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func (r *queryResolver) SimilarPerformers(ctx context.Context, performerID string, limit *int) ([]*models.RecommendationResult, error) {
	id, err := strconv.Atoi(performerID)
	if err != nil {
		return nil, fmt.Errorf("invalid performer ID: %s", performerID)
	}
	l := 20
	if limit != nil {
		l = *limit
	}

	scorer := recommendation.NewScorer(
		nil,
		r.repository.Scene,
		r.repository.Performer,
		r.repository.Studio,
		r.repository.Tag,
	)

	var results []*models.RecommendationResult
	err = r.withReadTxn(ctx, func(ctx context.Context) error {
		res, err := scorer.SimilarPerformers(ctx, id, l)
		if err != nil {
			return err
		}
		for i := range res {
			item := res[i]
			results = append(results, &item)
		}
		return nil
	})
	return results, err
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

func (r *mutationResolver) DismissRecommendation(ctx context.Context, entityType string, entityKey string) (bool, error) {
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		return r.repository.DismissedRecommendation.Dismiss(ctx, entityType, entityKey)
	}); err != nil {
		return false, err
	}
	return true, nil
}

func (r *mutationResolver) UndismissRecommendation(ctx context.Context, entityType string, entityKey string) (bool, error) {
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		return r.repository.DismissedRecommendation.Undismiss(ctx, entityType, entityKey)
	}); err != nil {
		return false, err
	}
	return true, nil
}

func (r *mutationResolver) LikeRecommendation(ctx context.Context, entityType string, entityKey string) (bool, error) {
	const likeBoost = 0.1
	const performerLikeBoost = 0.2
	const profileID = 1

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		// Record the like (idempotent)
		if err := r.repository.LikedRecommendation.Like(ctx, entityType, entityKey); err != nil {
			return err
		}

		// Apply weight nudge only for local items
		if !strings.HasPrefix(entityKey, "local:") {
			return nil
		}
		localID, err := strconv.Atoi(strings.TrimPrefix(entityKey, "local:"))
		if err != nil {
			return nil
		}

		cp := r.repository.ContentProfile
		switch entityType {
		case "scene":
			scene, err := r.repository.Scene.Find(ctx, localID)
			if err != nil || scene == nil {
				return err
			}
			if err := scene.LoadTagIDs(ctx, r.repository.Scene); err != nil {
				return err
			}
			if err := scene.LoadPerformerIDs(ctx, r.repository.Scene); err != nil {
				return err
			}
			if err := cp.NudgeTagWeights(ctx, profileID, scene.TagIDs.List(), likeBoost); err != nil {
				return err
			}
			if err := cp.NudgePerformerWeights(ctx, profileID, scene.PerformerIDs.List(), likeBoost); err != nil {
				return err
			}
			if scene.StudioID != nil {
				if err := cp.NudgeStudioWeight(ctx, profileID, *scene.StudioID, likeBoost); err != nil {
					return err
				}
			}
		case "performer":
			if err := cp.NudgePerformerWeights(ctx, profileID, []int{localID}, performerLikeBoost); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return false, err
	}
	return true, nil
}

func (r *mutationResolver) UnlikeRecommendation(ctx context.Context, entityType string, entityKey string) (bool, error) {
	const likeBoost = 0.1
	const performerLikeBoost = 0.2
	const profileID = 1

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		if err := r.repository.LikedRecommendation.Unlike(ctx, entityType, entityKey); err != nil {
			return err
		}

		// Reverse weight nudge for local items (weights clamped ≥ 0 in SQL)
		if !strings.HasPrefix(entityKey, "local:") {
			return nil
		}
		localID, err := strconv.Atoi(strings.TrimPrefix(entityKey, "local:"))
		if err != nil {
			return nil
		}

		cp := r.repository.ContentProfile
		switch entityType {
		case "scene":
			scene, err := r.repository.Scene.Find(ctx, localID)
			if err != nil || scene == nil {
				return err
			}
			if err := scene.LoadTagIDs(ctx, r.repository.Scene); err != nil {
				return err
			}
			if err := scene.LoadPerformerIDs(ctx, r.repository.Scene); err != nil {
				return err
			}
			if err := cp.NudgeTagWeights(ctx, profileID, scene.TagIDs.List(), -likeBoost); err != nil {
				return err
			}
			if err := cp.NudgePerformerWeights(ctx, profileID, scene.PerformerIDs.List(), -likeBoost); err != nil {
				return err
			}
			if scene.StudioID != nil {
				if err := cp.NudgeStudioWeight(ctx, profileID, *scene.StudioID, -likeBoost); err != nil {
					return err
				}
			}
		case "performer":
			if err := cp.NudgePerformerWeights(ctx, profileID, []int{localID}, -performerLikeBoost); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return false, err
	}
	return true, nil
}

func (r *queryResolver) ListDismissedRecommendations(ctx context.Context, entityType string) ([]*models.DismissedRecommendationItem, error) {
	var entries []models.DismissedRecommendationEntry
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		entries, err = r.repository.DismissedRecommendation.ListDismissedWithTime(ctx, entityType)
		return err
	}); err != nil {
		return nil, err
	}

	result := make([]*models.DismissedRecommendationItem, len(entries))
	for i, e := range entries {
		result[i] = &models.DismissedRecommendationItem{
			EntityType:  e.EntityType,
			EntityKey:   e.EntityKey,
			DismissedAt: e.DismissedAt,
		}
	}
	return result, nil
}
