package manager

import (
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"io"

	"github.com/disintegration/imaging"

	"github.com/stashapp/stash/pkg/fsutil"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/nativegen"
	"github.com/stashapp/stash/pkg/nativegen/container/mp4"
)

// A marker's assets are a twenty-second preview video, an animated webp, and a
// still. Two of the three have a native path here; the webp does not, because
// nothing in this tree can encode one and writing an encoder to save a fifth of
// a marker's generation time is not a trade worth making.
//
// Both native paths are off unless config.NativeMarkerGeneration is turned on,
// separately from the pipeline as a whole. ffmpeg is faster at this particular
// job and there is no reason to pretend otherwise; the native path is kept for
// the machines and builds where that does not hold.

// markerRequest describes one marker asset completely, so that a backend needs
// nothing from the task beyond it.
type markerRequest struct {
	path   string
	output string

	// seconds is where in the film the marker is.
	seconds float64

	// duration is how long the preview video runs for. The still ignores it.
	duration float64

	// width is the width the asset is written at.
	width int

	// vrMode names a projection that has to be flattened into a rectilinear
	// view before the asset is legible. Empty for flat footage.
	vrMode string

	// audio reports whether the preview video is meant to carry sound. The
	// still ignores it.
	audio bool

	// native is the scene-wide session this request belongs to, or nil for a
	// one-off request (regenerating a single marker). See nativeMarkerSession.
	native *nativeMarkerSession
}

// file returns the request's pre-opened demux, or nil when there isn't one —
// a one-off request, or a session that declined the file outright and so never
// reaches here (nativeMarkerWanted has already said no).
func (req markerRequest) file() *mp4.File {
	if req.native == nil {
		return nil
	}
	return req.native.file
}

// nativeMarkerSession is a video file opened once and shared across every
// marker cut from it in one generation run.
//
// A scene's markers are otherwise each their own call into nativegen, and each
// of those reopens and reparses the same sample tables from scratch — real
// work on a long film, and work repeated once per marker per asset kind. This
// does it once per scene instead: openNativeMarkerSession opens (or declines)
// the file up front, and every markerRequest for that scene carries the result
// through nativeMarkerWanted so a file this backend cannot handle is declined
// once, loudly, rather than once per marker, silently.
type nativeMarkerSession struct {
	file *mp4.File
}

// openNativeMarkerSession opens path for a scene's worth of marker generation.
//
// It returns nil when the native pipeline is not asked for at all, so a run
// with it off costs nothing here. When it is asked for but the file declines —
// a container this demuxer cannot read, most often — the session is still
// returned, holding no file, so that every marker's nativeMarkerWanted check
// sees the same decision instead of each independently reaching it and logging
// it.
func openNativeMarkerSession(ctx context.Context, path string) *nativeMarkerSession {
	if !nativeMarkerGenerationEnabled() {
		return nil
	}

	f, err := mp4.Open(path)
	if err != nil {
		if ctx.Err() == nil {
			logger.Infof("[generator] native marker generation declined %s, using ffmpeg: %v", path, err)
		}
		return &nativeMarkerSession{}
	}
	return &nativeMarkerSession{file: f}
}

// close releases the session's file, if it opened one. Safe on a nil session.
func (s *nativeMarkerSession) close() {
	if s != nil && s.file != nil {
		s.file.Close()
	}
}

const (
	// nativeMarkerQP is the constant quantiser a marker preview is encoded at.
	//
	// The ffmpeg path asks libx264 for CRF 24, three steps softer than a scene
	// preview's 21. The two scales are not the same control, but keeping the
	// same relationship between the two kinds of preview lands them at a
	// comparable size and look.
	nativeMarkerQP = 25

	// nativeMarkerScreenshotQuality is the JPEG quality a marker still is
	// written at. ffmpeg is asked for -q:v 2, the second best of its scale.
	nativeMarkerScreenshotQuality = 92
)

// markerPreviewVideo generates the marker's preview video, preferring the
// native pipeline when it is enabled and can take the file.
//
// It reports whether it produced the video. A false return is not a failure: it
// means the native path declined and the caller should run the ffmpeg one.
func (t *GenerateMarkersTask) markerPreviewVideo(ctx context.Context, req markerRequest) bool {
	if !t.nativeMarkerWanted(req) {
		return false
	}

	if err := generateNativeMarkerPreview(ctx, req); err != nil {
		return t.declined(ctx, "marker preview", req, err)
	}

	logger.Debugf("[generator] native (%s) produced a marker preview for %s at %.0fs",
		nativegen.Describe(), req.path, req.seconds)
	return true
}

