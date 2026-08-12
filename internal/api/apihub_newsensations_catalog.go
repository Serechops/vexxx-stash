package api

import (
	"encoding/json"
	"net/http"

	"github.com/stashapp/stash/pkg/logger"
)

// ─── import endpoint ──────────────────────────────────────────────────────────

// nsImportRequest is the JSON body the plugin POSTs to push scraped data.
type nsImportRequest struct {
	Series []nsStoredSeries `json:"series"`
	Scenes []nsStoredScene  `json:"scenes"`
}

// ImportNewSensationsCatalog receives scraped NewSensations data from an
// external scraper and writes it to the SQLite sidecar store. The IPTV
// provider reads from that store exclusively.
//
// POST /apihub-newsensations/import
// Content-Type: application/json
// Body: { "series": [...], "scenes": [...] }
func ImportNewSensationsCatalog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req nsImportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		logger.Warnf("[apihub] NS import: invalid JSON: %v", err)
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if len(req.Series) > 0 {
		if err := nsCatalog.upsertSeriesList(req.Series); err != nil {
			logger.Errorf("[apihub] NS import: failed to write series: %v", err)
			http.Error(w, "failed to write series", http.StatusInternalServerError)
			return
		}
		logger.Infof("[apihub] NS import: %d series written", len(req.Series))
	}
	if len(req.Scenes) > 0 {
		if err := nsCatalog.upsertScenes(req.Scenes); err != nil {
			logger.Errorf("[apihub] NS import: failed to write scenes: %v", err)
			http.Error(w, "failed to write scenes", http.StatusInternalServerError)
			return
		}
		logger.Infof("[apihub] NS import: %d scenes written", len(req.Scenes))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"series": len(req.Series),
		"scenes": len(req.Scenes),
	})
}
