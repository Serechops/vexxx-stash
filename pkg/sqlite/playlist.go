package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/rand"
	"time"

	"github.com/doug-martin/goqu/v9"
	"github.com/doug-martin/goqu/v9/exp"
	"github.com/jmoiron/sqlx"
	"github.com/stashapp/stash/pkg/models"
)

const (
	playlistTable     = "playlists"
	playlistItemTable = "playlist_items"
)

var playlistRepository = repository{
	tableName: playlistTable,
	idColumn:  idColumn,
}

type playlistRow struct {
	ID          int             `db:"id" goqu:"skipinsert"`
	Name        string          `db:"name"`
	Description sql.NullString  `db:"description"`
	CoverType   sql.NullString  `db:"cover_type"`
	CoverID     sql.NullInt64   `db:"cover_id"`
	Duration    int             `db:"duration"`
	ItemCount   int             `db:"item_count"`
	UserID      sql.NullInt64   `db:"user_id"`
	CreatedAt   Timestamp       `db:"created_at"`
	UpdatedAt   Timestamp       `db:"updated_at"`
}

func (r *playlistRow) fromPlaylist(p models.Playlist) {
	r.ID = p.ID
	r.Name = p.Name
	r.Description = sql.NullString{String: p.Description, Valid: p.Description != ""}
	if p.CoverType != nil {
		r.CoverType = sql.NullString{String: *p.CoverType, Valid: true}
	}
	if p.CoverID != nil {
		r.CoverID = sql.NullInt64{Int64: int64(*p.CoverID), Valid: true}
	}
	r.Duration = p.Duration
	r.ItemCount = p.ItemCount
	if p.UserID != nil {
		r.UserID = sql.NullInt64{Int64: int64(*p.UserID), Valid: true}
	}
	r.CreatedAt = Timestamp{Timestamp: p.CreatedAt}
	r.UpdatedAt = Timestamp{Timestamp: p.UpdatedAt}
}

func (r playlistRow) toPlaylist() *models.Playlist {
	p := &models.Playlist{
		ID:        r.ID,
		Name:      r.Name,
		Duration:  r.Duration,
		ItemCount: r.ItemCount,
		CreatedAt: r.CreatedAt.Timestamp,
		UpdatedAt: r.UpdatedAt.Timestamp,
	}
	if r.Description.Valid {
		p.Description = r.Description.String
	}
	if r.CoverType.Valid {
		p.CoverType = &r.CoverType.String
	}
	if r.CoverID.Valid {
		id := int(r.CoverID.Int64)
		p.CoverID = &id
	}
	if r.UserID.Valid {
		id := int(r.UserID.Int64)
		p.UserID = &id
	}
	return p
}

type playlistItemRow struct {
	ID               int            `db:"id" goqu:"skipinsert"`
	PlaylistID       int            `db:"playlist_id"`
	Position         int            `db:"position"`
	MediaType        string         `db:"media_type"`
	SceneID          sql.NullInt64  `db:"scene_id"`
	ImageID          sql.NullInt64  `db:"image_id"`
	GalleryID        sql.NullInt64  `db:"gallery_id"`
	GroupID          sql.NullInt64  `db:"group_id"`
	DurationOverride sql.NullInt64  `db:"duration_override"`
	Notes            sql.NullString `db:"notes"`
	CreatedAt        Timestamp      `db:"created_at"`
}

func (r *playlistItemRow) fromPlaylistItem(pi models.PlaylistItem) {
	r.ID = pi.ID
	r.PlaylistID = pi.PlaylistID
	r.Position = pi.Position
	r.MediaType = string(pi.MediaType)
	if pi.SceneID != nil {
		r.SceneID = sql.NullInt64{Int64: int64(*pi.SceneID), Valid: true}
	}
	if pi.ImageID != nil {
		r.ImageID = sql.NullInt64{Int64: int64(*pi.ImageID), Valid: true}
	}
	if pi.GalleryID != nil {
		r.GalleryID = sql.NullInt64{Int64: int64(*pi.GalleryID), Valid: true}
	}
	if pi.GroupID != nil {
		r.GroupID = sql.NullInt64{Int64: int64(*pi.GroupID), Valid: true}
	}
	if pi.DurationOverride != nil {
		r.DurationOverride = sql.NullInt64{Int64: int64(*pi.DurationOverride), Valid: true}
	}
	r.Notes = sql.NullString{String: pi.Notes, Valid: pi.Notes != ""}
	r.CreatedAt = Timestamp{Timestamp: pi.CreatedAt}
}

