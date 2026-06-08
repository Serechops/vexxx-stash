package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path"
	"strconv"
	"strings"

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
}

type deovrVideoShort struct {
	Title        string `json:"title"`
	VideoLength  int    `json:"videoLength"`
	ThumbnailURL string `json:"thumbnailUrl"`
	VideoURL     string `json:"video_url"`
}

type deovrSceneShort struct {
	Name string            `json:"name"`
	List []deovrVideoShort `json:"list"`
}

type deovrResponseShort struct {
	Scenes     []deovrSceneShort `json:"scenes"`
	Authorized string            `json:"authorized"`
}

func buildDeoVRURL(baseURL string, path string, apiKey string) string {
	if apiKey != "" {
		return fmt.Sprintf("%s%s?apikey=%s", baseURL, path, apiKey)
	}
	return fmt.Sprintf("%s%s", baseURL, path)
}

func buildFilterQuery(r *http.Request) string {
	var parts []string
	if apiKey := r.URL.Query().Get("apikey"); apiKey != "" {
		parts = append(parts, "apikey="+apiKey)
	}
	if tagID := r.URL.Query().Get("tag_id"); tagID != "" {
		parts = append(parts, "tag_id="+tagID)
	}
	if performerID := r.URL.Query().Get("performer_id"); performerID != "" {
		parts = append(parts, "performer_id="+performerID)
	}
	if studioID := r.URL.Query().Get("studio_id"); studioID != "" {
		parts = append(parts, "studio_id="+studioID)
	}
	if q := r.URL.Query().Get("q"); q != "" {
		parts = append(parts, "q="+q)
	}
	if len(parts) > 0 {
		return "&" + strings.Join(parts, "&")
	}
	return ""
}

