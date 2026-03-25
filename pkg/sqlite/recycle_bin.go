package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/stashapp/stash/pkg/models"
)

const recycleBinTable = "recycle_bin"

// recycleBinRow mirrors the recycle_bin table columns for sqlx scanning.
type recycleBinRow struct {
	ID          int            `db:"id"`
	EntityType  string         `db:"entity_type"`
	EntityID    int            `db:"entity_id"`
	EntityName  string         `db:"entity_name"`
	DeletedData string         `db:"deleted_data"`
	DeletedAt   Timestamp      `db:"deleted_at"`
	GroupID     sql.NullString `db:"group_id"`
}

func (r *recycleBinRow) resolve() *models.RecycleBinEntry {
	e := &models.RecycleBinEntry{
		ID:         r.ID,
		EntityType: r.EntityType,
		EntityID:   r.EntityID,
		EntityName: r.EntityName,
		DeletedAt:  r.DeletedAt.Timestamp,
	}
	if r.GroupID.Valid {
		s := r.GroupID.String
		e.GroupID = &s
	}
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(r.DeletedData), &m); err == nil {
		e.DeletedData = m
	}
	return e
}

// RecycleBinStore implements models.RecycleBinReaderWriter against SQLite.
type RecycleBinStore struct{}

func NewRecycleBinStore() *RecycleBinStore {
	return &RecycleBinStore{}
}

// ── reads ─────────────────────────────────────────────────────────────────────

func (s *RecycleBinStore) FindByID(ctx context.Context, id int) (*models.RecycleBinEntry, error) {
	var row recycleBinRow
	if err := dbWrapper.Get(ctx, &row,
		`SELECT * FROM `+recycleBinTable+` WHERE id = ?`, id,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return row.resolve(), nil
}

func (s *RecycleBinStore) FindAll(ctx context.Context, limit, offset int) ([]*models.RecycleBinEntry, error) {
	q := `SELECT * FROM ` + recycleBinTable + ` ORDER BY deleted_at DESC`
	var args []interface{}
	if limit > 0 {
		q += ` LIMIT ?`
		args = append(args, limit)
		if offset > 0 {
			q += ` OFFSET ?`
			args = append(args, offset)
		}
	}
	var rows []recycleBinRow
	if err := dbWrapper.Select(ctx, &rows, q, args...); err != nil {
		return nil, err
	}
	ret := make([]*models.RecycleBinEntry, len(rows))
	for i, r := range rows {
		rCopy := r
		ret[i] = rCopy.resolve()
	}
	return ret, nil
}

func (s *RecycleBinStore) Count(ctx context.Context) (int, error) {
	var n int
	if err := dbWrapper.Get(ctx, &n, `SELECT COUNT(*) FROM `+recycleBinTable); err != nil {
		return 0, err
	}
	return n, nil
}

// ── internal record helper ────────────────────────────────────────────────────

func (s *RecycleBinStore) record(ctx context.Context, entityType string, entityID int, entityName string, data map[string]interface{}, groupID *string) error {
	b, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("recycle bin: marshalling snapshot for %s %d: %w", entityType, entityID, err)
	}

	var gid interface{}
	if groupID != nil {
		gid = *groupID
	}

	_, err = dbWrapper.Exec(ctx,
		`INSERT INTO `+recycleBinTable+`(entity_type, entity_id, entity_name, deleted_data, deleted_at, group_id) VALUES (?, ?, ?, ?, ?, ?)`,
		entityType, entityID, entityName, string(b),
		time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		gid,
	)
	return err
}

// ── snapshot helpers ──────────────────────────────────────────────────────────

func (s *RecycleBinStore) SnapshotTag(ctx context.Context, qb models.TagReader, t *models.Tag, groupID *string) error {
	aliases, _ := qb.GetAliases(ctx, t.ID)
	parentIDs, _ := qb.GetParentIDs(ctx, t.ID)
	childIDs, _ := qb.GetChildIDs(ctx, t.ID)
	stashIDs, _ := qb.GetStashIDs(ctx, t.ID)

	stashIDList := stashIDsToMaps(stashIDs)

	data := map[string]interface{}{
		"id":              t.ID,
		"name":            t.Name,
		"sort_name":       t.SortName,
		"description":     t.Description,
		"favorite":        t.Favorite,
		"ignore_auto_tag": t.IgnoreAutoTag,
		"created_at":      t.CreatedAt.UTC().Format(time.RFC3339Nano),
		"updated_at":      t.UpdatedAt.UTC().Format(time.RFC3339Nano),
		"aliases":         stringSliceOrEmpty(aliases),
		"parent_ids":      intSliceOrEmpty(parentIDs),
		"child_ids":       intSliceOrEmpty(childIDs),
		"stash_ids":       stashIDList,
		// reverse associations — entities that reference this tag
		"scene_ids":        intSliceOrEmpty(queryIDs(ctx, `SELECT scene_id FROM scenes_tags WHERE tag_id = ?`, t.ID)),
		"performer_ids":    intSliceOrEmpty(queryIDs(ctx, `SELECT performer_id FROM performers_tags WHERE tag_id = ?`, t.ID)),
		"gallery_ids":      intSliceOrEmpty(queryIDs(ctx, `SELECT gallery_id FROM galleries_tags WHERE tag_id = ?`, t.ID)),
		"image_ids":        intSliceOrEmpty(queryIDs(ctx, `SELECT image_id FROM images_tags WHERE tag_id = ?`, t.ID)),
		"group_ids":        intSliceOrEmpty(queryIDs(ctx, `SELECT group_id FROM groups_tags WHERE tag_id = ?`, t.ID)),
		"scene_marker_ids": intSliceOrEmpty(queryIDs(ctx, `SELECT scene_marker_id FROM scene_markers_tags WHERE tag_id = ?`, t.ID)),
		// markers that use this tag as their primary — stored with ON DELETE SET NULL so they survive deletion but lose the link
		"primary_marker_ids": intSliceOrEmpty(queryIDs(ctx, `SELECT id FROM scene_markers WHERE primary_tag_id = ?`, t.ID)),
	}
	return s.record(ctx, "tag", t.ID, t.Name, data, groupID)
}

