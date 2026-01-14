package api

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/file"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/plugin"
	"github.com/stashapp/stash/pkg/plugin/hook"
	"github.com/stashapp/stash/pkg/renamer"
	"github.com/stashapp/stash/pkg/scene"
	"github.com/stashapp/stash/pkg/sliceutil"
	"github.com/stashapp/stash/pkg/sliceutil/stringslice"
	"github.com/stashapp/stash/pkg/utils"
)

// used to refetch scene after hooks run
func (r *mutationResolver) getScene(ctx context.Context, id int) (ret *models.Scene, err error) {
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		ret, err = r.repository.Scene.Find(ctx, id)
		return err
	}); err != nil {
		return nil, err
	}

	return ret, nil
}

func (r *mutationResolver) SceneCreate(ctx context.Context, input models.SceneCreateInput) (ret *models.Scene, err error) {
	translator := changesetTranslator{
		inputMap: getUpdateInputMap(ctx),
	}

	fileIDs, err := translator.fileIDSliceFromStringSlice(input.FileIds)
	if err != nil {
		return nil, fmt.Errorf("converting file ids: %w", err)
	}

	// Populate a new scene from the input
	newScene := models.NewScene()

	newScene.Title = translator.string(input.Title)
	newScene.Code = translator.string(input.Code)
	newScene.Details = translator.string(input.Details)
	newScene.Director = translator.string(input.Director)
	newScene.Rating = input.Rating100
	newScene.Organized = translator.bool(input.Organized)
	newScene.StashIDs = models.NewRelatedStashIDs(models.StashIDInputs(input.StashIds).ToStashIDs())

	newScene.StartPoint = input.StartPoint
	newScene.EndPoint = input.EndPoint

	newScene.Date, err = translator.datePtr(input.Date)
	if err != nil {
		return nil, fmt.Errorf("converting date: %w", err)
	}
	newScene.StudioID, err = translator.intPtrFromString(input.StudioID)
	if err != nil {
		return nil, fmt.Errorf("converting studio id: %w", err)
	}

	if input.Urls != nil {
		newScene.URLs = models.NewRelatedStrings(stringslice.TrimSpace(input.Urls))
	} else if input.URL != nil {
		newScene.URLs = models.NewRelatedStrings([]string{strings.TrimSpace(*input.URL)})
	}

	newScene.PerformerIDs, err = translator.relatedIds(input.PerformerIds)
	if err != nil {
		return nil, fmt.Errorf("converting performer ids: %w", err)
	}
	newScene.TagIDs, err = translator.relatedIds(input.TagIds)
	if err != nil {
		return nil, fmt.Errorf("converting tag ids: %w", err)
	}
	newScene.GalleryIDs, err = translator.relatedIds(input.GalleryIds)
	if err != nil {
		return nil, fmt.Errorf("converting gallery ids: %w", err)
	}

	// prefer groups over movies
	if len(input.Groups) > 0 {
		newScene.Groups, err = translator.relatedGroups(input.Groups)
		if err != nil {
			return nil, fmt.Errorf("converting groups: %w", err)
		}
	} else if len(input.Movies) > 0 {
		newScene.Groups, err = translator.relatedGroupsFromMovies(input.Movies)
		if err != nil {
			return nil, fmt.Errorf("converting movies: %w", err)
		}
	}

	var coverImageData []byte
	if input.CoverImage != nil {
		var err error
		coverImageData, err = utils.ProcessImageInput(ctx, *input.CoverImage)
		if err != nil {
			return nil, fmt.Errorf("processing cover image: %w", err)
		}
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		ret, err = r.Resolver.sceneService.Create(ctx, &newScene, fileIDs, coverImageData)
		return err
	}); err != nil {
		return nil, err
	}

	return ret, nil
}

func (r *mutationResolver) SceneUpdate(ctx context.Context, input models.SceneUpdateInput) (ret *models.Scene, err error) {
	translator := changesetTranslator{
		inputMap: getUpdateInputMap(ctx),
	}

	// Start the transaction and save the scene
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		ret, err = r.sceneUpdate(ctx, input, translator)
		return err
	}); err != nil {
		return nil, err
	}

	r.hookExecutor.ExecutePostHooks(ctx, ret.ID, hook.SceneUpdatePost, input, translator.getFields())

	// Auto-Rename if enabled
	cfg := manager.GetInstance().Config
	if cfg.GetRenamerEnabled() {
		template := cfg.GetRenamerTemplate()
		if template != "" {
			if err := r.withTxn(ctx, func(ctx context.Context) error {
				setOrganized := input.Organized
				// renameSceneFile(ctx, s, template, dryRun bool, setOrganized *bool, moveFiles *bool)
				_, err := r.renameSceneFile(ctx, ret, template, false, setOrganized, nil)
				if err != nil {
					logger.Errorf("Auto-rename failed for scene %d: %v", ret.ID, err)
				}
				return nil
			}); err != nil {
				logger.Errorf("Auto-rename txn failed for scene %d: %v", ret.ID, err)
			}
		}
	}

	return r.getScene(ctx, ret.ID)
}

