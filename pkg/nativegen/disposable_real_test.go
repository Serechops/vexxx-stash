package nativegen

import (
	"path/filepath"
	"testing"

	"github.com/stashapp/stash/pkg/nativegen/container/mp4"
)

// How much a disposable-frame skip is worth is a property of how the library was
// encoded, not of this code, so it is measured before it is relied on. This walks
// exactly the samples a phash walk would submit — the same run-up from each
// target's preceding keyframe — and counts how many of them nothing is predicted
// from.
//
//	STASH_NATIVEGEN_TEST_FILES="E:\API Hub\*.mp4" \
//	  go test ./pkg/nativegen/ -run DisposableShare -v -count=1 -timeout 30m
func TestDisposableShareRealFiles(t *testing.T) {
	files := concurrencyTestFiles(t)
	if len(files) == 0 {
		t.Skip("no files matched")
	}
	if len(files) > 12 {
		files = files[:12]
	}

	var totalRunUp, totalDisposable int
	classified := 0

	t.Logf("%-46s %6s %8s %9s %7s", "file", "codec", "run-up", "disposable", "share")
	for _, path := range files {
		f, err := mp4.Open(path)
		if err != nil {
			t.Logf("%-46s open failed: %v", trunc(filepath.Base(path), 46), err)
			continue
		}
		track := f.Video()
		if track == nil {
			f.Close()
			continue
		}

		test := newDisposableTest(track, f.SampleAnnexB)
		if test == nil {
			t.Logf("%-46s %6s   no disposability test for this stream",
				trunc(filepath.Base(path), 46), track.Codec)
			f.Close()
			continue
		}

		wanted, err := samplesAt(track, PhashTimes(track.DurationSeconds()))
		if err != nil {
			t.Logf("%-46s samplesAt: %v", trunc(filepath.Base(path), 46), err)
			f.Close()
			continue
		}

		// The same continuation rule feedExactFrames uses, so this counts the walk
		// that actually happens rather than 25 independent GOP walks.
		runUp, disposable := 0, 0
		high := -1
		for _, wf := range wanted {
			start := syncBefore(track, wf.sample)
			if high+1 > start {
				start = high + 1
			}
			for i := start; i <= wf.sample; i++ {
				high = i
				// The target itself is never a candidate: it is the frame being
				// walked to.
				if i == wf.sample {
					continue
				}
				runUp++
				data, err := f.SampleAnnexB(i)
				if err != nil {
					break
				}
				if test(data) {
					disposable++
				}
			}
		}
		f.Close()

		share := 0.0
		if runUp > 0 {
			share = 100 * float64(disposable) / float64(runUp)
		}
		t.Logf("%-46s %6s %8d %9d %6.1f%%",
			trunc(filepath.Base(path), 46), track.Codec, runUp, disposable, share)

		totalRunUp += runUp
		totalDisposable += disposable
		classified++
	}

	if classified == 0 {
		t.Skip("no file could be classified")
	}
	share := 100 * float64(totalDisposable) / float64(totalRunUp)
	t.Logf("")
	t.Logf("%d files: %d run-up frames, %d disposable (%.1f%%) — an upper bound on what skipping them saves",
		classified, totalRunUp, totalDisposable, share)
}

func trunc(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}
