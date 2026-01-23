package api

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/fsutil"
	"github.com/stashapp/stash/pkg/models"
	"golang.org/x/text/collate"
)

func (r *queryResolver) Configuration(ctx context.Context) (*ConfigResult, error) {
	return makeConfigResult(), nil
}

func (r *queryResolver) Directory(ctx context.Context, path, locale *string) (*Directory, error) {

	directory := &Directory{}
	var err error

	col := newCollator(locale, collate.IgnoreCase, collate.Numeric)

	var dirPath = ""
	if path != nil {
		dirPath = *path
	}
	currentDir := getDir(dirPath)
	directories, err := listDir(col, currentDir)
	if err != nil {
		return directory, err
	}

	directory.Path = currentDir
	directory.Parent = getParent(currentDir)
	directory.Directories = directories

	return directory, err
}

func getDir(path string) string {
	if path == "" {
		path = fsutil.GetHomeDirectory()
	}

	return path
}

func getParent(path string) *string {
	isRoot := path == "/"
	if isRoot {
		return nil
	} else {
		parentPath := filepath.Clean(path + "/..")
		return &parentPath
	}
}

func makeConfigResult() *ConfigResult {
	return &ConfigResult{
		General:   makeConfigGeneralResult(),
		Interface: makeConfigInterfaceResult(),
		Dlna:      makeConfigDLNAResult(),
		Scraping:  makeConfigScrapingResult(),
		Renamer:   makeConfigRenamerResult(),
		Defaults:  makeConfigDefaultsResult(),
		UI:        makeConfigUIResult(),
	}
}

func makeConfigRenamerResult() *ConfigRenamerResult {
	config := config.GetInstance()
	return &ConfigRenamerResult{
		Enabled:        config.GetRenamerEnabled(),
		Template:       config.GetRenamerTemplate(),
		PerformerLimit: config.GetRenamerPerformerLimit(),
		MoveFiles:      config.GetRenamerMoveFiles(),
	}
}

func makeConfigGeneralResult() *ConfigGeneralResult {
	config := config.GetInstance()
	logFile := config.GetLogFile()

	maxTranscodeSize := config.GetMaxTranscodeSize()
	maxStreamingTranscodeSize := config.GetMaxStreamingTranscodeSize()

	customPerformerImageLocation := config.GetCustomPerformerImageLocation()

	return &ConfigGeneralResult{
		Stashes:                       config.GetStashPaths(),
		DatabasePath:                  config.GetDatabasePath(),
		BackupDirectoryPath:           config.GetBackupDirectoryPath(),
		DeleteTrashPath:               config.GetDeleteTrashPath(),
		GeneratedPath:                 config.GetGeneratedPath(),
		MetadataPath:                  config.GetMetadataPath(),
		ConfigFilePath:                config.GetConfigFile(),
		ScrapersPath:                  config.GetScrapersPath(),
		PluginsPath:                   config.GetPluginsPath(),
		CachePath:                     config.GetCachePath(),
		BlobsPath:                     config.GetBlobsPath(),
		BlobsStorage:                  config.GetBlobsStorage(),
		FfmpegPath:                    config.GetFFMpegPath(),
		FfprobePath:                   config.GetFFProbePath(),
		CalculateMd5:                  config.IsCalculateMD5(),
		VideoFileNamingAlgorithm:      config.GetVideoFileNamingAlgorithm(),
		ParallelTasks:                 config.GetParallelTasks(),
		PreviewAudio:                  config.GetPreviewAudio(),
		PreviewSegments:               config.GetPreviewSegments(),
		PreviewSegmentDuration:        config.GetPreviewSegmentDuration(),
		PreviewExcludeStart:           config.GetPreviewExcludeStart(),
		PreviewExcludeEnd:             config.GetPreviewExcludeEnd(),
		PreviewPreset:                 config.GetPreviewPreset(),
		TranscodeHardwareAcceleration: config.GetTranscodeHardwareAcceleration(),
		MaxTranscodeSize:              &maxTranscodeSize,
		MaxStreamingTranscodeSize:     &maxStreamingTranscodeSize,
		WriteImageThumbnails:          config.IsWriteImageThumbnails(),
		CreateImageClipsFromVideos:    config.IsCreateImageClipsFromVideos(),
		GalleryCoverRegex:             config.GetGalleryCoverRegex(),
		APIKey:                        config.GetAPIKey(),
		Username:                      config.GetUsername(),
		Password:                      config.GetPasswordHash(),
		MaxSessionAge:                 config.GetMaxSessionAge(),
		LogFile:                       &logFile,
		LogOut:                        config.GetLogOut(),
		LogLevel:                      config.GetLogLevel(),
		LogAccess:                     config.GetLogAccess(),
		LogFileMaxSize:                config.GetLogFileMaxSize(),
		VideoExtensions:               config.GetVideoExtensions(),
		ImageExtensions:               config.GetImageExtensions(),
		GalleryExtensions:             config.GetGalleryExtensions(),
		CreateGalleriesFromFolders:    config.GetCreateGalleriesFromFolders(),
		Excludes:                      config.GetExcludes(),
		ImageExcludes:                 config.GetImageExcludes(),
		CustomPerformerImageLocation:  &customPerformerImageLocation,
		StashBoxes:                    config.GetStashBoxes(),
		PythonPath:                    config.GetPythonPath(),
		TranscodeInputArgs:            config.GetTranscodeInputArgs(),
		TranscodeOutputArgs:           config.GetTranscodeOutputArgs(),
		LiveTranscodeInputArgs:        config.GetLiveTranscodeInputArgs(),
		LiveTranscodeOutputArgs:       config.GetLiveTranscodeOutputArgs(),
		DrawFunscriptHeatmapRange:     config.GetDrawFunscriptHeatmapRange(),
		ScraperPackageSources:         config.GetScraperPackageSources(),
		PluginPackageSources:          config.GetPluginPackageSources(),
	}
}

