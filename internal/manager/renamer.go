package manager

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/file"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/renamer"
)

type RenameResult struct {
	ID         string
	OldPath    string
	NewPath    string
	Error      string
	Skipped    bool
	SkipReason string
}

func RenameSceneFile(ctx context.Context, repo models.Repository, s *models.Scene, template string, dryRun bool, setOrganized *bool, moveFiles *bool, perPageLimit *int) (*RenameResult, error) {
	if err := s.LoadFiles(ctx, repo.Scene); err != nil {
		return nil, err
	}

	// Get Primary File object
	var primaryFile *models.VideoFile
	if len(s.Files.List()) > 0 {
		if s.PrimaryFileID != nil {
			for _, f := range s.Files.List() {
				if f.ID == *s.PrimaryFileID {
					primaryFile = f
					break
				}
			}
		}
		if primaryFile == nil {
			primaryFile = s.Files.List()[0]
		}
	}

	if primaryFile == nil {
		return &RenameResult{
			ID:    strconv.Itoa(s.ID),
			Error: "Scene has no files",
		}, nil
	}

	// Load Studio
	var studio *models.Studio
	var parentStudio *models.Studio
	if s.StudioID != nil {
		studio, _ = repo.Studio.Find(ctx, *s.StudioID)
		if studio != nil && studio.ParentID != nil {
			parentStudio, _ = repo.Studio.Find(ctx, *studio.ParentID)
		}
	}

	// Load Performers
	if err := s.LoadPerformerIDs(ctx, repo.Scene); err != nil {
		return nil, err
	}
	var performers []*models.Performer
	for _, pid := range s.PerformerIDs.List() {
		p, _ := repo.Performer.Find(ctx, pid)
		if p != nil {
			performers = append(performers, p)
		}
	}

	renamerService := renamer.NewRenamer()
	// Get performer limit from config if not provided
	var limit int
	if perPageLimit != nil {
		limit = *perPageLimit
	} else {
		limit = config.GetInstance().GetRenamerPerformerLimit()
	}

	newPath, err := renamerService.ComposePath(template, s, studio, parentStudio, performers, primaryFile, limit)
	if err != nil {
		return &RenameResult{
			ID:      strconv.Itoa(s.ID),
			OldPath: primaryFile.Path,
			Error:   err.Error(),
		}, nil
	}

	// Determine if we should move files
	shouldMove := config.GetInstance().GetRenamerMoveFiles()
	if moveFiles != nil {
		shouldMove = *moveFiles
	}

	paths := config.GetInstance().GetStashPaths()
	libraryPath := paths.GetStashFromDirPath(primaryFile.Path)

	// If renamer path is not absolute, join with libraryPath.Path
	fullNewPath := newPath
	if !filepath.IsAbs(newPath) && libraryPath != nil {
		fullNewPath = filepath.Join(libraryPath.Path, newPath)
	}

	// If we are NOT moving files, we must preserve the original directory
	if !shouldMove {
		originalDir := filepath.Dir(primaryFile.Path)
		filename := filepath.Base(fullNewPath)
		fullNewPath = filepath.Join(originalDir, filename)
	}

	// Check if the destination is exactly the same as the source
	if filepath.Clean(fullNewPath) == filepath.Clean(primaryFile.Path) {
		return &RenameResult{
			ID:         strconv.Itoa(s.ID),
			OldPath:    primaryFile.Path,
			NewPath:    fullNewPath,
			Skipped:    true,
			SkipReason: "Destination matches current path",
		}, nil
	}

	res := &RenameResult{
		ID:      strconv.Itoa(s.ID),
		OldPath: primaryFile.Path,
		NewPath: fullNewPath,
	}

	if !dryRun {
		fileStore := repo.File
		folderStore := repo.Folder
		mover := file.NewMover(fileStore, folderStore)

		// Execute Move
		dir := filepath.Dir(fullNewPath)
		base := filepath.Base(fullNewPath)

		// Ensure physical directory exists
		if err := os.MkdirAll(dir, 0755); err != nil {
			logger.Errorf("RenameScenes: Failed to create physical directory %s: %v", dir, err)
			res.Error = fmt.Sprintf("failed to create directory: %v", err)
			return res, nil
		}

		// GetOrCreate Folder
		logger.Debugf("RenameScenes: Requesting/Creating folder: %s", dir)
		folder, err := file.GetOrCreateFolderHierarchy(ctx, folderStore, dir)
		if err != nil {
			logger.Errorf("RenameScenes: GetOrCreateFolderHierarchy error for scene %d: %v", s.ID, err)
			res.Error = err.Error()
			return res, nil
		}

		if err := mover.Move(ctx, primaryFile, folder, base); err != nil {
			logger.Errorf("RenameScenes: Mover.Move error for scene %d: %v", s.ID, err)
			res.Error = err.Error()
			return res, nil
		}

		// Update Organized flag if requested
		if setOrganized != nil {
			s.Organized = *setOrganized
			if err := repo.Scene.Update(ctx, s); err != nil {
				res.Error = fmt.Sprintf("File renamed, but failed to update organized: %v", err)
			}
		}
	}

	return res, nil
}