func (r *mutationResolver) ScenesUpdate(ctx context.Context, input []*models.SceneUpdateInput) (ret []*models.Scene, err error) {
	inputMaps := getUpdateInputMaps(ctx)

	// Start the transaction and save the scenes
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		for i, scene := range input {
			translator := changesetTranslator{
				inputMap: inputMaps[i],
			}

			thisScene, err := r.sceneUpdate(ctx, *scene, translator)
			if err != nil {
				return err
			}

			ret = append(ret, thisScene)
		}

		return nil
	}); err != nil {
		return nil, err
	}

	// execute post hooks outside of txn
	var newRet []*models.Scene
	for i, scene := range ret {
		translator := changesetTranslator{
			inputMap: inputMaps[i],
		}

		r.hookExecutor.ExecutePostHooks(ctx, scene.ID, hook.SceneUpdatePost, input, translator.getFields())

		scene, err = r.getScene(ctx, scene.ID)
		if err != nil {
			return nil, err
		}

		// Auto-Rename if enabled
		cfg := manager.GetInstance().Config
		if cfg.GetRenamerEnabled() {
			template := cfg.GetRenamerTemplate()
			if template != "" {
				// We ignore errors here to prevent failing the update if rename fails
				// But we should log?
				// renameSceneFile uses repository which uses ctx/txn?
				// getScene uses r.withTxn internally if we call it?
				// No, getScene (line 26) calls r.withTxn.
				// RenameScenes calls r.withTxn.
				// We are currently OUTSIDE the main SceneUpdate txn (line 161).
				// So we can call renameSceneFile, but we should wrap it in txn?
				// renameSceneFile doesn't start a txn.
				// The passed ctx might NOT have a txn attached here?
				// Line 157 closes the txn.
				// So we should wrap this in txn.
				if err := r.withTxn(ctx, func(ctx context.Context) error {
					setOrganized := input[i].Organized
					_, err := r.renameSceneFile(ctx, scene, template, false, setOrganized, nil)
					if err != nil {
						logger.Errorf("Auto-rename failed for scene %d: %v", scene.ID, err)
					}
					return nil // Don't fail the request
				}); err != nil {
					logger.Errorf("Auto-rename txn failed for scene %d: %v", scene.ID, err)
				}

				// Re-fetch scene after rename?
				// If renamed, path changed. Ret array has old scene object.
				// We should return fresh object.
				scene, err = r.getScene(ctx, scene.ID)
				if err != nil {
					return nil, err
				}
			}
		}

		newRet = append(newRet, scene)
	}

	return newRet, nil
}

func scenePartialFromInput(input models.SceneUpdateInput, translator changesetTranslator) (*models.ScenePartial, error) {
	updatedScene := models.NewScenePartial()

	updatedScene.Title = translator.optionalString(input.Title, "title")
	updatedScene.Code = translator.optionalString(input.Code, "code")
	updatedScene.Details = translator.optionalString(input.Details, "details")
	updatedScene.Director = translator.optionalString(input.Director, "director")
	updatedScene.Rating = translator.optionalInt(input.Rating100, "rating100")

	if input.OCounter != nil {
		logger.Warnf("o_counter is deprecated and no longer supported, use sceneIncrementO/sceneDecrementO instead")
	}

	if input.PlayCount != nil {
		logger.Warnf("play_count is deprecated and no longer supported, use sceneIncrementPlayCount/sceneDecrementPlayCount instead")
	}

	updatedScene.PlayDuration = translator.optionalFloat64(input.PlayDuration, "play_duration")
	updatedScene.StartPoint = translator.optionalFloat64(input.StartPoint, "start_point")
	updatedScene.EndPoint = translator.optionalFloat64(input.EndPoint, "end_point")
	updatedScene.Organized = translator.optionalBool(input.Organized, "organized")
	updatedScene.StashIDs = translator.updateStashIDs(input.StashIds, "stash_ids")

	var err error

	updatedScene.Date, err = translator.optionalDate(input.Date, "date")
	if err != nil {
		return nil, fmt.Errorf("converting date: %w", err)
	}
	updatedScene.StudioID, err = translator.optionalIntFromString(input.StudioID, "studio_id")
	if err != nil {
		return nil, fmt.Errorf("converting studio id: %w", err)
	}

	updatedScene.URLs = translator.optionalURLs(input.Urls, input.URL)

	updatedScene.PrimaryFileID, err = translator.fileIDPtrFromString(input.PrimaryFileID)
	if err != nil {
		return nil, fmt.Errorf("converting primary file id: %w", err)
	}

	updatedScene.PerformerIDs, err = translator.updateIds(input.PerformerIds, "performer_ids")
	if err != nil {
		return nil, fmt.Errorf("converting performer ids: %w", err)
	}
	updatedScene.TagIDs, err = translator.updateIds(input.TagIds, "tag_ids")
	if err != nil {
		return nil, fmt.Errorf("converting tag ids: %w", err)
	}
	updatedScene.GalleryIDs, err = translator.updateIds(input.GalleryIds, "gallery_ids")
	if err != nil {
		return nil, fmt.Errorf("converting gallery ids: %w", err)
	}

	if translator.hasField("groups") {
		updatedScene.GroupIDs, err = translator.updateGroupIDs(input.Groups, "groups")
		if err != nil {
			return nil, fmt.Errorf("converting groups: %w", err)
		}
	} else if translator.hasField("movies") {
		updatedScene.GroupIDs, err = translator.updateGroupIDsFromMovies(input.Movies, "movies")
		if err != nil {
			return nil, fmt.Errorf("converting movies: %w", err)
		}
	}

	return &updatedScene, nil
}

func (r *mutationResolver) sceneUpdate(ctx context.Context, input models.SceneUpdateInput, translator changesetTranslator) (*models.Scene, error) {
	sceneID, err := strconv.Atoi(input.ID)
	if err != nil {
		return nil, fmt.Errorf("converting id: %w", err)
	}

	qb := r.repository.Scene

	originalScene, err := qb.Find(ctx, sceneID)
	if err != nil {
		return nil, err
	}

	if originalScene == nil {
		return nil, fmt.Errorf("scene with id %d not found", sceneID)
	}

	// Populate scene from the input
	updatedScene, err := scenePartialFromInput(input, translator)
	if err != nil {
		return nil, err
	}

	// ensure that title is set where scene has no file
	if updatedScene.Title.Set && updatedScene.Title.Value == "" {
		if err := originalScene.LoadFiles(ctx, r.repository.Scene); err != nil {
			return nil, err
		}

		if len(originalScene.Files.List()) == 0 {
			return nil, errors.New("title must be set if scene has no files")
		}
	}

	if updatedScene.PrimaryFileID != nil {
		newPrimaryFileID := *updatedScene.PrimaryFileID

		// if file hash has changed, we should migrate generated files
		// after commit
		if err := originalScene.LoadFiles(ctx, r.repository.Scene); err != nil {
			return nil, err
		}

		// ensure that new primary file is associated with scene
		var f *models.VideoFile
		for _, ff := range originalScene.Files.List() {
			if ff.ID == newPrimaryFileID {
				f = ff
			}
		}

		if f == nil {
			return nil, fmt.Errorf("file with id %d not associated with scene", newPrimaryFileID)
		}
	}

	var coverImageData []byte
	if input.CoverImage != nil {
		var err error
		coverImageData, err = utils.ProcessImageInput(ctx, *input.CoverImage)
		if err != nil {
			return nil, fmt.Errorf("processing cover image: %w", err)
		}
	}

	scene, err := qb.UpdatePartial(ctx, sceneID, *updatedScene)
	if err != nil {
		return nil, err
	}

	if err := r.sceneUpdateCoverImage(ctx, scene, coverImageData); err != nil {
		return nil, err
	}

	return scene, nil
}

