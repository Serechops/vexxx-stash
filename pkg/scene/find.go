package scene

import (
	"context"
	"fmt"

	"github.com/stashapp/stash/pkg/models"
)

type LoadRelationshipOption func(context.Context, *models.Scene, models.SceneReader) error

func LoadURLs(ctx context.Context, scene *models.Scene, r models.SceneReader) error {
	if err := scene.LoadURLs(ctx, r); err != nil {
		return fmt.Errorf("loading scene URLs: %w", err)
	}

	return nil
}

func LoadStashIDs(ctx context.Context, scene *models.Scene, r models.SceneReader) error {
	if err := scene.LoadStashIDs(ctx, r); err != nil {
		return fmt.Errorf("failed to load stash IDs for scene %d: %w", scene.ID, err)
	}

	return nil
}

func LoadFiles(ctx context.Context, scene *models.Scene, r models.SceneReader) error {
	if err := scene.LoadFiles(ctx, r); err != nil {
		return fmt.Errorf("failed to load files for scene %d: %w", scene.ID, err)
	}

	return nil
}

// bulkLoadRelationships batch-loads all standard relationships for a slice of scenes
// using a single SQL query per relationship type instead of one query per scene.
func bulkLoadRelationships(ctx context.Context, scenes []*models.Scene, r models.SceneReader) error {
	if len(scenes) == 0 {
		return nil
	}

	ids := make([]int, len(scenes))
	for i, s := range scenes {
		ids[i] = s.ID
	}

	// URLs
	urls, err := r.GetManyURLs(ctx, ids)
	if err != nil {
		return fmt.Errorf("bulk loading scene URLs: %w", err)
	}
	for i, s := range scenes {
		vals := urls[i]
		if vals == nil {
			vals = []string{}
		}
		s.URLs = models.NewRelatedStrings(vals)
	}

	// Performer IDs
	performerIDs, err := r.GetManyPerformerIDs(ctx, ids)
	if err != nil {
		return fmt.Errorf("bulk loading scene performer IDs: %w", err)
	}
	for i, s := range scenes {
		vals := performerIDs[i]
		if vals == nil {
			vals = []int{}
		}
		s.PerformerIDs = models.NewRelatedIDs(vals)
	}

	// Tag IDs
	tagIDs, err := r.GetManyTagIDs(ctx, ids)
	if err != nil {
		return fmt.Errorf("bulk loading scene tag IDs: %w", err)
	}
	for i, s := range scenes {
		vals := tagIDs[i]
		if vals == nil {
			vals = []int{}
		}
		s.TagIDs = models.NewRelatedIDs(vals)
	}

	// Gallery IDs
	galleryIDs, err := r.GetManyGalleryIDs(ctx, ids)
	if err != nil {
		return fmt.Errorf("bulk loading scene gallery IDs: %w", err)
	}
	for i, s := range scenes {
		vals := galleryIDs[i]
		if vals == nil {
			vals = []int{}
		}
		s.GalleryIDs = models.NewRelatedIDs(vals)
	}

	// Stash IDs
	stashIDs, err := r.GetManyStashIDs(ctx, ids)
	if err != nil {
		return fmt.Errorf("bulk loading scene stash IDs: %w", err)
	}
	for i, s := range scenes {
		vals := stashIDs[i]
		if vals == nil {
			vals = []models.StashID{}
		}
		s.StashIDs = models.NewRelatedStashIDs(vals)
	}

	return nil
}

// FindByIDs retrieves multiple scenes by their IDs.
// Missing scenes will be ignored, and the returned scenes are unsorted.
// This method will load the specified relationships for each scene.
func (s *Service) FindByIDs(ctx context.Context, ids []int, load ...LoadRelationshipOption) ([]*models.Scene, error) {
	qb := s.Repository

	scenes, err := qb.FindByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}

	if err := bulkLoadRelationships(ctx, scenes, qb); err != nil {
		return nil, err
	}

	return scenes, nil
}

// FindMany retrieves multiple scenes by their IDs. Return value is guaranteed to be in the same order as the input.
// Missing scenes will return an error.
// This method will load the specified relationships for each scene.
func (s *Service) FindMany(ctx context.Context, ids []int, load ...LoadRelationshipOption) ([]*models.Scene, error) {
	qb := s.Repository

	scenes, err := qb.FindMany(ctx, ids)
	if err != nil {
		return nil, err
	}

	if err := bulkLoadRelationships(ctx, scenes, qb); err != nil {
		return nil, err
	}

	return scenes, nil
}

func (s *Service) LoadRelationships(ctx context.Context, scene *models.Scene, load ...LoadRelationshipOption) error {
	for _, l := range load {
		if err := l(ctx, scene, s.Repository); err != nil {
			return err
		}
	}

	return nil
}