func (s *RecycleBinStore) SnapshotPerformer(ctx context.Context, qb models.PerformerReader, p *models.Performer, groupID *string) error {
	aliases, _ := qb.GetAliases(ctx, p.ID)
	urls, _ := qb.GetURLs(ctx, p.ID)
	tagIDs, _ := qb.GetTagIDs(ctx, p.ID)
	stashIDs, _ := qb.GetStashIDs(ctx, p.ID)

	data := map[string]interface{}{
		"id":              p.ID,
		"name":            p.Name,
		"disambiguation":  p.Disambiguation,
		"gender":          genderString(p.Gender),
		"birthdate":       dateString(p.Birthdate),
		"death_date":      dateString(p.DeathDate),
		"ethnicity":       p.Ethnicity,
		"country":         p.Country,
		"eye_color":       p.EyeColor,
		"hair_color":      p.HairColor,
		"height":          p.Height,
		"weight":          p.Weight,
		"measurements":    p.Measurements,
		"fake_tits":       p.FakeTits,
		"penis_length":    p.PenisLength,
		"circumcised":     circumcisedString(p.Circumcised),
		"career_length":   p.CareerLength,
		"tattoos":         p.Tattoos,
		"piercings":       p.Piercings,
		"favorite":        p.Favorite,
		"rating":          p.Rating,
		"details":         p.Details,
		"ignore_auto_tag": p.IgnoreAutoTag,
		"created_at":      p.CreatedAt.UTC().Format(time.RFC3339Nano),
		"updated_at":      p.UpdatedAt.UTC().Format(time.RFC3339Nano),
		"aliases":         stringSliceOrEmpty(aliases),
		"urls":            stringSliceOrEmpty(urls),
		"tag_ids":         intSliceOrEmpty(tagIDs),
		"stash_ids":       stashIDsToMaps(stashIDs),
		// reverse associations — entities that feature this performer
		"scene_ids":   intSliceOrEmpty(queryIDs(ctx, `SELECT scene_id FROM performers_scenes WHERE performer_id = ?`, p.ID)),
		"gallery_ids": intSliceOrEmpty(queryIDs(ctx, `SELECT gallery_id FROM performers_galleries WHERE performer_id = ?`, p.ID)),
		"image_ids":   intSliceOrEmpty(queryIDs(ctx, `SELECT image_id FROM performers_images WHERE performer_id = ?`, p.ID)),
	}
	return s.record(ctx, "performer", p.ID, p.Name, data, groupID)
}

func (s *RecycleBinStore) SnapshotStudio(ctx context.Context, qb models.StudioReader, st *models.Studio, groupID *string) error {
	aliases, _ := qb.GetAliases(ctx, st.ID)
	urls, _ := qb.GetURLs(ctx, st.ID)
	tagIDs, _ := qb.GetTagIDs(ctx, st.ID)
	stashIDs, _ := qb.GetStashIDs(ctx, st.ID)

	data := map[string]interface{}{
		"id":              st.ID,
		"name":            st.Name,
		"parent_id":       st.ParentID,
		"rating":          st.Rating,
		"favorite":        st.Favorite,
		"details":         st.Details,
		"ignore_auto_tag": st.IgnoreAutoTag,
		"organized":       st.Organized,
		"created_at":      st.CreatedAt.UTC().Format(time.RFC3339Nano),
		"updated_at":      st.UpdatedAt.UTC().Format(time.RFC3339Nano),
		"aliases":         stringSliceOrEmpty(aliases),
		"urls":            stringSliceOrEmpty(urls),
		"tag_ids":         intSliceOrEmpty(tagIDs),
		"stash_ids":       stashIDsToMaps(stashIDs),
	}
	return s.record(ctx, "studio", st.ID, st.Name, data, groupID)
}

