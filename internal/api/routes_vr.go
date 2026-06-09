package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"path"
	"strconv"
	"strings"
	"sync"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/txn"
)

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

// GET /deovr — returns the HTML page list, the shortened paginated JSON, or single video detail JSON.
type deovrCorrection struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Br   float64 `json:"br"`
	Cont float64 `json:"cont"`
	Sat  float64 `json:"sat"`
}

type deovrTimestamp struct {
	TS   int    `json:"ts"`
	Name string `json:"name"`
}

type deovrSource struct {
	Resolution int    `json:"resolution"`
	URL        string `json:"url"`
}

type deovrEncoding struct {
	Name         string        `json:"name"`
	VideoSources []deovrSource `json:"videoSources"`
}

type deovrActor struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type deovrCategoryTag struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type deovrCategory struct {
	Tag deovrCategoryTag `json:"tag"`
}

type deovrVideoDetail struct {
	Encodings      []deovrEncoding  `json:"encodings"`
	Title          string           `json:"title"`
	ID             int              `json:"id"`
	VideoLength    int              `json:"videoLength"`
	Is3D           bool             `json:"is3d"`
	ScreenType     string           `json:"screenType"`
	StereoMode     string           `json:"stereoMode"`
	SkipIntro      int              `json:"skipIntro"`
	VideoThumbnail string           `json:"videoThumbnail,omitempty"`
	VideoPreview   string           `json:"videoPreview,omitempty"`
	ThumbnailURL   string           `json:"thumbnailUrl"`
	TimeStamps     []deovrTimestamp `json:"timeStamps,omitempty"`
	Corrections    *deovrCorrection `json:"corrections,omitempty"`
	Description    string           `json:"description,omitempty"`
	Actors         []deovrActor     `json:"actors,omitempty"`
	Categories     []deovrCategory  `json:"categories,omitempty"`
}

type deovrVideoShort struct {
	Title          string `json:"title"`
	VideoLength    int    `json:"videoLength"`
	ThumbnailURL   string `json:"thumbnailUrl"`
	VideoURL       string `json:"video_url"`
	VideoThumbnail string `json:"videoThumbnail,omitempty"`
	VideoPreview   string `json:"videoPreview,omitempty"`
}

type deovrSceneShort struct {
	Name string            `json:"name"`
	List []deovrVideoShort `json:"list"`
}

type deovrResponseShort struct {
	Scenes     []deovrSceneShort `json:"scenes"`
	Authorized string            `json:"authorized"`
}

func buildDeoVRURL(baseURL string, pathStr string, apiKey string) string {
	if apiKey != "" {
		separator := "?"
		if strings.Contains(pathStr, "?") {
			separator = "&"
		}
		return fmt.Sprintf("%s%s%sapikey=%s", baseURL, pathStr, separator, apiKey)
	}
	return fmt.Sprintf("%s%s", baseURL, pathStr)
}