func (r *mutationResolver) sceneUpdateCoverImage(ctx context.Context, s *models.Scene, coverImageData []byte) error {
	if len(coverImageData) > 0 {
		qb := r.repository.Scene

		// update cover table
		if err := qb.UpdateCover(ctx, s.ID, coverImageData); err != nil {
			return err
		}
	}

	return nil
}

func (r *mutationResolver) BulkSceneUpdate(ctx context.Context, input BulkSceneUpdateInput) ([]*models.Scene, error) {
	sceneIDs, err := stringslice.StringSliceToIntSlice(input.Ids)
	if err != nil {
		return nil, fmt.Errorf("converting ids: %w", err)
	}

	translator := changesetTranslator{
		inputMap: getUpdateInputMap(ctx),
	}

	// Populate scene from the input
	updatedScene := models.NewScenePartial()

	updatedScene.Title = translator.optionalString(input.Title, "title")
	updatedScene.Code = translator.optionalString(input.Code, "code")
	updatedScene.Details = translator.optionalString(input.Details, "details")
	updatedScene.Director = translator.optionalString(input.Director, "director")
	updatedScene.Rating = translator.optionalInt(input.Rating100, "rating100")
	updatedScene.Organized = translator.optionalBool(input.Organized, "organized")

	updatedScene.Date, err = translator.optionalDate(input.Date, "date")
	if err != nil {
		return nil, fmt.Errorf("converting date: %w", err)
	}
	updatedScene.StudioID, err = translator.optionalIntFromString(input.StudioID, "studio_id")
	if err != nil {
		return nil, fmt.Errorf("converting studio id: %w", err)
	}

	updatedScene.URLs = translator.optionalURLsBulk(input.Urls, input.URL)

	updatedScene.PerformerIDs, err = translator.updateIdsBulk(input.PerformerIds, "performer_ids")
	if err != nil {
		return nil, fmt.Errorf("converting performer ids: %w", err)
	}
	updatedScene.TagIDs, err = translator.updateIdsBulk(input.TagIds, "tag_ids")
	if err != nil {
		return nil, fmt.Errorf("converting tag ids: %w", err)
	}
	updatedScene.GalleryIDs, err = translator.updateIdsBulk(input.GalleryIds, "gallery_ids")
	if err != nil {
		return nil, fmt.Errorf("converting gallery ids: %w", err)
	}

	if translator.hasField("group_ids") {
		updatedScene.GroupIDs, err = translator.updateGroupIDsBulk(input.GroupIds, "group_ids")
		if err != nil {
			return nil, fmt.Errorf("converting group ids: %w", err)
		}
	} else if translator.hasField("movie_ids") {
		updatedScene.GroupIDs, err = translator.updateGroupIDsBulk(input.MovieIds, "movie_ids")
		if err != nil {
			return nil, fmt.Errorf("converting movie ids: %w", err)
		}
	}

	ret := []*models.Scene{}

	// Start the transaction and save the scenes
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.Scene

		for _, sceneID := range sceneIDs {
			scene, err := qb.UpdatePartial(ctx, sceneID, updatedScene)
			if err != nil {
				return err
			}

			ret = append(ret, scene)
		}

		return nil
	}); err != nil {
		return nil, err
	}

	// execute post hooks outside of txn
	var newRet []*models.Scene
	for _, scene := range ret {
		r.hookExecutor.ExecutePostHooks(ctx, scene.ID, hook.SceneUpdatePost, input, translator.getFields())

		scene, err = r.getScene(ctx, scene.ID)
		if err != nil {
			return nil, err
		}

		newRet = append(newRet, scene)
	}

	return newRet, nil
}

func (r *mutationResolver) SceneDestroy(ctx context.Context, input models.SceneDestroyInput) (bool, error) {
	sceneID, err := strconv.Atoi(input.ID)
	if err != nil {
		return false, fmt.Errorf("converting id: %w", err)
	}

	fileNamingAlgo := manager.GetInstance().Config.GetVideoFileNamingAlgorithm()
	trashPath := manager.GetInstance().Config.GetDeleteTrashPath()

	var s *models.Scene
	fileDeleter := &scene.FileDeleter{
		Deleter:        file.NewDeleterWithTrash(trashPath),
		FileNamingAlgo: fileNamingAlgo,
		Paths:          manager.GetInstance().Paths,
	}

	deleteGenerated := utils.IsTrue(input.DeleteGenerated)
	deleteFile := utils.IsTrue(input.DeleteFile)

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.Scene
		var err error
		s, err = qb.Find(ctx, sceneID)
		if err != nil {
			return err
		}

		if s == nil {
			return fmt.Errorf("scene with id %d not found", sceneID)
		}

		// kill any running encoders
		manager.KillRunningStreams(s, fileNamingAlgo)

		return r.sceneService.Destroy(ctx, s, fileDeleter, deleteGenerated, deleteFile)
	}); err != nil {
		fileDeleter.Rollback()
		return false, err
	}

	// perform the post-commit actions
	fileDeleter.Commit()

	// call post hook after performing the other actions
	r.hookExecutor.ExecutePostHooks(ctx, s.ID, hook.SceneDestroyPost, plugin.SceneDestroyInput{
		SceneDestroyInput: input,
		Checksum:          s.Checksum,
		OSHash:            s.OSHash,
		Path:              s.Path,
	}, nil)

	return true, nil
}

