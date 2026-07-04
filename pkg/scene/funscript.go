package scene

import (
	"context"
	"path/filepath"

	"github.com/stashapp/stash/pkg/file/video"
	"github.com/stashapp/stash/pkg/models"
)

// FunscriptReaderWriter is the subset of the scene store needed to auto-assign
// funscripts to a scene.
type FunscriptReaderWriter interface {
	GetSceneFunscripts(ctx context.Context, sceneID int) ([]*models.SceneFunscript, error)
	UpdateSceneFunscripts(ctx context.Context, sceneID int, funscripts []*models.SceneFunscript) error
}

// DetectAndStoreFunscripts scans videoPath's directory for .funscript files and
// unions any newly-found ones into the scene's assigned funscripts. Existing rows
// are never removed, so manually added funscripts (which may live elsewhere) are
// preserved. Returns the number of newly-added funscripts.
func DetectAndStoreFunscripts(ctx context.Context, rw FunscriptReaderWriter, sceneID int, videoPath string) (int, error) {
	detected := video.ListFunscripts(videoPath)
	if len(detected) == 0 {
		return 0, nil
	}

	existing, err := rw.GetSceneFunscripts(ctx, sceneID)
	if err != nil {
		return 0, err
	}

	have := make(map[string]struct{}, len(existing))
	for _, f := range existing {
		have[f.Path] = struct{}{}
	}

	merged := existing
	added := 0
	for _, p := range detected {
		if _, ok := have[p]; ok {
			continue
		}
		merged = append(merged, &models.SceneFunscript{
			Path:  p,
			Label: filepath.Base(p),
		})
		have[p] = struct{}{}
		added++
	}

	if added == 0 {
		return 0, nil
	}

	if err := rw.UpdateSceneFunscripts(ctx, sceneID, merged); err != nil {
		return 0, err
	}
	return added, nil
}