func (rs vrRoutes) deovrHandler(w http.ResponseWriter, r *http.Request) {
	// Get base URL from middleware context (respects ExternalHost, TLS, and proxy config)
	baseURL, _ := r.Context().Value(BaseURLCtxKey).(string)
	if baseURL == "" {
		// Fallback: derive from request if context isn't set
		scheme := "http"
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" || r.URL.Scheme == "https" {
			scheme = "https"
		}
		baseURL = scheme + "://" + r.Host + getProxyPrefix(r)
	}

	// Derive the base URL for all DeoVR-facing media resources
	// (streams, thumbnails, previews, video detail URLs). We respect the
	// incoming protocol (HTTP or HTTPS) to ensure that if Stash is accessed
	// over a secure connection (such as an HTTPS reverse proxy or tunnel),
	// the media and thumbnail URLs are served over HTTPS to comply with
	// DeoVR's security policies.
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" || r.URL.Scheme == "https" {
		scheme = "https"
	}
	deovrBaseURL := scheme + "://" + r.Host + getProxyPrefix(r)

	apiKey := r.URL.Query().Get("apikey")

	// Branch A: Single video detail JSON
	if r.URL.Query().Has("video_id") {
		videoIDStr := r.URL.Query().Get("video_id")
		videoID, err := strconv.Atoi(videoIDStr)
		if err != nil {
			http.Error(w, "invalid video_id", http.StatusBadRequest)
			return
		}

		var detail deovrVideoDetail
		if err := txn.WithReadTxn(r.Context(), rs.txnManager, func(ctx context.Context) error {
			scene, err := rs.repository.Scene.Find(ctx, videoID)
			if err != nil {
				return err
			}
			if scene == nil {
				return fmt.Errorf("scene not found")
			}

			if err := scene.LoadFiles(ctx, rs.repository.Scene); err != nil {
				return err
			}

			duration := 0
			filepath := ""
			resolution := 1080
			codecName := "h264"
			pf := scene.Files.Primary()
			if pf != nil {
				duration = int(pf.Duration)
				filepath = pf.Path
				if pf.Height > 0 {
					resolution = pf.Height
				}
				if pf.VideoCodec != "" {
					c := strings.ToLower(pf.VideoCodec)
					if strings.Contains(c, "h264") || strings.Contains(c, "avc") {
						codecName = "h264"
					} else if strings.Contains(c, "h265") || strings.Contains(c, "hevc") {
						codecName = "hevc"
					} else if strings.Contains(c, "av1") {
						codecName = "av1"
					} else if strings.Contains(c, "vp9") {
						codecName = "vp9"
					} else {
						codecName = c
					}
				}
			} else {
				if files := scene.Files.List(); len(files) > 0 {
					f := files[0]
					duration = int(f.Duration)
					filepath = f.Path
					if f.Height > 0 {
						resolution = f.Height
					}
				}
			}

			title := scene.Title
			if title == "" && filepath != "" {
				title = path.Base(filepath)
			}

			// Fetch tags early so we can apply tag-based VR overrides
			// before calculating screenType/stereoMode
			tags, err := rs.repository.Tag.FindBySceneID(ctx, scene.ID)

			// Build tag name set for lookups
			tagNames := make(map[string]bool)
			if err == nil {
				for _, t := range tags {
					tagNames[t.Name] = true
				}
			}

			screenType, stereoMode, is3d := getDeoVRMode(scene, title, filepath)
			// Apply tag-based overrides (from stash-deovr convention) on top of
			// the scene.VRMode / heuristic result.  This allows per-scene tags to
			// override the projection without needing the explicit VRMode field.
			screenType, stereoMode, is3d = applyDeoVRTagOverrides(tagNames, screenType, stereoMode, is3d)

			// Get markers for timeStamps
			markers, err := rs.repository.SceneMarker.FindBySceneID(ctx, videoID)
			var timeStamps []deovrTimestamp
			if err == nil && len(markers) > 0 {
				timeStamps = make([]deovrTimestamp, 0, len(markers))
				for _, m := range markers {
					label := ""
					if m.Title != nil {
						label = *m.Title
					}
					timeStamps = append(timeStamps, deovrTimestamp{
						TS:   int(m.Seconds),
						Name: label,
					})
				}
			}

			// Fetch performers
			performers, err := rs.repository.Performer.FindBySceneID(ctx, scene.ID)
			var deovrActors []deovrActor
			if err == nil && len(performers) > 0 {
				deovrActors = make([]deovrActor, 0, len(performers))
				for _, p := range performers {
					deovrActors = append(deovrActors, deovrActor{
						ID:   p.ID,
						Name: p.Name,
					})
				}
			}

			// Build categories from tags (already fetched above)
			var deovrCategories []deovrCategory
			if len(tags) > 0 {
				deovrCategories = make([]deovrCategory, 0, len(tags))
				for _, t := range tags {
					deovrCategories = append(deovrCategories, deovrCategory{
						Tag: deovrCategoryTag{
							ID:   t.ID,
							Name: t.Name,
						},
					})
				}
			}

			// Optionally fetch studio and add it to categories
			studio, err := rs.repository.Studio.FindBySceneID(ctx, scene.ID)
			if err == nil && studio != nil {
				deovrCategories = append(deovrCategories, deovrCategory{
					Tag: deovrCategoryTag{
						ID:   studio.ID,
						Name: studio.Name,
					},
				})
			}

			thumbURL := buildDeoVRURL(deovrBaseURL, fmt.Sprintf("/scene/%d/screenshot.jpg", scene.ID), apiKey)
			streamURL := buildDeoVRURL(deovrBaseURL, fmt.Sprintf("/scene/%d/stream", scene.ID), apiKey)

			var videoPreviewURL string
			if scene.HasPreview {
				videoPreviewURL = buildDeoVRURL(deovrBaseURL, fmt.Sprintf("/scene/%d/preview.mp4", scene.ID), apiKey)
			}

			detail = deovrVideoDetail{
				Encodings: []deovrEncoding{
					{
						Name: codecName,
						VideoSources: []deovrSource{
							{
								Resolution: resolution,
								URL:        streamURL,
							},
						},
					},
				},
				Title:          title,
				ID:             scene.ID,
				VideoLength:    duration,
				Is3D:           is3d,
				ScreenType:     screenType,
				StereoMode:     stereoMode,
				SkipIntro:      0,
				VideoThumbnail: "",
				VideoPreview:   videoPreviewURL,
				ThumbnailURL:   thumbURL,
				TimeStamps:     timeStamps,
				Description:    scene.Details,
				Actors:         deovrActors,
				Categories:     deovrCategories,
			}
			return nil
		}); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		writeJSON(w, detail)
		return
	}

	// Filter helper logic
	// requireTag names are resolved inside the transaction where ctx is available.
	applyFilters := func(ctx context.Context, sceneFilter *models.SceneFilterType) {
		if qQuery := r.URL.Query().Get("q"); qQuery != "" {
			sceneFilter.Title = &models.StringCriterionInput{
				Value:    qQuery,
				Modifier: models.CriterionModifierIncludes,
			}
		}
		if tagIDQuery := r.URL.Query().Get("tag_id"); tagIDQuery != "" {
			sceneFilter.Tags = &models.HierarchicalMultiCriterionInput{
				Value:    []string{tagIDQuery},
				Modifier: models.CriterionModifierIncludes,
			}
		}
		if requireTag := r.URL.Query().Get("require_tag"); requireTag != "" {
			names := strings.Split(requireTag, ",")
			var ids []string
			for _, name := range names {
				name = strings.TrimSpace(name)
				if name == "" {
					continue
				}
				tag, err := rs.repository.Tag.FindByName(ctx, name, false)
				if err == nil && tag != nil {
					ids = append(ids, strconv.Itoa(tag.ID))
				}
			}
			if len(ids) > 0 {
				sceneFilter.Tags = &models.HierarchicalMultiCriterionInput{
					Value:    ids,
					Modifier: models.CriterionModifierIncludesAll,
				}
			}
		}
		if performerIDQuery := r.URL.Query().Get("performer_id"); performerIDQuery != "" {
			sceneFilter.Performers = &models.MultiCriterionInput{
				Value:    []string{performerIDQuery},
				Modifier: models.CriterionModifierIncludes,
			}
		}
		if studioIDQuery := r.URL.Query().Get("studio_id"); studioIDQuery != "" {
			sceneFilter.Studios = &models.HierarchicalMultiCriterionInput{
				Value:    []string{studioIDQuery},
				Modifier: models.CriterionModifierIncludes,
			}
		}
	}

	// 1. Get total number of scenes matching filters
	var totalScenes int
	if err := txn.WithReadTxn(r.Context(), rs.txnManager, func(ctx context.Context) error {
		sceneFilter := &models.SceneFilterType{}
		applyFilters(ctx, sceneFilter)
		result, err := rs.repository.Scene.Query(ctx, models.SceneQueryOptions{
			QueryOptions: models.QueryOptions{
				FindFilter: models.BatchFindFilter(0), // Count only
				Count:      true,
			},
			SceneFilter: sceneFilter,
		})
		if err != nil {
			return err
		}
		totalScenes = result.Count
		return nil
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	pageSize := 100
	totalPages := (totalScenes + pageSize - 1) / pageSize
	if totalPages == 0 {
		totalPages = 1
	}

	pageStr := r.URL.Query().Get("page")
	page, err := strconv.Atoi(pageStr)
	if err != nil || page < 1 {
		page = 1
	}
	if page > totalPages {
		page = totalPages
	}

	// Content negotiation: serve JSON (VR Selection Scene format) when
	// the DeoVR native player is requesting, or when explicitly asked.
	// Serve a minimal launch page for everything else (browsers) so they
	// get a "Launch in VR" button that triggers the deovr:// protocol.
	userAgent := strings.ToLower(r.UserAgent())
	isJSON := strings.Contains(userAgent, "deovr") || r.URL.Query().Get("format") == "json"

	// Branch B: Categorized Index JSON for the native DeoVR player.
	// Returns sections: Recent, VR, 2D, then per-performer and per-studio sections.
	// Each item's video_url points back to Branch A for the full video detail JSON.
	if isJSON {
		type categorizedShort struct {
			entry deovrVideoShort
			vr    bool
		}
		var categorized []categorizedShort
		// Caches for dynamic studio/performer sections: name → list of entries
		studioSections := make(map[string][]deovrVideoShort)
		performerSections := make(map[string][]deovrVideoShort)

		if err := txn.WithReadTxn(r.Context(), rs.txnManager, func(ctx context.Context) error {
			sceneFilter := &models.SceneFilterType{}
			applyFilters(ctx, sceneFilter)
			findFilter := &models.FindFilterType{
				PerPage: &pageSize,
				Page:    &page,
			}

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

			categorized = make([]categorizedShort, 0, len(scenes))
			for _, scene := range scenes {
				if err := scene.LoadFiles(ctx, rs.repository.Scene); err != nil {
					return err
				}

				duration := 0
				filepath := ""
				if files := scene.Files.List(); len(files) > 0 {
					duration = int(files[0].Duration)
					filepath = files[0].Path
				}

				title := scene.Title
				if title == "" && filepath != "" {
					title = path.Base(filepath)
				}

				thumbURL := buildDeoVRURL(deovrBaseURL, fmt.Sprintf("/scene/%d/screenshot.jpg", scene.ID), apiKey)
				// video_url points back to /deovr to get single video JSON detail (Branch A)
				videoDetailURL := buildDeoVRURL(deovrBaseURL, fmt.Sprintf("/deovr?video_id=%d", scene.ID), apiKey)

				var videoPreviewURL string
				if scene.HasPreview {
					videoPreviewURL = buildDeoVRURL(deovrBaseURL, fmt.Sprintf("/scene/%d/preview.mp4", scene.ID), apiKey)
				}

				entry := deovrVideoShort{
					Title:          title,
					VideoLength:    duration,
					ThumbnailURL:   thumbURL,
					VideoURL:       videoDetailURL,
					VideoThumbnail: "",
					VideoPreview:   videoPreviewURL,
				}

				// Classify as VR — check VRMode field first,
				// then fall back to tag-based classification matching stash-deovr conventions.
				sceneTags, tagErr := rs.repository.Tag.FindBySceneID(ctx, scene.ID)
				tagNames := make(map[string]bool)
				if tagErr == nil {
					for _, t := range sceneTags {
						tagNames[t.Name] = true
					}
				}
				_, _, is3d := getDeoVRMode(scene, title, filepath)
				_, _, is3d = applyDeoVRTagOverrides(tagNames, "dome", "sbs", is3d)

				categorized = append(categorized, categorizedShort{
					entry: entry,
					vr:    is3d,
				})

				// Build per-performer sections
				performers, perfErr := rs.repository.Performer.FindBySceneID(ctx, scene.ID)
				if perfErr == nil {
					for _, p := range performers {
						performerSections[p.Name] = append(performerSections[p.Name], entry)
					}
				}

				// Build per-studio sections
				studio, studioErr := rs.repository.Studio.FindBySceneID(ctx, scene.ID)
				if studioErr == nil && studio != nil {
					studioSections[studio.Name] = append(studioSections[studio.Name], entry)
				}
			}
			return nil
		}); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Build ordered output: Recent, VR, 2D, then studio sections, then performer sections.
		recent := make([]deovrVideoShort, 0, len(categorized))
		var vrSection []deovrVideoShort
		var flatSection []deovrVideoShort
		for _, cs := range categorized {
			recent = append(recent, cs.entry)
			if cs.vr {
				vrSection = append(vrSection, cs.entry)
			} else {
				flatSection = append(flatSection, cs.entry)
			}
		}

		scenesOut := []deovrSceneShort{
			{Name: "Recent", List: recent},
		}
		if len(vrSection) > 0 {
			scenesOut = append(scenesOut, deovrSceneShort{Name: "VR", List: vrSection})
		}
		if len(flatSection) > 0 {
			scenesOut = append(scenesOut, deovrSceneShort{Name: "2D", List: flatSection})
		}
		// Append studio sections
		for name, list := range studioSections {
			scenesOut = append(scenesOut, deovrSceneShort{Name: name, List: list})
		}
		// Append performer sections
		for name, list := range performerSections {
			scenesOut = append(scenesOut, deovrSceneShort{Name: name, List: list})
		}

		writeJSON(w, deovrResponseShort{
			Scenes:     scenesOut,
			Authorized: "0",
		})
		return
	}

	// Branch C: Minimal launch page for browsers — auto-triggers the
	// deovr:// protocol to enter VR Selection Scene mode.  DeoVR's
	// built-in browser shows the native grid when opened via this URL.
	pageUrl := fmt.Sprintf("%s/deovr?page=%d&format=json", deovrBaseURL, page)
	if apiKey != "" {
		pageUrl += "&apikey=" + apiKey
	}

	deovrUrl := "deovr://" + pageUrl

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)

	fmt.Fprintf(w, `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vexxx DeoVR Library</title>
<style>
body { font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3; text-align: center; padding: 3rem 1rem; margin: 0; display: flex; flex-direction: column; align-items: center; min-height: 100vh; justify-content: center; }
h1 { font-size: 2rem; margin-bottom: 0.5rem; }
p { color: #8b949e; margin-bottom: 2rem; }
.btn { display: inline-block; background: linear-gradient(135deg, #8a2be2, #00f0ff); color: #fff; padding: 1rem 2.5rem; border-radius: 50px; font-size: 1.25rem; font-weight: 700; text-decoration: none; box-shadow: 0 4px 20px rgba(138,43,226,0.4); transition: transform 0.2s; }
.btn:hover { transform: scale(1.05); }
.meta { font-size: 0.85rem; color: #484f58; margin-top: 2rem; }
</style>
</head>
<body>
<h1>Vexxx DeoVR Library</h1>
<p>%d scenes available · Page %d of %d</p>
<a class="btn" href="%s">Launch in DeoVR</a>
<p class="meta">Opens the VR Selection Scene in the DeoVR player app</p>
</body>
</html>`, totalScenes, page, totalPages, deovrUrl)
}

