package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/internal/manager/config"
)

// apihubDownloadRoutes implements the "add to library" download pipeline for the
// APIHub plugin: the plugin resolves a batch of direct download URLs client-side
// (keeping the account tokens in the browser) and posts them here; the backend
// streams each file into the library's download root as a JobManager job so the
// transfer surfaces in the Tasks JobTable with live progress and a stop button.
type apihubDownloadRoutes struct {
	routes
	history *apihubHistoryStore
}

func (rs apihubDownloadRoutes) Routes() chi.Router {
	r := chi.NewRouter()

	r.Post("/start", rs.Start)
	r.Get("/history", rs.History)
	r.Delete("/history", rs.ClearHistory)
	r.Delete("/history/{id}", rs.DeleteHistoryEntry)

	return r
}

type apihubDownloadStartRequest struct {
	Items []apihubDownloadItem `json:"items"`
}

type apihubDownloadStartResponse struct {
	JobID string `json:"jobId"`
}

func (rs apihubDownloadRoutes) Start(w http.ResponseWriter, r *http.Request) {
	var req apihubDownloadStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Items) == 0 {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	for i := range req.Items {
		if strings.TrimSpace(req.Items[i].URL) == "" || strings.TrimSpace(req.Items[i].Filename) == "" {
			http.Error(w, "each item requires a url and filename", http.StatusBadRequest)
			return
		}
	}

	root, err := resolveDownloadRoot()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	j := &apihubDownloadJob{
		items:   req.Items,
		root:    root,
		client:  &http.Client{},
		history: rs.history,
	}

	desc := fmt.Sprintf("Downloading %s to library", pluralScenes(len(req.Items)))

	// r.Context() is safe here: the JobManager detaches it (context.WithoutCancel)
	// so the job outlives this request, while the stop button still cancels it.
	jobID := manager.GetInstance().JobManager.Add(r.Context(), desc, j)

	writeJSON(w, apihubDownloadStartResponse{JobID: strconv.Itoa(jobID)})
}

// History returns a page of past downloads, most recent first. Query params:
// limit, offset, status ("success" | "partial" | "failed"), q (title/studio
// substring search).
func (rs apihubDownloadRoutes) History(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))

	result, err := rs.history.list(apihubHistoryListParams{
		Limit:  limit,
		Offset: offset,
		Status: strings.TrimSpace(q.Get("status")),
		Query:  q.Get("q"),
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, result)
}

// ClearHistory deletes every recorded download-history entry.
func (rs apihubDownloadRoutes) ClearHistory(w http.ResponseWriter, r *http.Request) {
	if err := rs.history.clear(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteHistoryEntry deletes a single download-history entry by id.
func (rs apihubDownloadRoutes) DeleteHistoryEntry(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	if err := rs.history.deleteEntry(id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func pluralScenes(n int) string {
	if n == 1 {
		return "1 scene"
	}
	return fmt.Sprintf("%d scenes", n)
}

// resolveDownloadRoot determines the folder downloads are written to. It uses
// the apihub plugin's `downloadDir` setting when set, otherwise defaults to an
// "APIHub Downloads" folder under the first configured library path. The result
// MUST resolve inside a library path so the post-download scan can import the
// file; if the chosen folder isn't in one yet, it's registered as a library
// path automatically rather than failing.
func resolveDownloadRoot() (string, error) {
	cfg := config.GetInstance()
	paths := cfg.GetStashPaths()

	var root string
	if pc := cfg.GetPluginConfiguration("apihub"); pc != nil {
		if v, ok := pc["downloadDir"].(string); ok && strings.TrimSpace(v) != "" {
			root = strings.TrimSpace(v)
		}
	}
	if root == "" {
		if len(paths) == 0 {
			return "", fmt.Errorf("no library paths configured — add one under Settings > Library, or set the APIHub download folder")
		}
		root = filepath.Join(paths[0].Path, "APIHub Downloads")
	}
	root = filepath.Clean(root)

	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", fmt.Errorf("create download folder: %w", err)
	}

	// The post-download scan can only import files that live inside a configured
	// library path. If the download folder isn't in one yet, register it as a
	// library path so scans (and the folder-hierarchy step) can reach it.
	if paths.GetStashFromDirPath(root) == nil {
		if err := addLibraryPath(cfg, root); err != nil {
			return "", fmt.Errorf("registering download folder %q as a library path: %w", root, err)
		}
	}

	return root, nil
}

// addLibraryPath appends path to the configured library (stash) paths and
// persists the config, so a dedicated download folder outside the existing
// libraries becomes scannable. No-op if it's already configured.
func addLibraryPath(cfg *config.Config, path string) error {
	existing := cfg.GetStashPaths()
	for _, p := range existing {
		if p.Path == path {
			return nil
		}
	}
	updated := append(existing, &config.StashConfig{Path: path})
	cfg.SetInterface(config.Stash, updated)
	return cfg.Write()
}
