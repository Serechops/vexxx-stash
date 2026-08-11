package nativegen

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stashapp/stash/pkg/nativegen/container/mp4"
)

// Every measurement in this package so far has been of one file at a time, and a
// Generate run is not one file at a time: it starts parallel_tasks jobs at once.
// That gap matters more here than it would for an ffmpeg path, because the
// resource being shared is one GPU with two fixed-function decode engines rather
// than a machine's worth of cores — and because the device set deliberately does
// not cap how many decode sessions exist, so the third concurrent job and the
// thirtieth are both allowed to open their own.
//
// So this measures the scaling curve directly, over distinct real files, the way
// a Generate run would.
//
// Two things make the numbers trustworthy that would otherwise wreck them:
//
//   - Files differ enormously in size, so a level's wall time cannot be compared
//     against level one's. Each file is therefore timed alone first, and a
//     level's speedup is the sum of its own files' solo times over its wall time.
//     Perfect parallelism is N, complete serialisation is 1.0.
//
//   - Decode is not the only shared resource. Eighty-one keyframes out of a 15 GB
//     8K file is a lot of scattered reading, and a disk ceiling would look
//     exactly like a GPU ceiling. Each level therefore runs twice, once reading
//     the samples without decoding them, so the two curves can be told apart.
//
//     STASH_NATIVEGEN_TEST_FILES="E:\API Hub\*.mp4" \
//     go test ./pkg/nativegen/ -run ConcurrencyScaling -v -count=1 -timeout 60m
//
// -count=1 is not optional: Go caches real-file results and will serve a
// previous run's timings as live ones.
func TestConcurrencyScalingRealFiles(t *testing.T) {
	if !Available() {
		t.Skip("no native hardware backend on this machine")
	}
	files := concurrencyTestFiles(t)

	// Past 8 is beyond what parallel_tasks would ever auto-detect to, and is here
	// to find the cliff rather than to describe normal use: sixteen concurrent 8K
	// decode sessions is also a test of whether the driver runs out of surfaces,
	// and a failure there is worth knowing about even if nobody configures it.
	levels := []int{1, 2, 3, 4, 6, 8, 12, 16}
	maxLevel := levels[len(levels)-1]
	if len(files) < maxLevel {
		t.Skipf("need %d files to measure up to %d-way concurrency, have %d", maxLevel, maxLevel, len(files))
	}
	files = files[:maxLevel]

	t.Logf("backend: %s, device set holds %d", Describe(), decodeDeviceCount)
	for i, p := range files {
		t.Logf("  file %d  %s", i, filepath.Base(p))
	}

	const (
		tiles = 81
		width = 160
	)

	// One sheet, and the bytes it had to read to make one. Both phases go through
	// the same sample list so the read-only phase reads exactly what the decoding
	// phase reads.
	sheet := func(path string, decode bool) (int64, error) {
		f, err := mp4.Open(path)
		if err != nil {
			return 0, err
		}
		defer f.Close()

		if decode {
			// The production entry point, so this measures the real generator and
			// not a reimplementation of it.
			_, err := Sprite(context.Background(), SpriteOptions{
				Path: path, Count: tiles, Width: width,
			})
			return 0, err
		}

		track := f.Video()
		if track == nil {
			return 0, fmt.Errorf("no video track")
		}
		times, err := tileTimes(track, SpriteOptions{Path: path, Count: tiles, Width: width})
		if err != nil {
			return 0, err
		}
		var read int64
		for _, s := range track.KeyframesAt(times) {
			if s < 0 {
				continue
			}
			data, err := f.SampleAnnexB(s)
			if err != nil {
				return read, err
			}
			read += int64(len(data))
		}
		return read, nil
	}

	// Warm up with a full sheet of each file, not just a read of it. The first
	// version of this warmed only the file cache and the baselines came out
	// systematically slow — n=1 reported a 1.15x speedup over itself, which is
	// impossible and was the tell. A first decode in a process pays for AMF
	// initialisation and runs while the GPU is still at idle clocks, so whichever
	// file is measured first carries a cost none of the others do, and it is the
	// low concurrency levels that are made to look good by it.
	for _, p := range files {
		if _, err := sheet(p, true); err != nil {
			t.Fatalf("warming %s: %v", filepath.Base(p), err)
		}
	}

	// Phase per file, alone. This is the denominator everything else is measured
	// against, so it is what the concurrent runs are being compared to and has to
	// be measured the same way.
	type solo struct {
		decode time.Duration
		read   time.Duration
		bytes  int64
	}
	solos := make([]solo, len(files))
	for i, p := range files {
		// Best of soloRepeats rather than one measurement. These are second-long
		// operations on a machine that is also a desktop, so the fastest run is the
		// one least polluted by whatever else wanted the GPU.
		const soloRepeats = 3
		for r := 0; r < soloRepeats; r++ {
			start := time.Now()
			n, err := sheet(p, false)
			if err != nil {
				t.Fatalf("solo read %s: %v", filepath.Base(p), err)
			}
			if d := time.Since(start); r == 0 || d < solos[i].read {
				solos[i].read = d
			}
			solos[i].bytes = n

			start = time.Now()
			if _, err := sheet(p, true); err != nil {
				t.Fatalf("solo sheet %s: %v", filepath.Base(p), err)
			}
			if d := time.Since(start); r == 0 || d < solos[i].decode {
				solos[i].decode = d
			}
		}

		t.Logf("solo  file %d  read %6v (%4d MB)  sheet %6v",
			i, solos[i].read.Round(time.Millisecond), solos[i].bytes/(1<<20),
			solos[i].decode.Round(time.Millisecond))
	}

	// A level: run the first n files at once and report how the wall time compares
	// against those same n files run one after another.
	run := func(n int, decode bool) (wall, serial time.Duration, errs []error) {
		for i := 0; i < n; i++ {
			if decode {
				serial += solos[i].decode
			} else {
				serial += solos[i].read
			}
		}

		errs = make([]error, n)
		var wg sync.WaitGroup
		// Started together rather than as they are spawned, so a slow goroutine
		// launch does not stagger the very thing being measured.
		gate := make(chan struct{})
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-gate
				_, errs[i] = sheet(files[i], decode)
			}(i)
		}
		start := time.Now()
		close(gate)
		wg.Wait()
		return time.Since(start), serial, errs
	}

	type result struct {
		n             int
		readSpeedup   float64
		decodeSpeedup float64
		decodeWall    time.Duration
		failures      int
		firstFailure  error
	}
	var results []result

	for _, n := range levels {
		readWall, readSerial, readErrs := run(n, false)
		decodeWall, decodeSerial, decodeErrs := run(n, true)

		r := result{
			n:             n,
			readSpeedup:   readSerial.Seconds() / readWall.Seconds(),
			decodeSpeedup: decodeSerial.Seconds() / decodeWall.Seconds(),
			decodeWall:    decodeWall,
		}
		for _, err := range append(readErrs, decodeErrs...) {
			if err != nil {
				r.failures++
				if r.firstFailure == nil {
					r.firstFailure = err
				}
			}
		}
		results = append(results, r)

		t.Logf("n=%-2d  read %5.2fx of serial   decode %5.2fx of serial   wall %7v   %d failures",
			n, r.readSpeedup, r.decodeSpeedup, decodeWall.Round(time.Millisecond), r.failures)
		if r.firstFailure != nil {
			t.Errorf("n=%d: %d of %d jobs failed, first: %v", n, r.failures, 2*n, r.firstFailure)
		}

		// One job at a time is the baseline by definition, so this level must come
		// out at 1.00x. It policing itself is what makes the rest of the column
		// worth reading: when it drifted to 1.15x the baseline was measuring
		// process warm-up, and every speedup above was inflated by it.
		if n == 1 && (r.decodeSpeedup < 0.93 || r.decodeSpeedup > 1.07) {
			t.Errorf("n=1 decoded at %.2fx of its own baseline, want 1.00x — the baseline is not measuring the same thing as the concurrent run, so no figure below is trustworthy",
				r.decodeSpeedup)
		}
	}

	// The summary is the point of the test: where the decode curve stops climbing
	// is where a cap would have to sit, and whether the read curve is still
	// climbing there is what says the ceiling is the GPU and not the disk.
	t.Log("")
	t.Log("  n   decode speedup   read speedup   marginal decode gain")
	best, bestN := 0.0, 0
	for i, r := range results {
		marginal := r.decodeSpeedup
		if i > 0 {
			marginal = r.decodeSpeedup - results[i-1].decodeSpeedup
		}
		t.Logf(" %2d        %5.2fx         %5.2fx           %+5.2f", r.n, r.decodeSpeedup, r.readSpeedup, marginal)
		if r.decodeSpeedup > best {
			best, bestN = r.decodeSpeedup, r.n
		}
	}
	t.Logf("best decode throughput at n=%d (%.2fx serial)", bestN, best)

	// Concurrency that makes the work slower than doing it one file at a time is
	// the failure this test exists to catch: it means a Generate run is worse for
	// having been parallelised, which no amount of per-file speed makes up for.
	for _, r := range results {
		if r.decodeSpeedup < 0.95 {
			t.Errorf("n=%d decoded at %.2fx of serial — %d concurrent jobs are slower than running them one at a time",
				r.n, r.decodeSpeedup, r.n)
		}
	}
}

// concurrencyTestFiles resolves the file list, largest first, so that the
// concurrency levels are measured on the files where decode dominates.
func concurrencyTestFiles(t *testing.T) []string {
	t.Helper()

	spec := os.Getenv("STASH_NATIVEGEN_TEST_FILES")
	if spec == "" {
		t.Skip("set STASH_NATIVEGEN_TEST_FILES to a ;-separated list of files or globs")
	}

	var paths []string
	for _, part := range strings.Split(spec, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		matches, err := filepath.Glob(part)
		if err != nil {
			t.Fatalf("bad pattern %q: %v", part, err)
		}
		if len(matches) == 0 {
			if _, err := os.Stat(part); err == nil {
				matches = []string{part}
			}
		}
		paths = append(paths, matches...)
	}

	type sized struct {
		path string
		size int64
	}
	var sizes []sized
	for _, p := range paths {
		info, err := os.Stat(p)
		if err != nil || info.IsDir() {
			continue
		}
		sizes = append(sizes, sized{p, info.Size()})
	}
	sort.Slice(sizes, func(a, b int) bool { return sizes[a].size > sizes[b].size })

	out := make([]string, 0, len(sizes))
	for _, s := range sizes {
		out = append(out, s.path)
	}
	return out
}
