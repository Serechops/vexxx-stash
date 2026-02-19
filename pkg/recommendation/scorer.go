package recommendation

import (
	"context"
	"sort"
	"strconv"
	"strings"

	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
)

// Scorer computes recommendation scores for entities against a content profile.
type Scorer struct {
	profile         *ProfileData
	sceneReader     models.SceneReader
	performerReader models.PerformerReader
	studioReader    models.StudioReader
	tagReader       models.TagReader
}

// NewScorer creates a Scorer with the given profile data.
func NewScorer(
	profile *ProfileData,
	sceneReader models.SceneReader,
	performerReader models.PerformerReader,
	studioReader models.StudioReader,
	tagReader models.TagReader,
) *Scorer {
	return &Scorer{
		profile:         profile,
		sceneReader:     sceneReader,
		performerReader: performerReader,
		studioReader:    studioReader,
		tagReader:       tagReader,
	}
}

// ScoreScene computes a recommendation score for a scene (0-1).
func (s *Scorer) ScoreScene(ctx context.Context, scene *models.Scene, tagWeight, perfWeight, studioWeight float64) (float64, string) {
	if s.profile == nil {
		return 0, ""
	}

	// Need at least one weight source to score against
	if len(s.profile.TagWeights) == 0 && len(s.profile.PerformerWeights) == 0 && len(s.profile.StudioWeights) == 0 {
		return 0, ""
	}

	var totalScore float64
	var reasons []string

	// Load relationships if not already loaded
	if err := scene.LoadTagIDs(ctx, s.sceneReader); err != nil {
		// Skip this scene if we can't load its tags
		return 0, ""
	}
	if err := scene.LoadPerformerIDs(ctx, s.sceneReader); err != nil {
		// Continue without performer scoring if load fails
	}

	// Score based on tags (only if loaded)
	var tagScore float64
	matchedTags := 0
	if scene.TagIDs.Loaded() {
		for _, tagID := range scene.TagIDs.List() {
			if weight, ok := s.profile.TagWeights[tagID]; ok {
				tagScore += weight
				matchedTags++
			}
		}
	}
	if matchedTags > 0 {
		tagScore /= float64(matchedTags)
		totalScore += tagScore * tagWeight
		if matchedTags >= 2 {
			reasons = append(reasons, "matching tags")
		}
	}

	// Score based on performers (only if loaded)
	var performerScore float64
	matchedPerformers := 0
	if scene.PerformerIDs.Loaded() {
		for _, performerID := range scene.PerformerIDs.List() {
			if weight, ok := s.profile.PerformerWeights[performerID]; ok {
				performerScore += weight
				matchedPerformers++
			}
		}
	}
	if matchedPerformers > 0 {
		performerScore /= float64(matchedPerformers)
		totalScore += performerScore * perfWeight
		if matchedPerformers >= 1 {
			reasons = append(reasons, "favorite performers")
		}
	}

	// Score based on studio
	if scene.StudioID != nil {
		if weight, ok := s.profile.StudioWeights[*scene.StudioID]; ok {
			totalScore += weight * studioWeight
			if weight > 0.5 {
				reasons = append(reasons, "preferred studio")
			}
		}
	}

	// Build reason string
	reason := ""
	if len(reasons) > 0 {
		reason = "Based on " + joinReasons(reasons)
	}

	return totalScore, reason
}

// ScorePerformer computes a recommendation score for a performer.
func (s *Scorer) ScorePerformer(ctx context.Context, performer *models.Performer, appearanceWeight, historyWeight float64) (float64, string) {
	if s.profile == nil {
		return 0, ""
	}

	var totalScore float64
	var reasons []string

	// Direct performer weight (Viewing History)
	if weight, ok := s.profile.PerformerWeights[performer.ID]; ok {
		totalScore += weight * historyWeight
		reasons = append(reasons, "viewing history")
	}

	// Attribute matching (Appearance)
	attrScore := s.scorePerformerAttributes(performer)
	if attrScore > 0 {
		totalScore += attrScore * appearanceWeight
		reasons = append(reasons, "matching attributes")
	}

	reason := ""
	if len(reasons) > 0 {
		reason = "Based on " + joinReasons(reasons)
	}

	return totalScore, reason
}

