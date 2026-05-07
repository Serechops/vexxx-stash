package manager

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/job"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/sliceutil/stringslice"
	"github.com/stashapp/stash/pkg/stashtag"
)

// ─── GraphQL-bound types (matched by gqlgen.yml model mappings) ───────────────

// StashTagBatchInput holds the input for a StashTag batch analysis job.
type StashTagBatchInput struct {
	SceneIDs            []string `json:"sceneIDs"`
	Threshold           float64  `json:"threshold"`
	AutoAcceptThreshold float64  `json:"autoAcceptThreshold"`
	AutoGenerateSprites bool     `json:"autoGenerateSprites"`
}

// StashTagTagPrediction holds one tag prediction.
type StashTagTagPrediction struct {
	Name       string  `json:"name"`
	Confidence float64 `json:"confidence"`
}

// StashTagSceneResult holds the analysis result for one scene.
type StashTagSceneResult struct {
	SceneID    string                  `json:"sceneID"`
	SceneLabel string                  `json:"sceneLabel"`
	Status     string                  `json:"status"` // "done" | "error" | "skipped"
	Tags       []StashTagTagPrediction `json:"tags"`
	Error      *string                 `json:"error"`
}

// StashTagJobResult holds all results for a completed batch job.
type StashTagJobResult struct {
	JobID               string                `json:"jobID"`
	Threshold           float64               `json:"threshold"`
	AutoAcceptThreshold float64               `json:"autoAcceptThreshold"`
	Scenes              []StashTagSceneResult `json:"scenes"`
}

// ─── In-memory result store ───────────────────────────────────────────────────

var (
	stashTagResultsMu  sync.RWMutex
	stashTagResultsMap = map[string]*StashTagJobResult{}
)

// GetStashTagJobResult returns the cached result for a job, or nil if not found.
func GetStashTagJobResult(jobID string) *StashTagJobResult {
	stashTagResultsMu.RLock()
	defer stashTagResultsMu.RUnlock()
	return stashTagResultsMap[jobID]
}

// ClearStashTagJobResult removes cached results for a job.
func ClearStashTagJobResult(jobID string) {
	stashTagResultsMu.Lock()
	defer stashTagResultsMu.Unlock()
	delete(stashTagResultsMap, jobID)
}

func setStashTagJobResult(result *StashTagJobResult) {
	stashTagResultsMu.Lock()
	defer stashTagResultsMu.Unlock()
	stashTagResultsMap[result.JobID] = result
}

// ─── Manager method ───────────────────────────────────────────────────────────

// StashTagBatchAnalyze queues a StashTag batch analysis job and returns the job ID.
func (s *Manager) StashTagBatchAnalyze(ctx context.Context, input StashTagBatchInput) (int, error) {
	j := &stashTagBatchJob{
		input:   input,
		jobIDCh: make(chan string, 1),
	}
	id := s.JobManager.Add(ctx, fmt.Sprintf("StashTag: analysing %d scenes", len(input.SceneIDs)), j)
	// The dispatcher goroutine can only start after Add() releases its mutex,
	// which happens on return. We send before that window closes via the
	// buffered channel so Execute() always finds the value ready.
	j.jobIDCh <- strconv.Itoa(id)
	return id, nil
}

// ─── Job implementation ───────────────────────────────────────────────────────

type stashTagBatchJob struct {
	input   StashTagBatchInput
	jobIDCh chan string // buffered(1): populated by StashTagBatchAnalyze before Execute() runs
}

