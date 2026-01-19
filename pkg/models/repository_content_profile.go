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
}
