package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"io"
	"os"
	"path/filepath"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/stashface"
	"github.com/stashapp/stash/pkg/utils"
)

type stashFaceRoutes struct {
	routes
	controller  *stashface.Controller
	sceneFinder SceneFinder
}

func (rs stashFaceRoutes) Routes() chi.Router {
	logger.Infof("StashFace: Registering routes including identify_screenshot")
	r := chi.NewRouter()

	r.Get("/status", rs.Status)
	r.Post("/identify", rs.Identify)
	r.Post("/candidates", rs.Candidates)
	r.Get("/candidates/{filename}", rs.ServeCandidate)
	r.Post("/generate_sprite", rs.GenerateSprite)
	r.Post("/identify_screenshot", rs.IdentifyScreenshot)

	return r
}

func (rs stashFaceRoutes) Status(w http.ResponseWriter, r *http.Request) {
	logger.Debug("StashFace: Status endpoint called")
	status, err := rs.controller.Status(r.Context())
	if err != nil {
		logger.Errorf("StashFace: Status check failed: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	logger.Debugf("StashFace: Status success: %+v", status)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// Identify handles both Multipart upload (manual file) and JSON (server-side file)
func (rs stashFaceRoutes) Identify(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if rec := recover(); rec != nil {
			logger.Errorf("StashFace: PANIC in Identify endpoint: %v", rec)
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		}
	}()

	logger.Infof("StashFace: Identify endpoint called")

	var imagePath, vttPath string
	var threshold float64 = 0.5
	var results = 10

	contentType := r.Header.Get("Content-Type")

	if strings.Contains(contentType, "application/json") {
		// Handle JSON request (paths already on server)
		var req struct {
			ImagePath string  `json:"image_path"`
			VTTPath   string  `json:"vtt_path"`
			Threshold float64 `json:"threshold"`
			Results   int     `json:"results"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		imagePath = req.ImagePath
		vttPath = req.VTTPath
		threshold = req.Threshold
		results = req.Results

		logger.Infof("StashFace: JSON request. Image: %s, VTT: %s", imagePath, vttPath)

		// Validate paths exist and are within allowed temp dirs?
		// For MVP we assume trusted internal usage or basic checks.
		if _, err := os.Stat(imagePath); err != nil {
			http.Error(w, "Image path not found", http.StatusNotFound)
			return
		}

	} else {
		// Handle Multipart (File Upload)
		if err := r.ParseMultipartForm(32 << 20); err != nil { // 32MB max
			logger.Errorf("StashFace: ParseMultipartForm failed: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		tempDir := rs.controller.GetTempDir()
		logger.Infof("StashFace: Using temp dir: %s", tempDir)
		_ = os.MkdirAll(tempDir, 0755)

		// Helper to save file
		saveFile := func(formKey string, filename string) (string, error) {
			file, _, err := r.FormFile(formKey)
			if err != nil {
				return "", err
			}
			defer file.Close()

			dstPath := filepath.Join(tempDir, filename)
			dst, err := os.Create(dstPath)
			if err != nil {
				return "", err
			}
			defer dst.Close()

			if _, err := io.Copy(dst, file); err != nil {
				return "", err
			}
			return dstPath, nil
		}

		var err error
		imagePath, err = saveFile("image", "upload_sprite.jpg")
		if err != nil {
			logger.Errorf("StashFace: Failed to save image: %v", err)
			http.Error(w, "Failed to save image: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer os.Remove(imagePath)
		logger.Infof("StashFace: Saved image to %s", imagePath)

		vttPath, err = saveFile("vtt_file", "upload_sprite.vtt")
		if err != nil {
			logger.Errorf("StashFace: Failed to save VTT: %v", err)
			http.Error(w, "Failed to save VTT: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer os.Remove(vttPath)
		logger.Infof("StashFace: Saved VTT to %s", vttPath)

		threshold, _ = strconv.ParseFloat(r.FormValue("threshold"), 64)
		if threshold == 0 {
			threshold = 0.5
		}

		rVal, _ := strconv.Atoi(r.FormValue("results"))
		if rVal > 0 {
			results = rVal
		}
	}

	// Default context timeout for external call
	ctx, cancel := context.WithTimeout(r.Context(), 180*time.Second) // Increased timeout
	defer cancel()

	identReq := stashface.IdentifyRequest{
		ImagePath: imagePath,
		VTTPath:   "", // Force empty to use /multiple_image_search as find_faces_in_sprite is unreliable
		Threshold: threshold,
		Results:   results,
	}

	logger.Infof("StashFace: Calling controller.Identify")
	resp, err := rs.controller.Identify(ctx, identReq)
	if err != nil {
		logger.Errorf("StashFace identify error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	logger.Infof("StashFace: Identify success, returning response")

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		logger.Errorf("StashFace: Failed to write JSON response: %v", err)
	}
}

func (rs stashFaceRoutes) Candidates(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if rec := recover(); rec != nil {
			logger.Errorf("StashFace: PANIC in Candidates endpoint: %v", rec)
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		}
	}()

	var req struct {
		SceneID   string `json:"scene_id"`
		NumFrames int    `json:"num_frames"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	sceneID, _ := strconv.Atoi(req.SceneID)
	if sceneID == 0 {
		http.Error(w, "Invalid scene ID", http.StatusBadRequest)
		return
	}

	// Look up scene to gets path
	logger.Infof("StashFace Candidates: sceneID=%d", sceneID)

	if rs.controller == nil {
		logger.Error("StashFace: PANIC AVOIDED - Controller is NIL")
		http.Error(w, "Controller not initialized", http.StatusInternalServerError)
		return
	}
	if rs.sceneFinder == nil {
		logger.Error("StashFace: PANIC AVOIDED - SceneFinder is NIL")
		http.Error(w, "SceneFinder not initialized", http.StatusInternalServerError)
		return
	}
	if rs.txnManager == nil {
		logger.Error("StashFace: PANIC AVOIDED - TxnManager is NIL")
		http.Error(w, "TxnManager not initialized", http.StatusInternalServerError)
		return
	}

	var scene *models.Scene
	err := rs.withReadTxn(r, func(ctx context.Context) error {
		var err error
		scene, err = rs.sceneFinder.Find(ctx, sceneID)
		return err
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if scene == nil {
		http.Error(w, "Scene not found", http.StatusNotFound)
		return
	}

	// Calculate scene hash for sprite path
	sceneHash := scene.GetHash(config.GetInstance().GetVideoFileNamingAlgorithm())
	vttPath := manager.GetInstance().Paths.Scene.GetSpriteVttFilePath(sceneHash)

	// Since we are running outside main thread, we should use a detached context or long timeout
	// but here we just use request context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	if scene.Path == "" {
		http.Error(w, "Scene has no path", http.StatusBadRequest)
		return
	}

	numFrames := req.NumFrames
	if numFrames <= 0 {
		numFrames = 10
	}

	paths, err := rs.controller.GenerateCandidates(ctx, scene.Path, vttPath, numFrames)
	if err != nil {
		logger.Errorf("StashFace: GenerateCandidates failed: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Convert absolute paths to relative URL paths for frontend
	// We need to serve these files.
	// The temp dir is likely not served by default server static handlers unless we add it.
	// But `controller.go` is putting them in `tempDir`.
	// Does Stash have a generic "serve file" endpoint? Yes `routes_scene.go` serves specific files.
	// But these are new temporary files.
	// Maybe we can serve them via a new route in stashFaceRoutes: `GET /candidate/{filename}`?

	// Let's assume we return filenames and add a serving endpoint.
	filenames := make([]string, len(paths))
	for i, p := range paths {
		filenames[i] = filepath.Base(p)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"filenames": filenames,
	})
}

func (rs stashFaceRoutes) GenerateSprite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Filenames []string `json:"filenames"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tempDir := rs.controller.GetTempDir()
	candidateDir := filepath.Join(tempDir, "candidates")

	absPaths := make([]string, len(req.Filenames))
	for i, f := range req.Filenames {
		absPaths[i] = filepath.Join(candidateDir, f)
	}

	spritePath, vttPath, err := rs.controller.GenerateSpriteFromCandidates(absPaths)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Return identifiers that can be used to Identify
	// Identify endpoint expects multipart upload, OR we can modify it to accept paths
	// OR we updated Identify logic to take uploaded files.
	// But here we generated files on server.

	// Ideally, `identify` endpoint should support "use generated sprite".
	// But that complicates things.
	// Or we just return the paths and let the frontend call `identify` with local paths?
	// Frontend can't send local paths unless we bypass upload.

	// Actually, `identify` logic in `routes_stashface.go` (current) parses multipart form.
	// We should probably allow the frontend to trigger identification on the *generated* sprite.

	// Let's update Identify to check for "generated=true"?
	// Or just return the paths here and have a new `IdentifyGenerated` endpoint?
	// Or Update Identify to accept JSON payload pointing to generated files.

	// For now, return the paths relative to temp dir?
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"sprite_path": spritePath,
		"vtt_path":    vttPath,
	})
}

func (rs stashFaceRoutes) IdentifyScreenshot(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SceneID string `json:"scene_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	sceneID, err := strconv.Atoi(req.SceneID)
	if err != nil {
		http.Error(w, "Invalid scene ID", http.StatusBadRequest)
		return
	}

	// Fetch cover image (screenshot)
	// We use GetCover which returns bytes
	var coverData []byte
	err = rs.withReadTxn(r, func(ctx context.Context) error {
		var err error
		coverData, err = rs.sceneFinder.GetCover(ctx, sceneID)
		return err
	})

	if err != nil {
		http.Error(w, "Failed to get scene screenshot: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if len(coverData) == 0 {
		http.Error(w, "Scene has no screenshot", http.StatusNotFound)
		return
	}

	// Write to temp file
	tempDir := rs.controller.GetTempDir()
	screenshotPath := filepath.Join(tempDir, fmt.Sprintf("screenshot_%d.jpg", sceneID))
	if err := os.WriteFile(screenshotPath, coverData, 0644); err != nil {
		http.Error(w, "Failed to write screenshot file", http.StatusInternalServerError)
		return
	}

	// We don't generate VTT for single screenshot anymore, resorting to multiple_image_search fallback in client.py
	// This works better for single images.

	ctx, cancel := context.WithTimeout(r.Context(), 180*time.Second)
	defer cancel()

	identReq := stashface.IdentifyRequest{
		ImagePath: screenshotPath,
		VTTPath:   "",  // Empty VTT triggers generic image search
		Threshold: 0.5, // Default
		Results:   10,  // Default
	}

	res, err := rs.controller.Identify(ctx, identReq)
	if err != nil {
		logger.Errorf("StashFace: Identify failed: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

func (rs stashFaceRoutes) ServeCandidate(w http.ResponseWriter, r *http.Request) {
	filename := chi.URLParam(r, "filename")
	if filename == "" || strings.Contains(filename, "..") || strings.Contains(filename, "/") {
		http.Error(w, "Invalid filename", http.StatusBadRequest)
		return
	}

	tempDir := rs.controller.GetTempDir()
	candidateDir := filepath.Join(tempDir, "candidates")
	filepath := filepath.Join(candidateDir, filename)

	utils.ServeStaticFile(w, r, filepath)
}
