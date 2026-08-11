package generate

// This file exposes the preview path's own arithmetic so that an alternative
// backend can reproduce it exactly.
//
// The two backends have to agree on where a preview is cut, not merely produce
// previews of the same length: the whole point of the fallback is that either
// can generate any given scene and the result is the same artefact. Rather than
// copy the calculations somewhere else, where they could drift, they are shared
// from here.

// PreviewWidth is the width every preview is scaled to.
const PreviewWidth = scenePreviewWidth

// PreviewStepSizeAndOffset returns the spacing between segment start times and
// the time the first one begins at.
func PreviewStepSizeAndOffset(o PreviewOptions, videoDuration float64) (stepSize, offset float64) {
	return o.getStepSizeAndOffset(videoDuration)
}

// PreviewSegmentDuration returns how long each segment runs for, applying the
// same floor the ffmpeg path does — a segment shorter than this can produce a
// file with no video stream at all.
func PreviewSegmentDuration(o PreviewOptions) float64 {
	if o.SegmentDuration < minSegmentDuration {
		return minSegmentDuration
	}
	return o.SegmentDuration
}

// PreviewIsSingleSegment reports whether the preview would be generated as one
// continuous cut rather than as segments joined together, which is what happens
// for a video shorter than the segments asked of it.
func PreviewIsSingleSegment(o PreviewOptions, videoDuration float64) bool {
	return videoDuration < o.SegmentDuration*float64(o.Segments)
}
