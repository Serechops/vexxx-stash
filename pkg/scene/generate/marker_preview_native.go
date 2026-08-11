package generate

// This file exposes the marker path's own dimensions and arithmetic so that an
// alternative backend can reproduce them exactly, for the same reason
// preview_native.go does: either backend must be able to generate any given
// marker and produce the same artefact, so the numbers are shared rather than
// copied.

// MarkerPreviewWidth is the width a marker's preview video is scaled to.
const MarkerPreviewWidth = markerPreviewWidth

// MarkerPreviewDuration returns how long the preview at a marker runs for.
//
// It is a fixed twenty seconds, cut short only by a marker whose own end comes
// sooner.
func MarkerPreviewDuration(seconds float64, endSeconds *float64) float64 {
	if endSeconds != nil && *endSeconds-seconds < maxMarkerPreviewDuration {
		return *endSeconds - seconds
	}
	return maxMarkerPreviewDuration
}
