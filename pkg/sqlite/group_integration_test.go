//go:build integration
// +build integration

package sqlite_test

import (
	"context"
	"testing"
	"time"

	"github.com/stashapp/stash/pkg/models"
	"github.com/stretchr/testify/assert"
)

func TestGroupScenes(t *testing.T) {
	withRollbackTxn(func(ctx context.Context) error {
		qb := db.Group
		sqb := db.Scene

		// Create a group
		date, _ := models.ParseDate("2023-01-01")
		group := &models.Group{
			Name:      "Test Group Scenes",
			Date:      &date,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		err := qb.Create(ctx, group)
		assert.NoError(t, err)
		assert.NotZero(t, group.ID)

		// Create two scenes
		scene1 := &models.Scene{
			Title:     "Scene 1",
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		err = sqb.Create(ctx, scene1, nil)
		assert.NoError(t, err)

		scene2 := &models.Scene{
			Title:     "Scene 2",
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		err = sqb.Create(ctx, scene2, nil)
		assert.NoError(t, err)

		// Link scenes to group
		idx1 := 1
		idx2 := 2
		scenes := []models.GroupScene{
			{
				SceneID:    scene1.ID,
				SceneIndex: &idx1,
			},
			{
				SceneID:    scene2.ID,
				SceneIndex: &idx2,
			},
		}

		err = qb.UpdateScenes(ctx, group.ID, scenes)
		assert.NoError(t, err)

		// Get scenes
		gotScenes, err := qb.GetScenes(ctx, group.ID)
		assert.NoError(t, err)
		assert.Len(t, gotScenes, 2)

		// Verify order and indices
		found1 := false
		found2 := false
		for _, s := range gotScenes {
			if s.SceneID == scene1.ID {
				assert.Equal(t, idx1, *s.SceneIndex)
				found1 = true
			}
			if s.SceneID == scene2.ID {
				assert.Equal(t, idx2, *s.SceneIndex)
				found2 = true
			}
		}
		assert.True(t, found1, "Scene 1 not found")
		assert.True(t, found2, "Scene 2 not found")

		return nil
	})
}