func (s *RecycleBinStore) SnapshotGallery(ctx context.Context, qb models.GalleryReader, g *models.Gallery, groupID *string) error {
	urls, _ := qb.GetURLs(ctx, g.ID)
	tagIDs, _ := qb.GetTagIDs(ctx, g.ID)
	performerIDs, _ := qb.GetPerformerIDs(ctx, g.ID)

	data := map[string]interface{}{
		"id":            g.ID,
		"title":         g.Title,
		"code":          g.Code,
		"date":          dateString(g.Date),
		"details":       g.Details,
		"photographer":  g.Photographer,
		"rating":        g.Rating,
		"organized":     g.Organized,
		"studio_id":     g.StudioID,
		"created_at":    g.CreatedAt.UTC().Format(time.RFC3339Nano),
		"updated_at":    g.UpdatedAt.UTC().Format(time.RFC3339Nano),
		"urls":          stringSliceOrEmpty(urls),
		"tag_ids":       intSliceOrEmpty(tagIDs),
		"performer_ids": intSliceOrEmpty(performerIDs),
		// reverse associations — images and scenes linked to this gallery
		"image_ids": intSliceOrEmpty(queryIDs(ctx, `SELECT image_id FROM galleries_images WHERE gallery_id = ?`, g.ID)),
		"scene_ids": intSliceOrEmpty(queryIDs(ctx, `SELECT scene_id FROM scenes_galleries WHERE gallery_id = ?`, g.ID)),
	}

	name := g.Title
	if name == "" {
		name = fmt.Sprintf("gallery #%d", g.ID)
	}
	return s.record(ctx, "gallery", g.ID, name, data, groupID)
}

func (s *RecycleBinStore) SnapshotImage(ctx context.Context, qb models.ImageReader, i *models.Image, groupID *string) error {
	urls, _ := qb.GetURLs(ctx, i.ID)
	tagIDs, _ := qb.GetTagIDs(ctx, i.ID)
	performerIDs, _ := qb.GetPerformerIDs(ctx, i.ID)
	galleryIDs, _ := qb.GetGalleryIDs(ctx, i.ID)

	data := map[string]interface{}{
		"id":            i.ID,
		"title":         i.Title,
		"code":          i.Code,
		"date":          dateString(i.Date),
		"details":       i.Details,
		"photographer":  i.Photographer,
		"rating":        i.Rating,
		"organized":     i.Organized,
		"o_counter":     i.OCounter,
		"studio_id":     i.StudioID,
		"created_at":    i.CreatedAt.UTC().Format(time.RFC3339Nano),
		"updated_at":    i.UpdatedAt.UTC().Format(time.RFC3339Nano),
		"urls":          stringSliceOrEmpty(urls),
		"tag_ids":       intSliceOrEmpty(tagIDs),
		"performer_ids": intSliceOrEmpty(performerIDs),
		"gallery_ids":   intSliceOrEmpty(galleryIDs),
	}

	name := i.Title
	if name == "" {
		name = fmt.Sprintf("image #%d", i.ID)
	}
	return s.record(ctx, "image", i.ID, name, data, groupID)
}

func (s *RecycleBinStore) SnapshotGroup(ctx context.Context, qb models.GroupReader, g *models.Group, groupID *string) error {
	urls, _ := qb.GetURLs(ctx, g.ID)
	tagIDs, _ := qb.GetTagIDs(ctx, g.ID)

	data := map[string]interface{}{
		"id":          g.ID,
		"name":        g.Name,
		"aliases":     g.Aliases,
		"duration":    g.Duration,
		"date":        dateString(g.Date),
		"rating":      g.Rating,
		"studio_id":   g.StudioID,
		"director":    g.Director,
		"synopsis":    g.Synopsis,
		"trailer_url": g.TrailerURL,
		"created_at":  g.CreatedAt.UTC().Format(time.RFC3339Nano),
		"updated_at":  g.UpdatedAt.UTC().Format(time.RFC3339Nano),
		"urls":        stringSliceOrEmpty(urls),
		"tag_ids":     intSliceOrEmpty(tagIDs),
		// scenes contained in this group (with optional scene_index ordering)
		"group_scenes": queryGroupScenes(ctx, g.ID),
		// group hierarchy — groups this group belongs to, and sub-groups it contains
		"containing_groups": queryGroupRelations(ctx, `SELECT containing_id AS id, order_index, COALESCE(description,'') AS description FROM groups_relations WHERE sub_id = ?`, g.ID),
		"sub_groups":        queryGroupRelations(ctx, `SELECT sub_id AS id, order_index, COALESCE(description,'') AS description FROM groups_relations WHERE containing_id = ?`, g.ID),
	}
	return s.record(ctx, "group", g.ID, g.Name, data, groupID)
}

func (s *RecycleBinStore) SnapshotSceneMarker(ctx context.Context, qb models.SceneMarkerReader, m *models.SceneMarker, groupID *string) error {
	tagIDs, _ := qb.GetTagIDs(ctx, m.ID)

	data := map[string]interface{}{
		"id":             m.ID,
		"title":          m.Title,
		"seconds":        m.Seconds,
		"end_seconds":    m.EndSeconds,
		"primary_tag_id": m.PrimaryTagID,
		"scene_id":       m.SceneID,
		"created_at":     m.CreatedAt.UTC().Format(time.RFC3339Nano),
		"updated_at":     m.UpdatedAt.UTC().Format(time.RFC3339Nano),
		"tag_ids":        intSliceOrEmpty(tagIDs),
	}

	name := m.Title
	if name == "" {
		name = fmt.Sprintf("marker #%d", m.ID)
	}
	return s.record(ctx, "scene_marker", m.ID, name, data, groupID)
}

// ── restore ───────────────────────────────────────────────────────────────────

