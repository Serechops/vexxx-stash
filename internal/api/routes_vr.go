package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/txn"
)

// vrMediaItem is the media object shape expected by the Babylon.js VR theatre.
type vrMediaItem struct {
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	Studio        string   `json:"studio,omitempty"`
	Performers    []string `json:"performers"`
	Tags          []string `json:"tags"`
	Duration      float64  `json:"duration,omitempty"`
	ThumbnailPath string   `json:"thumbnailPath,omitempty"`
	PreviewPath   string   `json:"previewPath,omitempty"`
}

// vrRoutes holds the handler methods for the VR theatre API shim.
// Route registration is handled in server.go.
type vrRoutes struct {
	routes
	repository *models.Repository
	config     *config.Config
}

// ─── helpers ──────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		http.Error(w, "encoding error", http.StatusInternalServerError)
	}
}

func (rs vrRoutes) sceneToMediaItem(
	ctx context.Context,
	scene *models.Scene,
	performers []*models.Performer,
	studio *models.Studio,
	tags []*models.Tag,
) vrMediaItem {
	item := vrMediaItem{
		ID:            strconv.Itoa(scene.ID),
		Title:         scene.Title,
		Performers:    make([]string, 0, len(performers)),
		Tags:          make([]string, 0, len(tags)),
		ThumbnailPath: fmt.Sprintf("/scene/%d/screenshot", scene.ID),
		PreviewPath:   fmt.Sprintf("/scene/%d/preview", scene.ID),
	}

	if studio != nil {
		item.Studio = studio.Name
	}

	for _, p := range performers {
		item.Performers = append(item.Performers, p.Name)
	}

	for _, t := range tags {
		item.Tags = append(item.Tags, t.Name)
	}

	// Primary file duration
	for _, f := range scene.Files.List() {
		item.Duration = f.Duration
		break
	}

	return item
}

// ─── handlers ─────────────────────────────────────────────────────────────────

// GET /api/library  — returns the full scene list (up to 2000 scenes).
func (rs vrRoutes) libraryHandler(w http.ResponseWriter, r *http.Request) {
	var items []vrMediaItem

	if err := txn.WithReadTxn(r.Context(), rs.txnManager, func(ctx context.Context) error {
		sceneFilter := &models.SceneFilterType{}
		findFilter := models.BatchFindFilter(2000)

		result, err := rs.repository.Scene.Query(ctx, models.SceneQueryOptions{
			QueryOptions: models.QueryOptions{
				FindFilter: findFilter,
				Count:      false,
			},
			SceneFilter: sceneFilter,
		})
		if err != nil {
			return err
		}

		scenes, err := result.Resolve(ctx)
		if err != nil {
			return err
		}

		items = make([]vrMediaItem, 0, len(scenes))

		for _, scene := range scenes {
			if err := scene.LoadFiles(ctx, rs.repository.Scene); err != nil {
				return err
			}
			if err := scene.LoadPerformerIDs(ctx, rs.repository.Scene); err != nil {
				return err
			}
			if err := scene.LoadTagIDs(ctx, rs.repository.Scene); err != nil {
				return err
			}

			var performers []*models.Performer
			if ids := scene.PerformerIDs.List(); len(ids) > 0 {
				performers, err = rs.repository.Performer.FindMany(ctx, ids)
				if err != nil {
					return err
				}
			}

			var studio *models.Studio
			if scene.StudioID != nil {
				studio, err = rs.repository.Studio.Find(ctx, *scene.StudioID)
				if err != nil {
					return err
				}
			}

			var tags []*models.Tag
			if ids := scene.TagIDs.List(); len(ids) > 0 {
				tags, err = rs.repository.Tag.FindMany(ctx, ids)
				if err != nil {
					return err
				}
			}

			items = append(items, rs.sceneToMediaItem(ctx, scene, performers, studio, tags))
		}

		return nil
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]interface{}{"items": items})
}