func (r *mutationResolver) ScenesDestroy(ctx context.Context, input models.ScenesDestroyInput) (bool, error) {
	sceneIDs, err := stringslice.StringSliceToIntSlice(input.Ids)
	if err != nil {
		return false, fmt.Errorf("converting ids: %w", err)
	}

	var scenes []*models.Scene
	fileNamingAlgo := manager.GetInstance().Config.GetVideoFileNamingAlgorithm()
	trashPath := manager.GetInstance().Config.GetDeleteTrashPath()

	fileDeleter := &scene.FileDeleter{
		Deleter:        file.NewDeleterWithTrash(trashPath),
		FileNamingAlgo: fileNamingAlgo,
		Paths:          manager.GetInstance().Paths,
	}

	deleteGenerated := utils.IsTrue(input.DeleteGenerated)
	deleteFile := utils.IsTrue(input.DeleteFile)

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.Scene

		for _, id := range sceneIDs {
			scene, err := qb.Find(ctx, id)
			if err != nil {
				return err
			}
			if scene == nil {
				return fmt.Errorf("scene with id %d not found", id)
			}

			scenes = append(scenes, scene)

			// kill any running encoders
			manager.KillRunningStreams(scene, fileNamingAlgo)

			if err := r.sceneService.Destroy(ctx, scene, fileDeleter, deleteGenerated, deleteFile); err != nil {
				return err
			}
		}

		return nil
	}); err != nil {
		fileDeleter.Rollback()
		return false, err
	}

	// perform the post-commit actions
	fileDeleter.Commit()

	for _, scene := range scenes {
		// call post hook after performing the other actions
		r.hookExecutor.ExecutePostHooks(ctx, scene.ID, hook.SceneDestroyPost, plugin.ScenesDestroyInput{
			ScenesDestroyInput: input,
			Checksum:           scene.Checksum,
			OSHash:             scene.OSHash,
			Path:               scene.Path,
		}, nil)
	}

	return true, nil
}

func (r *mutationResolver) SceneAssignFile(ctx context.Context, input AssignSceneFileInput) (bool, error) {
	sceneID, err := strconv.Atoi(input.SceneID)
	if err != nil {
		return false, fmt.Errorf("converting scene id: %w", err)
	}

	fileID, err := strconv.Atoi(input.FileID)
	if err != nil {
		return false, fmt.Errorf("converting file id: %w", err)
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		return r.Resolver.sceneService.AssignFile(ctx, sceneID, models.FileID(fileID))
	}); err != nil {
		return false, fmt.Errorf("assigning file to scene: %w", err)
	}

	return true, nil
}

func (r *mutationResolver) SceneMerge(ctx context.Context, input SceneMergeInput) (*models.Scene, error) {
	srcIDs, err := stringslice.StringSliceToIntSlice(input.Source)
	if err != nil {
		return nil, fmt.Errorf("converting source ids: %w", err)
	}

	destID, err := strconv.Atoi(input.Destination)
	if err != nil {
		return nil, fmt.Errorf("converting destination id: %w", err)
	}

	var values *models.ScenePartial
	var coverImageData []byte

	if input.Values != nil {
		translator := changesetTranslator{
			inputMap: getNamedUpdateInputMap(ctx, "input.values"),
		}

		values, err = scenePartialFromInput(*input.Values, translator)
		if err != nil {
			return nil, err
		}

		if input.Values.CoverImage != nil {
			var err error
			coverImageData, err = utils.ProcessImageInput(ctx, *input.Values.CoverImage)
			if err != nil {
				return nil, fmt.Errorf("processing cover image: %w", err)
			}
		}
	} else {
		v := models.NewScenePartial()
		values = &v
	}

	mgr := manager.GetInstance()
	trashPath := mgr.Config.GetDeleteTrashPath()
	fileDeleter := &scene.FileDeleter{
		Deleter:        file.NewDeleterWithTrash(trashPath),
		FileNamingAlgo: mgr.Config.GetVideoFileNamingAlgorithm(),
		Paths:          mgr.Paths,
	}

	var ret *models.Scene
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		if err := r.Resolver.sceneService.Merge(ctx, srcIDs, destID, fileDeleter, scene.MergeOptions{
			ScenePartial:       *values,
			IncludePlayHistory: utils.IsTrue(input.PlayHistory),
			IncludeOHistory:    utils.IsTrue(input.OHistory),
		}); err != nil {
			return err
		}

		ret, err = r.Resolver.repository.Scene.Find(ctx, destID)
		if err != nil {
			return err
		}
		if ret == nil {
			return fmt.Errorf("scene with id %d not found", destID)
		}

		return r.sceneUpdateCoverImage(ctx, ret, coverImageData)
	}); err != nil {
		return nil, err
	}

	return ret, nil
}

func (r *mutationResolver) getSceneMarker(ctx context.Context, id int) (ret *models.SceneMarker, err error) {
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		ret, err = r.repository.SceneMarker.Find(ctx, id)
		return err
	}); err != nil {
		return nil, err
	}

	return ret, nil
}