// Restore re-inserts the original entity and its join-table data.
// If the entry belongs to a group, the entire group is restored atomically.
func (s *RecycleBinStore) Restore(ctx context.Context, id int) error {
	var row recycleBinRow
	if err := dbWrapper.Get(ctx, &row,
		`SELECT * FROM `+recycleBinTable+` WHERE id = ?`, id,
	); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("recycle bin entry %d not found", id)
		}
		return err
	}

	if row.GroupID.Valid {
		if err := s.restoreGroup(ctx, row.GroupID.String); err != nil {
			return err
		}
		_, err := dbWrapper.Exec(ctx, `DELETE FROM `+recycleBinTable+` WHERE group_id = ?`, row.GroupID.String)
		return err
	}
	if err := s.restoreEntry(ctx, &row); err != nil {
		return err
	}
	_, err := dbWrapper.Exec(ctx, `DELETE FROM `+recycleBinTable+` WHERE id = ?`, id)
	return err
}

func (s *RecycleBinStore) restoreGroup(ctx context.Context, groupID string) error {
	var rows []recycleBinRow
	if err := dbWrapper.Select(ctx, &rows,
		`SELECT * FROM `+recycleBinTable+` WHERE group_id = ? ORDER BY id ASC`, groupID,
	); err != nil {
		return err
	}
	if len(rows) == 0 {
		return fmt.Errorf("no recycle bin entries found for group %q", groupID)
	}
	for _, r := range rows {
		rCopy := r
		if err := s.restoreEntry(ctx, &rCopy); err != nil {
			return fmt.Errorf("restoring entry %d (%s %d): %w", r.ID, r.EntityType, r.EntityID, err)
		}
	}
	return nil
}

func (s *RecycleBinStore) restoreEntry(ctx context.Context, row *recycleBinRow) error {
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(row.DeletedData), &data); err != nil {
		return fmt.Errorf("entry %d: corrupt deleted_data: %w", row.ID, err)
	}

	switch row.EntityType {
	case "tag":
		return s.restoreTag(ctx, data)
	case "performer":
		return s.restorePerformer(ctx, data)
	case "studio":
		return s.restoreStudio(ctx, data)
	case "gallery":
		return s.restoreGallery(ctx, data)
	case "image":
		return s.restoreImage(ctx, data)
	case "group":
		return s.restoreGroupEntity(ctx, data)
	case "scene_marker":
		return s.restoreSceneMarker(ctx, data)
	default:
		return fmt.Errorf("entry %d: unknown entity_type %q", row.ID, row.EntityType)
	}
}

// ── entity-specific restore implementations ───────────────────────────────────

func (s *RecycleBinStore) restoreTag(ctx context.Context, d map[string]interface{}) error {
	j := jsonMap(d)
	id := j.int("id")

	if _, err := dbWrapper.Exec(ctx, `
		INSERT OR REPLACE INTO tags
			(id, name, sort_name, description, ignore_auto_tag, favorite, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, j.str("name"), j.str("sort_name"), j.str("description"),
		j.bool("ignore_auto_tag"), j.bool("favorite"),
		j.str("created_at"), j.str("updated_at"),
	); err != nil {
		return fmt.Errorf("restoring tag %d: %w", id, err)
	}

	// aliases
	if _, err := dbWrapper.Exec(ctx, `DELETE FROM tag_aliases WHERE tag_id = ?`, id); err != nil {
		return err
	}
	for _, alias := range j.stringSlice("aliases") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO tag_aliases (tag_id, alias) VALUES (?, ?)`, id, alias); err != nil {
			return err
		}
	}

	// parent relations: current tag is the child
	if _, err := dbWrapper.Exec(ctx, `DELETE FROM tags_relations WHERE child_id = ?`, id); err != nil {
		return err
	}
	for _, parentID := range j.intSlice("parent_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO tags_relations (parent_id, child_id) VALUES (?, ?)`, parentID, id); err != nil {
			return err
		}
	}

	// child relations: current tag is the parent
	if _, err := dbWrapper.Exec(ctx, `DELETE FROM tags_relations WHERE parent_id = ?`, id); err != nil {
		return err
	}
	for _, childID := range j.intSlice("child_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO tags_relations (parent_id, child_id) VALUES (?, ?)`, id, childID); err != nil {
			return err
		}
	}

	// stash IDs
	if _, err := dbWrapper.Exec(ctx, `DELETE FROM tag_stash_ids WHERE tag_id = ?`, id); err != nil {
		return err
	}
	for _, sid := range j.stashIDs("stash_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO tag_stash_ids (tag_id, endpoint, stash_id) VALUES (?, ?, ?)`, id, sid.endpoint, sid.stashID); err != nil {
			return err
		}
	}

	// re-link scenes that used this tag
	for _, sceneID := range j.intSlice("scene_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO scenes_tags (scene_id, tag_id) VALUES (?, ?)`, sceneID, id); err != nil {
			return err
		}
	}
	// re-link performers that used this tag
	for _, performerID := range j.intSlice("performer_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO performers_tags (performer_id, tag_id) VALUES (?, ?)`, performerID, id); err != nil {
			return err
		}
	}
	// re-link galleries that used this tag
	for _, galleryID := range j.intSlice("gallery_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO galleries_tags (gallery_id, tag_id) VALUES (?, ?)`, galleryID, id); err != nil {
			return err
		}
	}
	// re-link images that used this tag
	for _, imageID := range j.intSlice("image_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO images_tags (image_id, tag_id) VALUES (?, ?)`, imageID, id); err != nil {
			return err
		}
	}
	// re-link groups that used this tag
	for _, groupID := range j.intSlice("group_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO groups_tags (group_id, tag_id) VALUES (?, ?)`, groupID, id); err != nil {
			return err
		}
	}
	// re-link scene markers that used this tag (secondary tag)
	for _, markerID := range j.intSlice("scene_marker_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO scene_markers_tags (scene_marker_id, tag_id) VALUES (?, ?)`, markerID, id); err != nil {
			return err
		}
	}
	// restore primary_tag_id on markers that were orphaned when this tag was deleted (ON DELETE SET NULL)
	for _, markerID := range j.intSlice("primary_marker_ids") {
		if _, err := dbWrapper.Exec(ctx, `UPDATE scene_markers SET primary_tag_id = ? WHERE id = ? AND primary_tag_id IS NULL`, id, markerID); err != nil {
			return err
		}
	}
	return nil
}

