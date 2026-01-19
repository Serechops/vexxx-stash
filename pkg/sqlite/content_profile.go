package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/doug-martin/goqu/v9"
	"github.com/doug-martin/goqu/v9/exp"
	"github.com/jmoiron/sqlx"

	"github.com/stashapp/stash/pkg/models"
)

const (
	contentProfileTable   = "content_profiles"
	tagWeightsTable       = "tag_weights"
	performerWeightsTable = "performer_weights"
	studioWeightsTable    = "studio_weights"
	attributeWeightsTable = "attribute_weights"
)

var (
	contentProfileTableMgr = &table{
		table:    goqu.T(contentProfileTable),
		idColumn: goqu.T(contentProfileTable).Col(idColumn),
	}
)

type contentProfileRow struct {
	ID          int            `db:"id" goqu:"skipinsert"`
	ProfileType string         `db:"profile_type"`
	ProfileKey  sql.NullString `db:"profile_key"`
	CreatedAt   time.Time      `db:"created_at"`
	UpdatedAt   time.Time      `db:"updated_at"`
	ProfileData sql.NullString `db:"profile_data"`
}

func (r *contentProfileRow) fromContentProfile(o *models.ContentProfile) {
	r.ID = o.ID
	r.ProfileType = o.ProfileType
	r.CreatedAt = o.CreatedAt
	r.UpdatedAt = o.UpdatedAt

	if o.ProfileKey != nil {
		r.ProfileKey = sql.NullString{String: *o.ProfileKey, Valid: true}
	}
	if o.ProfileData != nil {
		r.ProfileData = sql.NullString{String: *o.ProfileData, Valid: true}
	}
}

func (r *contentProfileRow) resolve() *models.ContentProfile {
	ret := &models.ContentProfile{
		ID:          r.ID,
		ProfileType: r.ProfileType,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}

	if r.ProfileKey.Valid {
		ret.ProfileKey = &r.ProfileKey.String
	}
	if r.ProfileData.Valid {
		ret.ProfileData = &r.ProfileData.String
	}

	return ret
}

// ContentProfileStore provides database operations for ContentProfile entities.
type ContentProfileStore struct {
	repository
	tableMgr *table
}

// NewContentProfileStore creates a new ContentProfileStore.
func NewContentProfileStore() *ContentProfileStore {
	return &ContentProfileStore{
		repository: repository{
			tableName: contentProfileTable,
			idColumn:  idColumn,
		},
		tableMgr: contentProfileTableMgr,
	}
}

func (qb *ContentProfileStore) table() exp.IdentifierExpression {
	return qb.tableMgr.table
}

func (qb *ContentProfileStore) selectDataset() *goqu.SelectDataset {
	return dialect.From(qb.table()).Select(qb.table().All())
}

// FindUserProfile retrieves the global user content profile.
func (qb *ContentProfileStore) FindUserProfile(ctx context.Context) (*models.ContentProfile, error) {
	return qb.findByTypeAndKey(ctx, "user", nil)
}

// FindAll retrieves all content profiles.
func (qb *ContentProfileStore) FindAll(ctx context.Context) ([]*models.ContentProfile, error) {
	q := qb.selectDataset()
	return qb.getMany(ctx, q)
}

