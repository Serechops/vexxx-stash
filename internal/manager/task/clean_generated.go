package task

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/job"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/models/paths"
)

type CleanGeneratedOptions struct {
	BlobFiles bool `json:"blobs"`

	Sprites     bool `json:"sprites"`
	Screenshots bool `json:"screenshots"`
	Transcodes  bool `json:"transcodes"`

	Markers bool `json:"markers"`

	ImageThumbnails bool `json:"imageThumbnails"`

	DryRun bool `json:"dryRun"`
}

type BlobCleaner interface {
	EntryExists(ctx context.Context, checksum string) (bool, error)
	GetAllChecksums(ctx context.Context) (map[string]struct{}, error)
}

type CleanGeneratedJob struct {
	Options CleanGeneratedOptions

	Paths                    *paths.Paths
	BlobsStorageType         config.BlobsStorageType
	VideoFileNamingAlgorithm models.HashAlgorithm

	BlobCleaner BlobCleaner
	Repository  models.Repository

	dryRunPrefix  string
	totalTasks    int
	tasksComplete int
}

func (j *CleanGeneratedJob) deleteFile(path string) {
	if j.Options.DryRun {
		logger.Debugf("would delete file: %s", path)
		return
	}

	if err := os.Remove(path); err != nil {
		logger.Errorf("error deleting file %s: %v", path, err)
	}
}

func (j *CleanGeneratedJob) deleteDir(path string) {
	if j.Options.DryRun {
		logger.Debugf("would delete file: %s", path)
		return
	}

	if err := os.RemoveAll(path); err != nil {
		logger.Errorf("error deleting directory %s: %v", path, err)
	}
}

func (j *CleanGeneratedJob) countTasks() int {
	tasks := 0

	if j.Options.BlobFiles {
		tasks++
	}
	if j.Options.Sprites {
		tasks++
	}
	if j.Options.Screenshots {
		tasks++
	}
	if j.Options.Transcodes {
		tasks++
	}
	if j.Options.Markers {
		tasks++
	}
	if j.Options.ImageThumbnails {
		tasks++
	}
	return tasks
}

func (j *CleanGeneratedJob) taskComplete(progress *job.Progress) {
	j.tasksComplete++
	progress.SetPercent(float64(j.tasksComplete) / float64(j.totalTasks))
}

func (j *CleanGeneratedJob) logError(err error) {
	if !errors.Is(err, context.Canceled) {
		logger.Error(err)
	}
}

func (j *CleanGeneratedJob) Execute(ctx context.Context, progress *job.Progress) error {
	j.tasksComplete = 0

	if !j.BlobsStorageType.IsValid() {
		return fmt.Errorf("invalid blobs storage type: %s", j.BlobsStorageType)
	}

	if !j.VideoFileNamingAlgorithm.IsValid() {
		return fmt.Errorf("invalid video file naming algorithm: %s", j.VideoFileNamingAlgorithm)
	}

	if j.Options.DryRun {
		j.dryRunPrefix = "[dry run] "
	}

	logger.Infof("Cleaning generated files %s", j.dryRunPrefix)

	j.totalTasks = j.countTasks()

	if j.Options.BlobFiles {
		progress.ExecuteTask("Cleaning blob files", func() {
			if err := j.cleanBlobFiles(ctx, progress); err != nil {
				j.logError(fmt.Errorf("error cleaning blob files: %w", err))
			}
		})
		j.taskComplete(progress)
	}

	if j.Options.Sprites {
		progress.ExecuteTask("Cleaning sprite files", func() {
			if err := j.cleanSpriteFiles(ctx, progress); err != nil {
				j.logError(fmt.Errorf("error cleaning sprite files: %w", err))
			}
		})
		j.taskComplete(progress)
	}

	if j.Options.Screenshots {
		progress.ExecuteTask("Cleaning screenshot files", func() {
			if err := j.cleanScreenshotFiles(ctx, progress); err != nil {
				j.logError(fmt.Errorf("error cleaning screenshot files: %w", err))
			}
		})
		j.taskComplete(progress)
	}

	if j.Options.Transcodes {
		progress.ExecuteTask("Cleaning transcode files", func() {
			if err := j.cleanTranscodeFiles(ctx, progress); err != nil {
				j.logError(fmt.Errorf("error cleaning transcode files: %w", err))
			}
		})
		j.taskComplete(progress)
	}

	if j.Options.Markers {
		progress.ExecuteTask("Cleaning marker files", func() {
			if err := j.cleanMarkerFiles(ctx, progress); err != nil {
				j.logError(fmt.Errorf("error cleaning marker files: %w", err))
			}
		})
		j.taskComplete(progress)
	}

	if j.Options.ImageThumbnails {
		progress.ExecuteTask("Cleaning thumbnail files", func() {
			if err := j.cleanThumbnailFiles(ctx, progress); err != nil {
				j.logError(fmt.Errorf("error cleaning thumbnail files: %w", err))
			}
		})
		j.taskComplete(progress)
	}

	if job.IsCancelled(ctx) {
		logger.Info("Stopping due to user request")
		return nil
	}

	logger.Infof("Finished cleaning generated files")
	return nil
}