func (j *stashTagBatchJob) Execute(ctx context.Context, progress *job.Progress) error {
	// Receive the job ID that was placed in the channel before this goroutine started.
	jobIDStr := <-j.jobIDCh

	cfg := config.GetInstance()
	controller := stashtag.NewController(
		cfg.GetPythonPath(),
		filepath.Join(cfg.GetGeneratedPath(), "stashtag"),
	)

	fileNamingAlgo := cfg.GetVideoFileNamingAlgorithm()
	r := instance.Repository

	// Convert string IDs to ints (drop any invalid)
	sceneIDs, err := stringslice.StringSliceToIntSlice(j.input.SceneIDs)
	if err != nil {
		return fmt.Errorf("invalid scene IDs: %w", err)
	}

	// Pre-populate result with "pending" entries so the query returns
	// partial data while the job is running.
	scenes := make([]StashTagSceneResult, len(sceneIDs))
	for i, id := range sceneIDs {
		scenes[i] = StashTagSceneResult{
			SceneID:    strconv.Itoa(id),
			SceneLabel: fmt.Sprintf("Scene %d", id),
			Status:     "pending",
			Tags:       []StashTagTagPrediction{},
		}
	}
	result := &StashTagJobResult{
		JobID:               jobIDStr,
		Threshold:           j.input.Threshold,
		AutoAcceptThreshold: j.input.AutoAcceptThreshold,
		Scenes:              scenes,
	}
	setStashTagJobResult(result)

	progress.SetTotal(len(sceneIDs))

	for i, sceneID := range sceneIDs {
		if job.IsCancelled(ctx) {
			break
		}

		idx := i // capture for closure
		sceneIDStr := strconv.Itoa(sceneID)
		sceneLabel := sceneIDStr // updated once DB load succeeds

		progress.ExecuteTask(fmt.Sprintf("StashTag: scene %s — loading", sceneLabel), func() {
			sceneResult := &result.Scenes[idx]

			// Load scene from DB (OSHash/Checksum come from the join query)
			type sceneInfo struct {
				label     string
				hash      string
				hasHash   bool
				fullScene *models.Scene // only set when autoGenerateSprites is true
			}
			var info sceneInfo

			err := r.WithReadTxn(ctx, func(ctx context.Context) error {
				s, err := r.Scene.Find(ctx, sceneID)
				if err != nil {
					return err
				}
				if s == nil {
					return fmt.Errorf("scene %d not found", sceneID)
				}
				// Build a display label from title or filename
				if s.Title != "" {
					info.label = s.Title
				} else if s.Path != "" {
					info.label = filepath.Base(s.Path)
				} else {
					info.label = sceneIDStr
				}
				h := s.GetHash(fileNamingAlgo)
				info.hash = h
				info.hasHash = h != ""

				// Only load files when auto-generation may be needed
				if j.input.AutoGenerateSprites {
					if err := s.LoadFiles(ctx, r.Scene); err != nil {
						return fmt.Errorf("loading files for scene %d: %w", sceneID, err)
					}
					info.fullScene = s
				}
				return nil
			})

			sceneResult.SceneLabel = info.label
			sceneLabel = info.label

			if err != nil {
				errStr := err.Error()
				sceneResult.Status = "error"
				sceneResult.Error = &errStr
				logger.Warnf("StashTagBatch: scene %d: %v", sceneID, err)
				progress.Increment()
				return
			}

			if !info.hasHash {
				errStr := "no file hash available (scene has no associated file)"
				sceneResult.Status = "skipped"
				sceneResult.Error = &errStr
				progress.Increment()
				return
			}

			spritePath := instance.Paths.Scene.GetSpriteImageFilePath(info.hash)
			vttPath := instance.Paths.Scene.GetSpriteVttFilePath(info.hash)

			if _, statErr := os.Stat(spritePath); os.IsNotExist(statErr) {
				if !j.input.AutoGenerateSprites {
					errStr := "sprite file not found — generate sprites first via Scene → Operations, or enable Auto-generate"
					sceneResult.Status = "skipped"
					sceneResult.Error = &errStr
					progress.Increment()
					return
				}

				// Auto-generate sprites synchronously
				if info.fullScene == nil || info.fullScene.Path == "" {
					errStr := "cannot auto-generate sprites: scene has no video file path"
					sceneResult.Status = "skipped"
					sceneResult.Error = &errStr
					progress.Increment()
					return
				}

				logger.Infof("StashTagBatch: auto-generating sprites for scene %d", sceneID)
				progress.ExecuteTask(fmt.Sprintf("StashTag: scene %s — generating sprite sheet", sceneLabel), func() {
					spriteTask := GenerateSpriteTask{
						Scene:               *info.fullScene,
						Overwrite:           false,
						fileNamingAlgorithm: fileNamingAlgo,
					}
					spriteTask.Start(ctx)
				})

				// Verify generation succeeded
				if _, statErr2 := os.Stat(spritePath); os.IsNotExist(statErr2) {
					errStr := "sprite generation failed — check FFmpeg is available and the video file is readable"
					sceneResult.Status = "error"
					sceneResult.Error = &errStr
					progress.Increment()
					return
				}
			}

			progress.ExecuteTask(fmt.Sprintf("StashTag: scene %s — running AI prediction", sceneLabel), func() {
				resp, err := controller.PredictTags(ctx, stashtag.PredictTagsRequest{
					ImagePath: spritePath,
					VTTPath:   vttPath,
					Threshold: j.input.Threshold,
				})
				if err != nil {
					errStr := err.Error()
					sceneResult.Status = "error"
					sceneResult.Error = &errStr
					logger.Warnf("StashTagBatch: prediction failed for scene %d: %v", sceneID, err)
					return
				}
				if !resp.Success {
					errMsg := resp.Error
					if errMsg == "" {
						errMsg = "StashTag prediction returned failure"
					}
					sceneResult.Status = "error"
					sceneResult.Error = &errMsg
					return
				}

				// Parse the tag result map
				tags, parseErr := parseStashTagResult(resp.Result)
				if parseErr != nil {
					errStr := parseErr.Error()
					sceneResult.Status = "error"
					sceneResult.Error = &errStr
					return
				}

				sceneResult.Status = "done"
				sceneResult.Tags = tags
			})

			progress.Increment()
		})
	}

	return nil
}

// parseStashTagResult parses the raw JSON result from StashTag into a sorted
// slice of predictions (highest confidence first).
func parseStashTagResult(raw json.RawMessage) ([]StashTagTagPrediction, error) {
	if len(raw) == 0 {
		return nil, nil
	}

	// The result is a map of tag_key → { label, prob, confidence }
	var tagMap map[string]struct {
		Label      string  `json:"label"`
		Prob       float64 `json:"prob"`
		Confidence float64 `json:"confidence"`
	}
	if err := json.Unmarshal(raw, &tagMap); err != nil {
		return nil, fmt.Errorf("parsing StashTag result: %w", err)
	}

	preds := make([]StashTagTagPrediction, 0, len(tagMap))
	for key, data := range tagMap {
		name := data.Label
		if name == "" {
			name = key
		}
		conf := data.Prob
		if conf == 0 {
			conf = data.Confidence
		}
		preds = append(preds, StashTagTagPrediction{
			Name:       name,
			Confidence: conf * 100, // store as 0-100 to match frontend convention
		})
	}

	// Sort descending by confidence
	for i := 1; i < len(preds); i++ {
		for j := i; j > 0 && preds[j].Confidence > preds[j-1].Confidence; j-- {
			preds[j], preds[j-1] = preds[j-1], preds[j]
		}
	}

	return preds, nil
}