func (r playlistItemRow) toPlaylistItem() *models.PlaylistItem {
	pi := &models.PlaylistItem{
		ID:         r.ID,
		PlaylistID: r.PlaylistID,
		Position:   r.Position,
		MediaType:  models.PlaylistMediaType(r.MediaType),
		CreatedAt:  r.CreatedAt.Timestamp,
	}
	if r.SceneID.Valid {
		id := int(r.SceneID.Int64)
		pi.SceneID = &id
	}
	if r.ImageID.Valid {
		id := int(r.ImageID.Int64)
		pi.ImageID = &id
	}
	if r.GalleryID.Valid {
		id := int(r.GalleryID.Int64)
		pi.GalleryID = &id
	}
	if r.GroupID.Valid {
		id := int(r.GroupID.Int64)
		pi.GroupID = &id
	}
	if r.DurationOverride.Valid {
		d := int(r.DurationOverride.Int64)
		pi.DurationOverride = &d
	}
	if r.Notes.Valid {
		pi.Notes = r.Notes.String
	}
	return pi
}

type PlaylistStore struct {
	tableMgr     *table
	itemTableMgr *table
}

func NewPlaylistStore() *PlaylistStore {
	return &PlaylistStore{
		tableMgr: &table{
			table:    goqu.T(playlistTable),
			idColumn: goqu.T(playlistTable).Col("id"),
		},
		itemTableMgr: &table{
			table:    goqu.T(playlistItemTable),
			idColumn: goqu.T(playlistItemTable).Col("id"),
		},
	}
}

func (qb *PlaylistStore) table() exp.IdentifierExpression {
	return qb.tableMgr.table
}

func (qb *PlaylistStore) selectDataset() *goqu.SelectDataset {
	return dialect.From(qb.table()).Select(qb.table().All())
}

func (qb *PlaylistStore) itemTable() exp.IdentifierExpression {
	return qb.itemTableMgr.table
}

func (qb *PlaylistStore) itemSelectDataset() *goqu.SelectDataset {
	return dialect.From(qb.itemTable()).Select(qb.itemTable().All())
}

// Find finds a playlist by ID
func (qb *PlaylistStore) Find(ctx context.Context, id int) (*models.Playlist, error) {
	ret, err := qb.get(ctx, qb.selectDataset().Where(qb.table().Col("id").Eq(id)))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return ret, err
}

func (qb *PlaylistStore) get(ctx context.Context, q *goqu.SelectDataset) (*models.Playlist, error) {
	ret, err := qb.getMany(ctx, q)
	if err != nil {
		return nil, err
	}

	if len(ret) == 0 {
		return nil, sql.ErrNoRows
	}

	return ret[0], nil
}

func (qb *PlaylistStore) getMany(ctx context.Context, q *goqu.SelectDataset) ([]*models.Playlist, error) {
	var ret []*models.Playlist
	if err := queryFunc(ctx, q, false, func(r *sqlx.Rows) error {
		var row playlistRow
		if err := r.StructScan(&row); err != nil {
			return err
		}
		ret = append(ret, row.toPlaylist())
		return nil
	}); err != nil {
		return nil, err
	}

	return ret, nil
}

// FindMany finds playlists by IDs
func (qb *PlaylistStore) FindMany(ctx context.Context, ids []int) ([]*models.Playlist, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	idsInterface := make([]interface{}, len(ids))
	for i, id := range ids {
		idsInterface[i] = id
	}

	q := qb.selectDataset().Where(qb.table().Col("id").In(idsInterface...))

	var rows []playlistRow
	if err := queryFunc(ctx, q, false, func(r *sqlx.Rows) error {
		var row playlistRow
		if err := r.StructScan(&row); err != nil {
			return err
		}
		rows = append(rows, row)
		return nil
	}); err != nil {
		return nil, fmt.Errorf("finding playlists: %w", err)
	}

	result := make([]*models.Playlist, len(rows))
	for i, row := range rows {
		result[i] = row.toPlaylist()
	}

	return result, nil
}

// FindByName finds a playlist by name
func (qb *PlaylistStore) FindByName(ctx context.Context, name string) (*models.Playlist, error) {
	ret, err := qb.get(ctx, qb.selectDataset().Where(qb.table().Col("name").Eq(name)))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return ret, err
}

