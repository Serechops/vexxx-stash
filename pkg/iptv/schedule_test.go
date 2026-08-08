package iptv

import (
	"testing"
	"time"
)

// entries builds a cycle input from a list of durations, giving each scene a
// distinct id so programmes are easy to identify in assertions.
func entries(durations ...float64) []SceneEntry {
	out := make([]SceneEntry, 0, len(durations))
	for i, d := range durations {
		out = append(out, SceneEntry{
			SceneID:  100 + i,
			Title:    "scene",
			Duration: d,
		})
	}
	return out
}

func TestBuildCycleQuantisesAndDropsShortScenes(t *testing.T) {
	// 10s -> 5 segments, 1.5s -> dropped, 7.9s -> 3 segments (tail truncated),
	// 0 -> dropped, 4s -> 2 segments.
	c := BuildCycle(1, entries(10, 1.5, 7.9, 0, 4))

	if len(c.Programs) != 3 {
		t.Fatalf("expected 3 programmes after dropping sub-segment scenes, got %d", len(c.Programs))
	}
	if c.TotalSegs != 10 {
		t.Fatalf("expected 10 total segments, got %d", c.TotalSegs)
	}

	want := []struct{ sceneID, segments, startSeg int }{
		{100, 5, 0},
		{102, 3, 5},
		{104, 2, 8},
	}
	for i, w := range want {
		p := c.Programs[i]
		if p.SceneID != w.sceneID || p.Segments != w.segments || p.StartSeg != w.startSeg {
			t.Errorf("programme %d = {scene:%d segs:%d start:%d}, want {scene:%d segs:%d start:%d}",
				i, p.SceneID, p.Segments, p.StartSeg, w.sceneID, w.segments, w.startSeg)
		}
	}
}

func TestBuildCyclePreservesInputOrder(t *testing.T) {
	in := []SceneEntry{
		{SceneID: 9, Duration: 4},
		{SceneID: 3, Duration: 4},
		{SceneID: 7, Duration: 4},
	}
	c := BuildCycle(1, in)

	for i, want := range []int{9, 3, 7} {
		if c.Programs[i].SceneID != want {
			t.Errorf("programme %d is scene %d, want %d — input order must be preserved",
				i, c.Programs[i].SceneID, want)
		}
	}
}

// Every segment of a cycle must map to exactly one programme, and consecutive
// segments must advance by exactly one position. This is the property the whole
// stitched playlist depends on: a gap or an overlap would show up as a skipped
// or repeated couple of seconds on air.
func TestLocateCoversEverySegmentContiguously(t *testing.T) {
	c := BuildCycle(1, entries(10, 4, 6))
	if c.TotalSegs != 10 {
		t.Fatalf("setup: expected 10 segments, got %d", c.TotalSegs)
	}

	// Walk two full loops so the wrap is exercised too.
	var prev Slot
	for abs := int64(0); abs < int64(c.TotalSegs)*2; abs++ {
		slot, ok := c.Locate(abs)
		if !ok {
			t.Fatalf("segment %d did not map to any programme", abs)
		}

		if slot.LocalSeg < 0 || slot.LocalSeg >= slot.Program.Segments {
			t.Fatalf("segment %d mapped to local segment %d, outside programme of %d segments",
				abs, slot.LocalSeg, slot.Program.Segments)
		}

		if abs > 0 {
			sameProgramme := slot.ProgramIdx == prev.ProgramIdx && slot.LoopNumber == prev.LoopNumber
			switch {
			case sameProgramme:
				if slot.LocalSeg != prev.LocalSeg+1 {
					t.Fatalf("segment %d: local segment jumped %d -> %d within one programme",
						abs, prev.LocalSeg, slot.LocalSeg)
				}
			default:
				if slot.LocalSeg != 0 {
					t.Fatalf("segment %d: new programme started at local segment %d, want 0",
						abs, slot.LocalSeg)
				}
				if prev.LocalSeg != prev.Program.Segments-1 {
					t.Fatalf("segment %d: left previous programme at local segment %d, want %d (its last)",
						abs, prev.LocalSeg, prev.Program.Segments-1)
				}
			}
		}
		prev = slot
	}
}