func makeConfigInterfaceResult() *ConfigInterfaceResult {
	config := config.GetInstance()
	menuItems := config.GetMenuItems()
	soundOnPreview := config.GetSoundOnPreview()
	wallShowTitle := config.GetWallShowTitle()
	showScrubber := config.GetShowScrubber()
	wallPlayback := config.GetWallPlayback()
	noBrowser := config.GetNoBrowser()
	notificationsEnabled := config.GetNotificationsEnabled()
	maximumLoopDuration := config.GetMaximumLoopDuration()
	autostartVideo := config.GetAutostartVideo()
	autostartVideoOnPlaySelected := config.GetAutostartVideoOnPlaySelected()
	continuePlaylistDefault := config.GetContinuePlaylistDefault()
	showStudioAsText := config.GetShowStudioAsText()
	css := config.GetCSS()
	cssEnabled := config.GetCSSEnabled()
	javascript := config.GetJavascript()
	javascriptEnabled := config.GetJavascriptEnabled()
	customLocales := config.GetCustomLocales()
	customLocalesEnabled := config.GetCustomLocalesEnabled()
	language := config.GetLanguage()
	handyKey := config.GetHandyKey()
	scriptOffset := config.GetFunscriptOffset()
	useStashHostedFunscript := config.GetUseStashHostedFunscript()
	imageLightboxOptions := config.GetImageLightboxOptions()
	disableDropdownCreate := config.GetDisableDropdownCreate()

	return &ConfigInterfaceResult{
		SfwContentMode:               config.GetSFWContentMode(),
		MenuItems:                    menuItems,
		SoundOnPreview:               &soundOnPreview,
		WallShowTitle:                &wallShowTitle,
		WallPlayback:                 &wallPlayback,
		ShowScrubber:                 &showScrubber,
		MaximumLoopDuration:          &maximumLoopDuration,
		NoBrowser:                    &noBrowser,
		NotificationsEnabled:         &notificationsEnabled,
		AutostartVideo:               &autostartVideo,
		ShowStudioAsText:             &showStudioAsText,
		AutostartVideoOnPlaySelected: &autostartVideoOnPlaySelected,
		ContinuePlaylistDefault:      &continuePlaylistDefault,
		CSS:                          &css,
		CSSEnabled:                   &cssEnabled,
		Javascript:                   &javascript,
		JavascriptEnabled:            &javascriptEnabled,
		CustomLocales:                &customLocales,
		CustomLocalesEnabled:         &customLocalesEnabled,
		Language:                     &language,

		ImageLightbox: &imageLightboxOptions,

		DisableDropdownCreate: disableDropdownCreate,

		HandyKey:                &handyKey,
		FunscriptOffset:         &scriptOffset,
		UseStashHostedFunscript: &useStashHostedFunscript,
	}
}

func makeConfigDLNAResult() *ConfigDLNAResult {
	config := config.GetInstance()

	return &ConfigDLNAResult{
		ServerName:     config.GetDLNAServerName(),
		Enabled:        config.GetDLNADefaultEnabled(),
		Port:           config.GetDLNAPort(),
		WhitelistedIPs: config.GetDLNADefaultIPWhitelist(),
		Interfaces:     config.GetDLNAInterfaces(),
		VideoSortOrder: config.GetVideoSortOrder(),
	}
}