func (s *RecycleBinStore) restorePerformer(ctx context.Context, d map[string]interface{}) error {
	j := jsonMap(d)
	id := j.int("id")

	if _, err := dbWrapper.Exec(ctx, `
		INSERT OR REPLACE INTO performers
			(id, name, disambiguation, gender, birthdate, ethnicity, country,
			 eye_color, hair_color, height, weight, measurements, fake_tits,
			 penis_length, circumcised, career_length, tattoos, piercings,
			 favorite, rating, details, death_date, ignore_auto_tag, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		j.str("name"), j.strOrNil("disambiguation"), j.strOrNil("gender"),
		j.strOrNil("birthdate"), j.strOrNil("ethnicity"), j.strOrNil("country"),
		j.strOrNil("eye_color"), j.strOrNil("hair_color"),
		j.intOrNil("height"), j.intOrNil("weight"),
		j.strOrNil("measurements"), j.strOrNil("fake_tits"),
		j.floatOrNil("penis_length"), j.strOrNil("circumcised"),
		j.strOrNil("career_length"), j.strOrNil("tattoos"), j.strOrNil("piercings"),
		j.bool("favorite"), j.intOrNil("rating"), j.strOrNil("details"),
		j.strOrNil("death_date"),
		j.bool("ignore_auto_tag"),
		j.str("created_at"), j.str("updated_at"),
	); err != nil {
		return fmt.Errorf("restoring performer %d: %w", id, err)
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM performer_aliases WHERE performer_id = ?`, id); err != nil {
		return err
	}
	for _, alias := range j.stringSlice("aliases") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO performer_aliases (performer_id, alias) VALUES (?, ?)`, id, alias); err != nil {
			return err
		}
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM performer_urls WHERE performer_id = ?`, id); err != nil {
		return err
	}
	for pos, u := range j.stringSlice("urls") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO performer_urls (performer_id, position, url) VALUES (?, ?, ?)`, id, pos, u); err != nil {
			return err
		}
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM performers_tags WHERE performer_id = ?`, id); err != nil {
		return err
	}
	for _, tagID := range j.intSlice("tag_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO performers_tags (performer_id, tag_id) VALUES (?, ?)`, id, tagID); err != nil {
			return err
		}
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM performer_stash_ids WHERE performer_id = ?`, id); err != nil {
		return err
	}
	for _, sid := range j.stashIDs("stash_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO performer_stash_ids (performer_id, endpoint, stash_id) VALUES (?, ?, ?)`, id, sid.endpoint, sid.stashID); err != nil {
			return err
		}
	}

	// re-link scenes featuring this performer
	for _, sceneID := range j.intSlice("scene_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO performers_scenes (performer_id, scene_id) VALUES (?, ?)`, id, sceneID); err != nil {
			return err
		}
	}
	// re-link galleries featuring this performer
	for _, galleryID := range j.intSlice("gallery_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO performers_galleries (performer_id, gallery_id) VALUES (?, ?)`, id, galleryID); err != nil {
			return err
		}
	}
	// re-link images featuring this performer
	for _, imageID := range j.intSlice("image_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO performers_images (performer_id, image_id) VALUES (?, ?)`, id, imageID); err != nil {
			return err
		}
	}
	return nil
}

func (s *RecycleBinStore) restoreStudio(ctx context.Context, d map[string]interface{}) error {
	j := jsonMap(d)
	id := j.int("id")

	if _, err := dbWrapper.Exec(ctx, `
		INSERT OR REPLACE INTO studios
			(id, name, parent_id, rating, favorite, details, ignore_auto_tag, organized, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		j.str("name"), j.intOrNil("parent_id"),
		j.intOrNil("rating"), j.bool("favorite"), j.strOrNil("details"),
		j.bool("ignore_auto_tag"), j.bool("organized"),
		j.str("created_at"), j.str("updated_at"),
	); err != nil {
		return fmt.Errorf("restoring studio %d: %w", id, err)
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM studio_aliases WHERE studio_id = ?`, id); err != nil {
		return err
	}
	for _, alias := range j.stringSlice("aliases") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO studio_aliases (studio_id, alias) VALUES (?, ?)`, id, alias); err != nil {
			return err
		}
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM studio_urls WHERE studio_id = ?`, id); err != nil {
		return err
	}
	for pos, u := range j.stringSlice("urls") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO studio_urls (studio_id, position, url) VALUES (?, ?, ?)`, id, pos, u); err != nil {
			return err
		}
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM studios_tags WHERE studio_id = ?`, id); err != nil {
		return err
	}
	for _, tagID := range j.intSlice("tag_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO studios_tags (studio_id, tag_id) VALUES (?, ?)`, id, tagID); err != nil {
			return err
		}
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM studio_stash_ids WHERE studio_id = ?`, id); err != nil {
		return err
	}
	for _, sid := range j.stashIDs("stash_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO studio_stash_ids (studio_id, endpoint, stash_id) VALUES (?, ?, ?)`, id, sid.endpoint, sid.stashID); err != nil {
			return err
		}
	}
	return nil
}

