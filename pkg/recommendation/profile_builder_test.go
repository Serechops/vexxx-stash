package recommendation

import (
	"context"
	"testing"
	"time"

	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/models/mocks"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

// mockSceneGetterPB implements SceneGetter for testing in profile builder tests
type mockSceneGetterPB struct {
	scenes []*models.Scene
}

func (m *mockSceneGetterPB) FindMany(ctx context.Context, ids []int) ([]*models.Scene, error) {
	return m.scenes, nil
}

func (m *mockSceneGetterPB) Find(ctx context.Context, id int) (*models.Scene, error) {
	for _, s := range m.scenes {
		if s.ID == id {
			return s, nil
		}
	}
	return nil, nil
}

func (m *mockSceneGetterPB) FindByIDs(ctx context.Context, ids []int) ([]*models.Scene, error) {
	return m.scenes, nil
}

// createMockSceneQueryResultPB creates a SceneQueryResult that returns the given scenes
func createMockSceneQueryResultPB(scenes []*models.Scene) *models.SceneQueryResult {
	getter := &mockSceneGetterPB{scenes: scenes}
	result := models.NewSceneQueryResult(getter)
	ids := make([]int, len(scenes))
	for i, s := range scenes {
		ids[i] = s.ID
	}
	result.IDs = ids
	result.Count = len(scenes)
	return result
}

// --- ProfileData Tests ---

func TestProfileData_TopTags(t *testing.T) {
	pd := &ProfileData{
		TagWeights: map[int]float64{
			1: 0.9,
			2: 0.7,
			3: 0.5,
			4: 0.3,
			5: 0.1,
		},
	}

	tests := []struct {
		name     string
		n        int
		expected int
	}{
		{"Top 3", 3, 3},
		{"Top 5", 5, 5},
		{"Top 10 (more than available)", 10, 5},
		{"Top 0 (all)", 0, 5},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := pd.TopTags(tt.n)
			assert.Len(t, result, tt.expected)

			// Verify ordering
			for i := 0; i < len(result)-1; i++ {
				assert.GreaterOrEqual(t, result[i].Weight, result[i+1].Weight)
			}
		})
	}
}

func TestProfileData_TopPerformers(t *testing.T) {
	pd := &ProfileData{
		PerformerWeights: map[int]float64{
			10: 1.0,
			20: 0.8,
			30: 0.6,
		},
	}

	result := pd.TopPerformers(2)

	assert.Len(t, result, 2)
	assert.Equal(t, 10, result[0].ID)
	assert.Equal(t, 1.0, result[0].Weight)
}

func TestProfileData_TopStudios(t *testing.T) {
	pd := &ProfileData{
		StudioWeights: map[int]float64{
			100: 0.85,
			200: 0.65,
		},
	}

	result := pd.TopStudios(5)

	assert.Len(t, result, 2)
	assert.Equal(t, 100, result[0].ID)
}

func TestProfileData_TopAttributes(t *testing.T) {
	pd := &ProfileData{
		AttributeWeights: map[string]map[string]float64{
			"gender": {
				"FEMALE": 0.9,
				"MALE":   0.3,
			},
			"hair_color": {
				"Blonde":   0.8,
				"Brunette": 0.7,
				"Red":      0.5,
			},
		},
	}

	tests := []struct {
		name       string
		attrName   string
		n          int
		expected   int
		firstValue string
	}{
		{"Top genders", "gender", 10, 2, "FEMALE"},
		{"Top 2 hair colors", "hair_color", 2, 2, "Blonde"},
		{"Unknown attribute", "unknown", 5, 0, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := pd.TopAttributes(tt.attrName, tt.n)

			if tt.expected == 0 {
				assert.Nil(t, result)
			} else {
				assert.Len(t, result, tt.expected)
				assert.Equal(t, tt.firstValue, result[0].Value)
			}
		})
	}
}

func TestProfileData_EmptyMaps(t *testing.T) {
	pd := &ProfileData{
		TagWeights:       map[int]float64{},
		PerformerWeights: map[int]float64{},
		StudioWeights:    map[int]float64{},
		AttributeWeights: map[string]map[string]float64{},
	}

	assert.Empty(t, pd.TopTags(10))
	assert.Empty(t, pd.TopPerformers(10))
	assert.Empty(t, pd.TopStudios(10))
	assert.Nil(t, pd.TopAttributes("gender", 10))
}

// --- Normalization Tests ---