// Create creates a new playlist
func (qb *PlaylistStore) Create(ctx context.Context, newPlaylist *models.Playlist) error {
	var r playlistRow
	r.fromPlaylist(*newPlaylist)

	id, err := qb.tableMgr.insertID(ctx, r)
	if err != nil {
		return fmt.Errorf("creating playlist: %w", err)
	}

	updated, err := qb.Find(ctx, id)
	if err != nil {
		return fmt.Errorf("finding after create: %w", err)
	}

	*newPlaylist = *updated
	return nil
}

// Update partially updates a playlist
func (qb *PlaylistStore) Update(ctx context.Context, id int, partial models.PlaylistPartial) (*models.Playlist, error) {
	if err := qb.tableMgr.checkIDExists(ctx, id); err != nil {
		return nil, err
	}

	r := playlistRecordFromPartial(partial)

	if len(r) > 0 {
		if err := qb.tableMgr.updateByID(ctx, id, r); err != nil {
			return nil, fmt.Errorf("updating playlist: %w", err)
		}
	}

	return qb.Find(ctx, id)
}

func playlistRecordFromPartial(partial models.PlaylistPartial) exp.Record {
	r := exp.Record{}

	if partial.Name.Set {
		r["name"] = partial.Name.Value
	}
	if partial.Description.Set {
		if partial.Description.Value == "" {
			r["description"] = nil
		} else {
			r["description"] = partial.Description.Value
		}
	}
	if partial.CoverType.Set {
		if partial.CoverType.Value == "" {
			r["cover_type"] = nil
		} else {
			r["cover_type"] = partial.CoverType.Value
		}
	}
	if partial.CoverID.Set {
		if partial.CoverID.Value == 0 {
			r["cover_id"] = nil
		} else {
			r["cover_id"] = partial.CoverID.Value
		}
	}
	if partial.Duration.Set {
		r["duration"] = partial.Duration.Value
	}
	if partial.ItemCount.Set {
		r["item_count"] = partial.ItemCount.Value
	}
	if partial.UserID.Set {
		if partial.UserID.Value == 0 {
			r["user_id"] = nil
		} else {
			r["user_id"] = partial.UserID.Value
		}
	}
	if partial.UpdatedAt.Set {
		r["updated_at"] = Timestamp{Timestamp: partial.UpdatedAt.Value}
	}

	return r
}

// UpdateFull fully updates a playlist
func (qb *PlaylistStore) UpdateFull(ctx context.Context, updatedPlaylist *models.Playlist) error {
	var r playlistRow
	r.fromPlaylist(*updatedPlaylist)

	if err := qb.tableMgr.updateByID(ctx, updatedPlaylist.ID, r); err != nil {
		return fmt.Errorf("updating playlist: %w", err)
	}

	return nil
}

// Destroy deletes a playlist by ID
func (qb *PlaylistStore) Destroy(ctx context.Context, id int) error {
	return qb.tableMgr.destroyExisting(ctx, []int{id})
}

// Query queries playlists with filters
func (qb *PlaylistStore) Query(ctx context.Context, playlistFilter *models.PlaylistFilterType, findFilter *models.FindFilterType) ([]*models.Playlist, int, error) {
	if playlistFilter == nil {
		playlistFilter = &models.PlaylistFilterType{}
	}
	if findFilter == nil {
		findFilter = &models.FindFilterType{}
	}

	query := playlistRepository.newQuery()
	distinctIDs(&query, playlistTable)

	if q := findFilter.Q; q != nil && *q != "" {
		searchColumns := []string{"playlists.name", "playlists.description"}
		query.parseQueryString(searchColumns, *q)
	}

	qb.applyPlaylistFilter(&query, playlistFilter)

	var err error
	query.sortAndPagination, err = qb.getPlaylistSort(findFilter)
	if err != nil {
		return nil, 0, err
	}
	query.sortAndPagination += getPagination(findFilter)

	idsResult, countResult, err := query.executeFind(ctx)
	if err != nil {
		return nil, 0, err
	}

	playlists, err := qb.FindMany(ctx, idsResult)
	if err != nil {
		return nil, 0, err
	}

	return playlists, countResult, nil
}