// scorePerformerAttributes scores a performer based on attribute matches.
func (s *Scorer) scorePerformerAttributes(performer *models.Performer) float64 {
	if s.profile.AttributeWeights == nil {
		return 0
	}

	var totalScore float64
	attrCount := 0

	// Gender
	if performer.Gender != nil {
		if genderWeights, ok := s.profile.AttributeWeights["gender"]; ok {
			if weight, ok := genderWeights[string(*performer.Gender)]; ok {
				totalScore += weight
				attrCount++
			}
		}
	}

	// Ethnicity
	if performer.Ethnicity != "" {
		if ethWeights, ok := s.profile.AttributeWeights["ethnicity"]; ok {
			if weight, ok := ethWeights[performer.Ethnicity]; ok {
				totalScore += weight
				attrCount++
			}
		}
	}

	// Hair color
	if performer.HairColor != "" {
		if hairWeights, ok := s.profile.AttributeWeights["hair_color"]; ok {
			if weight, ok := hairWeights[performer.HairColor]; ok {
				totalScore += weight
				attrCount++
			}
		}
	}

	// Eye color
	if performer.EyeColor != "" {
		if eyeWeights, ok := s.profile.AttributeWeights["eye_color"]; ok {
			if weight, ok := eyeWeights[performer.EyeColor]; ok {
				totalScore += weight
				attrCount++
			}
		}
	}

	if attrCount == 0 {
		return 0
	}

	return totalScore / float64(attrCount)
}

// RecommendScenes returns scenes scored by preference, optionally including watched ones.
func (s *Scorer) RecommendScenes(ctx context.Context, limit int, minScore float64, includeWatched bool, tagW, perfW, studioW float64) ([]models.RecommendationResult, error) {
	// Query scenes
	findFilter := &models.FindFilterType{
		PerPage: intPtr(500), // Get a good sample for scoring
	}
	sceneFilter := &models.SceneFilterType{}

	// If we ONLY want unwatched, filter by play duration 0
	if !includeWatched {
		sceneFilter.PlayDuration = &models.IntCriterionInput{
			Value:    0,
			Modifier: models.CriterionModifierEquals,
		}
	}

	result, err := s.sceneReader.Query(ctx, models.SceneQueryOptions{
		QueryOptions: models.QueryOptions{
			FindFilter: findFilter,
			Count:      false,
		},
		SceneFilter: sceneFilter,
	})
	if err != nil {
		return nil, err
	}

	scenes, err := result.Resolve(ctx)
	if err != nil {
		return nil, err
	}

	// Score and filter
	var recommendations []models.RecommendationResult
	for _, scene := range scenes {
		// Calculate score
		score, reason := s.ScoreScene(ctx, scene, tagW, perfW, studioW)
		if score < minScore {
			continue
		}

		rec := models.RecommendationResult{
			Type:   "scene",
			ID:     strconv.Itoa(scene.ID),
			Name:   scene.GetTitle(),
			Score:  score,
			Reason: reason,
			Scene:  scene,
		}

		recommendations = append(recommendations, rec)
	}

	// Sort by score descending
	sort.Slice(recommendations, func(i, j int) bool {
		return recommendations[i].Score > recommendations[j].Score
	})

	// Limit results
	if limit > 0 && len(recommendations) > limit {
		recommendations = recommendations[:limit]
	}

	return recommendations, nil
}

// RecommendUnwatchedScenes is a convenience wrapper for RecommendScenes with includeWatched=false
func (s *Scorer) RecommendUnwatchedScenes(ctx context.Context, limit int, minScore float64, tagW, perfW, studioW float64) ([]models.RecommendationResult, error) {
	return s.RecommendScenes(ctx, limit, minScore, false, tagW, perfW, studioW)
}