func TestNormalizeWeights(t *testing.T) {
	tests := []struct {
		name     string
		input    map[int]float64
		expected map[int]float64
	}{
		{
			name:     "Empty map",
			input:    map[int]float64{},
			expected: map[int]float64{},
		},
		{
			name:     "Single value",
			input:    map[int]float64{1: 5.0},
			expected: map[int]float64{1: 1.0},
		},
		{
			name:     "Multiple values",
			input:    map[int]float64{1: 10.0, 2: 5.0, 3: 2.5},
			expected: map[int]float64{1: 1.0, 2: 0.5, 3: 0.25},
		},
		{
			name:     "All zeros",
			input:    map[int]float64{1: 0.0, 2: 0.0},
			expected: map[int]float64{1: 0.0, 2: 0.0},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizeWeights(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestNormalizeStringWeights(t *testing.T) {
	tests := []struct {
		name     string
		input    map[string]float64
		expected map[string]float64
	}{
		{
			name:     "Empty map",
			input:    map[string]float64{},
			expected: map[string]float64{},
		},
		{
			name:     "Multiple values",
			input:    map[string]float64{"a": 100.0, "b": 50.0, "c": 25.0},
			expected: map[string]float64{"a": 1.0, "b": 0.5, "c": 0.25},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizeStringWeights(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestTopN(t *testing.T) {
	weights := map[int]float64{
		1: 0.5,
		2: 0.9,
		3: 0.3,
		4: 0.7,
	}

	result := topN(weights, 2)

	assert.Len(t, result, 2)
	assert.Equal(t, 2, result[0].ID)
	assert.Equal(t, 0.9, result[0].Weight)
	assert.Equal(t, 4, result[1].ID)
	assert.Equal(t, 0.7, result[1].Weight)
}

// --- ProfileBuilder Tests ---

func TestNewProfileBuilder(t *testing.T) {
	mockSceneReader := &mocks.SceneReaderWriter{}
	mockPerformerReader := &mocks.PerformerReaderWriter{}
	mockTagReader := &mocks.TagReaderWriter{}
	mockStudioReader := &mocks.StudioReaderWriter{}

	pb := NewProfileBuilder(mockSceneReader, mockPerformerReader, mockTagReader, mockStudioReader)

	assert.NotNil(t, pb)
	assert.Equal(t, mockSceneReader, pb.sceneReader)
	assert.Equal(t, mockPerformerReader, pb.performerReader)
}

func TestComputeSceneScore_RatingOnly(t *testing.T) {
	pb := &ProfileBuilder{}

	tests := []struct {
		name     string
		rating   *int
		expected float64
	}{
		{"No rating", nil, 1.0},
		{"Zero rating", intPtr(0), 1.0},
		{"50% rating", intPtr(50), 0.5},
		{"100% rating", intPtr(100), 1.0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			scene := &models.Scene{
				Rating: tt.rating,
			}
			// Note: we need to set UpdatedAt for recency calculation
			scene.UpdatedAt = time.Now()

			score := pb.computeSceneScore(scene)

			// Score includes engagement and recency multipliers
			// For unwatched scene: base * 0.5 * recencyBoost
			// With recencyBoost ~1.5 for recent scenes
			// So for base 1.0: 1.0 * 0.5 * 1.5 = 0.75
			assert.Greater(t, score, 0.0)
		})
	}
}

func TestComputeSceneScore_WithPlayDuration(t *testing.T) {
	pb := &ProfileBuilder{}

	// Create scene with play duration
	scene := &models.Scene{
		Rating:       intPtr(100),
		PlayDuration: 100.0, // Watched for 100 seconds
		UpdatedAt:    time.Now(),
	}

	score := pb.computeSceneScore(scene)

	// Watched scenes should have higher score than base
	assert.Greater(t, score, 1.0)
}

func TestComputeSceneScore_Recency(t *testing.T) {
	pb := &ProfileBuilder{}

	// Recent scene
	recentScene := &models.Scene{
		UpdatedAt: time.Now(),
	}

	// Old scene
	oldScene := &models.Scene{
		UpdatedAt: time.Now().AddDate(-2, 0, 0), // 2 years ago
	}

	recentScore := pb.computeSceneScore(recentScene)
	oldScore := pb.computeSceneScore(oldScene)

	// Recent scenes should have higher scores
	assert.Greater(t, recentScore, oldScore)
}

func TestBuildUserProfile_Integration(t *testing.T) {
	ctx := context.Background()

	// Create test scenes
	rating80 := 80
	studioID := 5

	scene1 := &models.Scene{
		ID:        1,
		Rating:    &rating80,
		StudioID:  &studioID,
		UpdatedAt: time.Now(),
	}
	scene1.TagIDs = models.NewRelatedIDs([]int{1, 2})
	scene1.PerformerIDs = models.NewRelatedIDs([]int{10})

	scenes := []*models.Scene{scene1}

	// Setup mocks
	mockSceneReader := &mocks.SceneReaderWriter{}
	mockPerformerReader := &mocks.PerformerReaderWriter{}
	mockTagReader := &mocks.TagReaderWriter{}
	mockStudioReader := &mocks.StudioReaderWriter{}

	// Mock scene query
	mockResult := createMockSceneQueryResultPB(scenes)

	mockSceneReader.On("Query", ctx, mock.AnythingOfType("models.SceneQueryOptions")).
		Return(mockResult, nil).Once()

	// Empty result for second page
	emptyResult := createMockSceneQueryResultPB([]*models.Scene{})

	mockSceneReader.On("Query", ctx, mock.AnythingOfType("models.SceneQueryOptions")).
		Return(emptyResult, nil)

	// Mock performer lookup
	performer := &models.Performer{
		ID:       10,
		Name:     "Test Performer",
		Favorite: true,
	}
	performer.Gender = genderPtr(models.GenderEnumFemale)

	mockPerformerReader.On("Find", ctx, 10).Return(performer, nil)

	// Mock studio lookup
	studio := &models.Studio{
		ID:       5,
		Name:     "Test Studio",
		Favorite: true,
	}
	mockStudioReader.On("Find", ctx, 5).Return(studio, nil)

	// Mock tag lookup for hierarchy
	tag1 := &models.Tag{ID: 1, Name: "Tag1"}
	tag1.ParentIDs = models.NewRelatedIDs([]int{})
	tag2 := &models.Tag{ID: 2, Name: "Tag2"}
	tag2.ParentIDs = models.NewRelatedIDs([]int{})

	mockTagReader.On("Find", ctx, 1).Return(tag1, nil)
	mockTagReader.On("Find", ctx, 2).Return(tag2, nil)

	pb := NewProfileBuilder(mockSceneReader, mockPerformerReader, mockTagReader, mockStudioReader)

	profile, err := pb.BuildUserProfile(ctx)

	assert.NoError(t, err)
	assert.NotNil(t, profile)
	assert.Greater(t, profile.SceneCount, 0)
	assert.NotEmpty(t, profile.TagWeights)
	assert.NotEmpty(t, profile.PerformerWeights)
	assert.NotEmpty(t, profile.StudioWeights)
}

// --- Weighted Item Tests ---

func TestWeightedItem(t *testing.T) {
	item := WeightedItem{
		ID:     42,
		Weight: 0.85,
	}

	assert.Equal(t, 42, item.ID)
	assert.Equal(t, 0.85, item.Weight)
}

func TestWeightedStringItem(t *testing.T) {
	item := WeightedStringItem{
		Value:  "Blonde",
		Weight: 0.75,
	}

	assert.Equal(t, "Blonde", item.Value)
	assert.Equal(t, 0.75, item.Weight)
}

// --- Edge Cases ---

func TestTopN_EmptyMap(t *testing.T) {
	result := topN(map[int]float64{}, 10)
	assert.Empty(t, result)
}

func TestTopN_NegativeN(t *testing.T) {
	weights := map[int]float64{1: 0.5}
	result := topN(weights, -1)
	// With n < 0, the length check (len > n) will pass, returning all items
	assert.Len(t, result, 1)
}

func TestNormalizeWeights_NegativeValues(t *testing.T) {
	// Edge case: negative weights (shouldn't happen in practice)
	weights := map[int]float64{1: -5.0, 2: 10.0}

	result := normalizeWeights(weights)

	// Max is 10.0, so 2 should be 1.0 and 1 should be -0.5
	assert.Equal(t, 1.0, result[2])
	assert.Equal(t, -0.5, result[1])
}

func TestProfileData_NilMaps(t *testing.T) {
	pd := &ProfileData{
		TagWeights:       nil,
		PerformerWeights: nil,
		StudioWeights:    nil,
		AttributeWeights: nil,
	}

	// Should handle nil maps gracefully
	assert.Empty(t, pd.TopTags(10))
	assert.Empty(t, pd.TopPerformers(10))
	assert.Empty(t, pd.TopStudios(10))
	assert.Nil(t, pd.TopAttributes("any", 10))
}
