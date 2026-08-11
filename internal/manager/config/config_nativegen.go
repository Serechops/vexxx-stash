package config

// Configuration for the native (ffmpeg-free) generation pipeline in
// pkg/nativegen. Kept in its own file rather than added to config.go so the
// upstream file stays untouched and merges cleanly.

const (
	// NativeGeneration selects the native pipeline for the generators that
	// implement one. It defaults to off: the native path is the newer of the
	// two, and the ffmpeg path is what every existing library was built with.
	NativeGeneration        = "nativegen.enabled"
	nativeGenerationDefault = false

	// NativeMarkerGeneration extends the native pipeline to scene markers. It
	// is a separate switch, and off even when the pipeline is on, because it is
	// the one job the native path measurably loses: a marker is a single
	// twenty-second segment from a fixed point, which can use neither of the two
	// things the native path wins with — spreading segments across both media
	// engines, and moving a segment onto the keyframe nearest it. Measured on a
	// 5400x2700 HEVC film, ffmpeg takes 6.0s to native's 13.7s for the preview
	// and 1.4s to 2.2s for the still.
	//
	// It remains available because that comparison is this machine's, not every
	// machine's, and because it is the only way to generate markers on a build
	// without ffmpeg.
	NativeMarkerGeneration        = "nativegen.markers"
	nativeMarkerGenerationDefault = false
)

// GetNativeGeneration reports whether generators should try the native pipeline
// before falling back to ffmpeg.
//
// This is a preference, not a guarantee. A generator that cannot use the native
// path for a given file — no supported GPU, an unsupported container, a rotated
// track — falls back silently and logs the reason, so turning this on can never
// leave a scene without its sprite.
func (i *Config) GetNativeGeneration() bool {
	return i.getBoolDefault(NativeGeneration, nativeGenerationDefault)
}

// GetNativeMarkerGeneration reports whether marker assets have been opted in to
// the native pipeline.
//
// This is the setting as stored, not the decision. Markers are also subordinate
// to GetNativeGeneration — turning the pipeline off turns them off with it — and
// the two are combined where the decision is made, so that turning the pipeline
// off and on again does not lose what markers were set to.
func (i *Config) GetNativeMarkerGeneration() bool {
	return i.getBoolDefault(NativeMarkerGeneration, nativeMarkerGenerationDefault)
}
