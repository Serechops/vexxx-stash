package models

import (
	"context"
	"time"
)

type PotentialScene struct {
	ID        int       `db:"id" json:"id"`
	StashID   string    `db:"stash_id" json:"stash_id"`
	Data      string    `db:"data" json:"data"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}

type PotentialSceneCreateInput struct {
	StashID   string     `json:"stash_id"`
	Data      string     `json:"data"`
	CreatedAt *time.Time `json:"created_at"`
}

type PotentialSceneFilterInput struct {
	StashID          *string  `json:"stash_id"`
	StashIDs         []string `json:"stash_ids"`
	PerformerStashID *string  `json:"performer_stash_id"`
	StudioStashID    *string  `json:"studio_stash_id"`
}

type PotentialSceneRepository interface {
	Create(ctx context.Context, newPotentialScene PotentialScene) (*PotentialScene, error)
	Find(ctx context.Context, id int) (*PotentialScene, error)
	FindByStashID(ctx context.Context, stashID string) (*PotentialScene, error)
	FindAll(ctx context.Context) ([]*PotentialScene, error)
	Query(ctx context.Context, filter PotentialSceneFilterInput) ([]*PotentialScene, error)
	Destroy(ctx context.Context, id int) error
}