func (j *CleanGeneratedJob) setTaskProgress(taskProgress float64, progress *job.Progress) {
	progress.SetPercent((float64(j.tasksComplete) + taskProgress) / float64(j.totalTasks))
}

func (j *CleanGeneratedJob) logDelete(format string, args ...interface{}) {
	logger.Infof(j.dryRunPrefix+format, args...)
}

func (j *CleanGeneratedJob) getIntraFolderPrefix(basename string) (string, error) {
	var hash string
	_, err := fmt.Sscanf(basename, "%2x", &hash)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%x", hash), nil
}

func (j *CleanGeneratedJob) getBlobFileHash(basename string) (string, error) {
	var hash string
	_, err := fmt.Sscanf(basename, "%32x", &hash)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%x", hash), nil
}

// sceneFingerprintType returns the fingerprint type used for scene file naming.
func (j *CleanGeneratedJob) sceneFingerprintType() string {
	if j.VideoFileNamingAlgorithm == models.HashAlgorithmMd5 {
		return models.FingerprintTypeMD5
	}
	return models.FingerprintTypeOshash
}

// loadSceneHashes loads all scene fingerprints of the configured naming type
// into a set using a single read transaction.
func (j *CleanGeneratedJob) loadSceneHashes(ctx context.Context) (map[string]struct{}, error) {
	var validHashes map[string]struct{}
	if err := j.Repository.WithReadTxn(ctx, func(ctx context.Context) error {
		var err error
		validHashes, err = j.Repository.Scene.GetFingerprintsByType(ctx, j.sceneFingerprintType())
		return err
	}); err != nil {
		return nil, fmt.Errorf("loading scene fingerprints: %w", err)
	}
	return validHashes, nil
}

func (j *CleanGeneratedJob) cleanBlobFiles(ctx context.Context, progress *job.Progress) error {
	if j.BlobsStorageType != config.BlobStorageTypeFilesystem {
		logger.Debugf("skipping blob file cleanup, storage type is not filesystem")
		return nil
	}

	logger.Infof("Cleaning blob files")

	// Phase 1: collect all blob files on disk (no DB access).
	type entry struct{ path, name string }
	var entries []entry

	if err := filepath.WalkDir(j.Paths.Blobs, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		if d.IsDir() {
			if path == j.Paths.Blobs {
				return nil
			}
			_, ferr := j.getIntraFolderPrefix(d.Name())
			if ferr != nil {
				logger.Warnf("Ignoring unknown directory: %s", path)
				return fs.SkipDir
			}
			return nil
		}
		blobname := d.Name()
		if _, ferr := j.getBlobFileHash(blobname); ferr != nil {
			logger.Warnf("ignoring unknown blob file: %s", blobname)
			return nil
		}
		entries = append(entries, entry{path: path, name: blobname})
		return nil
	}); err != nil {
		return err
	}

	if job.IsCancelled(ctx) {
		return nil
	}

	// Phase 2: load all valid checksums from DB in a single transaction.
	var validChecksums map[string]struct{}
	if err := j.Repository.WithReadTxn(ctx, func(ctx context.Context) error {
		var err error
		validChecksums, err = j.BlobCleaner.GetAllChecksums(ctx)
		return err
	}); err != nil {
		return fmt.Errorf("loading blob checksums: %w", err)
	}

	// Phase 3: delete orphans.
	for i, e := range entries {
		if job.IsCancelled(ctx) {
			return nil
		}
		j.setTaskProgress(float64(i)/float64(len(entries)), progress)
		if _, ok := validChecksums[e.name]; !ok {
			j.logDelete("deleting unused blob file: %s", e.name)
			j.deleteFile(e.path)
		}
	}

	return nil
}

const (
	md5Length    = 32
	oshashLength = 16
)

func (j *CleanGeneratedJob) hashPatternPrefix() string {
	hashLen := oshashLength
	if j.VideoFileNamingAlgorithm == models.HashAlgorithmMd5 {
		hashLen = md5Length
	}

	return fmt.Sprintf("%%%dx", hashLen)
}

