package sqlite

import (
	"context"
	"database/sql"
	"strings"

	"github.com/stashapp/stash/pkg/models"
)

type PotentialSceneStore struct {
	repository
}

func NewPotentialSceneStore() *PotentialSceneStore {
	return &PotentialSceneStore{
		repository: repository{
			tableName: "potential_scenes",
			idColumn:  "id",
		},
	}
}

func (r *PotentialSceneStore) Create(ctx context.Context, newPotentialScene models.PotentialScene) (*models.PotentialScene, error) {
	const query = `INSERT INTO potential_scenes (stash_id, data, created_at) VALUES (?, ?, ?)`
	res, err := dbWrapper.Exec(ctx, query, newPotentialScene.StashID, newPotentialScene.Data, newPotentialScene.CreatedAt)
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	newPotentialScene.ID = int(id)
	return &newPotentialScene, nil
}

func (r *PotentialSceneStore) Find(ctx context.Context, id int) (*models.PotentialScene, error) {
	query := `SELECT * FROM potential_scenes WHERE id = ?`
	var ret models.PotentialScene
	if err := dbWrapper.Get(ctx, &ret, query, id); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &ret, nil
}

func (r *PotentialSceneStore) FindByStashID(ctx context.Context, stashID string) (*models.PotentialScene, error) {
	query := `SELECT * FROM potential_scenes WHERE stash_id = ?`
	var ret models.PotentialScene
	if err := dbWrapper.Get(ctx, &ret, query, stashID); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &ret, nil
}

func (r *PotentialSceneStore) FindAll(ctx context.Context) ([]*models.PotentialScene, error) {
	query := `SELECT * FROM potential_scenes`
	var ret []*models.PotentialScene
	if err := dbWrapper.Select(ctx, &ret, query); err != nil {
		return nil, err
	}
	return ret, nil
}

func (r *PotentialSceneStore) Destroy(ctx context.Context, id int) error {
	return r.destroy(ctx, []int{id})
}

func (r *PotentialSceneStore) Query(ctx context.Context, filter models.PotentialSceneFilterInput) ([]*models.PotentialScene, error) {
	query := `SELECT * FROM potential_scenes WHERE 1=1`
	var args []interface{}

	if filter.StashID != nil {
		query += ` AND stash_id = ?`
		args = append(args, *filter.StashID)
	}

	if len(filter.StashIDs) > 0 {
		placeholders := strings.Repeat(",?", len(filter.StashIDs))
		query += ` AND stash_id IN (` + placeholders[1:] + `)`
		for _, id := range filter.StashIDs {
			args = append(args, id)
		}
	}

	if filter.PerformerStashID != nil {
		query += ` AND data LIKE ?`
		args = append(args, "%"+*filter.PerformerStashID+"%")
	}

	if filter.StudioStashID != nil {
		query += ` AND data LIKE ?`
		args = append(args, "%"+*filter.StudioStashID+"%")
	}

	var ret []*models.PotentialScene
	if err := dbWrapper.Select(ctx, &ret, query, args...); err != nil {
		return nil, err
	}
	return ret, nil
}