func (s *RecycleBinStore) restoreGallery(ctx context.Context, d map[string]interface{}) error {
	j := jsonMap(d)
	id := j.int("id")

	if _, err := dbWrapper.Exec(ctx, `
		INSERT OR REPLACE INTO galleries
			(id, title, code, date, details, photographer, rating, organized, studio_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		j.strOrNil("title"), j.strOrNil("code"), j.strOrNil("date"),
		j.strOrNil("details"), j.strOrNil("photographer"),
		j.intOrNil("rating"), j.bool("organized"), j.intOrNil("studio_id"),
		j.str("created_at"), j.str("updated_at"),
	); err != nil {
		return fmt.Errorf("restoring gallery %d: %w", id, err)
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM gallery_urls WHERE gallery_id = ?`, id); err != nil {
		return err
	}
	for pos, u := range j.stringSlice("urls") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO gallery_urls (gallery_id, position, url) VALUES (?, ?, ?)`, id, pos, u); err != nil {
			return err
		}
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM galleries_tags WHERE gallery_id = ?`, id); err != nil {
		return err
	}
	for _, tagID := range j.intSlice("tag_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO galleries_tags (gallery_id, tag_id) VALUES (?, ?)`, id, tagID); err != nil {
			return err
		}
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM performers_galleries WHERE gallery_id = ?`, id); err != nil {
		return err
	}
	for _, pID := range j.intSlice("performer_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO performers_galleries (gallery_id, performer_id) VALUES (?, ?)`, id, pID); err != nil {
			return err
		}
	}

	// re-link images that belong to this gallery
	if _, err := dbWrapper.Exec(ctx, `DELETE FROM galleries_images WHERE gallery_id = ?`, id); err != nil {
		return err
	}
	for _, imgID := range j.intSlice("image_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO galleries_images (gallery_id, image_id) VALUES (?, ?)`, id, imgID); err != nil {
			return err
		}
	}
	// re-link scenes connected to this gallery
	for _, sceneID := range j.intSlice("scene_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO scenes_galleries (scene_id, gallery_id) VALUES (?, ?)`, sceneID, id); err != nil {
			return err
		}
	}
	return nil
}

func (s *RecycleBinStore) restoreImage(ctx context.Context, d map[string]interface{}) error {
	j := jsonMap(d)
	id := j.int("id")

	if _, err := dbWrapper.Exec(ctx, `
		INSERT OR REPLACE INTO images
			(id, title, code, date, details, photographer, rating, organized, o_counter, studio_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		j.strOrNil("title"), j.strOrNil("code"), j.strOrNil("date"),
		j.strOrNil("details"), j.strOrNil("photographer"),
		j.intOrNil("rating"), j.bool("organized"), j.intOrDefault("o_counter", 0),
		j.intOrNil("studio_id"),
		j.str("created_at"), j.str("updated_at"),
	); err != nil {
		return fmt.Errorf("restoring image %d: %w", id, err)
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM image_urls WHERE image_id = ?`, id); err != nil {
		return err
	}
	for pos, u := range j.stringSlice("urls") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO image_urls (image_id, position, url) VALUES (?, ?, ?)`, id, pos, u); err != nil {
			return err
		}
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM images_tags WHERE image_id = ?`, id); err != nil {
		return err
	}
	for _, tagID := range j.intSlice("tag_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO images_tags (image_id, tag_id) VALUES (?, ?)`, id, tagID); err != nil {
			return err
		}
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM performers_images WHERE image_id = ?`, id); err != nil {
		return err
	}
	for _, pID := range j.intSlice("performer_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO performers_images (image_id, performer_id) VALUES (?, ?)`, id, pID); err != nil {
			return err
		}
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM galleries_images WHERE image_id = ?`, id); err != nil {
		return err
	}
	for _, gID := range j.intSlice("gallery_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO galleries_images (gallery_id, image_id) VALUES (?, ?)`, gID, id); err != nil {
			return err
		}
	}
	return nil
}