// GET /api/library/media?id={sceneId}  — single scene with markers as timestamps.
func (rs vrRoutes) singleMediaHandler(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, "id required", http.StatusBadRequest)
		return
	}
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	type vrTimestamp struct {
		Label   string  `json:"label"`
		Seconds float64 `json:"seconds"`
	}
	type vrMediaItemExtended struct {
		vrMediaItem
		Timestamps []vrTimestamp `json:"timestamps,omitempty"`
	}

	var response vrMediaItemExtended

	if err := txn.WithReadTxn(r.Context(), rs.txnManager, func(ctx context.Context) error {
		scene, err := rs.repository.Scene.Find(ctx, id)
		if err != nil {
			return err
		}
		if scene == nil {
			return fmt.Errorf("scene not found")
		}

		if err := scene.LoadFiles(ctx, rs.repository.Scene); err != nil {
			return err
		}
		if err := scene.LoadPerformerIDs(ctx, rs.repository.Scene); err != nil {
			return err
		}
		if err := scene.LoadTagIDs(ctx, rs.repository.Scene); err != nil {
			return err
		}

		var performers []*models.Performer
		if ids := scene.PerformerIDs.List(); len(ids) > 0 {
			performers, err = rs.repository.Performer.FindMany(ctx, ids)
			if err != nil {
				return err
			}
		}

		var studio *models.Studio
		if scene.StudioID != nil {
			studio, err = rs.repository.Studio.Find(ctx, *scene.StudioID)
			if err != nil {
				return err
			}
		}

		var tags []*models.Tag
		if ids := scene.TagIDs.List(); len(ids) > 0 {
			tags, err = rs.repository.Tag.FindMany(ctx, ids)
			if err != nil {
				return err
			}
		}

		markers, err := rs.repository.SceneMarker.FindBySceneID(ctx, id)
		if err != nil {
			return err
		}

		timestamps := make([]vrTimestamp, 0, len(markers))
		for _, m := range markers {
			timestamps = append(timestamps, vrTimestamp{Label: m.Title, Seconds: m.Seconds})
		}

		response = vrMediaItemExtended{
			vrMediaItem: rs.sceneToMediaItem(ctx, scene, performers, studio, tags),
			Timestamps:  timestamps,
		}

		return nil
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, response)
}

// GET /api/library/studios  — distinct studio names.
func (rs vrRoutes) studiosHandler(w http.ResponseWriter, r *http.Request) {
	var names []string

	if err := txn.WithReadTxn(r.Context(), rs.txnManager, func(ctx context.Context) error {
		result, _, err := rs.repository.Studio.Query(ctx, &models.StudioFilterType{}, models.BatchFindFilter(500))
		if err != nil {
			return err
		}
		names = make([]string, 0, len(result))
		for _, s := range result {
			names = append(names, s.Name)
		}
		return nil
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, names)
}

// GET /api/library/performers  — distinct performer names.
func (rs vrRoutes) performersHandler(w http.ResponseWriter, r *http.Request) {
	var names []string

	if err := txn.WithReadTxn(r.Context(), rs.txnManager, func(ctx context.Context) error {
		result, _, err := rs.repository.Performer.Query(ctx, &models.PerformerFilterType{}, models.BatchFindFilter(500))
		if err != nil {
			return err
		}
		names = make([]string, 0, len(result))
		for _, p := range result {
			names = append(names, p.Name)
		}
		return nil
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, names)
}

// GET /api/library/tags  — distinct tag names.
func (rs vrRoutes) tagsHandler(w http.ResponseWriter, r *http.Request) {
	var names []string

	if err := txn.WithReadTxn(r.Context(), rs.txnManager, func(ctx context.Context) error {
		result, _, err := rs.repository.Tag.Query(ctx, &models.TagFilterType{}, models.BatchFindFilter(500))
		if err != nil {
			return err
		}
		names = make([]string, 0, len(result))
		for _, t := range result {
			names = append(names, t.Name)
		}
		return nil
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, names)
}

// GET /media/stream?id={sceneId}  →  redirect to /scene/{id}/stream
func (rs vrRoutes) streamRedirectHandler(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "id required", http.StatusBadRequest)
		return
	}
	if _, err := strconv.Atoi(id); err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	target := fmt.Sprintf("%s/scene/%s/stream", getProxyPrefix(r), id)
	if apiKey := r.URL.Query().Get("apikey"); apiKey != "" {
		target += "?apikey=" + apiKey
	}
	http.Redirect(w, r, target, http.StatusTemporaryRedirect)
}

// GET /media/script?id={sceneId}  →  redirect to /scene/{id}/funscript
func (rs vrRoutes) scriptRedirectHandler(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "id required", http.StatusBadRequest)
		return
	}
	if _, err := strconv.Atoi(id); err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	target := fmt.Sprintf("%s/scene/%s/funscript", getProxyPrefix(r), id)
	http.Redirect(w, r, target, http.StatusTemporaryRedirect)
}

// GET /api/settings?key=handy_ck  — returns the Handy connection key.
func (rs vrRoutes) settingsHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("key") != "handy_ck" {
		http.Error(w, "unknown key", http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]string{"value": rs.config.GetHandyKey()})
}

// GET /api/ping  — heartbeat.
func (rs vrRoutes) pingHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}