func (j *CleanGeneratedJob) getSpriteFileHash(basename string) (string, error) {
	patternPrefix := j.hashPatternPrefix()
	spritePattern := patternPrefix + "_sprite.jpg"

	var hash string
	_, err := fmt.Sscanf(basename, spritePattern, &hash)
	if err != nil {
		// also try thumbs
		thumbPattern := patternPrefix + "_thumbs.vtt"
		_, err = fmt.Sscanf(basename, thumbPattern, &hash)

		if err != nil {
			return "", err
		}
	}

	return fmt.Sprintf("%x", hash), nil
}

func (j *CleanGeneratedJob) cleanSpriteFiles(ctx context.Context, progress *job.Progress) error {
	return j.cleanSceneFiles(ctx, j.Paths.Generated.Vtt, "sprite", j.getSpriteFileHash, progress)
}

func (j *CleanGeneratedJob) cleanSceneFiles(ctx context.Context, path string, typ string, getSceneFileHash func(filename string) (string, error), progress *job.Progress) error {
	logger.Infof("Cleaning %s files", typ)

	// Phase 1: collect all relevant files on disk (no DB access).
	type entry struct{ path, hash string }
	var entries []entry

	if err := filepath.WalkDir(path, func(fpath string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		hash, ferr := getSceneFileHash(d.Name())
		if ferr != nil {
			logger.Warnf("Ignoring unknown %s file: %s", typ, d.Name())
			return nil
		}
		entries = append(entries, entry{path: fpath, hash: hash})
		return nil
	}); err != nil {
		return err
	}

	if job.IsCancelled(ctx) {
		return nil
	}

	// Phase 2: load all valid scene hashes from DB in a single transaction.
	validHashes, err := j.loadSceneHashes(ctx)
	if err != nil {
		return err
	}

	// Phase 3: delete orphans.
	for i, e := range entries {
		if job.IsCancelled(ctx) {
			return nil
		}
		j.setTaskProgress(float64(i)/float64(len(entries)), progress)
		if _, ok := validHashes[e.hash]; !ok {
			j.logDelete("deleting unused %s file: %s", typ, filepath.Base(e.path))
			j.deleteFile(e.path)
		}
	}

	return nil
}

func (j *CleanGeneratedJob) getScreenshotFileHash(basename string) (string, error) {
	var hash string
	var ext string
	// include the extension - which could be mp4/jpg/webp
	_, err := fmt.Sscanf(basename, j.hashPatternPrefix()+".%s", &hash, &ext)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%x", hash), nil
}

func (j *CleanGeneratedJob) cleanScreenshotFiles(ctx context.Context, progress *job.Progress) error {
	return j.cleanSceneFiles(ctx, j.Paths.Generated.Screenshots, "screenshot", j.getScreenshotFileHash, progress)
}

func (j *CleanGeneratedJob) getTranscodeFileHash(basename string) (string, error) {
	var hash string
	_, err := fmt.Sscanf(basename, j.hashPatternPrefix()+".mp4", &hash)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%x", hash), nil
}

func (j *CleanGeneratedJob) cleanTranscodeFiles(ctx context.Context, progress *job.Progress) error {
	return j.cleanSceneFiles(ctx, j.Paths.Generated.Transcodes, "transcode", j.getTranscodeFileHash, progress)
}

func (j *CleanGeneratedJob) getMarkerSceneFileHash(basename string) (string, error) {
	var hash string
	_, err := fmt.Sscanf(basename, j.hashPatternPrefix(), &hash)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%x", hash), nil
}

func (j *CleanGeneratedJob) getMarkerFileSeconds(basename string) (int, error) {
	var ret int
	var ext string
	// include the extension - which could be mp4/jpg/webp
	_, err := fmt.Sscanf(basename, "%d.%s", &ret, &ext)
	if err != nil {
		return 0, err
	}

	return ret, nil
}

