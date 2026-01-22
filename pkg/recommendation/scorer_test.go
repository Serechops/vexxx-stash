package recommendation

import (
	"context"
	"testing"

	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/models/mocks"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

// --- Test Helpers ---

// Note: intPtr is already defined in profile_builder.go, reuse it

func strPtr(s string) *string {
	return &s
}

func genderPtr(g models.GenderEnum) *models.GenderEnum {
	return &g
}

// mockSceneGetter implements SceneGetter for testing
type mockSceneGetter struct {
	scenes []*models.Scene
}

func (m *mockSceneGetter) FindMany(ctx context.Context, ids []int) ([]*models.Scene, error) {
	return m.scenes, nil
}

func (m *mockSceneGetter) Find(ctx context.Context, id int) (*models.Scene, error) {
	for _, s := range m.scenes {
		if s.ID == id {
			return s, nil
		}
	}
	return nil, nil
}

func (m *mockSceneGetter) FindByIDs(ctx context.Context, ids []int) ([]*models.Scene, error) {
	return m.scenes, nil
}

// createMockSceneQueryResult creates a SceneQueryResult that returns the given scenes
func createMockSceneQueryResult(scenes []*models.Scene) *models.SceneQueryResult {
	getter := &mockSceneGetter{scenes: scenes}
	result := models.NewSceneQueryResult(getter)
	ids := make([]int, len(scenes))
	for i, s := range scenes {
		ids[i] = s.ID
	}
	result.IDs = ids
	result.Count = len(scenes)
	return result
}

// createMockScene creates a test scene with loaded relationships
func createMockScene(id int, tagIDs, performerIDs []int, studioID *int) *models.Scene {
	scene := &models.Scene{
		ID:       id,
		Title:    "Test Scene",
		StudioID: studioID,
	}
	scene.TagIDs = models.NewRelatedIDs(tagIDs)
	scene.PerformerIDs = models.NewRelatedIDs(performerIDs)
	return scene
}

// createMockPerformer creates a test performer with attributes
func createMockPerformer(id int, name string, gender *models.GenderEnum, ethnicity, hairColor, eyeColor string) *models.Performer {
	return &models.Performer{
		ID:        id,
		Name:      name,
		Gender:    gender,
		Ethnicity: ethnicity,
		HairColor: hairColor,
		EyeColor:  eyeColor,
	}
}

// --- Scorer Unit Tests ---

func TestNewScorer(t *testing.T) {
	profile := &ProfileData{
		TagWeights:       map[int]float64{1: 0.5},
		PerformerWeights: map[int]float64{1: 0.8},
		StudioWeights:    map[int]float64{1: 0.6},
	}

	mockSceneReader := &mocks.SceneReaderWriter{}
	mockPerformerReader := &mocks.PerformerReaderWriter{}
	mockStudioReader := &mocks.StudioReaderWriter{}
	mockTagReader := &mocks.TagReaderWriter{}

	scorer := NewScorer(profile, mockSceneReader, mockPerformerReader, mockStudioReader, mockTagReader)

	assert.NotNil(t, scorer)
	assert.Equal(t, profile, scorer.profile)
}

func TestScoreScene_NilProfile(t *testing.T) {
	scorer := &Scorer{profile: nil}
	scene := createMockScene(1, []int{1, 2}, []int{1}, intPtr(1))

	score, reason := scorer.ScoreScene(context.Background(), scene, 0.5, 0.3, 0.2)

	assert.Equal(t, 0.0, score)
	assert.Equal(t, "", reason)
}

func TestScoreScene_EmptyTagWeights(t *testing.T) {
	profile := &ProfileData{
		TagWeights: map[int]float64{},
	}
	scorer := &Scorer{profile: profile}
	scene := createMockScene(1, []int{1, 2}, []int{1}, intPtr(1))

	score, reason := scorer.ScoreScene(context.Background(), scene, 0.5, 0.3, 0.2)

	assert.Equal(t, 0.0, score)
	assert.Equal(t, "", reason)
}

func TestScoreScene_TagsOnly(t *testing.T) {
	profile := &ProfileData{
		TagWeights:       map[int]float64{1: 0.8, 2: 0.6},
		PerformerWeights: map[int]float64{},
		StudioWeights:    map[int]float64{},
	}

	mockSceneReader := &mocks.SceneReaderWriter{}
	scorer := NewScorer(profile, mockSceneReader, nil, nil, nil)

	// Scene with two matching tags (IDs 1 and 2)
	scene := createMockScene(1, []int{1, 2}, []int{}, nil)

	score, reason := scorer.ScoreScene(context.Background(), scene, 0.5, 0.3, 0.2)

	// Expected: average tag weight (0.8 + 0.6) / 2 = 0.7, then * tagWeight 0.5 = 0.35
	expectedScore := 0.35
	assert.InDelta(t, expectedScore, score, 0.001)
	assert.Contains(t, reason, "matching tags")
}

func TestScoreScene_PerformersOnly(t *testing.T) {
	profile := &ProfileData{
		TagWeights:       map[int]float64{999: 0.1}, // Has at least one tag weight to pass nil check
		PerformerWeights: map[int]float64{1: 0.9, 2: 0.7},
		StudioWeights:    map[int]float64{},
	}

	mockSceneReader := &mocks.SceneReaderWriter{}
	scorer := NewScorer(profile, mockSceneReader, nil, nil, nil)

	// Scene with two matching performers (IDs 1 and 2) but no matching tags
	scene := createMockScene(1, []int{100}, []int{1, 2}, nil)

	score, reason := scorer.ScoreScene(context.Background(), scene, 0.5, 0.3, 0.2)

	// Expected: average performer weight (0.9 + 0.7) / 2 = 0.8, then * perfWeight 0.3 = 0.24
	expectedScore := 0.24
	assert.InDelta(t, expectedScore, score, 0.001)
	assert.Contains(t, reason, "favorite performers")
}

func TestScoreScene_StudioOnly(t *testing.T) {
	studioID := 5
	profile := &ProfileData{
		TagWeights:       map[int]float64{999: 0.1}, // Has at least one tag weight
		PerformerWeights: map[int]float64{},
		StudioWeights:    map[int]float64{5: 0.75},
	}

	mockSceneReader := &mocks.SceneReaderWriter{}
	scorer := NewScorer(profile, mockSceneReader, nil, nil, nil)

	// Scene with matching studio but no matching tags/performers
	scene := createMockScene(1, []int{100}, []int{100}, &studioID)

	score, reason := scorer.ScoreScene(context.Background(), scene, 0.5, 0.3, 0.2)

	// Expected: studio weight 0.75 * studioWeight 0.2 = 0.15
	expectedScore := 0.15
	assert.InDelta(t, expectedScore, score, 0.001)
	assert.Contains(t, reason, "preferred studio")
}

func TestScoreScene_CombinedFactors(t *testing.T) {
	studioID := 5
	profile := &ProfileData{
		TagWeights:       map[int]float64{1: 0.8, 2: 0.6},
		PerformerWeights: map[int]float64{10: 1.0},
		StudioWeights:    map[int]float64{5: 0.9},
	}

	mockSceneReader := &mocks.SceneReaderWriter{}
	scorer := NewScorer(profile, mockSceneReader, nil, nil, nil)

	// Scene with matching tags, performer, and studio
	scene := createMockScene(1, []int{1, 2, 3}, []int{10}, &studioID)

	score, reason := scorer.ScoreScene(context.Background(), scene, 0.5, 0.3, 0.2)

	// Expected:
	// Tags: (0.8 + 0.6) / 2 = 0.7 * 0.5 = 0.35
	// Performers: 1.0 / 1 = 1.0 * 0.3 = 0.3
	// Studio: 0.9 * 0.2 = 0.18
	// Total: 0.35 + 0.3 + 0.18 = 0.83
	expectedScore := 0.83
	assert.InDelta(t, expectedScore, score, 0.001)
	assert.Contains(t, reason, "matching tags")
	assert.Contains(t, reason, "favorite performers")
	assert.Contains(t, reason, "preferred studio")
}

func TestScoreScene_NoMatchingWeights(t *testing.T) {
	profile := &ProfileData{
		TagWeights:       map[int]float64{100: 0.5}, // Different tag ID
		PerformerWeights: map[int]float64{100: 0.5},
		StudioWeights:    map[int]float64{100: 0.5},
	}

	mockSceneReader := &mocks.SceneReaderWriter{}
	scorer := NewScorer(profile, mockSceneReader, nil, nil, nil)

	// Scene with non-matching IDs
	scene := createMockScene(1, []int{1, 2}, []int{1}, intPtr(1))

	score, reason := scorer.ScoreScene(context.Background(), scene, 0.5, 0.3, 0.2)

	assert.Equal(t, 0.0, score)
	assert.Equal(t, "", reason)
}

// --- Performer Scoring Tests ---

func TestScorePerformer_NilProfile(t *testing.T) {
	scorer := &Scorer{profile: nil}
	performer := createMockPerformer(1, "Test", nil, "", "", "")

	score, reason := scorer.ScorePerformer(context.Background(), performer, 0.5, 0.5)

	assert.Equal(t, 0.0, score)
	assert.Equal(t, "", reason)
}

func TestScorePerformer_HistoryOnly(t *testing.T) {
	profile := &ProfileData{
		PerformerWeights: map[int]float64{1: 0.9},
		AttributeWeights: map[string]map[string]float64{},
	}
	scorer := &Scorer{profile: profile}

	performer := createMockPerformer(1, "Jane Doe", nil, "", "", "")

	score, reason := scorer.ScorePerformer(context.Background(), performer, 0.5, 0.5)

	// Expected: performer weight 0.9 * historyWeight 0.5 = 0.45
	expectedScore := 0.45
	assert.InDelta(t, expectedScore, score, 0.001)
	assert.Contains(t, reason, "viewing history")
}

func TestScorePerformer_AttributesOnly(t *testing.T) {
	gender := models.GenderEnumFemale
	profile := &ProfileData{
		PerformerWeights: map[int]float64{},
		AttributeWeights: map[string]map[string]float64{
			"gender":     {"FEMALE": 0.8},
			"ethnicity":  {"Caucasian": 0.6},
			"hair_color": {"Blonde": 0.7},
			"eye_color":  {"Blue": 0.5},
		},
	}
	scorer := &Scorer{profile: profile}

	performer := createMockPerformer(99, "Jane Doe", &gender, "Caucasian", "Blonde", "Blue")

	score, reason := scorer.ScorePerformer(context.Background(), performer, 0.5, 0.5)

	// Expected: average attribute weight (0.8 + 0.6 + 0.7 + 0.5) / 4 = 0.65 * 0.5 = 0.325
	expectedScore := 0.325
	assert.InDelta(t, expectedScore, score, 0.001)
	assert.Contains(t, reason, "matching attributes")
}

func TestScorePerformer_CombinedFactors(t *testing.T) {
	gender := models.GenderEnumFemale
	profile := &ProfileData{
		PerformerWeights: map[int]float64{1: 0.8},
		AttributeWeights: map[string]map[string]float64{
			"gender":    {"FEMALE": 1.0},
			"hair_color": {"Brunette": 0.8},
		},
	}
	scorer := &Scorer{profile: profile}

	performer := createMockPerformer(1, "Jane Doe", &gender, "", "Brunette", "")

	score, reason := scorer.ScorePerformer(context.Background(), performer, 0.4, 0.6)

	// Expected:
	// History: 0.8 * 0.6 = 0.48
	// Attributes: (1.0 + 0.8) / 2 = 0.9 * 0.4 = 0.36
	// Total: 0.48 + 0.36 = 0.84
	expectedScore := 0.84
	assert.InDelta(t, expectedScore, score, 0.001)
	assert.Contains(t, reason, "viewing history")
	assert.Contains(t, reason, "matching attributes")
}

func TestScorePerformerAttributes_PartialMatch(t *testing.T) {
	gender := models.GenderEnumFemale
	profile := &ProfileData{
		AttributeWeights: map[string]map[string]float64{
			"gender":     {"FEMALE": 0.8},
			"ethnicity":  {"Asian": 0.6}, // Won't match
			"hair_color": {"Blonde": 0.7},
		},
	}
	scorer := &Scorer{profile: profile}

	// Performer matches gender and hair_color, but not ethnicity
	performer := createMockPerformer(1, "Jane", &gender, "Caucasian", "Blonde", "")

	attrScore := scorer.scorePerformerAttributes(performer)

	// Expected: (0.8 + 0.7) / 2 = 0.75 (only matching attributes counted)
	expectedScore := 0.75
	assert.InDelta(t, expectedScore, attrScore, 0.001)
}

func TestScorePerformerAttributes_NoMatches(t *testing.T) {
	profile := &ProfileData{
		AttributeWeights: map[string]map[string]float64{
			"gender": {"MALE": 0.8},
		},
	}
	scorer := &Scorer{profile: profile}

	gender := models.GenderEnumFemale
	performer := createMockPerformer(1, "Jane", &gender, "", "", "")

	attrScore := scorer.scorePerformerAttributes(performer)

	assert.Equal(t, 0.0, attrScore)
}

func TestScorePerformerAttributes_NilAttributeWeights(t *testing.T) {
	profile := &ProfileData{
		AttributeWeights: nil,
	}
	scorer := &Scorer{profile: profile}

	performer := createMockPerformer(1, "Jane", nil, "", "", "")

	attrScore := scorer.scorePerformerAttributes(performer)

	assert.Equal(t, 0.0, attrScore)
}

// --- Reason Formatting Tests ---

func TestJoinReasons_Empty(t *testing.T) {
	result := joinReasons([]string{})
	assert.Equal(t, "", result)
}

func TestJoinReasons_Single(t *testing.T) {
	result := joinReasons([]string{"matching tags"})
	assert.Equal(t, "matching tags", result)
}

func TestJoinReasons_Two(t *testing.T) {
	result := joinReasons([]string{"matching tags", "favorite performers"})
	assert.Equal(t, "matching tags and favorite performers", result)
}

func TestJoinReasons_Three(t *testing.T) {
	result := joinReasons([]string{"matching tags", "favorite performers", "preferred studio"})
	assert.Equal(t, "matching tags, favorite performers and preferred studio", result)
}

// --- Integration Tests with Mock Repositories ---

func TestRecommendScenes_Integration(t *testing.T) {
	ctx := context.Background()

	// Setup profile
	profile := &ProfileData{
		TagWeights:       map[int]float64{1: 0.9, 2: 0.7},
		PerformerWeights: map[int]float64{10: 0.8},
		StudioWeights:    map[int]float64{5: 0.6},
	}

	// Create mock scenes
	scene1 := createMockScene(1, []int{1, 2}, []int{10}, intPtr(5))
	scene1.Title = "High Score Scene"

	scene2 := createMockScene(2, []int{1}, []int{}, nil)
	scene2.Title = "Medium Score Scene"

	scene3 := createMockScene(3, []int{99}, []int{99}, intPtr(99))
	scene3.Title = "No Match Scene"

	scenes := []*models.Scene{scene1, scene2, scene3}

	// Setup mock scene reader
	mockSceneReader := &mocks.SceneReaderWriter{}

	// Mock Query to return our test scenes
	mockResult := createMockSceneQueryResult(scenes)

	mockSceneReader.On("Query", ctx, mock.AnythingOfType("models.SceneQueryOptions")).
		Return(mockResult, nil)

	scorer := NewScorer(profile, mockSceneReader, nil, nil, nil)

	// Run recommendation
	results, err := scorer.RecommendScenes(ctx, 10, 0.1, true, 0.5, 0.3, 0.2)

	assert.NoError(t, err)
	assert.NotEmpty(t, results)

	// Verify ordering (highest score first)
	if len(results) >= 2 {
		assert.GreaterOrEqual(t, results[0].Score, results[1].Score)
	}

	// Verify high-scoring scene is included
	found := false
	for _, r := range results {
		if r.ID == "1" {
			found = true
			assert.Greater(t, r.Score, 0.5)
		}
	}
	assert.True(t, found, "High scoring scene should be in results")
}

func TestRecommendScenes_WithMinScore(t *testing.T) {
	ctx := context.Background()

	profile := &ProfileData{
		TagWeights:       map[int]float64{1: 0.5},
		PerformerWeights: map[int]float64{},
		StudioWeights:    map[int]float64{},
	}

	// Scene with low score
	lowScoreScene := createMockScene(1, []int{1}, []int{}, nil)

	// Scene with no matching tags (zero score)
	zeroScoreScene := createMockScene(2, []int{99}, []int{}, nil)

	mockSceneReader := &mocks.SceneReaderWriter{}
	mockResult := createMockSceneQueryResult([]*models.Scene{lowScoreScene, zeroScoreScene})

	mockSceneReader.On("Query", ctx, mock.AnythingOfType("models.SceneQueryOptions")).
		Return(mockResult, nil)

	scorer := NewScorer(profile, mockSceneReader, nil, nil, nil)

	// High min score should filter out low-scoring scene
	results, err := scorer.RecommendScenes(ctx, 10, 0.5, true, 0.5, 0.3, 0.2)

	assert.NoError(t, err)
	assert.Empty(t, results, "All scenes should be filtered by min score")
}

func TestRecommendScenes_WithLimit(t *testing.T) {
	ctx := context.Background()

	profile := &ProfileData{
		TagWeights:       map[int]float64{1: 0.9, 2: 0.8, 3: 0.7},
		PerformerWeights: map[int]float64{},
		StudioWeights:    map[int]float64{},
	}

	// Create multiple scenes
	scenes := make([]*models.Scene, 10)
	for i := 0; i < 10; i++ {
		scenes[i] = createMockScene(i+1, []int{1, 2, 3}, []int{}, nil)
	}

	mockSceneReader := &mocks.SceneReaderWriter{}
	mockResult := createMockSceneQueryResult(scenes)

	mockSceneReader.On("Query", ctx, mock.AnythingOfType("models.SceneQueryOptions")).
		Return(mockResult, nil)

	scorer := NewScorer(profile, mockSceneReader, nil, nil, nil)

	// Limit to 3 results
	results, err := scorer.RecommendScenes(ctx, 3, 0.0, true, 0.5, 0.3, 0.2)

	assert.NoError(t, err)
	assert.Len(t, results, 3)
}

func TestSimilarScenes_Integration(t *testing.T) {
	ctx := context.Background()

	// Source scene
	sourceScene := createMockScene(1, []int{1, 2, 3}, []int{10, 20}, intPtr(5))

	// Similar scenes
	similarScene := createMockScene(2, []int{1, 2}, []int{10}, intPtr(5))
	similarScene.Title = "Similar Scene"

	// Dissimilar scene
	dissimilarScene := createMockScene(3, []int{99}, []int{99}, intPtr(99))
	dissimilarScene.Title = "Different Scene"

	mockSceneReader := &mocks.SceneReaderWriter{}

	// Mock Find for source scene
	mockSceneReader.On("Find", ctx, 1).Return(sourceScene, nil)

	// Mock Query for finding similar scenes
	mockResult := createMockSceneQueryResult([]*models.Scene{sourceScene, similarScene, dissimilarScene})

	mockSceneReader.On("Query", ctx, mock.AnythingOfType("models.SceneQueryOptions")).
		Return(mockResult, nil)

	scorer := NewScorer(nil, mockSceneReader, nil, nil, nil)

	results, err := scorer.SimilarScenes(ctx, 1, 5)

	assert.NoError(t, err)
	// Source scene should not be in results
	for _, r := range results {
		assert.NotEqual(t, "1", r.ID, "Source scene should not be in similar results")
	}
}

func TestRecommendPerformers_Integration(t *testing.T) {
	ctx := context.Background()

	gender := models.GenderEnumFemale
	profile := &ProfileData{
		PerformerWeights: map[int]float64{1: 0.9, 2: 0.5},
		AttributeWeights: map[string]map[string]float64{
			"gender":    {"FEMALE": 0.8},
			"hair_color": {"Blonde": 0.7},
		},
	}

	// Create mock performers
	performer1 := createMockPerformer(1, "Favorite Performer", &gender, "", "Blonde", "")
	performer2 := createMockPerformer(2, "Moderate Performer", nil, "", "", "")
	performer3 := createMockPerformer(3, "Unknown Performer", nil, "", "", "")

	mockPerformerReader := &mocks.PerformerReaderWriter{}

	mockPerformerReader.On("Query", ctx, mock.AnythingOfType("*models.PerformerFilterType"), mock.AnythingOfType("*models.FindFilterType")).
		Return([]*models.Performer{performer1, performer2, performer3}, 3, nil)

	scorer := NewScorer(profile, nil, mockPerformerReader, nil, nil)

	results, err := scorer.RecommendPerformers(ctx, 10, 0.1, 0.5, 0.5)

	assert.NoError(t, err)
	assert.NotEmpty(t, results)

	// Verify ordering
	if len(results) >= 2 {
		assert.GreaterOrEqual(t, results[0].Score, results[1].Score)
	}

	// Verify favorite performer is first
	if len(results) > 0 {
		assert.Equal(t, "1", results[0].ID)
	}
}

// --- Edge Case Tests ---

func TestScoreScene_WeightBoundaries(t *testing.T) {
	tests := []struct {
		name          string
		tagWeight     float64
		perfWeight    float64
		studioWeight  float64
		expectedRange [2]float64 // min, max
	}{
		{"All Zero Weights", 0.0, 0.0, 0.0, [2]float64{0.0, 0.0}},
		{"All Max Weights", 1.0, 1.0, 1.0, [2]float64{0.0, 3.0}},
		{"Normalized Weights", 0.5, 0.3, 0.2, [2]float64{0.0, 1.0}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			profile := &ProfileData{
				TagWeights:       map[int]float64{1: 1.0},
				PerformerWeights: map[int]float64{1: 1.0},
				StudioWeights:    map[int]float64{1: 1.0},
			}

			scorer := &Scorer{profile: profile}
			scene := createMockScene(1, []int{1}, []int{1}, intPtr(1))

			score, _ := scorer.ScoreScene(context.Background(), scene, tt.tagWeight, tt.perfWeight, tt.studioWeight)

			assert.GreaterOrEqual(t, score, tt.expectedRange[0])
			assert.LessOrEqual(t, score, tt.expectedRange[1])
		})
	}
}

func TestScoreScene_LargeNumberOfTags(t *testing.T) {
	// Create profile with many tags
	tagWeights := make(map[int]float64)
	tagIDs := make([]int, 100)
	for i := 0; i < 100; i++ {
		tagWeights[i] = 0.5
		tagIDs[i] = i
	}

	profile := &ProfileData{
		TagWeights:       tagWeights,
		PerformerWeights: map[int]float64{},
		StudioWeights:    map[int]float64{},
	}

	scorer := &Scorer{profile: profile}
	scene := createMockScene(1, tagIDs, []int{}, nil)

	score, _ := scorer.ScoreScene(context.Background(), scene, 1.0, 0.0, 0.0)

	// Average should still be 0.5 regardless of count
	assert.InDelta(t, 0.5, score, 0.001)
}