func guessDeoVRMode(title string, filepath string) (string, string, bool) {
	all := strings.ToLower(title + " " + filepath)

	screenType := "dome"
	stereoMode := "sbs"
	is3d := true

	if strings.Contains(all, "360") {
		screenType = "sphere"
	} else if strings.Contains(all, "fisheye190") || strings.Contains(all, "rf52") {
		screenType = "rf52"
	} else if strings.Contains(all, "mkx200") {
		screenType = "mkx200"
	} else if strings.Contains(all, "fisheye") {
		screenType = "fisheye"
	} else if strings.Contains(all, "2d") || strings.Contains(all, "flat") {
		screenType = "flat"
		stereoMode = "off"
		is3d = false
	}

	if strings.Contains(all, "tb") || strings.Contains(all, "top-bottom") || strings.Contains(all, "overunder") || strings.Contains(all, "over-under") || strings.Contains(all, "top.bottom") || strings.Contains(all, "3dv") {
		stereoMode = "tb"
	} else if strings.Contains(all, "sbs") || strings.Contains(all, "lr") || strings.Contains(all, "3dh") {
		stereoMode = "sbs"
	} else if strings.Contains(all, "mono") || !is3d {
		stereoMode = "off"
		is3d = false
	}

	return screenType, stereoMode, is3d
}