// Find retrieves a content profile by its ID.
func (qb *ContentProfileStore) Find(ctx context.Context, id int) (*models.ContentProfile, error) {
	ret, err := qb.find(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return ret, err
}

func (qb *ContentProfileStore) find(ctx context.Context, id int) (*models.ContentProfile, error) {
	q := qb.selectDataset().Where(qb.tableMgr.byID(id))
	return qb.get(ctx, q)
}

// findByTypeAndKey retrieves a profile by type and optional key.
func (qb *ContentProfileStore) findByTypeAndKey(ctx context.Context, profileType string, profileKey *string) (*models.ContentProfile, error) {
	table := qb.table()
	q := qb.selectDataset().Where(table.Col("profile_type").Eq(profileType))

	if profileKey != nil {
		q = q.Where(table.Col("profile_key").Eq(*profileKey))
	} else {
		q = q.Where(table.Col("profile_key").IsNull())
	}

	ret, err := qb.get(ctx, q)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return ret, err
}

func (qb *ContentProfileStore) get(ctx context.Context, q *goqu.SelectDataset) (*models.ContentProfile, error) {
	ret, err := qb.getMany(ctx, q)
	if err != nil {
		return nil, err
	}

	if len(ret) == 0 {
		return nil, sql.ErrNoRows
	}

	return ret[0], nil
}

func (qb *ContentProfileStore) getMany(ctx context.Context, q *goqu.SelectDataset) ([]*models.ContentProfile, error) {
	const single = false
	var ret []*models.ContentProfile
	if err := queryFunc(ctx, q, single, func(r *sqlx.Rows) error {
		var f contentProfileRow
		if err := r.StructScan(&f); err != nil {
			return err
		}

		s := f.resolve()
		ret = append(ret, s)
		return nil
	}); err != nil {
		return nil, err
	}

	return ret, nil
}

// Create inserts a new ContentProfile and returns the created entity.
func (qb *ContentProfileStore) Create(ctx context.Context, newObject *models.ContentProfile) error {
	var r contentProfileRow
	r.fromContentProfile(newObject)
	r.CreatedAt = time.Now()
	r.UpdatedAt = r.CreatedAt

	id, err := qb.tableMgr.insertID(ctx, r)
	if err != nil {
		return err
	}

	updated, err := qb.Find(ctx, id)
	if err != nil {
		return fmt.Errorf("finding after create: %w", err)
	}

	*newObject = *updated
	return nil
}

// Update modifies an existing ContentProfile.
func (qb *ContentProfileStore) Update(ctx context.Context, updatedObject *models.ContentProfile) error {
	var r contentProfileRow
	r.fromContentProfile(updatedObject)
	r.UpdatedAt = time.Now()

	if err := qb.tableMgr.updateByID(ctx, updatedObject.ID, r); err != nil {
		return err
	}

	return nil
}

// Destroy removes a ContentProfile and its associated weights (via CASCADE).
func (qb *ContentProfileStore) Destroy(ctx context.Context, id int) error {
	return qb.destroyExisting(ctx, []int{id})
}

// GetOrCreateUserProfile retrieves the user profile or creates one if it doesn't exist.
func (qb *ContentProfileStore) GetOrCreateUserProfile(ctx context.Context) (*models.ContentProfile, error) {
	profile, err := qb.FindUserProfile(ctx)
	if err != nil {
		return nil, err
	}

	if profile != nil {
		return profile, nil
	}

	// Create new user profile
	newProfile := models.NewContentProfile()
	if err := qb.Create(ctx, &newProfile); err != nil {
		return nil, err
	}
	return &newProfile, nil
}

// --- Weight Table Operations ---

// SetTagWeights replaces all tag weights for a profile.
func (qb *ContentProfileStore) SetTagWeights(ctx context.Context, profileID int, weights []models.TagWeight) error {
	table := goqu.T(tagWeightsTable)

	// Delete existing weights
	deleteQ := dialect.Delete(table).Where(table.Col("profile_id").Eq(profileID))
	if _, err := exec(ctx, deleteQ); err != nil {
		return fmt.Errorf("deleting existing tag weights: %w", err)
	}

	if len(weights) == 0 {
		return nil
	}

	// Batch insert new weights
	rows := make([]interface{}, len(weights))
	for i, w := range weights {
		rows[i] = goqu.Record{
			"profile_id": profileID,
			"tag_id":     w.TagID,
			"weight":     w.Weight,
		}
	}

	insertQ := dialect.Insert(table).Rows(rows...)
	if _, err := exec(ctx, insertQ); err != nil {
		return fmt.Errorf("inserting tag weights: %w", err)
	}

	return nil
}

// GetTagWeights retrieves tag weights for a profile, ordered by weight descending.
func (qb *ContentProfileStore) GetTagWeights(ctx context.Context, profileID int, limit int) ([]models.TagWeight, error) {
	table := goqu.T(tagWeightsTable)
	q := dialect.From(table).Select(
		table.Col("profile_id"),
		table.Col("tag_id"),
		table.Col("weight"),
	).Where(table.Col("profile_id").Eq(profileID)).Order(table.Col("weight").Desc())

	if limit > 0 {
		q = q.Limit(uint(limit))
	}

	var ret []models.TagWeight
	if err := queryFunc(ctx, q, false, func(r *sqlx.Rows) error {
		var w models.TagWeight
		if err := r.StructScan(&w); err != nil {
			return err
		}
		ret = append(ret, w)
		return nil
	}); err != nil {
		return nil, fmt.Errorf("getting tag weights: %w", err)
	}

	return ret, nil
}

// SetPerformerWeights replaces all performer weights for a profile.
func (qb *ContentProfileStore) SetPerformerWeights(ctx context.Context, profileID int, weights []models.PerformerWeight) error {
	table := goqu.T(performerWeightsTable)

	deleteQ := dialect.Delete(table).Where(table.Col("profile_id").Eq(profileID))
	if _, err := exec(ctx, deleteQ); err != nil {
		return fmt.Errorf("deleting existing performer weights: %w", err)
	}

	if len(weights) == 0 {
		return nil
	}

	rows := make([]interface{}, len(weights))
	for i, w := range weights {
		rows[i] = goqu.Record{
			"profile_id":   profileID,
			"performer_id": w.PerformerID,
			"weight":       w.Weight,
		}
	}

	insertQ := dialect.Insert(table).Rows(rows...)
	if _, err := exec(ctx, insertQ); err != nil {
		return fmt.Errorf("inserting performer weights: %w", err)
	}

	return nil
}

// GetPerformerWeights retrieves performer weights for a profile.
func (qb *ContentProfileStore) GetPerformerWeights(ctx context.Context, profileID int, limit int) ([]models.PerformerWeight, error) {
	table := goqu.T(performerWeightsTable)
	q := dialect.From(table).Select(
		table.Col("profile_id"),
		table.Col("performer_id"),
		table.Col("weight"),
	).Where(table.Col("profile_id").Eq(profileID)).Order(table.Col("weight").Desc())

	if limit > 0 {
		q = q.Limit(uint(limit))
	}

	var ret []models.PerformerWeight
	if err := queryFunc(ctx, q, false, func(r *sqlx.Rows) error {
		var w models.PerformerWeight
		if err := r.StructScan(&w); err != nil {
			return err
		}
		ret = append(ret, w)
		return nil
	}); err != nil {
		return nil, fmt.Errorf("getting performer weights: %w", err)
	}

	return ret, nil
}

// SetStudioWeights replaces all studio weights for a profile.
func (qb *ContentProfileStore) SetStudioWeights(ctx context.Context, profileID int, weights []models.StudioWeight) error {
	table := goqu.T(studioWeightsTable)

	deleteQ := dialect.Delete(table).Where(table.Col("profile_id").Eq(profileID))
	if _, err := exec(ctx, deleteQ); err != nil {
		return fmt.Errorf("deleting existing studio weights: %w", err)
	}

	if len(weights) == 0 {
		return nil
	}

	rows := make([]interface{}, len(weights))
	for i, w := range weights {
		rows[i] = goqu.Record{
			"profile_id": profileID,
			"studio_id":  w.StudioID,
			"weight":     w.Weight,
		}
	}

	insertQ := dialect.Insert(table).Rows(rows...)
	if _, err := exec(ctx, insertQ); err != nil {
		return fmt.Errorf("inserting studio weights: %w", err)
	}

	return nil
}

// GetStudioWeights retrieves studio weights for a profile.
func (qb *ContentProfileStore) GetStudioWeights(ctx context.Context, profileID int, limit int) ([]models.StudioWeight, error) {
	table := goqu.T(studioWeightsTable)
	q := dialect.From(table).Select(
		table.Col("profile_id"),
		table.Col("studio_id"),
		table.Col("weight"),
	).Where(table.Col("profile_id").Eq(profileID)).Order(table.Col("weight").Desc())

	if limit > 0 {
		q = q.Limit(uint(limit))
	}

	var ret []models.StudioWeight
	if err := queryFunc(ctx, q, false, func(r *sqlx.Rows) error {
		var w models.StudioWeight
		if err := r.StructScan(&w); err != nil {
			return err
		}
		ret = append(ret, w)
		return nil
	}); err != nil {
		return nil, fmt.Errorf("getting studio weights: %w", err)
	}

	return ret, nil
}

// SetAttributeWeights replaces all attribute weights for a profile.
func (qb *ContentProfileStore) SetAttributeWeights(ctx context.Context, profileID int, weights []models.AttributeWeight) error {
	table := goqu.T(attributeWeightsTable)

	deleteQ := dialect.Delete(table).Where(table.Col("profile_id").Eq(profileID))
	if _, err := exec(ctx, deleteQ); err != nil {
		return fmt.Errorf("deleting existing attribute weights: %w", err)
	}

	if len(weights) == 0 {
		return nil
	}

	rows := make([]interface{}, len(weights))
	for i, w := range weights {
		rows[i] = goqu.Record{
			"profile_id":      profileID,
			"attribute_name":  w.AttributeName,
			"attribute_value": w.AttributeValue,
			"weight":          w.Weight,
		}
	}

	insertQ := dialect.Insert(table).Rows(rows...)
	if _, err := exec(ctx, insertQ); err != nil {
		return fmt.Errorf("inserting attribute weights: %w", err)
	}

	return nil
}

// GetAttributeWeights retrieves attribute weights for a profile.
func (qb *ContentProfileStore) GetAttributeWeights(ctx context.Context, profileID int, limit int) ([]models.AttributeWeight, error) {
	table := goqu.T(attributeWeightsTable)
	q := dialect.From(table).Select(
		table.Col("profile_id"),
		table.Col("attribute_name"),
		table.Col("attribute_value"),
		table.Col("weight"),
	).Where(table.Col("profile_id").Eq(profileID)).Order(table.Col("weight").Desc())

	if limit > 0 {
		q = q.Limit(uint(limit))
	}

	var ret []models.AttributeWeight
	if err := queryFunc(ctx, q, false, func(r *sqlx.Rows) error {
		var w models.AttributeWeight
		if err := r.StructScan(&w); err != nil {
			return err
		}
		ret = append(ret, w)
		return nil
	}); err != nil {
		return nil, fmt.Errorf("getting attribute weights: %w", err)
	}

	return ret, nil
}

// SaveWeights persists all weight slices from a ContentProfile to the database.
func (qb *ContentProfileStore) SaveWeights(ctx context.Context, profile *models.ContentProfile) error {
	if err := qb.SetTagWeights(ctx, profile.ID, profile.TagWeights); err != nil {
		return err
	}
	if err := qb.SetPerformerWeights(ctx, profile.ID, profile.PerformerWeights); err != nil {
		return err
	}
	if err := qb.SetStudioWeights(ctx, profile.ID, profile.StudioWeights); err != nil {
		return err
	}
	if err := qb.SetAttributeWeights(ctx, profile.ID, profile.AttributeWeights); err != nil {
		return err
	}
	return nil
}

// LoadWeights populates all weight slices on a ContentProfile.
func (qb *ContentProfileStore) LoadWeights(ctx context.Context, profile *models.ContentProfile) error {
	var err error

	profile.TagWeights, err = qb.GetTagWeights(ctx, profile.ID, 0)
	if err != nil {
		return err
	}

	profile.PerformerWeights, err = qb.GetPerformerWeights(ctx, profile.ID, 0)
	if err != nil {
		return err
	}

	profile.StudioWeights, err = qb.GetStudioWeights(ctx, profile.ID, 0)
	if err != nil {
		return err
	}

	profile.AttributeWeights, err = qb.GetAttributeWeights(ctx, profile.ID, 0)
	if err != nil {
		return err
	}

	return nil
}