func (r *mutationResolver) SceneMarkerCreate(ctx context.Context, input SceneMarkerCreateInput) (*models.SceneMarker, error) {
	sceneID, err := strconv.Atoi(input.SceneID)
	if err != nil {
		return nil, fmt.Errorf("converting scene id: %w", err)
	}

	primaryTagID, err := strconv.Atoi(input.PrimaryTagID)
	if err != nil {
		return nil, fmt.Errorf("converting primary tag id: %w", err)
	}

	// Populate a new scene marker from the input
	newMarker := models.NewSceneMarker()

	newMarker.Title = strings.TrimSpace(input.Title)
	newMarker.Seconds = input.Seconds
	newMarker.PrimaryTagID = primaryTagID
	newMarker.SceneID = sceneID

	if input.EndSeconds != nil {
		if err := validateSceneMarkerEndSeconds(newMarker.Seconds, *input.EndSeconds); err != nil {
			return nil, err
		}
		newMarker.EndSeconds = input.EndSeconds
	}

	tagIDs, err := stringslice.StringSliceToIntSlice(input.TagIds)
	if err != nil {
		return nil, fmt.Errorf("converting tag ids: %w", err)
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.SceneMarker

		err := qb.Create(ctx, &newMarker)
		if err != nil {
			return err
		}

		// Save the marker tags
		// If this tag is the primary tag, then let's not add it.
		tagIDs = sliceutil.Exclude(tagIDs, []int{newMarker.PrimaryTagID})
		return qb.UpdateTags(ctx, newMarker.ID, tagIDs)
	}); err != nil {
		return nil, err
	}

	r.hookExecutor.ExecutePostHooks(ctx, newMarker.ID, hook.SceneMarkerCreatePost, input, nil)
	return r.getSceneMarker(ctx, newMarker.ID)
}

func validateSceneMarkerEndSeconds(seconds, endSeconds float64) error {
	if endSeconds < seconds {
		return fmt.Errorf("end_seconds (%f) must be greater than or equal to seconds (%f)", endSeconds, seconds)
	}
	return nil
}

func float64OrZero(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}

func (r *mutationResolver) SceneMarkerUpdate(ctx context.Context, input SceneMarkerUpdateInput) (*models.SceneMarker, error) {
	markerID, err := strconv.Atoi(input.ID)
	if err != nil {
		return nil, fmt.Errorf("converting id: %w", err)
	}

	translator := changesetTranslator{
		inputMap: getUpdateInputMap(ctx),
	}

	// Populate scene marker from the input
	updatedMarker := models.NewSceneMarkerPartial()

	updatedMarker.Title = translator.optionalString(input.Title, "title")
	updatedMarker.Seconds = translator.optionalFloat64(input.Seconds, "seconds")
	updatedMarker.EndSeconds = translator.optionalFloat64(input.EndSeconds, "end_seconds")
	updatedMarker.SceneID, err = translator.optionalIntFromString(input.SceneID, "scene_id")
	if err != nil {
		return nil, fmt.Errorf("converting scene id: %w", err)
	}
	updatedMarker.PrimaryTagID, err = translator.optionalIntFromString(input.PrimaryTagID, "primary_tag_id")
	if err != nil {
		return nil, fmt.Errorf("converting primary tag id: %w", err)
	}

	var tagIDs []int
	tagIdsIncluded := translator.hasField("tag_ids")
	if input.TagIds != nil {
		tagIDs, err = stringslice.StringSliceToIntSlice(input.TagIds)
		if err != nil {
			return nil, fmt.Errorf("converting tag ids: %w", err)
		}
	}

	mgr := manager.GetInstance()
	trashPath := mgr.Config.GetDeleteTrashPath()

	fileDeleter := &scene.FileDeleter{
		Deleter:        file.NewDeleterWithTrash(trashPath),
		FileNamingAlgo: mgr.Config.GetVideoFileNamingAlgorithm(),
		Paths:          mgr.Paths,
	}

	// Start the transaction and save the scene marker
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.SceneMarker
		sqb := r.repository.Scene

		// check to see if timestamp was changed
		existingMarker, err := qb.Find(ctx, markerID)
		if err != nil {
			return err
		}
		if existingMarker == nil {
			return fmt.Errorf("scene marker with id %d not found", markerID)
		}

		// Validate end_seconds
		shouldValidateEndSeconds := (updatedMarker.Seconds.Set || updatedMarker.EndSeconds.Set) && !updatedMarker.EndSeconds.Null
		if shouldValidateEndSeconds {
			seconds := existingMarker.Seconds
			if updatedMarker.Seconds.Set {
				seconds = updatedMarker.Seconds.Value
			}

			endSeconds := existingMarker.EndSeconds
			if updatedMarker.EndSeconds.Set {
				endSeconds = &updatedMarker.EndSeconds.Value
			}

			if endSeconds != nil {
				if err := validateSceneMarkerEndSeconds(seconds, *endSeconds); err != nil {
					return err
				}
			}
		}

		newMarker, err := qb.UpdatePartial(ctx, markerID, updatedMarker)
		if err != nil {
			return err
		}

		existingScene, err := sqb.Find(ctx, existingMarker.SceneID)
		if err != nil {
			return err
		}
		if existingScene == nil {
			return fmt.Errorf("scene with id %d not found", existingMarker.SceneID)
		}

		// remove the marker preview if the scene changed or if the timestamp was changed
		if existingMarker.SceneID != newMarker.SceneID || existingMarker.Seconds != newMarker.Seconds || float64OrZero(existingMarker.EndSeconds) != float64OrZero(newMarker.EndSeconds) {
			seconds := int(existingMarker.Seconds)
			if err := fileDeleter.MarkMarkerFiles(existingScene, seconds); err != nil {
				return err
			}
		}

		if tagIdsIncluded {
			// Save the marker tags
			// If this tag is the primary tag, then let's not add it.
			tagIDs = sliceutil.Exclude(tagIDs, []int{newMarker.PrimaryTagID})
			if err := qb.UpdateTags(ctx, markerID, tagIDs); err != nil {
				return err
			}
		}

		return nil
	}); err != nil {
		fileDeleter.Rollback()
		return nil, err
	}

	// perform the post-commit actions
	fileDeleter.Commit()

	r.hookExecutor.ExecutePostHooks(ctx, markerID, hook.SceneMarkerUpdatePost, input, translator.getFields())
	return r.getSceneMarker(ctx, markerID)
}