// markerScreenshot generates the marker's still, on the same terms.
func (t *GenerateMarkersTask) markerScreenshot(ctx context.Context, req markerRequest) bool {
	if !t.nativeMarkerWanted(req) {
		return false
	}

	if err := generateNativeMarkerScreenshot(ctx, req); err != nil {
		return t.declined(ctx, "marker screenshot", req, err)
	}

	logger.Debugf("[generator] native (%s) produced a marker screenshot for %s at %.0fs",
		nativegen.Describe(), req.path, req.seconds)
	return true
}

// nativeMarkerWanted reports whether the native path should even be attempted.
//
// An asset that already exists is not one to decline loudly: the ffmpeg path
// makes the same check and does nothing, so returning false here costs the run
// nothing and keeps a re-generation of an untouched library silent.
func (t *GenerateMarkersTask) nativeMarkerWanted(req markerRequest) bool {
	if req.native != nil {
		// A scene-wide session already decided the pipeline is off or this file
		// declined; either way every marker in the scene answers the same way
		// without repeating the check or the log line.
		if req.native.file == nil {
			return false
		}
	} else if !nativeMarkerGenerationEnabled() {
		return false
	}
	if !t.generator.Overwrite {
		if exists, _ := fsutil.FileExists(req.output); exists {
			return false
		}
	}
	return true
}

// declined reports a native attempt that did not produce its asset, and always
// returns false so a caller can return it directly.
func (t *GenerateMarkersTask) declined(ctx context.Context, what string, req markerRequest, err error) bool {
	// A cancelled job is not a file the native path cannot handle, and the
	// ffmpeg path would only be cancelled too, more slowly.
	if ctx.Err() != nil {
		return false
	}
	logger.Infof("[generator] native %s generation declined %s at %.0fs, using ffmpeg: %v",
		what, req.path, req.seconds, err)
	return false
}

// generateNativeMarkerPreview cuts the marker's preview as a single-segment
// preview video, which is exactly what one is.
func generateNativeMarkerPreview(ctx context.Context, req markerRequest) error {
	if err := nativeMarkerSupported(req); err != nil {
		return err
	}
	if req.duration <= 0 {
		return fmt.Errorf("marker preview has no duration")
	}

	return writeNativeFile(req.output, "native-marker-*.mp4", func(w io.Writer) error {
		return nativegen.Preview(ctx, nativegen.PreviewOptions{
			Path:            req.path,
			File:            req.file(),
			Starts:          []float64{req.seconds},
			SegmentDuration: req.duration,
			Width:           req.width,
			VRMode:          req.vrMode,
			QP:              nativeMarkerQP,
			Audio:           req.audio,
		}, w)
	})
}

// generateNativeMarkerScreenshot decodes the frame shown at the marker and
// writes it as a JPEG.
func generateNativeMarkerScreenshot(ctx context.Context, req markerRequest) error {
	if err := nativeMarkerSupported(req); err != nil {
		return err
	}
	if req.width <= 0 {
		return fmt.Errorf("marker screenshot has no width")
	}

	// VR footage is flattened to the rectilinear view at its own natural size
	// and then scaled, rather than being reprojected straight to the width
	// asked for. A still is asked for at the source's full width — 8192 for an
	// 8K film — and the reprojection costs a sample position per output pixel,
	// so asking it for that directly would build an enormous table to render a
	// 1280x720 view into. The ffmpeg path renders the same view at the same
	// size and scales it up the same way.
	decodeWidth := req.width
	if req.vrMode != "" {
		decodeWidth = nativegen.VRFlatWidth
	}

	frames, err := nativegen.Frames(ctx, nativegen.FrameOptions{
		Path:   req.path,
		File:   req.file(),
		Times:  []float64{req.seconds},
		Width:  decodeWidth,
		VRMode: req.vrMode,
	})
	if err != nil {
		return err
	}
	if len(frames) != 1 || frames[0] == nil {
		return fmt.Errorf("no frame at %.2fs", req.seconds)
	}

	return writeMarkerScreenshotImage(req.output, frames[0], req.width)
}

// writeMarkerScreenshotImage scales a decoded frame to its final width, if the
// decoder did not already land on it exactly, and writes it as a JPEG. Shared
// between the single-marker path above and the scene-wide batch below, so the
// two produce identical files.
func writeMarkerScreenshotImage(output string, img image.Image, width int) error {
	if img.Bounds().Dx() != width {
		img = imaging.Resize(img, width, 0, imaging.Lanczos)
	}

	return writeNativeFile(output, "native-marker-*.jpg", func(w io.Writer) error {
		return jpeg.Encode(w, img, &jpeg.Options{Quality: nativeMarkerScreenshotQuality})
	})
}