func getDeoVRMode(scene *models.Scene, title string, filepath string) (string, string, bool) {
	if scene.VRMode != nil {
		switch *scene.VRMode {
		case models.VRModeLR180:
			return "dome", "sbs", true
		case models.VRModeTB360:
			return "sphere", "tb", true
		case models.VRModeMono360:
			return "sphere", "off", false
		}
	}
	return guessDeoVRMode(title, filepath)
}

// applyDeoVRTagOverrides applies stash-deovr tag conventions (FLAT, DOME,
// SPHERE, FISHEYE, MKX200, SBS, TB) to override screenType/stereoMode on top
// of whatever the VRMode field or filename heuristic determined.  Tag overrides
// are applied independently — screen-type tags change the projection and stereo
// tags change the layout — so the two sets can be combined (e.g. DOME + SBS).
func applyDeoVRTagOverrides(tagNames map[string]bool, screenType string, stereoMode string, is3d bool) (string, string, bool) {
	// Screen-type tags — mutually exclusive, first match wins.
	switch {
	case tagNames["FLAT"]:
		return "flat", "off", false
	case tagNames["DOME"]:
		screenType = "dome"
		is3d = true
	case tagNames["SPHERE"]:
		screenType = "sphere"
		is3d = true
	case tagNames["FISHEYE"]:
		screenType = "fisheye"
		is3d = true
	case tagNames["MKX200"]:
		screenType = "mkx200"
		is3d = true
	}

	// Stereo-mode tags — mutually exclusive, first match wins.
	switch {
	case tagNames["SBS"]:
		return screenType, "sbs", is3d
	case tagNames["TB"]:
		return screenType, "tb", is3d
	}

	return screenType, stereoMode, is3d
}