func (r *mutationResolver) BulkSceneMarkerUpdate(ctx context.Context, input BulkSceneMarkerUpdateInput) ([]*models.SceneMarker, error) {
	ids, err := stringslice.StringSliceToIntSlice(input.Ids)
	if err != nil {
		return nil, fmt.Errorf("converting ids: %w", err)
	}

	translator := changesetTranslator{
		inputMap: getUpdateInputMap(ctx),
	}

	// Populate performer from the input
	partial := models.NewSceneMarkerPartial()

	partial.Title = translator.optionalString(input.Title, "title")

	partial.PrimaryTagID, err = translator.optionalIntFromString(input.PrimaryTagID, "primary_tag_id")
	if err != nil {
		return nil, fmt.Errorf("converting primary tag id: %w", err)
	}

	partial.TagIDs, err = translator.updateIdsBulk(input.TagIds, "tag_ids")
	if err != nil {
		return nil, fmt.Errorf("converting tag ids: %w", err)
	}

	ret := []*models.SceneMarker{}

	// Start the transaction and save the performers
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.SceneMarker

		for _, id := range ids {
			l := partial

			if err := adjustMarkerPartialForTagExclusion(ctx, r.repository.SceneMarker, id, &l); err != nil {
				return err
			}

			updated, err := qb.UpdatePartial(ctx, id, l)
			if err != nil {
				return err
			}

			ret = append(ret, updated)
		}

		return nil
	}); err != nil {
		return nil, err
	}

	// execute post hooks outside of txn
	var newRet []*models.SceneMarker
	for _, m := range ret {
		r.hookExecutor.ExecutePostHooks(ctx, m.ID, hook.SceneMarkerUpdatePost, input, translator.getFields())

		m, err = r.getSceneMarker(ctx, m.ID)
		if err != nil {
			return nil, err
		}

		newRet = append(newRet, m)
	}

	return newRet, nil
}

// adjustMarkerPartialForTagExclusion adjusts the SceneMarkerPartial to exclude the primary tag from tag updates.
func adjustMarkerPartialForTagExclusion(ctx context.Context, r models.SceneMarkerReader, id int, partial *models.SceneMarkerPartial) error {
	if partial.TagIDs == nil && !partial.PrimaryTagID.Set {
		return nil
	}

	// exclude primary tag from tag updates
	var primaryTagID int
	if partial.PrimaryTagID.Set {
		primaryTagID = partial.PrimaryTagID.Value
	} else {
		existing, err := r.Find(ctx, id)
		if err != nil {
			return fmt.Errorf("finding existing primary tag id: %w", err)
		}

		primaryTagID = existing.PrimaryTagID
	}

	existingTagIDs, err := r.GetTagIDs(ctx, id)
	if err != nil {
		return fmt.Errorf("getting existing tag ids: %w", err)
	}

	tagIDAttr := partial.TagIDs

	if tagIDAttr == nil {
		tagIDAttr = &models.UpdateIDs{
			IDs:  existingTagIDs,
			Mode: models.RelationshipUpdateModeSet,
		}
	}

	newTagIDs := tagIDAttr.Apply(existingTagIDs)
	// Remove primary tag from newTagIDs if present
	newTagIDs = sliceutil.Exclude(newTagIDs, []int{primaryTagID})

	if len(existingTagIDs) != len(newTagIDs) {
		partial.TagIDs = &models.UpdateIDs{
			IDs:  newTagIDs,
			Mode: models.RelationshipUpdateModeSet,
		}
	} else {
		// no change to tags required
		partial.TagIDs = nil
	}

	return nil
}

func (r *mutationResolver) SceneMarkerDestroy(ctx context.Context, id string) (bool, error) {
	return r.SceneMarkersDestroy(ctx, []string{id})
}

func (r *mutationResolver) SceneMarkersDestroy(ctx context.Context, markerIDs []string) (bool, error) {
	ids, err := stringslice.StringSliceToIntSlice(markerIDs)
	if err != nil {
		return false, fmt.Errorf("converting ids: %w", err)
	}

	var markers []*models.SceneMarker
	fileNamingAlgo := manager.GetInstance().Config.GetVideoFileNamingAlgorithm()
	trashPath := manager.GetInstance().Config.GetDeleteTrashPath()

	fileDeleter := &scene.FileDeleter{
		Deleter:        file.NewDeleterWithTrash(trashPath),
		FileNamingAlgo: fileNamingAlgo,
		Paths:          manager.GetInstance().Paths,
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.SceneMarker
		sqb := r.repository.Scene

		for _, markerID := range ids {
			marker, err := qb.Find(ctx, markerID)

			if err != nil {
				return err
			}

			if marker == nil {
				return fmt.Errorf("scene marker with id %d not found", markerID)
			}

			s, err := sqb.Find(ctx, marker.SceneID)

			if err != nil {
				return err
			}

			if s == nil {
				return fmt.Errorf("scene with id %d not found", marker.SceneID)
			}

			markers = append(markers, marker)

			if err := scene.DestroyMarker(ctx, s, marker, qb, fileDeleter); err != nil {
				return err
			}
		}

		return nil
	}); err != nil {
		fileDeleter.Rollback()
		return false, err
	}

	fileDeleter.Commit()

	for _, marker := range markers {
		r.hookExecutor.ExecutePostHooks(ctx, marker.ID, hook.SceneMarkerDestroyPost, markerIDs, nil)
	}

	return true, nil
}

func (r *mutationResolver) SceneSaveActivity(ctx context.Context, id string, resumeTime *float64, playDuration *float64) (ret bool, err error) {
	sceneID, err := strconv.Atoi(id)
	if err != nil {
		return false, fmt.Errorf("converting id: %w", err)
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.Scene

		ret, err = qb.SaveActivity(ctx, sceneID, resumeTime, playDuration)
		return err
	}); err != nil {
		return false, err
	}

	return ret, nil
}

