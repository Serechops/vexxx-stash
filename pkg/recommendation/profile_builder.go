// Package recommendation provides intelligent content recommendations based on user preferences.
package recommendation

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
)

// ProfileBuilder computes a ContentProfile from a user's library data.
type ProfileBuilder struct {
	sceneReader     models.SceneReader
	performerReader models.PerformerReader
	tagReader       models.TagReader
	studioReader    models.StudioReader
}

// NewProfileBuilder creates a ProfileBuilder with the required data readers.
func NewProfileBuilder(
	sceneReader models.SceneReader,
	performerReader models.PerformerReader,
	tagReader models.TagReader,
	studioReader models.StudioReader,
) *ProfileBuilder {
	return &ProfileBuilder{
		sceneReader:     sceneReader,
		performerReader: performerReader,
		tagReader:       tagReader,
		studioReader:    studioReader,
	}
}

// BuildUserProfile computes weight vectors from all scenes in the library.
// The algorithm considers:
// - Scene rating (base score)
// - Play duration vs actual duration (engagement)
// - Recency of play (recency boost)
// - Performer favorites (favorite boost)
func (pb *ProfileBuilder) BuildUserProfile(ctx context.Context) (*ProfileData, error) {
	logger.Info("Building user content profile...")

	// Aggregate weights
	tagWeights := make(map[int]float64)
	performerWeights := make(map[int]float64)
	studioWeights := make(map[int]float64)
	attributeWeights := make(map[string]map[string]float64)

	// Initialize attribute weight maps
	attributeWeights["gender"] = make(map[string]float64)
	attributeWeights["ethnicity"] = make(map[string]float64)
	attributeWeights["hair_color"] = make(map[string]float64)
	attributeWeights["eye_color"] = make(map[string]float64)

	// Query all scenes (paginated for large libraries)
	const pageSize = 100
	page := 1
	totalScenes := 0

	for {
		findFilter := &models.FindFilterType{
			Page:    &page,
			PerPage: intPtr(pageSize),
		}
		sceneFilter := &models.SceneFilterType{}

		result, err := pb.sceneReader.Query(ctx, models.SceneQueryOptions{
			QueryOptions: models.QueryOptions{
				FindFilter: findFilter,
				Count:      true,
			},
			SceneFilter: sceneFilter,
		})
		if err != nil {
			return nil, fmt.Errorf("querying scenes: %w", err)
		}

		if page == 1 {
			logger.Infof("Processing %d scenes for profile...", result.Count)
		}

		scenes, err := result.Resolve(ctx)
		if err != nil {
			return nil, fmt.Errorf("resolving scenes: %w", err)
		}

		if len(scenes) == 0 {
			break
		}

		for _, scene := range scenes {
			score := pb.computeSceneScore(scene)
			if score <= 0 {
				continue
			}

			// Load scene relationships
			if err := scene.LoadTagIDs(ctx, pb.sceneReader); err != nil {
				logger.Warnf("Failed to load tags for scene %d: %v", scene.ID, err)
				continue
			}
			if err := scene.LoadPerformerIDs(ctx, pb.sceneReader); err != nil {
				logger.Warnf("Failed to load performers for scene %d: %v", scene.ID, err)
				continue
			}

			// Aggregate tag weights
			for _, tagID := range scene.TagIDs.List() {
				tagWeights[tagID] += score
			}

			// Aggregate performer weights
			for _, performerID := range scene.PerformerIDs.List() {
				performerWeights[performerID] += score

				// Extract performer attributes for attribute weighting
				performer, err := pb.performerReader.Find(ctx, performerID)
				if err != nil || performer == nil {
					continue
				}

				// Weight attributes based on engagement
				if performer.Gender != nil {
					attributeWeights["gender"][string(*performer.Gender)] += score
				}
				if performer.Ethnicity != "" {
					attributeWeights["ethnicity"][performer.Ethnicity] += score
				}
				if performer.HairColor != "" {
					attributeWeights["hair_color"][performer.HairColor] += score
				}
				if performer.EyeColor != "" {
					attributeWeights["eye_color"][performer.EyeColor] += score
				}

				// Favorite performers get a boost
				if performer.Favorite {
					performerWeights[performerID] += score * 0.5
				}
			}

			// Aggregate studio weights
			if scene.StudioID != nil {
				studioWeights[*scene.StudioID] += score

				// Check if studio is favorited
				studio, err := pb.studioReader.Find(ctx, *scene.StudioID)
				if err == nil && studio != nil && studio.Favorite {
					studioWeights[*scene.StudioID] += score * 0.5
				}
			}

			totalScenes++
		}

		page++
	}

	logger.Infof("Processed %d scenes. Normalizing weights...", totalScenes)

	// Normalize all weights to 0-1 scale
	tagWeights = normalizeWeights(tagWeights)
	performerWeights = normalizeWeights(performerWeights)
	studioWeights = normalizeWeights(studioWeights)
	for attrName := range attributeWeights {
		attributeWeights[attrName] = normalizeStringWeights(attributeWeights[attrName])
	}

	// Propagate tag weights to parent tags (50% propagation)
	tagWeights, err := pb.propagateTagHierarchy(ctx, tagWeights)
	if err != nil {
		logger.Warnf("Failed to propagate tag hierarchy: %v", err)
	}

	return &ProfileData{
		TagWeights:       tagWeights,
		PerformerWeights: performerWeights,
		StudioWeights:    studioWeights,
		AttributeWeights: attributeWeights,
		SceneCount:       totalScenes,
		ComputedAt:       time.Now(),
	}, nil
}