// QueryCount returns the count of playlists matching the filter
func (qb *PlaylistStore) QueryCount(ctx context.Context, playlistFilter *models.PlaylistFilterType, findFilter *models.FindFilterType) (int, error) {
	if playlistFilter == nil {
		playlistFilter = &models.PlaylistFilterType{}
	}
	if findFilter == nil {
		findFilter = &models.FindFilterType{}
	}

	query := playlistRepository.newQuery()
	distinctIDs(&query, playlistTable)

	if q := findFilter.Q; q != nil && *q != "" {
		searchColumns := []string{"playlists.name", "playlists.description"}
		query.parseQueryString(searchColumns, *q)
	}

	qb.applyPlaylistFilter(&query, playlistFilter)

	return query.executeCount(ctx)
}



func (qb *PlaylistStore) applyPlaylistFilter(query *queryBuilder, filter *models.PlaylistFilterType) {
	if filter.Name != nil {
		clause := getStringSearchClause([]string{"playlists.name"}, filter.Name.Value, filter.Name.Modifier == models.CriterionModifierExcludes)
		query.addWhere(clause.sql)
		query.addArg(clause.args...)
	}
	if filter.UserID != nil {
		clause, args := getIntCriterionWhereClause("playlists.user_id", *filter.UserID)
		query.addWhere(clause)
		query.addArg(args...)
	}
	if filter.ItemCount != nil {
		clause, args := getIntCriterionWhereClause("playlists.item_count", *filter.ItemCount)
		query.addWhere(clause)
		query.addArg(args...)
	}
	if filter.Duration != nil {
		clause, args := getIntCriterionWhereClause("playlists.duration", *filter.Duration)
		query.addWhere(clause)
		query.addArg(args...)
	}
	if filter.CreatedAt != nil {
		clause, args := getTimestampCriterionWhereClause("playlists.created_at", *filter.CreatedAt)
		query.addWhere(clause)
		query.addArg(args...)
	}
	if filter.UpdatedAt != nil {
		clause, args := getTimestampCriterionWhereClause("playlists.updated_at", *filter.UpdatedAt)
		query.addWhere(clause)
		query.addArg(args...)
	}
}

func (qb *PlaylistStore) getPlaylistSort(findFilter *models.FindFilterType) (string, error) {
	var sort string
	var direction string
	if findFilter == nil {
		sort = "name"
		direction = "ASC"
	} else {
		sort = findFilter.GetSort("name")
		direction = findFilter.GetDirection()
	}

	sortQuery := ""
	switch sort {
	case "name":
		sortQuery = getSort(sort, direction, playlistTable)
	case "item_count", "duration", "created_at", "updated_at":
		sortQuery = getSort(sort, direction, playlistTable)
	case "random":
		sortQuery = getRandomSort(playlistTable, direction, rand.Uint64())
	default:
		sortQuery = getSort("name", direction, playlistTable)
	}

	return sortQuery, nil
}

// FindItems finds all items in a playlist ordered by position
func (qb *PlaylistStore) FindItems(ctx context.Context, playlistID int) ([]*models.PlaylistItem, error) {
	q := qb.itemSelectDataset().
		Where(qb.itemTable().Col("playlist_id").Eq(playlistID)).
		Order(qb.itemTable().Col("position").Asc())

	var rows []playlistItemRow
	if err := queryFunc(ctx, q, false, func(r *sqlx.Rows) error {
		var row playlistItemRow
		if err := r.StructScan(&row); err != nil {
			return err
		}
		rows = append(rows, row)
		return nil
	}); err != nil {
		return nil, fmt.Errorf("finding playlist items: %w", err)
	}

	result := make([]*models.PlaylistItem, len(rows))
	for i, row := range rows {
		result[i] = row.toPlaylistItem()
	}

	return result, nil
}

// FindItem finds a single playlist item by ID
func (qb *PlaylistStore) FindItem(ctx context.Context, id int) (*models.PlaylistItem, error) {
	q := qb.itemSelectDataset().Where(qb.itemTable().Col("id").Eq(id))

	rows, err := qb.queryItems(ctx, q)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}

	return rows[0], nil
}

// FindItemsByScene finds all playlist items containing a scene
func (qb *PlaylistStore) FindItemsByScene(ctx context.Context, sceneID int) ([]*models.PlaylistItem, error) {
	q := qb.itemSelectDataset().Where(qb.itemTable().Col("scene_id").Eq(sceneID))

	return qb.queryItems(ctx, q)
}

