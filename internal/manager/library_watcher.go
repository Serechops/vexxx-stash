package manager

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
)

type pendingFile struct {
	lastEventTime time.Time
	lastSize      int64
	lastModTime   time.Time
	retryCount    int
}

type LibraryWatcher struct {
	watcher    *fsnotify.Watcher
	mu         sync.Mutex
	watchPaths []string
	ctx        context.Context
	cancel     context.CancelFunc
	wg         sync.WaitGroup

	pending   map[string]*pendingFile
	pendingMu sync.Mutex
}

var libraryWatcherInstance *LibraryWatcher

func InitLibraryWatcher(ctx context.Context) {
	if libraryWatcherInstance != nil {
		return
	}

	w, err := fsnotify.NewWatcher()
	if err != nil {
		logger.Errorf("Failed to initialize library watcher: %v", err)
		return
	}

	watchCtx, cancel := context.WithCancel(ctx)
	libraryWatcherInstance = &LibraryWatcher{
		watcher: w,
		ctx:     watchCtx,
		cancel:  cancel,
		pending: make(map[string]*pendingFile),
	}

	libraryWatcherInstance.Start()
}

func GetLibraryWatcherInstance() *LibraryWatcher {
	return libraryWatcherInstance
}

func (lw *LibraryWatcher) Start() {
	lw.wg.Add(2)
	go lw.watchLoop()
	go lw.settleLoop()

	lw.UpdateWatches()
}

func (lw *LibraryWatcher) Stop() {
	if lw.cancel != nil {
		lw.cancel()
	}
	if lw.watcher != nil {
		_ = lw.watcher.Close()
	}
	lw.wg.Wait()
}

func (lw *LibraryWatcher) UpdateWatches() {
	lw.mu.Lock()
	defer lw.mu.Unlock()

	// 1. Get watched paths from configuration
	cfg := config.GetInstance()
	stashPaths := cfg.GetStashPaths()
	var newWatchPaths []string
	for _, p := range stashPaths {
		if p.Watch {
			newWatchPaths = append(newWatchPaths, p.Path)
		}
	}

	// 2. Remove directories no longer watched
	for _, p := range lw.watchPaths {
		stillWatched := false
		for _, np := range newWatchPaths {
			if np == p {
				stillWatched = true
				break
			}
		}
		if !stillWatched {
			lw.removeRecursive(p)
		}
	}

	// 3. Add new watched directories
	for _, np := range newWatchPaths {
		alreadyWatched := false
		for _, p := range lw.watchPaths {
			if p == np {
				alreadyWatched = true
				break
			}
		}
		if !alreadyWatched {
			lw.addRecursive(np)
		}
	}

	lw.watchPaths = newWatchPaths
}

func (lw *LibraryWatcher) addRecursive(root string) {
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // Skip errors/unreadable paths
		}
		if d.IsDir() {
			err = lw.watcher.Add(path)
			if err != nil {
				// Log limit warnings
				if strings.Contains(err.Error(), "no space left on device") || strings.Contains(err.Error(), "too many open files") {
					logger.Warnf("Library watcher hit OS watches limit: failed to watch %s. Please increase fs.inotify.max_user_watches.", path)
					return filepath.SkipDir // Stop walking deeper to avoid spam
				}
				logger.Debugf("Failed to watch subfolder %s: %v", path, err)
			}
		}
		return nil
	})
	if err != nil {
		logger.Errorf("Error walking path for watcher %s: %v", root, err)
	}
}

func (lw *LibraryWatcher) removeRecursive(root string) {
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			_ = lw.watcher.Remove(path)
		}
		return nil
	})
	if err != nil {
		logger.Debugf("Error removing paths from watcher for %s: %v", root, err)
	}
}

func (lw *LibraryWatcher) watchLoop() {
	defer lw.wg.Done()
	for {
		select {
		case <-lw.ctx.Done():
			return
		case event, ok := <-lw.watcher.Events:
			if !ok {
				return
			}

			// Handle folder creation dynamically
			if event.Has(fsnotify.Create) {
				info, err := os.Stat(event.Name)
				if err == nil && info.IsDir() {
					lw.mu.Lock()
					lw.addRecursive(event.Name)
					lw.mu.Unlock()
					continue
				}
			}

			// Track creation & write events on files
			if event.Has(fsnotify.Create) || event.Has(fsnotify.Write) {
				// Filter out temporary extensions early
				ext := strings.ToLower(filepath.Ext(event.Name))
				if ext == ".tmp" || ext == ".part" || ext == ".crdownload" || ext == ".!qb" {
					continue
				}

				lw.pendingMu.Lock()
				if entry, exists := lw.pending[event.Name]; exists {
					entry.lastEventTime = time.Now()
				} else {
					lw.pending[event.Name] = &pendingFile{
						lastEventTime: time.Now(),
					}
				}
				lw.pendingMu.Unlock()
			}
		case err, ok := <-lw.watcher.Errors:
			if !ok {
				return
			}
			logger.Debugf("Library watcher error: %v", err)
		}
	}
}

func (lw *LibraryWatcher) settleLoop() {
	defer lw.wg.Done()
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-lw.ctx.Done():
			return
		case <-ticker.C:
			lw.processPending()
		}
	}
}