func (j *CleanGeneratedJob) cleanMarkerFiles(ctx context.Context, progress *job.Progress) error {
	logger.Infof("Cleaning marker files")

	// Phase 1: walk FS collecting scene-hash directories and their marker files.
	type markerFile struct {
		path    string
		seconds int
	}
	type markerDir struct {
		path  string
		hash  string
		files []markerFile
	}
	var dirs []markerDir
	currentIdx := -1

	if err := filepath.WalkDir(j.Paths.Generated.Markers, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		if d.IsDir() {
			if path == j.Paths.Generated.Markers {
				return nil
			}
			if filepath.Dir(path) != j.Paths.Generated.Markers {
				logger.Warnf("Ignoring unknown marker directory: %s", path)
				return fs.SkipDir
			}
			sceneHash, ferr := j.getMarkerSceneFileHash(d.Name())
			if ferr != nil {
				logger.Warnf("Ignoring unknown marker directory: %s", path)
				return fs.SkipDir
			}
			dirs = append(dirs, markerDir{path: path, hash: sceneHash})
			currentIdx = len(dirs) - 1
			return nil
		}
		if currentIdx < 0 {
			return nil
		}
		seconds, ferr := j.getMarkerFileSeconds(d.Name())
		if ferr != nil {
			logger.Warnf("Ignoring unknown marker file: %s", d.Name())
			return nil
		}
		dirs[currentIdx].files = append(dirs[currentIdx].files, markerFile{path: path, seconds: seconds})
		return nil
	}); err != nil {
		return err
	}

	if job.IsCancelled(ctx) {
		return nil
	}

	// Phase 2: load valid scene hashes and their marker seconds in one transaction.
	fpType := j.sceneFingerprintType()
	var validScenes map[string]struct{}
	var validMarkers map[string]map[int]struct{}
	if err := j.Repository.WithReadTxn(ctx, func(ctx context.Context) error {
		var err error
		validScenes, err = j.Repository.Scene.GetFingerprintsByType(ctx, fpType)
		if err != nil {
			return err
		}
		validMarkers, err = j.Repository.Scene.GetHashedMarkerSeconds(ctx, fpType)
		return err
	}); err != nil {
		return fmt.Errorf("loading marker data: %w", err)
	}

	// Phase 3: delete orphan directories and files.
	for i, dir := range dirs {
		if job.IsCancelled(ctx) {
			return nil
		}
		j.setTaskProgress(float64(i)/float64(len(dirs)), progress)

		if _, ok := validScenes[dir.hash]; !ok {
			j.logDelete("deleting unused marker directory: %s", dir.hash)
			j.deleteDir(dir.path)
			continue
		}

		markerSeconds := validMarkers[dir.hash]
		for _, f := range dir.files {
			if markerSeconds == nil {
				j.logDelete("deleting unused marker file: %s", filepath.Base(f.path))
				j.deleteFile(f.path)
				continue
			}
			if _, ok := markerSeconds[f.seconds]; !ok {
				j.logDelete("deleting unused marker file: %s", filepath.Base(f.path))
				j.deleteFile(f.path)
			}
		}
	}

	return nil
}

func (j *CleanGeneratedJob) getThumbnailFileHash(basename string) (string, error) {
	var (
		hash  string
		width int
		ext   string
	)
	// include the extension - which could be jpg/webp
	_, err := fmt.Sscanf(basename, "%32x_%d.%s", &hash, &width, &ext)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%x", hash), nil
}

func (j *CleanGeneratedJob) cleanThumbnailFiles(ctx context.Context, progress *job.Progress) error {
	logger.Infof("Cleaning image thumbnail files")

	// Phase 1: collect all thumbnail files on disk (no DB access).
	type entry struct{ path, checksum string }
	var entries []entry

	if err := filepath.WalkDir(j.Paths.Generated.Thumbnails, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		if d.IsDir() {
			if path == j.Paths.Generated.Thumbnails {
				return nil
			}
			_, ferr := j.getIntraFolderPrefix(d.Name())
			if ferr != nil {
				logger.Warnf("Ignoring unknown thumbnail directory: %s", path)
				return fs.SkipDir
			}
			return nil
		}
		checksum, ferr := j.getThumbnailFileHash(d.Name())
		if ferr != nil {
			logger.Warnf("Ignoring unknown thumbnail file: %s", d.Name())
			return nil
		}
		entries = append(entries, entry{path: path, checksum: checksum})
		return nil
	}); err != nil {
		return err
	}

	if job.IsCancelled(ctx) {
		return nil
	}

	// Phase 2: load all valid image MD5 checksums from DB in a single transaction.
	var validChecksums map[string]struct{}
	if err := j.Repository.WithReadTxn(ctx, func(ctx context.Context) error {
		var err error
		validChecksums, err = j.Repository.Image.GetAllMD5Checksums(ctx)
		return err
	}); err != nil {
		return fmt.Errorf("loading image checksums: %w", err)
	}

	// Phase 3: delete orphans.
	for i, e := range entries {
		if job.IsCancelled(ctx) {
			return nil
		}
		j.setTaskProgress(float64(i)/float64(len(entries)), progress)
		if _, ok := validChecksums[e.checksum]; !ok {
			j.logDelete("deleting unused thumbnail file: %s", filepath.Base(e.path))
			j.deleteFile(e.path)
		}
	}

	return nil
}