func (s *RecycleBinStore) restoreGroupEntity(ctx context.Context, d map[string]interface{}) error {
	j := jsonMap(d)
	id := j.int("id")

	if _, err := dbWrapper.Exec(ctx, `
		INSERT OR REPLACE INTO groups
			(id, name, aliases, duration, date, rating, studio_id, director, description, trailer_url, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		j.str("name"), j.strOrNil("aliases"), j.intOrNil("duration"),
		j.strOrNil("date"),
		j.intOrNil("rating"), j.intOrNil("studio_id"),
		j.strOrNil("director"), j.strOrNil("synopsis"), j.strOrNil("trailer_url"),
		j.str("created_at"), j.str("updated_at"),
	); err != nil {
		return fmt.Errorf("restoring group %d: %w", id, err)
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM group_urls WHERE group_id = ?`, id); err != nil {
		return err
	}
	for pos, u := range j.stringSlice("urls") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO group_urls (group_id, position, url) VALUES (?, ?, ?)`, id, pos, u); err != nil {
			return err
		}
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM groups_tags WHERE group_id = ?`, id); err != nil {
		return err
	}
	for _, tagID := range j.intSlice("tag_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO groups_tags (group_id, tag_id) VALUES (?, ?)`, id, tagID); err != nil {
			return err
		}
	}

	// re-link scenes that belong to this group
	if _, err := dbWrapper.Exec(ctx, `DELETE FROM groups_scenes WHERE group_id = ?`, id); err != nil {
		return err
	}
	for _, gs := range j.groupScenes("group_scenes") {
		if gs.SceneIndex != nil {
			if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO groups_scenes (group_id, scene_id, scene_index) VALUES (?, ?, ?)`, id, gs.SceneID, *gs.SceneIndex); err != nil {
				return err
			}
		} else {
			if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO groups_scenes (group_id, scene_id) VALUES (?, ?)`, id, gs.SceneID); err != nil {
				return err
			}
		}
	}

	// re-link groups that contained this group as a sub-group
	if _, err := dbWrapper.Exec(ctx, `DELETE FROM groups_relations WHERE sub_id = ?`, id); err != nil {
		return err
	}
	for _, rel := range j.groupRelations("containing_groups") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO groups_relations (containing_id, sub_id, order_index, description) VALUES (?, ?, ?, ?)`, rel.ID, id, rel.OrderIndex, nullStr(rel.Description)); err != nil {
			return err
		}
	}

	// re-link sub-groups that this group contained
	if _, err := dbWrapper.Exec(ctx, `DELETE FROM groups_relations WHERE containing_id = ?`, id); err != nil {
		return err
	}
	for _, rel := range j.groupRelations("sub_groups") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO groups_relations (containing_id, sub_id, order_index, description) VALUES (?, ?, ?, ?)`, id, rel.ID, rel.OrderIndex, nullStr(rel.Description)); err != nil {
			return err
		}
	}
	return nil
}