func TestLocateWrapsAcrossLoops(t *testing.T) {
	c := BuildCycle(1, entries(10, 4)) // 7 segments total

	first, ok := c.Locate(0)
	if !ok {
		t.Fatal("segment 0 did not resolve")
	}
	wrapped, ok := c.Locate(int64(c.TotalSegs))
	if !ok {
		t.Fatal("first segment of second loop did not resolve")
	}

	if wrapped.ProgramIdx != first.ProgramIdx || wrapped.LocalSeg != first.LocalSeg {
		t.Errorf("wrap landed at programme %d/local %d, want %d/%d",
			wrapped.ProgramIdx, wrapped.LocalSeg, first.ProgramIdx, first.LocalSeg)
	}
	if wrapped.LoopNumber != first.LoopNumber+1 {
		t.Errorf("loop number %d after wrap, want %d", wrapped.LoopNumber, first.LoopNumber+1)
	}
}

// A clock set before Epoch must still land on a real programme. Truncating
// division would round towards zero here and produce a negative local segment.
func TestLocateHandlesTimesBeforeEpoch(t *testing.T) {
	c := BuildCycle(1, entries(10, 4))

	for _, abs := range []int64{-1, -7, -8, -1000} {
		slot, ok := c.Locate(abs)
		if !ok {
			t.Fatalf("segment %d did not resolve", abs)
		}
		if slot.LocalSeg < 0 || slot.LocalSeg >= slot.Program.Segments {
			t.Errorf("segment %d gave local segment %d, outside programme of %d",
				abs, slot.LocalSeg, slot.Program.Segments)
		}
	}
}

// The regression this design exists to avoid: vexxx-streaming rebuilt its
// schedule per calendar day, so whatever was on air at 00:00 was cut off
// mid-programme every night. An epoch-anchored cycle must cross midnight with
// no more disruption than any other second.
func TestNoDiscontinuityAtMidnight(t *testing.T) {
	// Durations chosen so the cycle length shares no convenient factor with a
	// day. Equal 90-minute programmes would divide 86400 exactly, putting a
	// legitimate programme boundary on every midnight and making the test pass
	// for the wrong reason.
	c := BuildCycle(1, entries(5400, 3600, 4802))

	midProgramme := 0
	firstMidnight := time.Date(2026, time.August, 7, 0, 0, 0, 0, time.UTC)

	for day := 0; day < 60; day++ {
		midnight := firstMidnight.AddDate(0, 0, day)

		before, okB := c.Locate(AbsSegment(midnight.Add(-SegmentSeconds * time.Second)))
		after, okA := c.Locate(AbsSegment(midnight))
		if !okB || !okA {
			t.Fatalf("day %d: midnight segments did not resolve", day)
		}

		if before.ProgramIdx == after.ProgramIdx && before.LoopNumber == after.LoopNumber {
			if after.LocalSeg != before.LocalSeg+1 {
				t.Fatalf("day %d: local segment jumped %d -> %d across midnight",
					day, before.LocalSeg, after.LocalSeg)
			}
			midProgramme++
			continue
		}

		// A real programme boundary may happen to coincide with midnight; what
		// must never happen is midnight *causing* one.
		if after.LocalSeg != 0 || before.LocalSeg != before.Program.Segments-1 {
			t.Fatalf("day %d: midnight forced a programme restart (left programme %d at local %d of %d, entered programme %d at local %d)",
				day, before.ProgramIdx, before.LocalSeg, before.Program.Segments,
				after.ProgramIdx, after.LocalSeg)
		}
	}

	if midProgramme == 0 {
		t.Fatal("test is vacuous: no midnight fell mid-programme, so nothing was proven")
	}
}

