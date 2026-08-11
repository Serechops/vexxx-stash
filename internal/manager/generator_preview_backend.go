package manager

import (
	"context"
	"fmt"
	"io"

	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/nativegen"
	"github.com/stashapp/stash/pkg/scene/generate"
)

// previewRequest describes one preview video completely.
type previewRequest struct {
	path   string
	output string

	// starts are the times each segment begins at, worked out here rather than
	// by a backend so that both cut at the same places.
	starts   []float64
	duration float64

	width  int
	vrMode string

	// audio reports whether the preview is meant to carry sound.
	audio bool

	// single marks a video short enough that its preview is one continuous cut
	// rather than segments joined together.
	single bool
}

// nativePreviewQP is the constant quantiser the native encoder uses.
//
// The ffmpeg path asks libx264 for CRF 21. The two scales are not the same
// control and do not convert exactly, but they are both "constant quality" and
// this lands a preview at a comparable size and look.
const nativePreviewQP = 22

// previewVideo generates the preview, preferring the native pipeline when it is
// enabled and can take the file.
//
// It reports whether it produced the preview. A false return is not a failure:
// it means the native path declined and the caller should run the ffmpeg one.
func (t *GeneratePreviewTask) previewVideo(ctx context.Context, req previewRequest) bool {
	if !nativeGenerationEnabled() {
		return false
	}

	if err := generateNativePreview(ctx, req); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return false
		}
		// Declining is designed behaviour, not an incident.
		logger.Infof("[generator] native preview generation declined %s, using ffmpeg: %v", req.path, err)
		return false
	}

	logger.Debugf("[generator] native (%s) produced a preview for %s", nativegen.Describe(), req.path)
	return true
}

// generateNativePreview writes the preview through a temporary file, so that a
// failure part-way through cannot leave a half-written preview where a complete
// one is expected.
func generateNativePreview(ctx context.Context, req previewRequest) error {
	if req.vrMode != "" && !nativegen.IsVRProjection(req.vrMode) {
		return fmt.Errorf("no native reprojection for VR mode %q", req.vrMode)
	}
	// A video shorter than the segments asked of it gets one continuous preview
	// covering the whole thing, which is a different shape from the segmented
	// one this backend builds.
	if req.single {
		return fmt.Errorf("video is short enough to preview in a single segment")
	}

	return writeNativeFile(req.output, "native-preview-*.mp4", func(w io.Writer) error {
		return nativegen.Preview(ctx, nativegen.PreviewOptions{
			Path:            req.path,
			Starts:          req.starts,
			SegmentDuration: req.duration,
			Width:           req.width,
			VRMode:          req.vrMode,
			QP:              nativePreviewQP,
			Audio:           req.audio,
			// A scene preview samples a film at a dozen arbitrary points, and
			// which second each sample begins on carries no meaning — so each is
			// allowed onto the keyframe nearest it, which is the difference
			// between decoding the segments and decoding every group of pictures
			// they land in. A marker's preview is not allowed this: it has to
			// begin at the marker.
			SnapToKeyframes: true,
		}, w)
	})
}

// previewSegmentStarts works out where each segment begins, reproducing the
// arithmetic in pkg/scene/generate so that the two backends cut a preview at
// exactly the same places.
func previewSegmentStarts(opts generate.PreviewOptions, videoDuration float64) []float64 {
	stepSize, offset := generate.PreviewStepSizeAndOffset(opts, videoDuration)

	starts := make([]float64, opts.Segments)
	for i := range starts {
		starts[i] = offset + float64(i)*stepSize
	}
	return starts
}
