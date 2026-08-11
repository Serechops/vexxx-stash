package container

import "testing"

// testTrack builds a track at 1000 ticks/second with a keyframe every 5
// seconds and non-keyframes every second in between.
func testTrack(keyframeInterval, count int) *VideoTrack {
	t := &VideoTrack{Timescale: 1000, Duration: uint64(count) * 1000}
	for i := 0; i < count; i++ {
		t.Samples = append(t.Samples, Sample{
			PTS:  int64(i) * 1000,
			DTS:  int64(i) * 1000,
			Sync: i%keyframeInterval == 0,
		})
	}
	return t
}

func TestSyncAtOrBefore(t *testing.T) {
	track := testTrack(5, 30) // keyframes at 0s, 5s, 10s, 15s, 20s, 25s

	cases := []struct {
		seconds float64
		want    int
	}{
		{0, 0},
		{4.9, 0},
		{5, 5},
		{7, 5},
		{9.99, 5},
		{29, 25},
		{1000, 25}, // past the end clamps to the final keyframe
		{-1, 0},    // before the start clamps to the first
	}

	for _, c := range cases {
		if got := track.SyncAtOrBefore(c.seconds); got != c.want {
			t.Errorf("SyncAtOrBefore(%v) = %d, want %d", c.seconds, got, c.want)
		}
	}
}

func TestNearestSync(t *testing.T) {
	track := testTrack(5, 30)

	cases := []struct {
		seconds float64
		want    int
	}{
		{0, 0},
		{2, 0},   // closer to the keyframe at 0s
		{2.5, 0}, // exactly between: ties go to the earlier keyframe
		{3, 5},   // closer to the keyframe at 5s
		{12, 10},
		{13, 15},
		{100, 25},
	}

	for _, c := range cases {
		if got := track.NearestSync(c.seconds); got != c.want {
			t.Errorf("NearestSync(%v) = %d, want %d", c.seconds, got, c.want)
		}
	}
}

func TestKeyframesAtIsDistinct(t *testing.T) {
	// 12 keyframes across 60 seconds, 9 tiles wanted. Several targets fall
	// nearest to the same keyframe, so this only succeeds if assignment
	// accounts for the targets that follow.
	track := testTrack(5, 60)

	times := make([]float64, 9)
	step := 60.0 / 9
	for i := range times {
		times[i] = float64(i) * step
	}

	got := track.KeyframesAt(times)
	if len(got) != len(times) {
		t.Fatalf("got %d indices for %d times", len(got), len(times))
	}

	seen := map[int]bool{}
	prev := -1
	for i, idx := range got {
		if idx < 0 {
			t.Fatalf("time %v resolved to no keyframe", times[i])
		}
		if !track.Samples[idx].Sync {
			t.Errorf("time %v resolved to sample %d, which is not a keyframe", times[i], idx)
		}
		if seen[idx] {
			t.Errorf("sample %d was selected twice", idx)
		}
		if idx <= prev {
			t.Errorf("tile %d selected sample %d, which does not follow %d", i, idx, prev)
		}
		seen[idx] = true
		prev = idx
	}
}

func TestKeyframesAtExactlyEnoughKeyframes(t *testing.T) {
	// The tightest case: exactly as many keyframes as tiles means every
	// keyframe must be used, in order, with no room to manoeuvre.
	track := testTrack(5, 45) // keyframes at 0,5,...,40 -> 9 of them

	times := make([]float64, 9)
	for i := range times {
		times[i] = float64(i)*5 + 2 // deliberately offset from the keyframes
	}

	got := track.KeyframesAt(times)
	for i, idx := range got {
		if want := i * 5; idx != want {
			t.Errorf("tile %d = sample %d, want %d", i, idx, want)
		}
	}
}

func TestKeyframesAtFewerKeyframesThanTiles(t *testing.T) {
	// Only 3 keyframes but 9 tiles requested. Repeats are unavoidable, but they
	// must be spread across the timeline rather than clustered, and the result
	// must still be non-decreasing.
	track := testTrack(10, 30)

	times := make([]float64, 9)
	for i := range times {
		times[i] = float64(i) * 3
	}

	got := track.KeyframesAt(times)
	distinct := map[int]bool{}
	prev := -1
	for i, idx := range got {
		if idx < 0 {
			t.Fatal("a tile resolved to no keyframe")
		}
		if idx < prev {
			t.Errorf("tile %d selected sample %d, which precedes %d", i, idx, prev)
		}
		distinct[idx] = true
		prev = idx
	}

	if len(distinct) != 3 {
		t.Errorf("used %d distinct keyframes, want all 3", len(distinct))
	}
}

func TestNoSyncSamples(t *testing.T) {
	track := &VideoTrack{Timescale: 1000}
	track.Samples = append(track.Samples, Sample{PTS: 0, Sync: false})

	if got := track.NearestSync(0); got != -1 {
		t.Errorf("NearestSync = %d, want -1 when the track has no sync samples", got)
	}
	for i, idx := range track.KeyframesAt([]float64{0, 1}) {
		if idx != -1 {
			t.Errorf("KeyframesAt[%d] = %d, want -1", i, idx)
		}
	}
}

func TestDurationSeconds(t *testing.T) {
	track := &VideoTrack{Timescale: 90000, Duration: 90000 * 125}
	if got := track.DurationSeconds(); got != 125 {
		t.Errorf("DurationSeconds = %v, want 125", got)
	}

	// A track with no timescale must not divide by zero.
	if got := (&VideoTrack{}).DurationSeconds(); got != 0 {
		t.Errorf("DurationSeconds on an empty track = %v, want 0", got)
	}
}