func (r *mutationResolver) SceneResetActivity(ctx context.Context, id string, resetResume *bool, resetDuration *bool) (ret bool, err error) {
	sceneID, err := strconv.Atoi(id)
	if err != nil {
		return false, fmt.Errorf("converting id: %w", err)
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.Scene

		ret, err = qb.ResetActivity(ctx, sceneID, utils.IsTrue(resetResume), utils.IsTrue(resetDuration))
		return err
	}); err != nil {
		return false, err
	}

	return ret, nil
}

// deprecated
func (r *mutationResolver) SceneIncrementPlayCount(ctx context.Context, id string) (ret int, err error) {
	sceneID, err := strconv.Atoi(id)
	if err != nil {
		return 0, fmt.Errorf("converting id: %w", err)
	}

	var updatedTimes []time.Time

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.Scene

		updatedTimes, err = qb.AddViews(ctx, sceneID, nil)
		return err
	}); err != nil {
		return 0, err
	}

	return len(updatedTimes), nil
}

func (r *mutationResolver) SceneAddPlay(ctx context.Context, id string, t []*time.Time) (*HistoryMutationResult, error) {
	sceneID, err := strconv.Atoi(id)
	if err != nil {
		return nil, fmt.Errorf("converting id: %w", err)
	}

	var times []time.Time

	// convert time to local time, so that sorting is consistent
	for _, tt := range t {
		times = append(times, tt.Local())
	}

	var updatedTimes []time.Time

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.Scene

		updatedTimes, err = qb.AddViews(ctx, sceneID, times)
		return err
	}); err != nil {
		return nil, err
	}

	return &HistoryMutationResult{
		Count:   len(updatedTimes),
		History: sliceutil.ValuesToPtrs(updatedTimes),
	}, nil
}

func (r *mutationResolver) SceneDeletePlay(ctx context.Context, id string, t []*time.Time) (*HistoryMutationResult, error) {
	sceneID, err := strconv.Atoi(id)
	if err != nil {
		return nil, err
	}

	var times []time.Time

	for _, tt := range t {
		times = append(times, *tt)
	}

	var updatedTimes []time.Time

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.Scene

		updatedTimes, err = qb.DeleteViews(ctx, sceneID, times)
		return err
	}); err != nil {
		return nil, err
	}

	return &HistoryMutationResult{
		Count:   len(updatedTimes),
		History: sliceutil.ValuesToPtrs(updatedTimes),
	}, nil
}

func (r *mutationResolver) SceneResetPlayCount(ctx context.Context, id string) (ret int, err error) {
	sceneID, err := strconv.Atoi(id)
	if err != nil {
		return 0, err
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.Scene

		ret, err = qb.DeleteAllViews(ctx, sceneID)
		return err
	}); err != nil {
		return 0, err
	}

	return ret, nil
}

// deprecated
func (r *mutationResolver) SceneIncrementO(ctx context.Context, id string) (ret int, err error) {
	sceneID, err := strconv.Atoi(id)
	if err != nil {
		return 0, fmt.Errorf("converting id: %w", err)
	}

	var updatedTimes []time.Time

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.Scene

		updatedTimes, err = qb.AddO(ctx, sceneID, nil)
		return err
	}); err != nil {
		return 0, err
	}

	return len(updatedTimes), nil
}

// deprecated
func (r *mutationResolver) SceneDecrementO(ctx context.Context, id string) (ret int, err error) {
	sceneID, err := strconv.Atoi(id)
	if err != nil {
		return 0, fmt.Errorf("converting id: %w", err)
	}

	var updatedTimes []time.Time

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.Scene

		updatedTimes, err = qb.DeleteO(ctx, sceneID, nil)
		return err
	}); err != nil {
		return 0, err
	}

	return len(updatedTimes), nil
}

func (r *mutationResolver) SceneResetO(ctx context.Context, id string) (ret int, err error) {
	sceneID, err := strconv.Atoi(id)
	if err != nil {
		return 0, fmt.Errorf("converting id: %w", err)
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.Scene

		ret, err = qb.ResetO(ctx, sceneID)
		return err
	}); err != nil {
		return 0, err
	}

	return ret, nil
}

func (r *mutationResolver) SceneAddO(ctx context.Context, id string, t []*time.Time) (*HistoryMutationResult, error) {
	sceneID, err := strconv.Atoi(id)
	if err != nil {
		return nil, fmt.Errorf("converting id: %w", err)
	}

	var times []time.Time

	// convert time to local time, so that sorting is consistent
	for _, tt := range t {
		times = append(times, tt.Local())
	}

	var updatedTimes []time.Time

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.Scene

		updatedTimes, err = qb.AddO(ctx, sceneID, times)
		return err
	}); err != nil {
		return nil, err
	}

	return &HistoryMutationResult{
		Count:   len(updatedTimes),
		History: sliceutil.ValuesToPtrs(updatedTimes),
	}, nil
}

func (r *mutationResolver) SceneDeleteO(ctx context.Context, id string, t []*time.Time) (*HistoryMutationResult, error) {
	sceneID, err := strconv.Atoi(id)
	if err != nil {
		return nil, fmt.Errorf("converting id: %w", err)
	}

	var times []time.Time

	for _, tt := range t {
		times = append(times, *tt)
	}

	var updatedTimes []time.Time

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.Scene

		updatedTimes, err = qb.DeleteO(ctx, sceneID, times)
		return err
	}); err != nil {
		return nil, err
	}

	return &HistoryMutationResult{
		Count:   len(updatedTimes),
		History: sliceutil.ValuesToPtrs(updatedTimes),
	}, nil
}

func (r *mutationResolver) SceneGenerateScreenshot(ctx context.Context, id string, at *float64) (string, error) {
	if at != nil {
		manager.GetInstance().GenerateScreenshot(ctx, id, *at)
	} else {
		manager.GetInstance().GenerateDefaultScreenshot(ctx, id)
	}

	return "todo", nil
}

