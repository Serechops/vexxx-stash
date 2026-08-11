package nativegen

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// The pool's contract is that two callers wanting one decoder each get different
// devices, and therefore different video engines. This asserts the mechanism
// directly, since the timing test below can only observe its effect.
//
//	go test ./pkg/nativegen/ -run DeviceSetHandsOutDistinct -v
func TestDeviceSetHandsOutDistinctDevices(t *testing.T) {
	if !Available() {
		t.Skip("no native hardware backend on this machine")
	}

	first, releaseFirst := decodeDevices.acquire(1)
	if releaseFirst == nil {
		t.Fatal("acquire(1) on an idle set returned nothing")
	}

	second, releaseSecond := decodeDevices.acquire(1)
	if releaseSecond == nil {
		t.Fatal("acquire(1) while one device is held returned nothing, so the set is handing out one token for the whole pool")
	}
	if first[0] == second[0] {
		t.Fatal("two concurrent callers were given the same device, which puts both decoders on one engine")
	}

	// With the set empty, a caller must be told so rather than handed a device
	// somebody is already decoding on.
	if devs, release := decodeDevices.acquire(1); release != nil {
		t.Errorf("acquire(1) on an exhausted set returned %d devices, want none", len(devs))
		release()
	}

	// And a split caller must get what is left rather than nothing, since half a
	// set still pins half the work.
	releaseSecond()
	devs, release := decodeDevices.acquire(decodeDeviceCount)
	if release == nil {
		t.Fatal("acquire of the whole set with one device free returned nothing")
	}
	if len(devs) != 1 {
		t.Errorf("acquire(%d) with one device free returned %d, want 1", decodeDeviceCount, len(devs))
	}
	release()

	// Releasing twice must not fill the channel and wedge the caller on its own
	// defer, which is what the release closure's sync.Once is there for.
	release()

	releaseFirst()

	if devs, release := decodeDevices.acquire(decodeDeviceCount); release == nil {
		t.Error("the set was not whole again after everything was released")
	} else {
		if len(devs) != decodeDeviceCount {
			t.Errorf("got %d devices back, want %d", len(devs), decodeDeviceCount)
		}
		release()
	}
}

// Two sprite sheets generating at once should take about as long as one, because
// each takes a device from the pool and the two devices sit on different engines.
// Before the sprite path went through the pool this was a coin flip: both
// decoders landed on the same engine roughly half the time and the pair took
// twice as long as one.
//
//	STASH_NATIVEGEN_TEST_MP4="vr.mp4" go test ./pkg/nativegen/ -run ConcurrentSprites -v -count=1 -timeout 30m
//
// -count=1 matters. Go caches real-file test results and will serve a previous
// run's timings as though they were live.
func TestConcurrentSpritesShareEnginesRealFile(t *testing.T) {
	path := os.Getenv("STASH_NATIVEGEN_TEST_MP4")
	if path == "" {
		t.Skip("set STASH_NATIVEGEN_TEST_MP4 to a video file")
	}
	if !Available() {
		t.Skip("no native hardware backend on this machine")
	}

	const count = 81
	opts := SpriteOptions{Path: path, Count: count, Width: 160}

	sheet := func() error {
		_, err := Sprite(context.Background(), opts)
		return err
	}

	// Twice, and the second is the baseline: the first pass warms the file cache,
	// so that what the concurrent pair is compared against is decode and not disk.
	for i := 0; i < 2; i++ {
		if err := sheet(); err != nil {
			t.Fatalf("warm-up sheet %d: %v", i, err)
		}
	}
	start := time.Now()
	if err := sheet(); err != nil {
		t.Fatalf("baseline sheet: %v", err)
	}
	alone := time.Since(start)
	t.Logf("%s: one sheet %v", filepath.Base(path), alone.Round(time.Millisecond))

	var wg sync.WaitGroup
	errs := make([]error, decodeDeviceCount)
	start = time.Now()
	for i := range errs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs[i] = sheet()
		}()
	}
	wg.Wait()
	together := time.Since(start)

	for i, err := range errs {
		if err != nil {
			t.Fatalf("concurrent sheet %d: %v", i, err)
		}
	}

	// Two engines cannot make two sheets free, so the figure to watch is how far
	// short of 2.00x this is. Serialised on one engine it lands at 2.00x or worse.
	t.Logf("%d sheets at once: %v (%.2fx one sheet, %.2fx the throughput)",
		len(errs), together.Round(time.Millisecond),
		together.Seconds()/alone.Seconds(),
		float64(len(errs))*alone.Seconds()/together.Seconds())

	if together > time.Duration(float64(alone)*1.8) {
		t.Errorf("%d concurrent sheets took %v against %v for one (%.2fx) — the pool is not spreading them across engines",
			len(errs), together.Round(time.Millisecond), alone.Round(time.Millisecond),
			together.Seconds()/alone.Seconds())
	}
}