func makeConfigScrapingResult() *ConfigScrapingResult {
	config := config.GetInstance()

	scraperUserAgent := config.GetScraperUserAgent()
	scraperCDPPath := config.GetScraperCDPPath()

	return &ConfigScrapingResult{
		ScraperUserAgent:   &scraperUserAgent,
		ScraperCertCheck:   config.GetScraperCertCheck(),
		ScraperCDPPath:     &scraperCDPPath,
		ExcludeTagPatterns: config.GetScraperExcludeTagPatterns(),
	}
}

func makeConfigDefaultsResult() *ConfigDefaultSettingsResult {
	config := config.GetInstance()
	deleteFileDefault := config.GetDeleteFileDefault()
	deleteGeneratedDefault := config.GetDeleteGeneratedDefault()

	return &ConfigDefaultSettingsResult{
		Identify:        config.GetDefaultIdentifySettings(),
		Scan:            config.GetDefaultScanSettings(),
		AutoTag:         config.GetDefaultAutoTagSettings(),
		Generate:        config.GetDefaultGenerateSettings(),
		DeleteFile:      &deleteFileDefault,
		DeleteGenerated: &deleteGeneratedDefault,
	}
}

func makeConfigUIResult() map[string]interface{} {
	return config.GetInstance().GetUIConfiguration()
}

func (r *queryResolver) ValidateStashBoxCredentials(ctx context.Context, input config.StashBoxInput) (*StashBoxValidationResult, error) {
	box := models.StashBox{Endpoint: input.Endpoint, APIKey: input.APIKey}
	client := r.newStashBoxClient(box)

	user, err := client.GetUser(ctx)

	valid := user != nil && user.Me != nil
	var status string
	if valid {
		status = fmt.Sprintf("Successfully authenticated as %s", user.Me.Name)
	} else {
		errorStr := strings.ToLower(err.Error())
		switch {
		case strings.Contains(errorStr, "doctype"):
			// Index file returned rather than graphql
			status = "Invalid endpoint"
		case strings.Contains(errorStr, "request failed"):
			status = "No response from server"
		case strings.Contains(errorStr, "invalid character") ||
			strings.Contains(errorStr, "illegal base64 data") ||
			strings.Contains(errorStr, "unexpected end of json input") ||
			strings.Contains(errorStr, "token contains an invalid number of segments"):
			status = "Malformed API key."
		case strings.Contains(errorStr, "signature is invalid"):
			status = "Invalid or expired API key."
		default:
			status = fmt.Sprintf("Unknown error: %s", err)
		}
	}

	result := StashBoxValidationResult{
		Valid:  valid,
		Status: status,
	}

	return &result, nil
}

// ValidateLibraryPath validates a path for use as a library directory.
// If running in Docker and the path doesn't exist, it provides guidance on how to mount it.
func (r *queryResolver) ValidateLibraryPath(ctx context.Context, path string) (*LibraryPathValidationResult, error) {
	mgr := manager.GetInstance()
	isDocker := mgr.GetSystemStatus().IsDocker

	// Check if path exists
	exists, err := fsutil.DirExists(path)

	// Detect if this looks like a host path (Windows drive letter, UNC path, etc.)
	isHostPath := isLikelyHostPath(path)

	if exists {
		return &LibraryPathValidationResult{
			Valid:      true,
			IsHostPath: false,
		}, nil
	}

	// Path doesn't exist
	result := &LibraryPathValidationResult{
		Valid:      false,
		IsHostPath: isHostPath,
	}

	if err != nil {
		result.Message = stringPtr(err.Error())
	} else {
		result.Message = stringPtr(fmt.Sprintf("Directory does not exist: %s", path))
	}

	// If running in Docker, provide helpful guidance
	if isDocker {
		// Generate suggested container path and mount command
		containerPath := suggestContainerPath(path)
		result.SuggestedContainerPath = stringPtr(containerPath)
		result.DockerMountCommand = stringPtr(generateDockerMountCommand(path, containerPath))

		// Include available container paths so user can see what's already mounted
		result.AvailableContainerPaths = getAvailableContainerPaths()
	}

	return result, nil
}

// isLikelyHostPath checks if a path looks like a host system path rather than a container path
func isLikelyHostPath(path string) bool {
	// Windows drive letter (e.g., C:\, D:\)
	if len(path) >= 2 && path[1] == ':' {
		return true
	}
	// Windows UNC path (e.g., \\server\share)
	if strings.HasPrefix(path, "\\\\") {
		return true
	}
	// Common Windows-style paths with backslashes
	if strings.Contains(path, "\\") {
		return true
	}
	return false
}