// EXT-X-DISCONTINUITY-SEQUENCE must never go backwards and must advance by
// exactly one per programme change, including across a cycle wrap.
func TestDiscontinuitySeqIsMonotonic(t *testing.T) {
	c := BuildCycle(1, entries(10, 4, 6))

	var prevSeq int64 = -1
	var prevSlot Slot
	for abs := int64(0); abs < int64(c.TotalSegs)*3; abs++ {
		slot, _ := c.Locate(abs)
		seq := c.DiscontinuitySeq(slot)

		if abs > 0 {
			changed := slot.ProgramIdx != prevSlot.ProgramIdx || slot.LoopNumber != prevSlot.LoopNumber
			switch {
			case changed && seq != prevSeq+1:
				t.Fatalf("segment %d: programme changed but sequence went %d -> %d", abs, prevSeq, seq)
			case !changed && seq != prevSeq:
				t.Fatalf("segment %d: same programme but sequence went %d -> %d", abs, prevSeq, seq)
			}
		}
		prevSeq, prevSlot = seq, slot
	}
}

func TestAiringsAreContiguousAndCoverRange(t *testing.T) {
	c := BuildCycle(1, entries(600, 1800, 1200))

	from := Epoch.Add(37 * time.Minute) // deliberately mid-programme
	to := from.Add(3 * time.Hour)

	airings := c.Airings(from, to, 100)
	if len(airings) == 0 {
		t.Fatal("no airings returned")
	}

	// The first airing must already be in progress at `from`, not start later:
	// an EPG whose first entry begins in the future leaves a hole in the guide.
	if airings[0].Start.After(from) {
		t.Errorf("first airing starts at %v, after the requested start %v", airings[0].Start, from)
	}
	if !airings[0].End.After(from) {
		t.Errorf("first airing ended at %v, before the requested start %v", airings[0].End, from)
	}

	for i := 1; i < len(airings); i++ {
		if !airings[i].Start.Equal(airings[i-1].End) {
			t.Errorf("gap between airing %d (ends %v) and %d (starts %v)",
				i-1, airings[i-1].End, i, airings[i].Start)
		}
	}

	last := airings[len(airings)-1]
	if last.End.Before(to) {
		t.Errorf("airings stop at %v, short of the requested end %v", last.End, to)
	}
}

func TestAiringsRespectsCap(t *testing.T) {
	c := BuildCycle(1, entries(4, 4, 4))

	airings := c.Airings(Epoch, Epoch.Add(24*time.Hour), 5)
	if len(airings) != 5 {
		t.Fatalf("expected the cap of 5 airings, got %d", len(airings))
	}
}

func TestEmptyCycle(t *testing.T) {
	// Every scene is below one segment, so nothing is schedulable.
	c := BuildCycle(1, entries(1, 0.5, 1.9))

	if !c.Empty() {
		t.Fatal("cycle with no schedulable scenes should report Empty")
	}
	if _, ok := c.Locate(0); ok {
		t.Error("Locate should fail on an empty cycle rather than divide by zero")
	}
	if got := c.Airings(Epoch, Epoch.Add(time.Hour), 10); got != nil {
		t.Errorf("Airings on an empty cycle returned %d entries, want none", len(got))
	}
}

func TestSegmentTimeRoundTrip(t *testing.T) {
	for _, abs := range []int64{0, 1, 12345, -1, -99999} {
		if got := AbsSegment(SegmentTime(abs)); got != abs {
			t.Errorf("round trip of segment %d gave %d", abs, got)
		}
	}
}