func htmlEscape(s string) string {
	r := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		`'`, "&#39;",
	)
	return r.Replace(s)
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

	// Derive a plain-HTTP base URL for all DeoVR-facing media resources
	// (streams, thumbnails, previews, video detail URLs).  DeoVR's VR
	// Selection Scene plays media over plain HTTP without needing SSL,
	// mirroring how DLNA serves content.  We intentionally ignore proxy
	// headers and ExternalHost here because DeoVR must connect directly
	// to the server's actual address over HTTP.
	deovrBaseURL := "http://" + r.Host + getProxyPrefix(r)

	apiKey := r.URL.Query().Get("apikey")
	filterQuery := buildFilterQuery(r)
	apiKeyQuery := ""
	if apiKey != "" {
		apiKeyQuery = "&apikey=" + apiKey
	}

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

			screenType, stereoMode, is3d := getDeoVRMode(scene, title, filepath)

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

			thumbURL := buildDeoVRURL(deovrBaseURL, fmt.Sprintf("/scene/%d/screenshot", scene.ID), apiKey)
			streamURL := buildDeoVRURL(deovrBaseURL, fmt.Sprintf("/scene/%d/stream", scene.ID), apiKey)
			previewURL := buildDeoVRURL(deovrBaseURL, fmt.Sprintf("/scene/%d/preview", scene.ID), apiKey)

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
				VideoThumbnail: previewURL,
				VideoPreview:   previewURL,
				ThumbnailURL:   thumbURL,
				TimeStamps:     timeStamps,
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
	applyFilters := func(sceneFilter *models.SceneFilterType) {
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
		applyFilters(sceneFilter)
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

	format := r.URL.Query().Get("format")
	// Content negotiation: serve JSON (VR Selection Scene, no SSL needed) when
	// DeoVR is detected, or when explicitly requested via ?format=json.
	// Serve HTML (styled portal with filters) for everything else.
	// Detection signals (in priority order):
	//   - ?format=json  → JSON (force VR mode)
	//   - ?format=html  → HTML (force portal)
	//   - User-Agent contains "deovr" → JSON (VR Selection Scene, HTTP streaming)
	//   - Default        → HTML (desktop browser portal)
	userAgent := strings.ToLower(r.UserAgent())
	isJSON := format == "json" || (format != "html" && strings.Contains(userAgent, "deovr"))

	// Branch B: Shortened Paginated List JSON
	if isJSON {
		var list []deovrVideoShort

		if err := txn.WithReadTxn(r.Context(), rs.txnManager, func(ctx context.Context) error {
			sceneFilter := &models.SceneFilterType{}
			applyFilters(sceneFilter)
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

			list = make([]deovrVideoShort, 0, len(scenes))
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

				thumbURL := buildDeoVRURL(deovrBaseURL, fmt.Sprintf("/scene/%d/screenshot", scene.ID), apiKey)
				// video_url points back to /deovr to get single video JSON detail (Branch A)
				videoDetailURL := buildDeoVRURL(deovrBaseURL, fmt.Sprintf("/deovr?video_id=%d", scene.ID), apiKey)

				list = append(list, deovrVideoShort{
					Title:        title,
					VideoLength:  duration,
					ThumbnailURL: thumbURL,
					VideoURL:     videoDetailURL,
				})
			}
			return nil
		}); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		writeJSON(w, deovrResponseShort{
			Scenes: []deovrSceneShort{
				{
					Name: fmt.Sprintf("Page %d of %d (Scenes %d-%d)", page, totalPages, (page-1)*pageSize+1, (page-1)*pageSize+len(list)),
					List: list,
				},
			},
			Authorized: "0",
		})
		return
	}

	// Fetch filter lists to render dropdowns in Branch C HTML
	type filterItem struct {
		ID   string
		Name string
	}
	var tagItems []filterItem
	var performerItems []filterItem
	var studioItems []filterItem

	_ = txn.WithReadTxn(r.Context(), rs.txnManager, func(ctx context.Context) error {
		tags, _, _ := rs.repository.Tag.Query(ctx, &models.TagFilterType{}, models.BatchFindFilter(500))
		for _, t := range tags {
			tagItems = append(tagItems, filterItem{ID: strconv.Itoa(t.ID), Name: t.Name})
		}
		performers, _, _ := rs.repository.Performer.Query(ctx, &models.PerformerFilterType{}, models.BatchFindFilter(500))
		for _, p := range performers {
			performerItems = append(performerItems, filterItem{ID: strconv.Itoa(p.ID), Name: p.Name})
		}
		studios, _, _ := rs.repository.Studio.Query(ctx, &models.StudioFilterType{}, models.BatchFindFilter(500))
		for _, s := range studios {
			studioItems = append(studioItems, filterItem{ID: strconv.Itoa(s.ID), Name: s.Name})
		}
		return nil
	})

	var tagOptions strings.Builder
	tagOptions.WriteString(`<option value="">All Tags</option>`)
	activeTagID := r.URL.Query().Get("tag_id")
	for _, t := range tagItems {
		selected := ""
		if t.ID == activeTagID {
			selected = "selected"
		}
		tagOptions.WriteString(fmt.Sprintf(`<option value="%s" %s>%s</option>`, t.ID, selected, htmlEscape(t.Name)))
	}

	var performerOptions strings.Builder
	performerOptions.WriteString(`<option value="">All Performers</option>`)
	activePerformerID := r.URL.Query().Get("performer_id")
	for _, p := range performerItems {
		selected := ""
		if p.ID == activePerformerID {
			selected = "selected"
		}
		performerOptions.WriteString(fmt.Sprintf(`<option value="%s" %s>%s</option>`, p.ID, selected, htmlEscape(p.Name)))
	}

	var studioOptions strings.Builder
	studioOptions.WriteString(`<option value="">All Studios</option>`)
	activeStudioID := r.URL.Query().Get("studio_id")
	for _, s := range studioItems {
		selected := ""
		if s.ID == activeStudioID {
			selected = "selected"
		}
		studioOptions.WriteString(fmt.Sprintf(`<option value="%s" %s>%s</option>`, s.ID, selected, htmlEscape(s.Name)))
	}

	// Fetch scenes for this page in Branch C (HTML format)
	var htmlScenes []*models.Scene
	if err := txn.WithReadTxn(r.Context(), rs.txnManager, func(ctx context.Context) error {
		sceneFilter := &models.SceneFilterType{}
		applyFilters(sceneFilter)
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

		resolvedScenes, err := result.Resolve(ctx)
		if err != nil {
			return err
		}
		htmlScenes = resolvedScenes
		for _, scene := range htmlScenes {
			_ = scene.LoadFiles(ctx, rs.repository.Scene)
		}
		return nil
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Build Scene Cards HTML
	var sceneCardsHTML strings.Builder
	for _, scene := range htmlScenes {
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

		thumbURL := buildDeoVRURL(baseURL, fmt.Sprintf("/scene/%d/screenshot", scene.ID), apiKey)
		previewURL := buildDeoVRURL(baseURL, fmt.Sprintf("/scene/%d/preview", scene.ID), apiKey)
		// videoDetailURL is consumed by DeoVR to fetch the single-video JSON
		// detail, so it must use the plain-HTTP deovrBaseURL to avoid SSL errors.
		videoDetailURL := buildDeoVRURL(deovrBaseURL, fmt.Sprintf("/deovr?video_id=%d", scene.ID), apiKey)

		deovrVideoURL := "deovr://" + videoDetailURL

		vrModeLabel := ""
		if scene.VRMode != nil {
			switch *scene.VRMode {
			case models.VRModeLR180:
				vrModeLabel = "180° LR"
			case models.VRModeTB360:
				vrModeLabel = "360° TB"
			case models.VRModeMono360:
				vrModeLabel = "360° Mono"
			}
		} else {
			vrModeLabel = "Not Set"
		}
		vrModeClass := "scene-vrmode"
		if scene.VRMode == nil {
			vrModeClass += " not-set"
		}

		sceneCardsHTML.WriteString(fmt.Sprintf(`
			<div class="scene-card">
				<div class="scene-thumbnail-container">
					<img class="scene-thumbnail" src="%s" alt="%s" />
					<video class="scene-preview" src="%s" loop muted playsinline></video>
					<span class="scene-duration">%s</span>
					<span class="%s">%s</span>
				</div>
				<div class="scene-info">
					<div class="scene-title">%s</div>
					<div class="scene-actions">
						<a href="%s" class="btn-play">Play in DeoVR</a>
						<a href="%s" class="btn-json" target="_blank">JSON</a>
					</div>
				</div>
			</div>
		`,
			thumbURL,
			htmlEscape(title),
			previewURL,
			formatDuration(duration),
			vrModeClass,
			vrModeLabel,
			htmlEscape(title),
			deovrVideoURL,
			videoDetailURL,
		))
	}
	if len(htmlScenes) == 0 {
		sceneCardsHTML.WriteString(`<div class="no-scenes">No scenes found matching your filters.</div>`)
	}

	// Build Pagination HTML
	var paginationHTML strings.Builder
	if totalPages > 1 {
		paginationHTML.WriteString(`<div class="pagination">`)

		buildPageURL := func(p int) string {
			return fmt.Sprintf("%s/deovr?page=%d&format=html%s%s", baseURL, p, apiKeyQuery, filterQuery)
		}

		if page > 1 {
			paginationHTML.WriteString(fmt.Sprintf(`<a href="%s" class="page-nav">&laquo; Prev</a>`, buildPageURL(page-1)))
		}

		for p := 1; p <= totalPages; p++ {
			activeClass := ""
			if p == page {
				activeClass = "active"
			}
			paginationHTML.WriteString(fmt.Sprintf(`<a href="%s" class="page-num-link %s">%d</a>`, buildPageURL(p), activeClass, p))
		}

		if page < totalPages {
			paginationHTML.WriteString(fmt.Sprintf(`<a href="%s" class="page-nav">Next &raquo;</a>`, buildPageURL(page+1)))
		}

		paginationHTML.WriteString(`</div>`)
	}

	// Build Feed Launch URL — uses deovrBaseURL (plain HTTP) so DeoVR
	// can fetch the JSON feed without SSL errors.
	pageUrl := fmt.Sprintf("%s/deovr?page=%d&format=json%s%s", deovrBaseURL, page, apiKeyQuery, filterQuery)
	deovrUrl := "deovr://" + pageUrl

	// Branch C: Serve Glassmorphic HTML Portal Page
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)

	// We use strings.Replace to safely substitute template values and avoid formatting % characters in CSS
	htmlTemplate := `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Vexxx VR Portal</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Access your high-performance Vexxx VR library directly in your DeoVR headset.">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #05070f;
            --card-bg: rgba(13, 17, 30, 0.45);
            --card-border: rgba(255, 255, 255, 0.06);
            --accent-primary: #8a2be2;
            --accent-primary-glow: rgba(138, 43, 226, 0.35);
            --accent-secondary: #00f0ff;
            --accent-secondary-glow: rgba(0, 240, 255, 0.25);
            --text-main: #f3f4f6;
            --text-muted: #9ca3af;
        }

        body {
            background-color: var(--bg-color);
            background-image: 
                radial-gradient(circle at 10% 20%, rgba(138, 43, 226, 0.08) 0%, transparent 40%),
                radial-gradient(circle at 90% 80%, rgba(0, 240, 255, 0.06) 0%, transparent 40%);
            color: var(--text-main);
            font-family: 'Inter', sans-serif;
            margin: 0;
            padding: 60px 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
            box-sizing: border-box;
        }

        .container {
            max-width: 1200px;
            width: 100%;
            text-align: center;
        }

        .header-logo {
            font-family: 'Outfit', sans-serif;
            font-size: 3.5rem;
            font-weight: 800;
            background: linear-gradient(135deg, var(--text-main) 30%, var(--accent-secondary) 70%, var(--accent-primary) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin: 0 0 10px 0;
            letter-spacing: -1px;
            filter: drop-shadow(0 2px 10px rgba(0, 240, 255, 0.15));
        }

        .subtitle {
            font-size: 1.25rem;
            color: var(--text-muted);
            margin-bottom: 30px;
            font-weight: 300;
            letter-spacing: 0.5px;
        }

        .stats-badge {
            background: linear-gradient(135deg, rgba(138, 43, 226, 0.15) 0%, rgba(0, 240, 255, 0.05) 100%);
            border: 1px solid var(--card-border);
            padding: 10px 24px;
            border-radius: 50px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 30px;
            font-weight: 500;
            font-size: 0.95rem;
            color: var(--text-main);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
            backdrop-filter: blur(10px);
        }

        .stats-badge .dot {
            width: 8px;
            height: 8px;
            background-color: var(--accent-secondary);
            border-radius: 50%;
            box-shadow: 0 0 8px var(--accent-secondary);
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(0, 240, 255, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(0, 240, 255, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(0, 240, 255, 0); }
        }

        .filter-bar {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 24px;
            padding: 20px;
            margin-bottom: 30px;
            display: flex;
            flex-wrap: wrap;
            gap: 15px;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(12px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            width: 100%;
            box-sizing: border-box;
        }

        .filter-input, .filter-select {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 10px 15px;
            color: var(--text-main);
            font-family: inherit;
            font-size: 0.95rem;
            outline: none;
            transition: all 0.3s ease;
            min-width: 160px;
            flex: 1;
        }

        .filter-input::placeholder {
            color: rgba(255, 255, 255, 0.3);
        }

        .filter-input:focus, .filter-select:focus {
            border-color: var(--accent-secondary);
            box-shadow: 0 0 10px rgba(0, 240, 255, 0.15);
            background: rgba(255, 255, 255, 0.08);
        }

        .filter-select option {
            background: #0d111e;
            color: var(--text-main);
        }

        .btn-filter, .btn-reset {
            padding: 10px 24px;
            border-radius: 12px;
            font-weight: 600;
            font-size: 0.95rem;
            cursor: pointer;
            transition: all 0.3s ease;
            border: none;
            font-family: inherit;
        }

        .btn-filter {
            background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
            color: #ffffff;
            box-shadow: 0 4px 15px var(--accent-primary-glow);
        }

        .btn-filter:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(138, 43, 226, 0.5);
        }

        .btn-reset {
            background: rgba(255, 255, 255, 0.08);
            color: var(--text-muted);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .btn-reset:hover {
            background: rgba(255, 255, 255, 0.15);
            color: var(--text-main);
        }

        .feed-launch-container {
            display: flex;
            justify-content: center;
            margin-bottom: 40px;
        }

        .btn-launch-feed {
            background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
            color: #ffffff;
            padding: 14px 36px;
            border-radius: 50px;
            font-size: 1.1rem;
            font-weight: 700;
            text-decoration: none;
            letter-spacing: 0.5px;
            box-shadow: 0 8px 25px var(--accent-primary-glow), 0 0 15px var(--accent-secondary-glow);
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            display: inline-flex;
            align-items: center;
            gap: 10px;
        }

        .btn-launch-feed:hover {
            transform: translateY(-3px) scale(1.03);
            box-shadow: 0 12px 30px rgba(138, 43, 226, 0.6), 0 0 25px rgba(0, 240, 255, 0.5);
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 28px;
            width: 100%;
            perspective: 1000px;
            margin-bottom: 50px;
        }

        .scene-card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 20px;
            padding: 12px;
            display: flex;
            flex-direction: column;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(16px);
            transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            position: relative;
            overflow: hidden;
            text-align: left;
        }

        .scene-card::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
            opacity: 0;
            transition: opacity 0.4s ease;
            z-index: 0;
            border-radius: 19px;
        }

        .scene-card:hover {
            transform: translateY(-6px);
            border-color: rgba(0, 240, 255, 0.3);
            box-shadow: 0 15px 35px rgba(138, 43, 226, 0.15), 0 0 30px rgba(0, 240, 255, 0.1);
        }

        .scene-card:hover::before {
            opacity: 0.04;
        }

        .scene-thumbnail-container {
            position: relative;
            width: 100%;
            padding-top: 56.25%; /* 16:9 */
            border-radius: 14px;
            overflow: hidden;
            background: #000;
            z-index: 1;
        }

        .scene-thumbnail {
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            object-fit: cover;
            transition: transform 0.5s ease, opacity 0.3s ease;
        }

        .scene-preview {
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            object-fit: cover;
            opacity: 0;
            transition: opacity 0.4s ease;
        }

        .scene-card:hover .scene-thumbnail {
            transform: scale(1.05);
        }

        .scene-card:hover .scene-preview {
            opacity: 1;
        }

        .scene-duration {
            position: absolute;
            bottom: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.75);
            backdrop-filter: blur(4px);
            color: #ffffff;
            padding: 3px 8px;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
            letter-spacing: 0.5px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .scene-vrmode {
            position: absolute;
            top: 10px;
            left: 10px;
            background: linear-gradient(135deg, rgba(138, 43, 226, 0.85) 0%, rgba(0, 240, 255, 0.85) 100%);
            backdrop-filter: blur(4px);
            color: #ffffff;
            padding: 3px 8px;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 700;
            letter-spacing: 0.5px;
            box-shadow: 0 2px 8px rgba(0, 240, 255, 0.25);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .scene-vrmode.not-set {
            background: rgba(255, 255, 255, 0.12);
            color: rgba(255, 255, 255, 0.5);
            box-shadow: none;
            font-weight: 500;
        }

        .scene-info {
            padding: 12px 6px 4px 6px;
            display: flex;
            flex-direction: column;
            flex-grow: 1;
            z-index: 1;
        }

        .scene-title {
            font-size: 0.95rem;
            font-weight: 600;
            color: var(--text-main);
            margin-bottom: 12px;
            line-height: 1.4;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
            height: 2.8em;
        }

        .scene-actions {
            display: flex;
            gap: 8px;
            margin-top: auto;
        }

        .btn-play {
            flex-grow: 1;
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: var(--text-main);
            padding: 8px 12px;
            border-radius: 10px;
            font-size: 0.85rem;
            font-weight: 600;
            text-decoration: none;
            text-align: center;
            transition: all 0.2s ease;
        }

        .btn-play:hover {
            background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
            border-color: transparent;
            box-shadow: 0 4px 15px rgba(0, 240, 255, 0.25);
            color: #ffffff;
            transform: translateY(-1px);
        }

        .btn-json {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.05);
            color: var(--text-muted);
            padding: 8px 12px;
            border-radius: 10px;
            font-size: 0.85rem;
            text-decoration: none;
            text-align: center;
            transition: all 0.2s ease;
        }

        .btn-json:hover {
            background: rgba(255, 255, 255, 0.1);
            color: var(--text-main);
            border-color: rgba(255, 255, 255, 0.2);
        }

        .no-scenes {
            grid-column: 1 / -1;
            padding: 50px;
            text-align: center;
            color: var(--text-muted);
            font-size: 1.1rem;
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 20px;
        }

        .pagination {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 8px;
            margin-top: 20px;
            margin-bottom: 40px;
        }

        .page-num-link, .page-nav {
            color: var(--text-muted);
            text-decoration: none;
            padding: 8px 16px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.05);
            transition: all 0.2s ease;
            font-size: 0.9rem;
            font-weight: 500;
        }

        .page-num-link:hover, .page-nav:hover {
            color: var(--text-main);
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.15);
        }

        .page-num-link.active {
            color: #ffffff;
            background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
            border-color: transparent;
            font-weight: 700;
            box-shadow: 0 4px 12px rgba(138, 43, 226, 0.25);
        }

        .footer-note {
            margin-top: 60px;
            font-size: 0.85rem;
            color: rgba(255, 255, 255, 0.3);
            letter-spacing: 0.5px;
        }
        
        .footer-note a {
            color: var(--accent-secondary);
            text-decoration: none;
        }
        .footer-note a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1 class="header-logo">VEXXX VR</h1>
        <div class="subtitle">DeoVR Player Library Portal</div>
        
        <div class="stats-badge">
            <span class="dot"></span>
            <span>__TOTAL_SCENES__ Scenes Connected</span>
        </div>

        <div class="filter-bar">
            <input type="text" id="search-query" class="filter-input" placeholder="Search title..." value="__SEARCH_QUERY__" onkeydown="if(event.key === 'Enter') applyFilters()">
            <select id="filter-tag" class="filter-select" onchange="applyFilters()">
                __TAG_OPTIONS__
            </select>
            <select id="filter-performer" class="filter-select" onchange="applyFilters()">
                __PERFORMER_OPTIONS__
            </select>
            <select id="filter-studio" class="filter-select" onchange="applyFilters()">
                __STUDIO_OPTIONS__
            </select>
            <button class="btn-filter" onclick="applyFilters()">Filter</button>
            <button class="btn-reset" onclick="resetFilters()">Reset</button>
        </div>

        <div class="feed-launch-container">
            <a href="__LAUNCH_FEED_URL__" class="btn-launch-feed">⚡ Open Page __PAGE_NUM__ in DeoVR Feed</a>
        </div>

        <div class="grid">
            __SCENE_CARDS__
        </div>

        __PAGINATION__

        <div class="footer-note">
            Open this page in the <strong>DeoVR Internet Browser</strong> to stream directly.<br>
            Powered by Vexxx VR Theatre Integration.
        </div>
    </div>

    <script>
        // Hover previews logic
        document.querySelectorAll('.scene-card').forEach(card => {
            const video = card.querySelector('.scene-preview');
            if (video) {
                card.addEventListener('mouseenter', () => {
                    video.play().catch(e => {
                        console.log("Play failed: ", e);
                    });
                });
                card.addEventListener('mouseleave', () => {
                    video.pause();
                    video.currentTime = 0;
                });
            }
        });

        function applyFilters() {
            const q = document.getElementById('search-query').value.trim();
            const tag = document.getElementById('filter-tag').value;
            const performer = document.getElementById('filter-performer').value;
            const studio = document.getElementById('filter-studio').value;
            
            const params = new URLSearchParams(window.location.search);
            params.set('format', 'html');
            
            if (q) params.set('q', q); else params.delete('q');
            if (tag) params.set('tag_id', tag); else params.delete('tag_id');
            if (performer) params.set('performer_id', performer); else params.delete('performer_id');
            if (studio) params.set('studio_id', studio); else params.delete('studio_id');
            
            params.delete('page');
            
            window.location.search = params.toString();
        }

        function resetFilters() {
            const params = new URLSearchParams(window.location.search);
            const apikey = params.get('apikey');
            
            const newParams = new URLSearchParams();
            newParams.set('format', 'html');
            if (apikey) newParams.set('apikey', apikey);
            
            window.location.search = newParams.toString();
        }
    </script>
</body>
</html>`

	replacer := strings.NewReplacer(
		"__TOTAL_SCENES__", strconv.Itoa(totalScenes),
		"__SEARCH_QUERY__", htmlEscape(r.URL.Query().Get("q")),
		"__TAG_OPTIONS__", tagOptions.String(),
		"__PERFORMER_OPTIONS__", performerOptions.String(),
		"__STUDIO_OPTIONS__", studioOptions.String(),
		"__LAUNCH_FEED_URL__", deovrUrl,
		"__PAGE_NUM__", strconv.Itoa(page),
		"__SCENE_CARDS__", sceneCardsHTML.String(),
		"__PAGINATION__", paginationHTML.String(),
	)

	_, _ = w.Write([]byte(replacer.Replace(htmlTemplate)))
}

func formatDuration(seconds int) string {
	h := seconds / 3600
	m := (seconds % 3600) / 60
	s := seconds % 60
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%d:%02d", m, s)
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
