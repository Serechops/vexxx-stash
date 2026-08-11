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
	"github.com/stashapp/stash/pkg/nativegen"
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
	if !nativeMarkerGenerationEnabled() {
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
	width := req.width
	if req.vrMode != "" {
		width = nativegen.VRFlatWidth
	}

	frames, err := nativegen.Frames(ctx, nativegen.FrameOptions{
		Path:   req.path,
		Times:  []float64{req.seconds},
		Width:  width,
		VRMode: req.vrMode,
	})
	if err != nil {
		return err
	}
	if len(frames) != 1 || frames[0] == nil {
		return fmt.Errorf("no frame at %.2fs", req.seconds)
	}

	img := image.Image(frames[0])
	if img.Bounds().Dx() != req.width {
		img = imaging.Resize(img, req.width, 0, imaging.Lanczos)
	}

	return writeNativeFile(req.output, "native-marker-*.jpg", func(w io.Writer) error {
		return jpeg.Encode(w, img, &jpeg.Options{Quality: nativeMarkerScreenshotQuality})
	})
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
