package models

import "context"

type ContentProfileReaderWriter interface {
	Create(ctx context.Context, newContentProfile *ContentProfile) error
	Update(ctx context.Context, updatedContentProfile *ContentProfile) error
	Destroy(ctx context.Context, id int) error
	Find(ctx context.Context, id int) (*ContentProfile, error)
	FindAll(ctx context.Context) ([]*ContentProfile, error)

	// Weight management
	SaveWeights(ctx context.Context, profile *ContentProfile) error
	LoadWeights(ctx context.Context, profile *ContentProfile) error

	// Incremental weight nudges (used by like/unlike signals)
	NudgeTagWeights(ctx context.Context, profileID int, tagIDs []int, delta float64) error
	NudgePerformerWeights(ctx context.Context, profileID int, performerIDs []int, delta float64) error
	NudgeStudioWeight(ctx context.Context, profileID, studioID int, delta float64) error
}
