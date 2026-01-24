package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/stashtag"
)

type stashTagRoutes struct {
	routes
	controller *stashtag.Controller
}

func (rs stashTagRoutes) Routes() chi.Router {
	logger.Infof("StashTag: Registering routes")
	r := chi.NewRouter()

	r.Get("/status", rs.Status)
	r.Post("/predict_tags", rs.PredictTags)
	r.Post("/predict_markers", rs.PredictMarkers)

	return r
}

func (rs stashTagRoutes) Status(w http.ResponseWriter, r *http.Request) {
	logger.Debug("StashTag: Status endpoint called")
	status, err := rs.controller.Status(r.Context())
	if err != nil {
		logger.Errorf("StashTag: Status check failed: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	logger.Debugf("StashTag: Status success: %+v", status)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// PredictTags handles prediction of tags from a sprite image
func (rs stashTagRoutes) PredictTags(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if rec := recover(); rec != nil {
			logger.Errorf("StashTag: PANIC in PredictTags endpoint: %v", rec)
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		}
	}()

	logger.Infof("StashTag: PredictTags endpoint called")

	var imagePath, vttPath, vttContent string
	var threshold float64 = 0.4

	contentType := r.Header.Get("Content-Type")

	if strings.Contains(contentType, "application/json") {
		// Handle JSON request (paths already on server)
		var req struct {
			ImagePath  string  `json:"image_path"`
			VTTPath    string  `json:"vtt_path"`
			VTTContent string  `json:"vtt_content"`
			Threshold  float64 `json:"threshold"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		imagePath = req.ImagePath
		vttPath = req.VTTPath
		vttContent = req.VTTContent
		threshold = req.Threshold

		logger.Infof("StashTag: JSON request. Image: %s, VTT: %s", imagePath, vttPath)

		if _, err := os.Stat(imagePath); err != nil {
			http.Error(w, "Image path not found", http.StatusNotFound)
			return
		}

	} else {
		// Handle Multipart (File Upload)
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			logger.Errorf("StashTag: ParseMultipartForm failed: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		tempDir := rs.controller.GetTempDir()
		logger.Infof("StashTag: Using temp dir: %s", tempDir)
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
		imagePath, err = saveFile("image", "stashtag_sprite.jpg")
		if err != nil {
			logger.Errorf("StashTag: Failed to save image: %v", err)
			http.Error(w, "Failed to save image: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer os.Remove(imagePath)
		logger.Infof("StashTag: Saved image to %s", imagePath)

		// VTT can be uploaded as file or as form value
		vttPath, _ = saveFile("vtt_file", "stashtag_sprite.vtt")
		if vttPath != "" {
			defer os.Remove(vttPath)
			logger.Infof("StashTag: Saved VTT to %s", vttPath)
		}

		// Or read VTT content directly
		vttContent = r.FormValue("vtt_content")

		threshold, _ = strconv.ParseFloat(r.FormValue("threshold"), 64)
		if threshold == 0 {
			threshold = 0.4
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 180*time.Second)
	defer cancel()

	req := stashtag.PredictTagsRequest{
		ImagePath:  imagePath,
		VTTPath:    vttPath,
		VTTContent: vttContent,
		Threshold:  threshold,
	}

	logger.Infof("StashTag: Calling controller.PredictTags")
	resp, err := rs.controller.PredictTags(ctx, req)
	if err != nil {
		logger.Errorf("StashTag PredictTags error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	logger.Infof("StashTag: PredictTags success, returning response")

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		logger.Errorf("StashTag: Failed to write JSON response: %v", err)
	}
}

// PredictMarkers handles prediction of markers from a sprite image
func (rs stashTagRoutes) PredictMarkers(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if rec := recover(); rec != nil {
			logger.Errorf("StashTag: PANIC in PredictMarkers endpoint: %v", rec)
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		}
	}()

	logger.Infof("StashTag: PredictMarkers endpoint called")

	var imagePath, vttPath, vttContent string
	var threshold float64 = 0.4

	contentType := r.Header.Get("Content-Type")

	if strings.Contains(contentType, "application/json") {
		var req struct {
			ImagePath  string  `json:"image_path"`
			VTTPath    string  `json:"vtt_path"`
			VTTContent string  `json:"vtt_content"`
			Threshold  float64 `json:"threshold"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		imagePath = req.ImagePath
		vttPath = req.VTTPath
		vttContent = req.VTTContent
		threshold = req.Threshold

		logger.Infof("StashTag: JSON request. Image: %s, VTT: %s", imagePath, vttPath)

		if _, err := os.Stat(imagePath); err != nil {
			http.Error(w, "Image path not found", http.StatusNotFound)
			return
		}

	} else {
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			logger.Errorf("StashTag: ParseMultipartForm failed: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		tempDir := rs.controller.GetTempDir()
		logger.Infof("StashTag: Using temp dir: %s", tempDir)
		_ = os.MkdirAll(tempDir, 0755)

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
		imagePath, err = saveFile("image", "stashtag_markers_sprite.jpg")
		if err != nil {
			logger.Errorf("StashTag: Failed to save image: %v", err)
			http.Error(w, "Failed to save image: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer os.Remove(imagePath)
		logger.Infof("StashTag: Saved image to %s", imagePath)

		vttPath, _ = saveFile("vtt_file", "stashtag_markers_sprite.vtt")
		if vttPath != "" {
			defer os.Remove(vttPath)
			logger.Infof("StashTag: Saved VTT to %s", vttPath)
		}

		vttContent = r.FormValue("vtt_content")

		threshold, _ = strconv.ParseFloat(r.FormValue("threshold"), 64)
		if threshold == 0 {
			threshold = 0.4
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 180*time.Second)
	defer cancel()

	req := stashtag.PredictMarkersRequest{
		ImagePath:  imagePath,
		VTTPath:    vttPath,
		VTTContent: vttContent,
		Threshold:  threshold,
	}

	logger.Infof("StashTag: Calling controller.PredictMarkers")
	resp, err := rs.controller.PredictMarkers(ctx, req)
	if err != nil {
		logger.Errorf("StashTag PredictMarkers error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	logger.Infof("StashTag: PredictMarkers success, returning response")

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		logger.Errorf("StashTag: Failed to write JSON response: %v", err)
	}
}
