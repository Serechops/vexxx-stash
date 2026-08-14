package manager

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"

	"github.com/stashapp/stash/pkg/fsutil"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/nativegen"
	"github.com/stashapp/stash/pkg/scene/generate"
)

// markerConcurrency bounds how many markers of one scene are generated at
// once, each on its own goroutine.
//
// Screenshots are already decoded for the whole scene in a single pass ahead
// of this (see generateNativeMarkerScreenshots), so what is left running per
// marker is overwhelmingly the preview video: its own decoder, its own
// encoder, its own output file, nothing shared with any other marker's run
// except the open source file (mp4.File.ReadSample is safe for concurrent
// callers — a fresh io.SectionReader per call, backed by os.File.ReadAt,
// which is itself safe for concurrent use) and the two device pools in
// pkg/nativegen (channel-based, built for concurrent acquire).
//
// This used to be a flat 4, on the reasoning that pkg/nativegen's own
// concurrency test found decode-only throughput scaling well past the
// two-device pool size with no cliff. That test measured a short, bounded
// run; it never exercised what a long batch of markers across many scenes
// does when concurrency exceeds the pool, which is fall back to an unpooled
// context — a full CreateContext/InitDX11 — per session over the pool's
// limit, repeatedly, for as long as the batch runs. Whether the driver
// reclaims those promptly or not is not something Go's GC can see or wait
// for: it has no pressure signal from GPU VRAM, only from its own heap. Tying
// this to DevicePoolSize keeps every concurrent marker inside pooled
// placement instead of gambling on that.
var markerConcurrency = nativegen.DevicePoolSize()

type GenerateMarkersTask struct {
	repository          models.Repository
	Scene               *models.Scene
	Marker              *models.SceneMarker
	Overwrite           bool
	fileNamingAlgorithm models.HashAlgorithm

	VideoPreview bool
	ImagePreview bool
	Screenshot   bool

	generator *generate.Generator
}

func (t *GenerateMarkersTask) GetDescription() string {
	if t.Scene != nil {
		return fmt.Sprintf("Generating markers for %s", t.Scene.Path)
	} else if t.Marker != nil {
		return fmt.Sprintf("Generating marker preview for marker ID %d", t.Marker.ID)
	}

	return "Generating markers"
}

func (t *GenerateMarkersTask) Start(ctx context.Context) error {
	if t.Scene != nil {
		t.generateSceneMarkers(ctx)
	}

	if t.Marker != nil {
		var scene *models.Scene
		r := t.repository
		if err := r.WithReadTxn(ctx, func(ctx context.Context) error {
			var err error
			scene, err = r.Scene.Find(ctx, t.Marker.SceneID)
			if err != nil {
				return err
			}
			if scene == nil {
				return fmt.Errorf("scene with id %d not found", t.Marker.SceneID)
			}

			return scene.LoadPrimaryFile(ctx, r.File)
		}); err != nil {
			logger.Errorf("error finding scene for marker generation: %v", err)
			return nil
		}

		videoFile := scene.Files.Primary()

		if videoFile == nil {
			// nothing to do
			return nil
		}

		// A single marker still asks for two assets (preview, screenshot), so
		// opening once here still saves a redundant reparse between them.
		native := openNativeMarkerSession(ctx, videoFile.Path)
		defer native.close()

		t.generateMarker(ctx, videoFile, scene, t.Marker, native, false)
	}
	return nil
}

func (t *GenerateMarkersTask) generateSceneMarkers(ctx context.Context) {
	var sceneMarkers []*models.SceneMarker
	r := t.repository
	if err := r.WithReadTxn(ctx, func(ctx context.Context) error {
		var err error
		sceneMarkers, err = r.SceneMarker.FindBySceneID(ctx, t.Scene.ID)
		return err
	}); err != nil {
		logger.Errorf("error getting scene markers: %s", err.Error())
		return
	}

	videoFile := t.Scene.Files.Primary()

	if len(sceneMarkers) == 0 || videoFile == nil {
		return
	}

	sceneHash := t.Scene.GetHash(t.fileNamingAlgorithm)

	// Make the folder for the scenes markers
	markersFolder := filepath.Join(instance.Paths.Generated.Markers, sceneHash)
	if err := fsutil.EnsureDir(markersFolder); err != nil {
		logger.Warnf("could not create the markers folder (%v): %v", markersFolder, err)
	}

	// Opened once for every marker cut from this scene, rather than once per
	// marker per asset. See nativeMarkerSession.
	native := openNativeMarkerSession(ctx, videoFile.Path)
	defer native.close()

	// Screenshots are decoded for the whole scene in one pass, ahead of the
	// per-marker loop below, so a marker whose screenshot this already wrote
	// can skip it. See generateNativeMarkerScreenshots.
	var nativeScreenshots map[int]bool
	if t.Screenshot {
		nativeScreenshots = t.generateNativeMarkerScreenshots(ctx, videoFile, t.Scene, sceneMarkers, sceneHash, native)
	}

	// Bounded rather than one goroutine per marker: a scene can carry far more
	// markers than there is any GPU session capacity for, and the semaphore
	// caps how many run at once without capping how many exist.
	var wg sync.WaitGroup
	sem := make(chan struct{}, markerConcurrency)

	for i, sceneMarker := range sceneMarkers {
		index := i + 1

		sem <- struct{}{}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-sem }()

			// Marker order in this log is now start order, not finish order —
			// several run at once, so which one lands first depends on the
			// scheduler rather than the list.
			logger.Progressf("[generator] <%s> scene marker %d of %d", sceneHash, index, len(sceneMarkers))

			t.generateMarker(ctx, videoFile, t.Scene, sceneMarker, native, nativeScreenshots[sceneMarker.ID])
		}()
	}
	wg.Wait()
}