// suggestContainerPath generates a sensible container path based on the host path
func suggestContainerPath(hostPath string) string {
	// Extract the last meaningful directory name from the path
	// e.g., "D:\nvme_pr0n\PornPlus" -> "/data/PornPlus"
	// e.g., "C:\Users\john\Videos" -> "/data/Videos"

	// Clean up the path
	cleanPath := strings.ReplaceAll(hostPath, "\\", "/")

	// Remove drive letter if present
	if len(cleanPath) >= 2 && cleanPath[1] == ':' {
		cleanPath = cleanPath[2:]
	}

	// Get the last directory name
	parts := strings.Split(cleanPath, "/")
	var dirName string
	for i := len(parts) - 1; i >= 0; i-- {
		if parts[i] != "" {
			dirName = parts[i]
			break
		}
	}

	if dirName == "" {
		dirName = "media"
	}

	return "/data/" + dirName
}

// generateDockerMountCommand generates the docker volume mount flag
func generateDockerMountCommand(hostPath, containerPath string) string {
	// Escape backslashes for display
	escapedHostPath := strings.ReplaceAll(hostPath, "\\", "/")
	return fmt.Sprintf("-v \"%s:%s\"", escapedHostPath, containerPath)
}

// stringPtr is a helper to get a pointer to a string
func stringPtr(s string) *string {
	return &s
}

// DockerMountedVolumes returns the list of mounted volumes when running in Docker
func (r *queryResolver) DockerMountedVolumes(ctx context.Context) ([]*DockerMountedVolume, error) {
	mgr := manager.GetInstance()
	if !mgr.GetSystemStatus().IsDocker {
		return []*DockerMountedVolume{}, nil
	}

	return getDockerMounts(), nil
}

// getDockerMounts reads /proc/mounts to get the list of mounted volumes
func getDockerMounts() []*DockerMountedVolume {
	var mounts []*DockerMountedVolume

	// Read /proc/mounts to get mount information
	data, err := os.ReadFile("/proc/mounts")
	if err != nil {
		return mounts
	}

	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}

		source := fields[0]
		mountPoint := fields[1]
		fsType := fields[2]

		// Skip system mounts and non-interesting filesystems
		if shouldSkipMount(mountPoint, fsType) {
			continue
		}

		mount := &DockerMountedVolume{
			ContainerPath: mountPoint,
			FsType:        stringPtr(fsType),
			IsMediaMount:  isLikelyMediaMount(mountPoint),
		}

		// For bind mounts, the source might give us the host path
		// However, in Docker, the source is usually the device or overlay path
		// We can't reliably get the host path from inside the container
		if source != "overlay" && source != "none" && strings.HasPrefix(source, "/") {
			mount.HostPath = stringPtr(source)
		}

		mounts = append(mounts, mount)
	}

	return mounts
}

// shouldSkipMount returns true if the mount should be skipped (system mounts, etc.)
func shouldSkipMount(mountPoint, fsType string) bool {
	// Skip virtual filesystems
	skipFsTypes := []string{"proc", "sysfs", "devpts", "tmpfs", "cgroup", "cgroup2", "mqueue", "devtmpfs", "securityfs", "debugfs", "hugetlbfs", "pstore", "bpf", "tracefs", "fusectl", "configfs", "autofs", "overlay"}
	for _, skip := range skipFsTypes {
		if fsType == skip {
			// Allow tmpfs for /tmp and /dev/shm as they might be useful
			if fsType == "tmpfs" && (mountPoint == "/tmp" || mountPoint == "/dev/shm") {
				continue
			}
			return true
		}
	}

	// Skip system paths
	skipPaths := []string{"/proc", "/sys", "/dev", "/run", "/var/lib/docker"}
	for _, skip := range skipPaths {
		if strings.HasPrefix(mountPoint, skip) {
			return true
		}
	}

	// Skip the root if it's an overlay (Docker's layered filesystem)
	if mountPoint == "/" {
		return true
	}

	return false
}

// isLikelyMediaMount returns true if the mount point looks like a media directory
func isLikelyMediaMount(mountPoint string) bool {
	mediaIndicators := []string{"/data", "/media", "/mnt", "/videos", "/movies", "/content", "/storage", "/home"}
	for _, indicator := range mediaIndicators {
		if strings.HasPrefix(mountPoint, indicator) || mountPoint == indicator {
			return true
		}
	}
	return false
}

// getAvailableContainerPaths returns a list of container paths that are likely media mount points
func getAvailableContainerPaths() []string {
	mounts := getDockerMounts()
	var paths []string

	for _, mount := range mounts {
		if mount.IsMediaMount {
			paths = append(paths, mount.ContainerPath)
		}
	}

	return paths
}