func (s *RecycleBinStore) restoreSceneMarker(ctx context.Context, d map[string]interface{}) error {
	j := jsonMap(d)
	id := j.int("id")

	if _, err := dbWrapper.Exec(ctx, `
		INSERT OR REPLACE INTO scene_markers
			(id, title, seconds, end_seconds, primary_tag_id, scene_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		j.str("title"), j.float("seconds"), j.floatOrNil("end_seconds"),
		j.intOrNil("primary_tag_id"), j.int("scene_id"),
		j.str("created_at"), j.str("updated_at"),
	); err != nil {
		return fmt.Errorf("restoring scene_marker %d: %w", id, err)
	}

	if _, err := dbWrapper.Exec(ctx, `DELETE FROM scene_markers_tags WHERE scene_marker_id = ?`, id); err != nil {
		return err
	}
	for _, tagID := range j.intSlice("tag_ids") {
		if _, err := dbWrapper.Exec(ctx, `INSERT OR IGNORE INTO scene_markers_tags (scene_marker_id, tag_id) VALUES (?, ?)`, id, tagID); err != nil {
			return err
		}
	}
	return nil
}

// ── purge ─────────────────────────────────────────────────────────────────────

func (s *RecycleBinStore) Purge(ctx context.Context, id int) error {
	_, err := dbWrapper.Exec(ctx, `DELETE FROM `+recycleBinTable+` WHERE id = ?`, id)
	return err
}

func (s *RecycleBinStore) PurgeAll(ctx context.Context) error {
	_, err := dbWrapper.Exec(ctx, `DELETE FROM `+recycleBinTable)
	return err
}

// ── internal JSON helper ──────────────────────────────────────────────────────

type jsonMap map[string]interface{}

func (m jsonMap) str(key string) string {
	v, _ := m[key].(string)
	return v
}

func (m jsonMap) strOrNil(key string) interface{} {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	s, ok := v.(string)
	if !ok || s == "" {
		return nil
	}
	return s
}

func (m jsonMap) int(key string) int {
	switch v := m[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	}
	return 0
}

func (m jsonMap) intOrNil(key string) interface{} {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	}
	return nil
}

func (m jsonMap) intOrDefault(key string, def int) int {
	v := m.intOrNil(key)
	if v == nil {
		return def
	}
	return v.(int)
}

func (m jsonMap) bool(key string) bool {
	v, _ := m[key].(bool)
	return v
}

func (m jsonMap) float(key string) float64 {
	v, _ := m[key].(float64)
	return v
}

func (m jsonMap) floatOrNil(key string) interface{} {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	f, ok := v.(float64)
	if !ok {
		return nil
	}
	return f
}

func (m jsonMap) stringSlice(key string) []string {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	arr, ok := v.([]interface{})
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func (m jsonMap) intSlice(key string) []int {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	arr, ok := v.([]interface{})
	if !ok {
		return nil
	}
	out := make([]int, 0, len(arr))
	for _, item := range arr {
		if f, ok := item.(float64); ok {
			out = append(out, int(f))
		}
	}
	return out
}

type stashIDPair struct {
	endpoint string
	stashID  string
}

func (m jsonMap) stashIDs(key string) []stashIDPair {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	arr, ok := v.([]interface{})
	if !ok {
		return nil
	}
	out := make([]stashIDPair, 0, len(arr))
	for _, item := range arr {
		sub, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		ep, _ := sub["endpoint"].(string)
		sid, _ := sub["stash_id"].(string)
		if ep != "" && sid != "" {
			out = append(out, stashIDPair{endpoint: ep, stashID: sid})
		}
	}
	return out
}

// ── snapshot serialisation helpers ───────────────────────────────────────────

func stringSliceOrEmpty(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func intSliceOrEmpty(s []int) []int {
	if s == nil {
		return []int{}
	}
	return s
}

func stashIDsToMaps(ids []models.StashID) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(ids))
	for _, sid := range ids {
		out = append(out, map[string]interface{}{
			"stash_id": sid.StashID,
			"endpoint": sid.Endpoint,
		})
	}
	return out
}

func genderString(g *models.GenderEnum) interface{} {
	if g == nil {
		return nil
	}
	return g.String()
}

func circumcisedString(c *models.CircumisedEnum) interface{} {
	if c == nil {
		return nil
	}
	return c.String()
}

func dateString(d *models.Date) interface{} {
	if d == nil {
		return nil
	}
	return d.String()
}

// ── recycle-bin query helpers ─────────────────────────────────────────────────

// queryIDs runs a single-column integer SELECT and returns the results.
// Errors are silently ignored (returns nil).
func queryIDs(ctx context.Context, query string, id int) []int {
	var ids []int
	if err := dbWrapper.Select(ctx, &ids, query, id); err != nil {
		return nil
	}
	return ids
}

// nullStr returns nil for an empty string, otherwise the string itself.
// Used when writing optional text fields to SQLite.
func nullStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// groupSceneRow is used when snapshotting the groups_scenes junction table.
type groupSceneRow struct {
	SceneID    int           `db:"scene_id"`
	SceneIndex sql.NullInt64 `db:"scene_index"`
}

// queryGroupScenes returns the scenes for a group as serialisable maps.
func queryGroupScenes(ctx context.Context, groupID int) []map[string]interface{} {
	var rows []groupSceneRow
	if err := dbWrapper.Select(ctx, &rows,
		`SELECT scene_id, scene_index FROM groups_scenes WHERE group_id = ?`, groupID,
	); err != nil {
		return nil
	}
	out := make([]map[string]interface{}, len(rows))
	for i, r := range rows {
		m := map[string]interface{}{"id": r.SceneID}
		if r.SceneIndex.Valid {
			v := int(r.SceneIndex.Int64)
			m["scene_index"] = v
		} else {
			m["scene_index"] = nil
		}
		out[i] = m
	}
	return out
}

// groupRelRow is used when snapshotting groups_relations.
type groupRelRow struct {
	ID          int            `db:"id"`
	OrderIndex  int            `db:"order_index"`
	Description sql.NullString `db:"description"`
}

// queryGroupRelations returns one side of the group hierarchy as serialisable maps.
func queryGroupRelations(ctx context.Context, query string, groupID int) []map[string]interface{} {
	var rows []groupRelRow
	if err := dbWrapper.Select(ctx, &rows, query, groupID); err != nil {
		return nil
	}
	out := make([]map[string]interface{}, len(rows))
	for i, r := range rows {
		var desc interface{}
		if r.Description.Valid && r.Description.String != "" {
			desc = r.Description.String
		}
		out[i] = map[string]interface{}{
			"id":          r.ID,
			"order_index": r.OrderIndex,
			"description": desc,
		}
	}
	return out
}

// ── jsonMap helpers for group data ────────────────────────────────────────────

type groupSceneEntry struct {
	SceneID    int
	SceneIndex *int
}

func (m jsonMap) groupScenes(key string) []groupSceneEntry {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	arr, ok := v.([]interface{})
	if !ok {
		return nil
	}
	out := make([]groupSceneEntry, 0, len(arr))
	for _, item := range arr {
		sub, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		entry := groupSceneEntry{}
		if f, ok := sub["id"].(float64); ok {
			entry.SceneID = int(f)
		}
		if si, ok := sub["scene_index"].(float64); ok {
			v := int(si)
			entry.SceneIndex = &v
		}
		out = append(out, entry)
	}
	return out
}

type groupRelEntry struct {
	ID          int
	OrderIndex  int
	Description string
}

func (m jsonMap) groupRelations(key string) []groupRelEntry {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	arr, ok := v.([]interface{})
	if !ok {
		return nil
	}
	out := make([]groupRelEntry, 0, len(arr))
	for _, item := range arr {
		sub, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		entry := groupRelEntry{}
		if f, ok := sub["id"].(float64); ok {
			entry.ID = int(f)
		}
		if oi, ok := sub["order_index"].(float64); ok {
			entry.OrderIndex = int(oi)
		}
		if d, ok := sub["description"].(string); ok {
			entry.Description = d
		}
		out = append(out, entry)
	}
	return out
}
