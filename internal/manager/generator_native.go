package manager

import (
	"io"
	"os"
	"path/filepath"

	"github.com/stashapp/stash/pkg/fsutil"
	"github.com/stashapp/stash/pkg/nativegen"
)

// Shared plumbing for the generators that can run through pkg/nativegen instead
// of ffmpeg. Each of them keeps its own backend file; what lives here is what
// they all need and must agree on.

// nativeGenerationEnabled reports whether the native pipeline should be tried
// before ffmpeg.
//
// It has to be both turned on and usable on this machine, and a caller has no
// reason to tell those apart: either way the ffmpeg path is what runs.
func nativeGenerationEnabled() bool {
	if instance == nil || instance.Config == nil || !instance.Config.GetNativeGeneration() {
		return false
	}
	return nativegen.Available()
}

// nativeGenerationBackend names the backend the native pipeline would use on
// this machine, and is empty when there is none.
//
// This is reported whether or not the pipeline is turned on, because it answers
// a question asked before turning it on: whether doing so would change anything.
func nativeGenerationBackend() string {
	if !nativegen.Available() {
		return ""
	}
	return nativegen.Describe()
}

// nativeMarkerGenerationEnabled reports the same for marker assets, which carry
// their own switch and stay on ffmpeg by default.
//
// Markers are the one generator ffmpeg is still faster at, so the pipeline being
// on is not enough to claim them; see config.NativeMarkerGeneration for the
// measurements behind that.
func nativeMarkerGenerationEnabled() bool {
	if !nativeGenerationEnabled() {
		return false
	}
	return instance.Config.GetNativeMarkerGeneration()
}

// NativePhashEnabled reports whether phashes should be computed by the native
// pipeline rather than by ffmpeg.
//
// Exported, unlike its siblings, because phashing is asked for from two places:
// the generate task here, and the single-file GeneratePhash mutation in package
// api. Both have to answer this the same way, so there is one answer rather than
// a duplicated pair of conditions.
//
// Note the two conditions are deliberately not equivalent to what pkg/videophash
// checks. This is whether the native path is wanted; whether it can be used on a
// given file — codec, container, colour tags — is that package's decision, and it
// falls back to ffmpeg silently when the answer is no.
func NativePhashEnabled() bool {
	if !nativeGenerationEnabled() {
		return false
	}
	return instance.Config.GetNativePhashGeneration()
}

// writeNativeFile writes a generated asset through a temporary file in the same
// directory, then moves it into place.
//
// A generator's output is looked for by name, and the name existing is taken to
// mean the asset is complete — nothing re-checks it. So a failure part-way
// through must not leave a partial file where a whole one is expected, and a
// reader must never see one being written. Renaming within a directory is
// atomic on every filesystem stash runs on, which gives both.
func writeNativeFile(output, pattern string, write func(io.Writer) error) error {
	if err := fsutil.EnsureDirAll(filepath.Dir(output)); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(filepath.Dir(output), pattern)
	if err != nil {
		return err
	}
	tmpName := tmp.Name()

	done := false
	defer func() {
		tmp.Close()
		if !done {
			_ = os.Remove(tmpName)
		}
	}()

	if err := write(tmp); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, output); err != nil {
		return err
	}

	done = true
	return nil
}