// ─── Tunnel Manager ──────────────────────────────────────────────────────────

// tunnelState tracks a running localtunnel process.
type tunnelState struct {
	mu      sync.Mutex
	cmd     *exec.Cmd
	cancel  context.CancelFunc
	url     string
	running bool
	err     string
}

var deovrTunnel tunnelState

// tunnelHandler manages the lifecycle of a localtunnel HTTPS tunnel for DeoVR.
func (rs vrRoutes) tunnelStartHandler(w http.ResponseWriter, r *http.Request) {
	deovrTunnel.mu.Lock()
	defer deovrTunnel.mu.Unlock()

	if deovrTunnel.running {
		writeJSON(w, map[string]interface{}{
			"status": "already_running",
			"url":    deovrTunnel.url,
		})
		return
	}

	// Verify npx/localtunnel is available before starting.
	if _, err := exec.LookPath("npx"); err != nil {
		writeJSON(w, map[string]interface{}{
			"status": "error",
			"error":  "Node.js/npx not found. Install Node.js from https://nodejs.org/, then run: npm install -g localtunnel",
		})
		return
	}

	// Use background context so the process outlives this HTTP request.
	ctx, cancel := context.WithCancel(context.Background())
	port := rs.config.GetPort()

	// Build localtunnel args from query params
	args := []string{"localtunnel", "--port", strconv.Itoa(port)}
	if subdomain := r.URL.Query().Get("subdomain"); subdomain != "" {
		args = append(args, "--subdomain", subdomain)
	}
	if localHost := r.URL.Query().Get("local_host"); localHost != "" {
		args = append(args, "--local-host", localHost)
	}
	cmd := exec.CommandContext(ctx, "npx", args...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		http.Error(w, fmt.Sprintf("failed to create stdout pipe: %v", err), http.StatusInternalServerError)
		return
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		http.Error(w, fmt.Sprintf("failed to create stderr pipe: %v", err), http.StatusInternalServerError)
		return
	}

	if err := cmd.Start(); err != nil {
		cancel()
		http.Error(w, fmt.Sprintf("failed to start localtunnel: %v", err), http.StatusInternalServerError)
		return
	}

	deovrTunnel.cmd = cmd
	deovrTunnel.cancel = cancel
	deovrTunnel.running = true
	deovrTunnel.url = ""
	deovrTunnel.err = ""

	// Parse stdout in background to capture the tunnel URL
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			// localtunnel prints: "your url is: https://xxxx.loca.lt"
			if strings.Contains(line, "your url is:") {
				parts := strings.Split(line, "https://")
				if len(parts) > 1 {
					url := "https://" + strings.TrimSpace(parts[len(parts)-1])
					deovrTunnel.mu.Lock()
					deovrTunnel.url = url
					deovrTunnel.mu.Unlock()
				}
			}
		}
	}()

	// Capture stderr for error diagnostics
	go func() {
		stderrScanner := bufio.NewScanner(stderr)
		var errBuf strings.Builder
		for stderrScanner.Scan() {
			line := stderrScanner.Text()
			errBuf.WriteString(line)
			errBuf.WriteString("\n")
		}
		if errBuf.Len() > 0 {
			deovrTunnel.mu.Lock()
			deovrTunnel.err = errBuf.String()
			deovrTunnel.mu.Unlock()
		}
	}()

	// Wait for process exit in background and update state
	go func() {
		err := cmd.Wait()
		deovrTunnel.mu.Lock()
		deovrTunnel.running = false
		if err != nil && deovrTunnel.err == "" {
			deovrTunnel.err = err.Error()
		}
		deovrTunnel.mu.Unlock()
	}()

	writeJSON(w, map[string]interface{}{
		"status": "starting",
		"port":   port,
	})
}

func (rs vrRoutes) tunnelStopHandler(w http.ResponseWriter, r *http.Request) {
	deovrTunnel.mu.Lock()
	defer deovrTunnel.mu.Unlock()

	if !deovrTunnel.running {
		writeJSON(w, map[string]interface{}{
			"status": "not_running",
		})
		return
	}

	if deovrTunnel.cancel != nil {
		deovrTunnel.cancel()
	}
	deovrTunnel.cmd = nil
	deovrTunnel.cancel = nil
	deovrTunnel.running = false
	deovrTunnel.url = ""

	writeJSON(w, map[string]interface{}{
		"status": "stopped",
	})
}

func (rs vrRoutes) tunnelStatusHandler(w http.ResponseWriter, r *http.Request) {
	deovrTunnel.mu.Lock()
	defer deovrTunnel.mu.Unlock()

	writeJSON(w, map[string]interface{}{
		"running": deovrTunnel.running,
		"url":     deovrTunnel.url,
		"error":   deovrTunnel.err,
	})
}