// SimilarScenes finds scenes similar to a given scene based on shared tags/performers.
func (s *Scorer) SimilarScenes(ctx context.Context, sceneID int, limit int) ([]models.RecommendationResult, error) {
	// Get the source scene
	sourceScene, err := s.sceneReader.Find(ctx, sceneID)
	if err != nil || sourceScene == nil {
		logger.Debugf("[SimilarScenes] Source scene %d not found or error: %v", sceneID, err)
		return nil, err
	}

	// Load source scene relationships
	if err := sourceScene.LoadTagIDs(ctx, s.sceneReader); err != nil {
		logger.Debugf("[SimilarScenes] Failed to load tag IDs for source scene %d: %v", sceneID, err)
		return nil, err
	}
	if err := sourceScene.LoadPerformerIDs(ctx, s.sceneReader); err != nil {
		logger.Debugf("[SimilarScenes] Failed to load performer IDs for source scene %d: %v", sceneID, err)
		// Continue without performer data
	}

	// Create a temporary profile based on this scene
	tempProfile := &ProfileData{
		TagWeights:       make(map[int]float64),
		PerformerWeights: make(map[int]float64),
		StudioWeights:    make(map[int]float64),
	}

	// Weight tags from source scene equally
	if sourceScene.TagIDs.Loaded() {
		for _, tagID := range sourceScene.TagIDs.List() {
			tempProfile.TagWeights[tagID] = 1.0
		}
	}
	if sourceScene.PerformerIDs.Loaded() {
		for _, performerID := range sourceScene.PerformerIDs.List() {
			tempProfile.PerformerWeights[performerID] = 1.0
		}
	}
	if sourceScene.StudioID != nil {
		tempProfile.StudioWeights[*sourceScene.StudioID] = 1.0
	}

	logger.Debugf("[SimilarScenes] Source scene %d profile: %d tags, %d performers, %d studios",
		sceneID, len(tempProfile.TagWeights), len(tempProfile.PerformerWeights), len(tempProfile.StudioWeights))

	// If source scene has no tags, performers, or studio, we can't find similar scenes
	if len(tempProfile.TagWeights) == 0 && len(tempProfile.PerformerWeights) == 0 && len(tempProfile.StudioWeights) == 0 {
		logger.Debugf("[SimilarScenes] Source scene %d has no tags, performers, or studio - cannot find similar scenes", sceneID)
		return nil, nil
	}

	// Create temporary scorer
	tempScorer := &Scorer{
		profile:     tempProfile,
		sceneReader: s.sceneReader,
	}

	// Query scenes and score
	findFilter := &models.FindFilterType{
		PerPage: intPtr(500),
	}

	result, err := s.sceneReader.Query(ctx, models.SceneQueryOptions{
		QueryOptions: models.QueryOptions{
			FindFilter: findFilter,
			Count:      true,
		},
	})
	if err != nil {
		logger.Debugf("[SimilarScenes] Query error: %v", err)
		return nil, err
	}

	scenes, err := result.Resolve(ctx)
	if err != nil {
		logger.Debugf("[SimilarScenes] Resolve error: %v", err)
		return nil, err
	}

	logger.Debugf("[SimilarScenes] Queried %d candidate scenes", len(scenes))

	var recommendations []models.RecommendationResult
	for _, scene := range scenes {
		// Skip the source scene
		if scene.ID == sceneID {
			continue
		}

		score, reason := tempScorer.ScoreScene(ctx, scene, 0.5, 0.3, 0.2)
		if score < 0.05 {
			continue
		}

		rec := models.RecommendationResult{
			Type:   "scene",
			ID:     strconv.Itoa(scene.ID),
			Name:   scene.GetTitle(),
			Score:  score,
			Reason: reason,
			Scene:  scene,
		}

		recommendations = append(recommendations, rec)
	}

	logger.Debugf("[SimilarScenes] Found %d similar scenes for scene %d", len(recommendations), sceneID)

	sort.Slice(recommendations, func(i, j int) bool {
		return recommendations[i].Score > recommendations[j].Score
	})

	if limit > 0 && len(recommendations) > limit {
		recommendations = recommendations[:limit]
	}

	return recommendations, nil
}

// --- Utility Functions ---

// RecommendPerformers returns performers scored by preference.
func (s *Scorer) RecommendPerformers(ctx context.Context, limit int, minScore float64, appearanceWeight, historyWeight float64) ([]models.RecommendationResult, error) {
	// Query all performers (paginated or large limit)
	// For now, let's fetch a reasonable number to score
	findFilter := &models.FindFilterType{
		PerPage: intPtr(500), // Check top 500 performers? Or maybe query all?
		// We can't really "query all" cleanly without batches, but 1000 is likely enough for local discovery
	}
	// TODO: Iterate all if needed, but 500 is a good start for performance

	result, _, err := s.performerReader.Query(ctx, &models.PerformerFilterType{}, findFilter)
	if err != nil {
		return nil, err
	}

	var recommendations []models.RecommendationResult
	for _, perf := range result {
		// Calculate score
		score, reason := s.ScorePerformer(ctx, perf, appearanceWeight, historyWeight)

		if score < minScore {
			continue
		}

		rec := models.RecommendationResult{
			Type:      "performer",
			ID:        strconv.Itoa(perf.ID),
			Name:      perf.Name,
			Score:     score,
			Reason:    reason,
			Performer: perf,
		}

		recommendations = append(recommendations, rec)
	}

	// Sort by score descending
	sort.Slice(recommendations, func(i, j int) bool {
		return recommendations[i].Score > recommendations[j].Score
	})

	// Limit
	if limit > 0 && len(recommendations) > limit {
		recommendations = recommendations[:limit]
	}

	return recommendations, nil
}

// --- Utility Functions ---

func joinReasons(reasons []string) string {
	if len(reasons) == 0 {
		return ""
	}
	if len(reasons) == 1 {
		return reasons[0]
	}

	// Use strings.Builder to avoid repeated string allocations
	var b strings.Builder
	// Pre-calculate approximate size: avg 20 chars per reason + separators
	b.Grow(len(reasons) * 22)

	b.WriteString(reasons[0])
	for i := 1; i < len(reasons)-1; i++ {
		b.WriteString(", ")
		b.WriteString(reasons[i])
	}
	b.WriteString(" and ")
	b.WriteString(reasons[len(reasons)-1])
	return b.String()
}