// computeSceneScore calculates the engagement score for a single scene.
func (pb *ProfileBuilder) computeSceneScore(scene *models.Scene) float64 {
	// Base score from rating (1.0 for unrated)
	baseScore := 1.0
	if scene.Rating != nil && *scene.Rating > 0 {
		baseScore = float64(*scene.Rating) / 100.0
	}

	// Engagement multiplier from play duration
	engagementMultiplier := 1.0
	if scene.PlayDuration > 0 {
		// Get actual scene duration from file metadata
		var actualDuration float64
		if scene.Files.Loaded() && scene.Files.Primary() != nil {
			actualDuration = scene.Files.Primary().Duration
		}

		if actualDuration > 0 {
			// Cap engagement at 100% (no bonus for rewatching)
			engagementRatio := math.Min(scene.PlayDuration/actualDuration, 1.0)
			// Scale to 0.5x - 2x multiplier
			engagementMultiplier = 0.5 + (engagementRatio * 1.5)
		} else {
			// If no duration info, give partial credit for any play
			engagementMultiplier = 1.5
		}
	} else {
		// Unwatched scenes get reduced weight (0.5x)
		engagementMultiplier = 0.5
	}

	// Recency boost (scenes played recently get higher weight)
	recencyBoost := 1.0
	// Note: We don't have last_played_at in the model currently
	// This would need to be added for full recency support
	// For now, we use UpdatedAt as a proxy
	daysSinceUpdate := time.Since(scene.UpdatedAt).Hours() / 24
	if daysSinceUpdate < 365 {
		recencyBoost = 1.0 + (0.5 * (1.0 - (daysSinceUpdate / 365.0)))
	}

	return baseScore * engagementMultiplier * recencyBoost
}

// propagateTagHierarchy propagates weights up the tag hierarchy.
// Child tag weights contribute 50% to their parent tags.
func (pb *ProfileBuilder) propagateTagHierarchy(ctx context.Context, weights map[int]float64) (map[int]float64, error) {
	result := make(map[int]float64)
	for k, v := range weights {
		result[k] = v
	}

	// For each weighted tag, propagate 50% to parents
	for tagID, weight := range weights {
		tag, err := pb.tagReader.Find(ctx, tagID)
		if err != nil || tag == nil {
			continue
		}

		if err := tag.LoadParentIDs(ctx, pb.tagReader); err != nil {
			continue
		}

		for _, parentID := range tag.ParentIDs.List() {
			result[parentID] += weight * 0.5
		}
	}

	// Re-normalize after propagation
	return normalizeWeights(result), nil
}

// ProfileData holds the computed weight vectors.
type ProfileData struct {
	TagWeights       map[int]float64
	PerformerWeights map[int]float64
	StudioWeights    map[int]float64
	AttributeWeights map[string]map[string]float64
	SceneCount       int
	ComputedAt       time.Time
}

// TopTags returns the N highest weighted tags.
func (pd *ProfileData) TopTags(n int) []WeightedItem {
	return topN(pd.TagWeights, n)
}

// TopPerformers returns the N highest weighted performers.
func (pd *ProfileData) TopPerformers(n int) []WeightedItem {
	return topN(pd.PerformerWeights, n)
}

// TopStudios returns the N highest weighted studios.
func (pd *ProfileData) TopStudios(n int) []WeightedItem {
	return topN(pd.StudioWeights, n)
}

// TopAttributes returns the N highest weighted values for an attribute.
func (pd *ProfileData) TopAttributes(attrName string, n int) []WeightedStringItem {
	attrMap, ok := pd.AttributeWeights[attrName]
	if !ok {
		return nil
	}

	var items []WeightedStringItem
	for value, weight := range attrMap {
		items = append(items, WeightedStringItem{Value: value, Weight: weight})
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].Weight > items[j].Weight
	})

	if n > 0 && len(items) > n {
		items = items[:n]
	}
	return items
}

// WeightedItem represents an entity ID with its weight.
type WeightedItem struct {
	ID     int
	Weight float64
}

// WeightedStringItem represents a string value with its weight.
type WeightedStringItem struct {
	Value  string
	Weight float64
}

// --- Utility Functions ---

func normalizeWeights(weights map[int]float64) map[int]float64 {
	if len(weights) == 0 {
		return weights
	}

	// Find max weight
	var maxWeight float64
	for _, w := range weights {
		if w > maxWeight {
			maxWeight = w
		}
	}

	if maxWeight == 0 {
		return weights
	}

	// Normalize to 0-1
	result := make(map[int]float64, len(weights))
	for id, w := range weights {
		result[id] = w / maxWeight
	}
	return result
}

// normalizeStringWeights normalizes string-keyed weights (for attributes)
func normalizeStringWeights(weights map[string]float64) map[string]float64 {
	if len(weights) == 0 {
		return weights
	}

	var maxWeight float64
	for _, w := range weights {
		if w > maxWeight {
			maxWeight = w
		}
	}

	if maxWeight == 0 {
		return weights
	}

	result := make(map[string]float64, len(weights))
	for key, w := range weights {
		result[key] = w / maxWeight
	}
	return result
}

func topN(weights map[int]float64, n int) []WeightedItem {
	var items []WeightedItem
	for id, weight := range weights {
		items = append(items, WeightedItem{ID: id, Weight: weight})
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].Weight > items[j].Weight
	})

	if n > 0 && len(items) > n {
		items = items[:n]
	}
	return items
}

func intPtr(i int) *int {
	return &i
}