func (r *mutationResolver) RenameScenes(ctx context.Context, input RenameFilesInput) ([]*RenameResult, error) {
	sceneIDInts, err := stringslice.StringSliceToIntSlice(input.Ids)
	if err != nil {
		return nil, fmt.Errorf("converting ids: %w", err)
	}

	dryRun := utils.IsTrue(input.DryRun)
	results := make([]*RenameResult, 0, len(sceneIDInts))

	// Use withTxn for consistency
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		for _, id := range sceneIDInts {
			s, err := r.repository.Scene.Find(ctx, id)
			if err != nil {
				return err
			}
			if s == nil {
				return fmt.Errorf("scene not found: %d", id)
			}

			res, err := r.renameSceneFile(ctx, s, input.Template, dryRun, input.SetOrganized, input.MoveFiles)
			if err != nil {
				// if error returned, it might be fatal, but we want to return result with error
				// renameSceneFile should probably return result with error populated if it's a "soft" error
				// But let's handle hard errors too
				msg := err.Error()
				results = append(results, &RenameResult{
					ID:    strconv.Itoa(id),
					Error: &msg,
				})
			} else {
				results = append(results, res)
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}

	return results, nil
}

func (r *mutationResolver) renameSceneFile(ctx context.Context, s *models.Scene, template string, dryRun bool, setOrganized *bool, moveFiles *bool) (*RenameResult, error) {
	if err := s.LoadFiles(ctx, r.repository.Scene); err != nil {
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
			Error: func(s string) *string { return &s }("Scene has no files"),
		}, nil
	}

	// Load Studio
	var studio *models.Studio
	var parentStudio *models.Studio
	if s.StudioID != nil {
		studio, _ = r.repository.Studio.Find(ctx, *s.StudioID)
		if studio != nil && studio.ParentID != nil {
			parentStudio, _ = r.repository.Studio.Find(ctx, *studio.ParentID)
		}
	}

	// Load Performers
	if err := s.LoadPerformerIDs(ctx, r.repository.Scene); err != nil {
		return nil, err
	}
	var performers []*models.Performer
	for _, pid := range s.PerformerIDs.List() {
		p, _ := r.repository.Performer.Find(ctx, pid)
		if p != nil {
			performers = append(performers, p)
		}
	}

	renamerService := renamer.NewRenamer()
	// Get performer limit from config
	performerLimit := config.GetInstance().GetRenamerPerformerLimit()
	newPath, err := renamerService.ComposePath(template, s, studio, parentStudio, performers, primaryFile, performerLimit)
	if err != nil {
		return &RenameResult{
			ID:      strconv.Itoa(s.ID),
			OldPath: primaryFile.Path,
			Error:   func(s string) *string { return &s }(err.Error()),
		}, nil
	}

	// Determine if we should move files
	shouldMove := config.GetInstance().GetRenamerMoveFiles()
	if moveFiles != nil {
		shouldMove = *moveFiles
	}

	paths := manager.GetInstance().Config.GetStashPaths()
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
	// Use Clean to normalize separators
	// On Windows, comparing cleaned paths is usually checking for string equality of standard format
	// Stash assumes mostly case-insensitive FS on Windows, but let's stick to Clean comparison first.
	// Actually, we should probably lowercase it on Windows, but Clean is a good start.
	// Given we just fixed the path separators, Clean should be enough if the casing matches. Serechops wants casing changes to happen?
	// If casing is different but path letters are same, Windows treats it as same file.
	// If the user wants to rename "File.mp4" to "file.mp4", that IS a rename on Windows but requires special handling (temp rename).
	// But here we are skipping if it matches.
	// If newPath == oldPath (including case), then absolutely skip.
	if filepath.Clean(fullNewPath) == filepath.Clean(primaryFile.Path) {
		msg := "Destination matches current path"
		return &RenameResult{
			ID:      strconv.Itoa(s.ID),
			OldPath: primaryFile.Path,
			NewPath: fullNewPath,
			Error:   &msg,
		}, nil
	}

	res := &RenameResult{
		ID:      strconv.Itoa(s.ID),
		OldPath: primaryFile.Path,
		NewPath: fullNewPath,
		DryRun:  dryRun,
	}

	if !dryRun {
		fileStore := r.repository.File
		folderStore := r.repository.Folder
		mover := file.NewMover(fileStore, folderStore)
		// RegisterHooks not accessible directly if we are inside a txn managed by withTxn?
		// resolver's withTxn wraps DB txn.
		// mover.RegisterHooks needs context? No, it takes ctx.
		// It adds OnCommit hooks.
		// Execute Move
		dir := filepath.Dir(fullNewPath)
		base := filepath.Base(fullNewPath)

		// Ensure physical directory exists
		if err := os.MkdirAll(dir, 0755); err != nil {
			logger.Errorf("RenameScenes: Failed to create physical directory %s: %v", dir, err)
			msg := fmt.Sprintf("failed to create directory: %v", err)
			res.Error = &msg
			return res, nil
		}

		// GetOrCreate Folder
		logger.Debugf("RenameScenes: Requesting/Creating folder: %s", dir)
		folder, err := file.GetOrCreateFolderHierarchy(ctx, folderStore, dir)
		if err != nil {
			logger.Errorf("RenameScenes: GetOrCreateFolderHierarchy error for scene %d: %v", s.ID, err)
			msg := err.Error()
			res.Error = &msg
			return res, nil
		}

		if err := mover.Move(ctx, primaryFile, folder, base); err != nil {
			logger.Errorf("RenameScenes: Mover.Move error for scene %d: %v", s.ID, err)
			msg := err.Error()
			res.Error = &msg
			return res, nil
		}

		// Update Organized flag if requested
		if setOrganized != nil {
			s.Organized = *setOrganized
			if err := r.repository.Scene.Update(ctx, s); err != nil {
				msg := fmt.Sprintf("File renamed, but failed to update organized: %v", err)
				res.Error = &msg
			}
		}
	}

	return res, nil
}