func (lw *LibraryWatcher) processPending() {
	lw.pendingMu.Lock()
	defer lw.pendingMu.Unlock()

	now := time.Now()
	for path, fileState := range lw.pending {
		// Wait 10 seconds of silence/debounce
		if now.Sub(fileState.lastEventTime) < 10*time.Second {
			continue
		}

		info, err := os.Stat(path)
		if err != nil {
			// File was deleted or moved, remove from list
			delete(lw.pending, path)
			continue
		}

		if info.IsDir() {
			delete(lw.pending, path)
			continue
		}

		// Settle Checks:
		// 1. Is size or modification time still changing?
		if info.Size() != fileState.lastSize || !info.ModTime().Equal(fileState.lastModTime) {
			fileState.lastSize = info.Size()
			fileState.lastModTime = info.ModTime()
			fileState.lastEventTime = now // Refresh timer to check again next cycle
			continue
		}

		// 2. Is it a valid media file (video, image, or zip)?
		if !useAsVideo(path) && !useAsImage(path) && !isZip(path) {
			delete(lw.pending, path)
			continue
		}

		// 3. Try to open the file to verify lock status
		if !isFileUnlocked(path) {
			// File is still locked by downloader/browser
			fileState.retryCount++
			if fileState.retryCount > 30 {
				// Stop trying after 5 minutes
				logger.Warnf("Library watcher giving up on locked file: %s", path)
				delete(lw.pending, path)
			} else {
				fileState.lastEventTime = now // Try again next cycle
			}
			continue
		}

		// Settle check passed! Trigger the scan
		delete(lw.pending, path)
		go func(filePath string) {
			ctx := context.Background()

			// Get watched roots
			lw.mu.Lock()
			roots := make([]string, len(lw.watchPaths))
			copy(roots, lw.watchPaths)
			lw.mu.Unlock()

			// Ensure parent folders exist in DB before scanning
			if err := lw.ensureParentFoldersExist(ctx, filepath.Dir(filePath), roots); err != nil {
				logger.Errorf("Library watcher: failed to ensure parent folders exist for %s: %v", filePath, err)
				return
			}

			logger.Infof("Library watcher: new media settled. Scanning: %s", filePath)
			// Trigger synchronous single-file scan
			_, scanErr := GetInstance().ScanFile(ctx, ScanFileInput{
				Path:   filePath,
				Rescan: false,
			})
			if scanErr != nil {
				logger.Errorf("Library watcher: failed to scan file %s: %v", filePath, scanErr)
			}
		}(path)
	}
}

// isFileUnlocked reports whether path can be safely handed off for scanning.
// It opens for read-write first, since exclusive locks held by downloaders/
// browsers on Windows block that outright. A permission error on that open
// doesn't necessarily mean the file is still being written though - it's
// also what a read-only mount (e.g. a Docker `:ro` library volume) looks
// like - so in that case fall back to a read-only open to confirm the file
// is at least accessible.
func isFileUnlocked(path string) bool {
	f, err := os.OpenFile(path, os.O_RDWR, 0)
	if err == nil {
		f.Close()
		return true
	}

	if !errors.Is(err, fs.ErrPermission) {
		return false
	}

	rf, err := os.Open(path)
	if err != nil {
		return false
	}
	rf.Close()
	return true
}

func (lw *LibraryWatcher) ensureParentFoldersExist(ctx context.Context, fileDir string, watchedRoots []string) error {
	fileDir = filepath.Clean(fileDir)
	var matchedRoot string
	for _, root := range watchedRoots {
		cleanRoot := filepath.Clean(root)
		// On Windows, compare case-insensitively
		if filepath.Separator == '\\' {
			if strings.HasPrefix(strings.ToLower(fileDir), strings.ToLower(cleanRoot)) {
				matchedRoot = cleanRoot
				break
			}
		} else {
			if strings.HasPrefix(fileDir, cleanRoot) {
				matchedRoot = cleanRoot
				break
			}
		}
	}
	if matchedRoot == "" {
		return fmt.Errorf("directory %s is not within any watched roots", fileDir)
	}

	// Build a list of directories starting from matchedRoot down to fileDir
	var dirsToEnsure []string
	current := fileDir
	for {
		dirsToEnsure = append([]string{current}, dirsToEnsure...)
		if strings.EqualFold(current, matchedRoot) || current == filepath.Dir(current) {
			break
		}
		current = filepath.Dir(current)
	}

	repo := GetInstance().Repository

	return repo.WithTxn(ctx, func(ctx context.Context) error {
		// Check and create each directory in order
		for _, dir := range dirsToEnsure {
			// Try to find the folder in DB
			existing, err := repo.Folder.FindByPath(ctx, dir, true)
			if err != nil {
				return err
			}

			if existing == nil {
				// Try case-insensitive search if filesystem is case-insensitive
				existing, err = repo.Folder.FindByPath(ctx, dir, false)
				if err != nil {
					return err
				}
			}

			if existing == nil {
				logger.Infof("Library watcher: parent folder %s doesn't exist. Creating database entry...", dir)

				// Get folder info using os.Stat
				info, err := os.Stat(dir)
				var modTime time.Time
				if err == nil {
					modTime = info.ModTime()
				} else {
					modTime = time.Now()
				}

				toCreate := &models.Folder{
					Path:      dir,
					CreatedAt: time.Now(),
					UpdatedAt: time.Now(),
					DirEntry: models.DirEntry{
						ModTime: modTime,
					},
				}

				// Link parent folder ID if there is one
				parentDir := filepath.Dir(dir)
				if !strings.EqualFold(parentDir, filepath.Dir(matchedRoot)) && parentDir != dir {
					parentFolder, err := repo.Folder.FindByPath(ctx, parentDir, true)
					if err == nil && parentFolder != nil {
						toCreate.ParentFolderID = &parentFolder.ID
					}
				}

				err = repo.Folder.Create(ctx, toCreate)
				if err != nil {
					logger.Errorf("Library watcher: failed to create parent folder %s in database: %v", dir, err)
					return err
				}
			}
		}
		return nil
	})
}