func (t *GenerateMarkersTask) generateMarker(ctx context.Context, videoFile *models.VideoFile, scene *models.Scene, sceneMarker *models.SceneMarker, native *nativeMarkerSession, screenshotDone bool) {
	sceneHash := scene.GetHash(t.fileNamingAlgorithm)
	seconds := float64(sceneMarker.Seconds)

	// check if marker past duration
	if seconds > float64(videoFile.Duration) {
		logger.Warnf("[generator] scene marker at %.2f seconds exceeds video duration of %.2f seconds, skipping", seconds, float64(videoFile.Duration))
		return
	}

	g := t.generator

	vrModeStr := ""
	if scene.VRMode != nil {
		vrModeStr = string(*scene.VRMode)
	}

	// The native pipeline is tried first for the assets it implements, and
	// declines any file or option it cannot reproduce exactly. Declining costs
	// a demux and nothing else, so the ffmpeg path below is reached no slower
	// than before.
	req := markerRequest{
		path:    videoFile.Path,
		seconds: seconds,
		vrMode:  vrModeStr,
		native:  native,
	}

	if t.VideoPreview {
		previewReq := req
		previewReq.output = g.MarkerPaths.GetVideoPreviewPath(sceneHash, int(seconds))
		previewReq.duration = generate.MarkerPreviewDuration(seconds, sceneMarker.EndSeconds)
		previewReq.width = generate.MarkerPreviewWidth
		previewReq.audio = instance.Config.GetPreviewAudio()

		if !t.markerPreviewVideo(ctx, previewReq) {
			if err := g.MarkerPreviewVideo(ctx, videoFile.Path, sceneHash, seconds, sceneMarker.EndSeconds, instance.Config.GetPreviewAudio(), vrModeStr); err != nil {
				logger.Errorf("[generator] failed to generate marker video: %v", err)
				logErrorOutput(err)
			}
		}
	}

	if t.ImagePreview {
		if err := g.SceneMarkerWebp(ctx, videoFile.Path, sceneHash, seconds, vrModeStr); err != nil {
			logger.Errorf("[generator] failed to generate marker image: %v", err)
			logErrorOutput(err)
		}
	}

	if t.Screenshot && !screenshotDone {
		shotReq := req
		shotReq.output = g.MarkerPaths.GetScreenshotPath(sceneHash, int(seconds))
		shotReq.width = videoFile.Width

		if !t.markerScreenshot(ctx, shotReq) {
			if err := g.SceneMarkerScreenshot(ctx, videoFile.Path, sceneHash, seconds, videoFile.Width, vrModeStr); err != nil {
				logger.Errorf("[generator] failed to generate marker screenshot: %v", err)
				logErrorOutput(err)
			}
		}
	}
}

func (t *GenerateMarkersTask) markersNeeded(ctx context.Context) int {
	markers := 0
	sceneMarkers, err := t.repository.SceneMarker.FindBySceneID(ctx, t.Scene.ID)
	if err != nil {
		logger.Errorf("error finding scene markers: %s", err.Error())
		return 0
	}

	if len(sceneMarkers) == 0 || t.Scene.Files.Primary() == nil {
		return 0
	}

	sceneHash := t.Scene.GetHash(t.fileNamingAlgorithm)
	for _, sceneMarker := range sceneMarkers {
		seconds := int(sceneMarker.Seconds)

		if t.Overwrite || !t.markerExists(sceneHash, seconds) {
			markers++
		}
	}

	return markers
}

func (t *GenerateMarkersTask) markerExists(sceneChecksum string, seconds int) bool {
	if sceneChecksum == "" {
		return false
	}

	videoExists := !t.VideoPreview || t.videoExists(sceneChecksum, seconds)
	imageExists := !t.ImagePreview || t.imageExists(sceneChecksum, seconds)
	screenshotExists := !t.Screenshot || t.screenshotExists(sceneChecksum, seconds)

	return videoExists && imageExists && screenshotExists
}

func (t *GenerateMarkersTask) videoExists(sceneChecksum string, seconds int) bool {
	if sceneChecksum == "" {
		return false
	}

	videoPath := instance.Paths.SceneMarkers.GetVideoPreviewPath(sceneChecksum, seconds)
	videoExists, _ := fsutil.FileExists(videoPath)

	return videoExists
}

func (t *GenerateMarkersTask) imageExists(sceneChecksum string, seconds int) bool {
	if sceneChecksum == "" {
		return false
	}

	imagePath := instance.Paths.SceneMarkers.GetWebpPreviewPath(sceneChecksum, seconds)
	imageExists, _ := fsutil.FileExists(imagePath)

	return imageExists
}

func (t *GenerateMarkersTask) screenshotExists(sceneChecksum string, seconds int) bool {
	if sceneChecksum == "" {
		return false
	}

	screenshotPath := instance.Paths.SceneMarkers.GetScreenshotPath(sceneChecksum, seconds)
	screenshotExists, _ := fsutil.FileExists(screenshotPath)

	return screenshotExists
}
