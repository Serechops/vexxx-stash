package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/megaface"
)

type megaFaceRoutes struct {
	routes
	controller *megaface.Controller
}

func (rs megaFaceRoutes) Routes() chi.Router {
	logger.Infof("MegaFace: Registering routes")
	r := chi.NewRouter()

	r.Get("/status", rs.Status)
	r.Post("/identify", rs.Identify)

	return r
}

func (rs megaFaceRoutes) Status(w http.ResponseWriter, r *http.Request) {
	logger.Debug("MegaFace: Status endpoint called")
	status, err := rs.controller.Status(r.Context())
	if err != nil {
		logger.Errorf("MegaFace: Status check failed: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	logger.Debugf("MegaFace: Status success: %+v", status)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// Identify handles image upload for MegaFace performer identification.
func (rs megaFaceRoutes) Identify(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if rec := recover(); rec != nil {
			logger.Errorf("MegaFace: PANIC in Identify endpoint: %v", rec)
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		}
	}()

	logger.Infof("MegaFace: Identify endpoint called")

	// Parse multipart form (32MB max)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		logger.Errorf("MegaFace: ParseMultipartForm failed: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tempDir := rs.controller.GetTempDir()
	logger.Infof("MegaFace: Using temp dir: %s", tempDir)
	_ = os.MkdirAll(tempDir, 0755)

	// Save uploaded image
	file, _, err := r.FormFile("image")
	if err != nil {
		logger.Errorf("MegaFace: Failed to get image from form: %v", err)
		http.Error(w, "No image provided: "+err.Error(), http.StatusBadRequest)
		return
	}
	defer file.Close()

	imagePath := filepath.Join(tempDir, "upload_image.jpg")
	dst, err := os.Create(imagePath)
	if err != nil {
		logger.Errorf("MegaFace: Failed to create temp file: %v", err)
		http.Error(w, "Failed to save image: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		logger.Errorf("MegaFace: Failed to copy image: %v", err)
		http.Error(w, "Failed to save image: "+err.Error(), http.StatusInternalServerError)
		return
	}
	dst.Close() // Close before using

	defer os.Remove(imagePath)
	logger.Infof("MegaFace: Saved image to %s", imagePath)

	// Call MegaFace with timeout
	ctx, cancel := context.WithTimeout(r.Context(), 180*time.Second)
	defer cancel()

	identReq := megaface.IdentifyRequest{
		ImagePath: imagePath,
	}

	logger.Infof("MegaFace: Calling controller.Identify")
	resp, err := rs.controller.Identify(ctx, identReq)
	if err != nil {
		logger.Errorf("MegaFace identify error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	logger.Infof("MegaFace: Identify success, returning response")

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		logger.Errorf("MegaFace: Failed to write JSON response: %v", err)
	}
}