// FindItemsByImage finds all playlist items containing an image
func (qb *PlaylistStore) FindItemsByImage(ctx context.Context, imageID int) ([]*models.PlaylistItem, error) {
	q := qb.itemSelectDataset().Where(qb.itemTable().Col("image_id").Eq(imageID))

	return qb.queryItems(ctx, q)
}

// FindItemsByGallery finds all playlist items containing a gallery
func (qb *PlaylistStore) FindItemsByGallery(ctx context.Context, galleryID int) ([]*models.PlaylistItem, error) {
	q := qb.itemSelectDataset().Where(qb.itemTable().Col("gallery_id").Eq(galleryID))

	return qb.queryItems(ctx, q)
}

// FindItemsByGroup finds all playlist items containing a group
func (qb *PlaylistStore) FindItemsByGroup(ctx context.Context, groupID int) ([]*models.PlaylistItem, error) {
	q := qb.itemSelectDataset().Where(qb.itemTable().Col("group_id").Eq(groupID))

	return qb.queryItems(ctx, q)
}

func (qb *PlaylistStore) queryItems(ctx context.Context, q *goqu.SelectDataset) ([]*models.PlaylistItem, error) {
	var rows []playlistItemRow
	if err := queryFunc(ctx, q, false, func(r *sqlx.Rows) error {
		var row playlistItemRow
		if err := r.StructScan(&row); err != nil {
			return err
		}
		rows = append(rows, row)
		return nil
	}); err != nil {
		return nil, fmt.Errorf("querying playlist items: %w", err)
	}

	result := make([]*models.PlaylistItem, len(rows))
	for i, row := range rows {
		result[i] = row.toPlaylistItem()
	}

	return result, nil
}

// CountByMediaType counts items of a specific media type in a playlist
func (qb *PlaylistStore) CountByMediaType(ctx context.Context, playlistID int, mediaType models.PlaylistMediaType) (int, error) {
	q := dialect.From(qb.itemTable()).
		Select(goqu.COUNT("*")).
		Where(
			qb.itemTable().Col("playlist_id").Eq(playlistID),
			qb.itemTable().Col("media_type").Eq(string(mediaType)),
		)

	var count int
	if err := querySimple(ctx, q, &count); err != nil {
		return 0, fmt.Errorf("counting playlist items: %w", err)
	}

	return count, nil
}

// AddItems adds items to a playlist at the specified position
func (qb *PlaylistStore) AddItems(ctx context.Context, playlistID int, items []*models.PlaylistItem, position *int) error {
	if len(items) == 0 {
		return nil
	}

	// Get current max position
	maxPos, err := qb.getMaxPosition(ctx, playlistID)
	if err != nil {
		return err
	}

	insertPos := maxPos + 1
	if position != nil && *position <= maxPos {
		insertPos = *position
		// Shift existing items to make room
		if err := qb.shiftPositions(ctx, playlistID, insertPos, len(items)); err != nil {
			return err
		}
	}

	// Insert new items
	for i, item := range items {
		item.PlaylistID = playlistID
		item.Position = insertPos + i
		if item.CreatedAt.IsZero() {
			item.CreatedAt = time.Now()
		}

		var r playlistItemRow
		r.fromPlaylistItem(*item)

		id, err := qb.itemTableMgr.insertID(ctx, r)
		if err != nil {
			return fmt.Errorf("adding playlist item: %w", err)
		}
		item.ID = id
	}

	// Update cached stats
	return qb.UpdateCachedStats(ctx, playlistID)
}

// RemoveItems removes items from a playlist
func (qb *PlaylistStore) RemoveItems(ctx context.Context, playlistID int, itemIDs []int) error {
	if len(itemIDs) == 0 {
		return nil
	}

	idsInterface := make([]interface{}, len(itemIDs))
	for i, id := range itemIDs {
		idsInterface[i] = id
	}

	q := dialect.Delete(qb.itemTable()).
		Where(
			qb.itemTable().Col("playlist_id").Eq(playlistID),
			qb.itemTable().Col("id").In(idsInterface...),
		)

	if _, err := exec(ctx, q); err != nil {
		return fmt.Errorf("removing playlist items: %w", err)
	}

	// Renumber positions to be contiguous
	if err := qb.renumberPositions(ctx, playlistID); err != nil {
		return err
	}

	// Update cached stats
	return qb.UpdateCachedStats(ctx, playlistID)
}

