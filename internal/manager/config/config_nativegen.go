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
	// is a separate switch, and still off by default even when the pipeline is
	// on, though not for the reason it used to be.
	//
	// It used to lose outright: measured on a 5400x2700 HEVC film, ffmpeg took
	// 6.0s to native's 13.7s for the preview, and 1.4s to native's 1.17s for the
	// still (after the disposable-picture skip fixed that half). The obvious
	// read of those numbers — decode and encode are just slower on this path for
	// a single twenty-second segment, which can use neither of the two things
	// the native path otherwise wins with (spreading segments across both media
	// engines, snapping a segment onto the nearest keyframe) — was wrong. Almost
	// none of the gap was decode or encode work. It was session setup: every
	// marker reopened and reparsed the file from scratch and stood up a fresh
	// AMF encoder context from scratch, both fixed costs paid once per marker
	// instead of once per scene. Amortising them across a scene's markers
	// (nativeMarkerSession in internal/manager, and the encodeDevices pool
	// mirroring decode's) turned the comparison around: a 75-marker scene, both
	// preview and still, ran at ~2.7s/marker native against ffmpeg's own ~7.4s/
	// marker on the same numbers above — roughly 2.7x faster, not slower.
	//
	// The default stays off anyway, for now: that is one scene on one machine,
	// and every other switch here earned its default from measurements across
	// more than that. Flip it once markers of different codecs, resolutions and
	// VR modes have borne out the same result.
	NativeMarkerGeneration        = "nativegen.markers"
	nativeMarkerGenerationDefault = false

	// NativePhashGeneration selects which backend computes perceptual hashes. It
	// is a separate switch, and the one that defaults on, because a phash is the
	// only generated asset whose correctness can be stated exactly rather than
	// judged: both backends decode the same twenty-five frames and scale them
	// with the same swscale, and the resulting hashes have been verified equal to
	// the bit on every file tried. There is nothing to prefer ffmpeg for except
	// time, and the native path takes 16.5s where ffmpeg takes 38.1s on a
	// 7680x3840 file.
	//
	// It exists anyway because a phash is a fingerprint shared with stash-box and
	// with other people's libraries, which makes it the asset a user is most
	// entitled to be conservative about: a wrong sprite is visibly wrong and
	// regenerated in seconds, where a wrong phash is invisible and propagates.
	// Turning this off pins hashing to the path every existing library was built
	// with.
	//
	// Note that "native" here does not mean ffmpeg-free: the native phash decodes
	// on the GPU but pipes the frames through ffmpeg for scaling, precisely so the
	// pixels are the ones the ffmpeg path would have produced.
	NativePhashGeneration        = "nativegen.phash"
	nativePhashGenerationDefault = true
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

// GetNativePhashGeneration reports whether phashes have been left with the
// native pipeline.
//
// Like markers this is the setting as stored and not the decision — phashing is
// subordinate to GetNativeGeneration too, so turning the pipeline off returns
// hashing to ffmpeg along with everything else.
func (i *Config) GetNativePhashGeneration() bool {
	return i.getBoolDefault(NativePhashGeneration, nativePhashGenerationDefault)
}