func TestShuffleSeedIsStableAndDistinct(t *testing.T) {
	if ShuffleSeed(42) != ShuffleSeed(42) {
		t.Error("seed must be stable for a given channel across calls")
	}

	seen := make(map[uint64]int)
	for id := 1; id <= 200; id++ {
		s := ShuffleSeed(id)
		if s >= 1e8 {
			t.Fatalf("seed %d for channel %d exceeds sqlite's 1e8 cap", s, id)
		}
		if prev, dup := seen[s]; dup {
			t.Errorf("channels %d and %d collide on seed %d", prev, id, s)
		}
		seen[s] = id
	}
}

// ─── stable shuffle ───────────────────────────────────────────────────────────

func shuffleInput(n int) []SceneEntry {
	entries := make([]SceneEntry, n)
	for i := range entries {
		entries[i] = SceneEntry{SceneID: i + 1, Duration: 600}
	}
	return entries
}

func ids(entries []SceneEntry) []int {
	out := make([]int, len(entries))
	for i, e := range entries {
		out[i] = e.SceneID
	}
	return out
}

// The whole point of the seed: a channel's rotation has to survive a restart,
// so the same seed must produce the same order every time.
func TestStableShuffleIsReproducible(t *testing.T) {
	a, b := shuffleInput(50), shuffleInput(50)

	StableShuffle(a, 12345)
	StableShuffle(b, 12345)

	for i := range a {
		if a[i].SceneID != b[i].SceneID {
			t.Fatalf("same seed produced different orders at index %d: %v vs %v", i, ids(a), ids(b))
		}
	}
}

// Sorting by id first is what makes the result independent of the order the
// upstream API happened to return — otherwise a catalog that came back in a
// different order would silently reshuffle a live channel.
func TestStableShuffleIgnoresInputOrder(t *testing.T) {
	forward := shuffleInput(50)

	reversed := shuffleInput(50)
	for i, j := 0, len(reversed)-1; i < j; i, j = i+1, j-1 {
		reversed[i], reversed[j] = reversed[j], reversed[i]
	}

	StableShuffle(forward, 999)
	StableShuffle(reversed, 999)

	for i := range forward {
		if forward[i].SceneID != reversed[i].SceneID {
			t.Fatalf("input order leaked into the result at index %d", i)
		}
	}
}

func TestStableShuffleIsAPermutation(t *testing.T) {
	entries := shuffleInput(200)
	StableShuffle(entries, 777)

	seen := make(map[int]bool, len(entries))
	for _, e := range entries {
		if seen[e.SceneID] {
			t.Fatalf("scene %d appears more than once", e.SceneID)
		}
		seen[e.SceneID] = true
	}
	if len(seen) != 200 {
		t.Errorf("got %d distinct entries, want 200 — the shuffle dropped some", len(seen))
	}
}

func TestStableShuffleActuallyReorders(t *testing.T) {
	entries := shuffleInput(100)
	StableShuffle(entries, 4242)

	inPlace := 0
	for i, e := range entries {
		if e.SceneID == i+1 {
			inPlace++
		}
	}
	// A real shuffle of 100 leaves ~1 element in place; sorted output would
	// leave all 100, which is the failure this guards against.
	if inPlace > 20 {
		t.Errorf("%d of 100 entries kept their original position — this is not shuffling", inPlace)
	}
}

func TestStableShuffleDiffersBySeed(t *testing.T) {
	a, b := shuffleInput(100), shuffleInput(100)

	StableShuffle(a, 1)
	StableShuffle(b, 2)

	same := 0
	for i := range a {
		if a[i].SceneID == b[i].SceneID {
			same++
		}
	}
	if same > 20 {
		t.Errorf("two seeds agreed on %d of 100 positions; the seed is barely being used", same)
	}
}

func TestStableShuffleHandlesTrivialInput(t *testing.T) {
	StableShuffle(nil, 1)
	StableShuffle([]SceneEntry{}, 1)

	one := []SceneEntry{{SceneID: 9}}
	StableShuffle(one, 1)
	if len(one) != 1 || one[0].SceneID != 9 {
		t.Error("a single entry should survive untouched")
	}
}
