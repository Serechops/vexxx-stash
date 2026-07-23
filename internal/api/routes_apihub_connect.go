package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// apihubConnectRoutes implements the "sign in with browser" flow for the
// APIHub plugin: start a driven Chrome session against a known login page,
// poll it until the user finishes logging in, and hand back the captured
// cookies in the same {name, value}[] shape a manual cookie-export already
// has, so the plugin's existing paste-a-blob parsing/storage code handles
// it unchanged.
type apihubConnectRoutes struct {
	routes
}

func (rs apihubConnectRoutes) Routes() chi.Router {
	r := chi.NewRouter()

	r.Post("/start", rs.Start)
	r.Get("/status", rs.Status)
	r.Post("/cancel", rs.Cancel)

	return r
}

type connectStartRequest struct {
	Target string `json:"target"`
}

type connectStartResponse struct {
	SessionID string `json:"sessionId"`
}

func (rs apihubConnectRoutes) Start(w http.ResponseWriter, r *http.Request) {
	var req connectStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Target == "" {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	sessionID, err := startConnectSession(req.Target)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	writeJSON(w, connectStartResponse{SessionID: sessionID})
}

type connectStatusResponse struct {
	Status  string       `json:"status"`
	Cookies []cookiePair `json:"cookies,omitempty"`
	Error   string       `json:"error,omitempty"`
}

func (rs apihubConnectRoutes) Status(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sessionId")
	if sessionID == "" {
		http.Error(w, "missing sessionId parameter", http.StatusBadRequest)
		return
	}

	connectSessionsMu.Lock()
	sess, ok := connectSessions[sessionID]
	connectSessionsMu.Unlock()
	if !ok {
		http.Error(w, "unknown sessionId", http.StatusNotFound)
		return
	}

	status, cookies, errMsg := sess.snapshot()
	writeJSON(w, connectStatusResponse{Status: string(status), Cookies: cookies, Error: errMsg})
}

type connectCancelRequest struct {
	SessionID string `json:"sessionId"`
}

func (rs apihubConnectRoutes) Cancel(w http.ResponseWriter, r *http.Request) {
	var req connectCancelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.SessionID == "" {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := cancelConnectSession(req.SessionID); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