// ReorderItems reorders items in a playlist based on the new order
func (qb *PlaylistStore) ReorderItems(ctx context.Context, playlistID int, itemIDs []int) error {
	// To avoid UNIQUE constraint violations on (playlist_id, position),
	// we first set all positions to negative values (which won't conflict),
	// then set them to the final positions.

	// Step 1: Set all items to negative positions (offset by -len-1 to avoid conflicts)
	for i, itemID := range itemIDs {
		q := dialect.Update(qb.itemTable()).
			Set(goqu.Record{"position": -(i + 1)}).
			Where(
				qb.itemTable().Col("id").Eq(itemID),
				qb.itemTable().Col("playlist_id").Eq(playlistID),
			)

		if _, err := exec(ctx, q); err != nil {
			return fmt.Errorf("reordering playlist item (step 1): %w", err)
		}
	}

	// Step 2: Set all items to their final (positive) positions
	for i, itemID := range itemIDs {
		q := dialect.Update(qb.itemTable()).
			Set(goqu.Record{"position": i}).
			Where(
				qb.itemTable().Col("id").Eq(itemID),
				qb.itemTable().Col("playlist_id").Eq(playlistID),
			)

		if _, err := exec(ctx, q); err != nil {
			return fmt.Errorf("reordering playlist item (step 2): %w", err)
		}
	}

	// Update the playlist's updated_at timestamp
	partial := models.NewPlaylistPartial()
	_, err := qb.Update(ctx, playlistID, partial)
	return err
}

// UpdateItemPosition updates a single item's position
func (qb *PlaylistStore) UpdateItemPosition(ctx context.Context, itemID int, newPosition int) error {
	q := dialect.Update(qb.itemTable()).
		Set(goqu.Record{"position": newPosition}).
		Where(qb.itemTable().Col("id").Eq(itemID))

	if _, err := exec(ctx, q); err != nil {
		return fmt.Errorf("updating item position: %w", err)
	}

	return nil
}

// UpdateCachedStats recalculates and updates the cached statistics for a playlist
func (qb *PlaylistStore) UpdateCachedStats(ctx context.Context, playlistID int) error {
	// Count items
	countQ := dialect.From(qb.itemTable()).
		Select(goqu.COUNT("*")).
		Where(qb.itemTable().Col("playlist_id").Eq(playlistID))

	var count int
	if err := querySimple(ctx, countQ, &count); err != nil {
		return fmt.Errorf("counting playlist items: %w", err)
	}

	// Calculate duration (for scenes)
	// This is a simplified calculation - in production you'd join with scenes/etc
	// to get actual durations
	partial := models.PlaylistPartial{
		ItemCount: models.NewOptionalInt(count),
		UpdatedAt: models.NewOptionalTime(time.Now()),
	}

	_, err := qb.Update(ctx, playlistID, partial)
	return err
}

func (qb *PlaylistStore) getMaxPosition(ctx context.Context, playlistID int) (int, error) {
	q := dialect.From(qb.itemTable()).
		Select(goqu.MAX("position")).
		Where(qb.itemTable().Col("playlist_id").Eq(playlistID))

	var maxPos sql.NullInt64
	if err := querySimple(ctx, q, &maxPos); err != nil {
		return -1, fmt.Errorf("getting max position: %w", err)
	}

	if !maxPos.Valid {
		return -1, nil
	}

	return int(maxPos.Int64), nil
}

func (qb *PlaylistStore) shiftPositions(ctx context.Context, playlistID int, fromPosition int, count int) error {
	q := dialect.Update(qb.itemTable()).
		Set(goqu.Record{"position": goqu.L("position + ?", count)}).
		Where(
			qb.itemTable().Col("playlist_id").Eq(playlistID),
			qb.itemTable().Col("position").Gte(fromPosition),
		)

	if _, err := exec(ctx, q); err != nil {
		return fmt.Errorf("shifting positions: %w", err)
	}

	return nil
}

func (qb *PlaylistStore) renumberPositions(ctx context.Context, playlistID int) error {
	// Get all items ordered by current position
	items, err := qb.FindItems(ctx, playlistID)
	if err != nil {
		return err
	}

	// Renumber them starting from 0
	for i, item := range items {
		if item.Position != i {
			if err := qb.UpdateItemPosition(ctx, item.ID, i); err != nil {
				return err
			}
		}
	}

	return nil
}