// generateNativeMarkerScreenshots decodes every wanted screenshot in a scene
// with one nativegen.Frames call instead of one call per marker.
//
// This needed nothing new in pkg/nativegen: FrameOptions.Times already takes
// a batch of times, and decodeExact already shares the run-up between wanted
// frames that fall inside the same group of pictures rather than decoding it
// once per frame. Calling Frames once per marker, as the per-marker path
// still does for a single request, was leaving that on the table — for
// markers scattered through a long film, it also collapses what used to be
// one decoder stood up per marker into one for the whole scene.
//
// It returns the marker IDs whose screenshot it wrote. Everything not in that
// set — no screenshot wanted, already up to date, past the video's duration,
// or caught in a batch that failed outright — is left for the caller, which
// already runs the ordinary per-marker path (native attempt, then ffmpeg) for
// any marker this function did not handle. That is what keeps a batch failure
// safe rather than merely fast when it works: nativegen.Frames fails all its
// requested times together, the same all-or-nothing trade Preview and Sprite
// already make for their own callers, just drawn at scene width here instead
// of one asset. When it fires, every marker in the scene falls through to
// being decoded — and, if that also fails, generated by ffmpeg — on its own,
// exactly as if this function had never run.
func (t *GenerateMarkersTask) generateNativeMarkerScreenshots(ctx context.Context, videoFile *models.VideoFile, scene *models.Scene, sceneMarkers []*models.SceneMarker, sceneHash string, native *nativeMarkerSession) map[int]bool {
	done := make(map[int]bool)
	if native == nil || native.file == nil {
		return done
	}

	vrModeStr := ""
	if scene.VRMode != nil {
		vrModeStr = string(*scene.VRMode)
	}
	if err := nativeMarkerSupported(markerRequest{vrMode: vrModeStr}); err != nil {
		return done
	}
	width := videoFile.Width
	if width <= 0 {
		return done
	}

	type screenshotJob struct {
		markerID int
		seconds  float64
		output   string
	}
	var jobs []screenshotJob
	for _, m := range sceneMarkers {
		seconds := float64(m.Seconds)
		if seconds > float64(videoFile.Duration) {
			// generateMarker warns about this case itself when it reaches the
			// same marker; nothing to add by saying it again here.
			continue
		}
		output := t.generator.MarkerPaths.GetScreenshotPath(sceneHash, int(seconds))
		if !t.generator.Overwrite {
			if exists, _ := fsutil.FileExists(output); exists {
				continue
			}
		}
		jobs = append(jobs, screenshotJob{markerID: m.ID, seconds: seconds, output: output})
	}
	if len(jobs) == 0 {
		return done
	}

	decodeWidth := width
	if vrModeStr != "" {
		decodeWidth = nativegen.VRFlatWidth
	}

	times := make([]float64, len(jobs))
	for i, j := range jobs {
		times[i] = j.seconds
	}

	frames, err := nativegen.Frames(ctx, nativegen.FrameOptions{
		Path:   videoFile.Path,
		File:   native.file,
		Times:  times,
		Width:  decodeWidth,
		VRMode: vrModeStr,
	})
	if err != nil {
		if ctx.Err() == nil {
			logger.Infof("[generator] native marker screenshot batch declined %s (%d markers), falling back per marker: %v",
				videoFile.Path, len(jobs), err)
		}
		return done
	}

	for i, j := range jobs {
		if frames[i] == nil {
			continue
		}
		if err := writeMarkerScreenshotImage(j.output, frames[i], width); err != nil {
			logger.Infof("[generator] writing native marker screenshot for %s at %.0fs: %v", videoFile.Path, j.seconds, err)
			continue
		}
		done[j.markerID] = true
	}

	logger.Debugf("[generator] native (%s) produced %d/%d marker screenshots for %s in one pass",
		nativegen.Describe(), len(done), len(jobs), videoFile.Path)

	return done
}

// nativeMarkerSupported rejects the marker assets the native path cannot
// reproduce faithfully.
func nativeMarkerSupported(req markerRequest) error {
	// A still or a preview rendered with the wrong projection is not obviously
	// wrong, it just shows the wrong part of the scene, so an unknown mode has
	// to go back to ffmpeg rather than be flattened as best it can.
	if req.vrMode != "" && !nativegen.IsVRProjection(req.vrMode) {
		return fmt.Errorf("no native reprojection for VR mode %q", req.vrMode)
	}
	return nil
}
