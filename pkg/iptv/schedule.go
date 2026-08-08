// Package iptv turns a static Stash library into 24/7 linear TV channels.
//
// The core idea is a *virtual timeline*. A channel never records "what is
// playing right now" anywhere. Instead each channel owns a deterministic,
// endlessly repeating Cycle of programmes, and the current programme is derived
// purely by arithmetic on the wall clock. Two viewers tuning in from different
// devices therefore land on the same frame with no shared state between them,
// and the answer survives a server restart unchanged.
//
// Everything is counted in whole segments of SegmentSeconds rather than in
// fractional seconds, which makes the timeline pure integer arithmetic from end
// to end and stops rounding drift accumulating over a cycle. The grid is a
// scheduling device only: delivery cuts programmes on a wall-clock timer, not on
// these boundaries.
package iptv

import (
	"hash/fnv"
	"sort"
	"time"
)

// SegmentSeconds is the granularity the schedule is quantised to. It is purely
// a scheduling grid — nothing is cut on this boundary at delivery time — so its
// only real effect is how much of each scene's tail is trimmed to keep the
// arithmetic in whole units.
const SegmentSeconds = 2

// Epoch anchors every channel's schedule. It is deliberately a fixed point in
// the past rather than "server start" or "midnight": schedules must be
// reproducible across restarts, and anchoring to midnight (as the upstream
// vexxx-streaming implementation did) makes every channel hard-cut mid-programme
// at 00:00 every night.
var Epoch = time.Date(2024, time.January, 1, 0, 0, 0, 0, time.UTC)

// SceneEntry is the library-side input to a Cycle. The order of the slice is
// significant and is preserved verbatim: callers are expected to have already
// applied a deterministic ordering (see ShuffleSeed).
type SceneEntry struct {
	SceneID  int
	Title    string
	Details  string
	Date     string
	Duration float64
}

// Program is one scene placed at a fixed offset within a channel's cycle.
type Program struct {
	SceneID  int
	Title    string
	Details  string
	Date     string
	Duration float64
	// Segments is the whole number of segments this programme occupies.
	Segments int
	// StartSeg is the programme's offset from the start of the cycle.
	StartSeg int
}

// Cycle is a channel's complete, endlessly repeating schedule.
type Cycle struct {
	ChannelID int
	Programs  []Program
	TotalSegs int
	BuiltAt   time.Time
}

// Slot identifies the programme covering a given absolute segment.
type Slot struct {
	ProgramIdx int
	Program    Program
	// LocalSeg is the segment index *within the scene*, which is what gets
	// handed to Stash's transcoder.
	LocalSeg int
	// LoopNumber counts how many complete times the cycle has repeated since
	// Epoch. It is what keeps the discontinuity sequence monotonic forever.
	LoopNumber int64
}

// ShuffleSeed derives a stable per-channel seed for Stash's `random_<seed>` sort
// order. Using the channel id alone would make low-numbered studios share
// obviously-correlated orderings (the sort is a modular polynomial of the row
// id), so it is hashed first. The result is kept under 1e8 because
// sqlite.getRandomSort caps the seed there anyway.
func ShuffleSeed(channelID int) uint64 {
	h := fnv.New64a()
	var buf [8]byte
	v := uint64(channelID)
	for i := 0; i < 8; i++ {
		buf[i] = byte(v >> (8 * i))
	}
	_, _ = h.Write(buf[:])
	return h.Sum64() % 1e8
}

// StableShuffle deterministically permutes entries in place.
//
// Library channels get their rotation from Stash's `random_<seed>` SQL sort,
// which sources outside the database cannot use. This is the equivalent for
// them: same guarantee — the same seed yields the same order across restarts,
// so a channel's rotation is a property of the channel rather than of when it
// was built.
//
// Entries are sorted by id before shuffling so the result does not depend on
// the order an upstream API happened to return, and the PRNG is written out
// here rather than taken from math/rand so the permutation is pinned to this
// code instead of to a standard-library implementation detail.
func StableShuffle(entries []SceneEntry, seed uint64) {
	if len(entries) < 2 {
		return
	}

	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].SceneID < entries[j].SceneID
	})

	state := seed
	next := func() uint64 {
		// splitmix64 — small, well-distributed, and fully specified here.
		state += 0x9e3779b97f4a7c15
		z := state
		z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
		z = (z ^ (z >> 27)) * 0x94d049bb133111eb
		return z ^ (z >> 31)
	}

	for i := len(entries) - 1; i > 0; i-- {
		j := int(next() % uint64(i+1))
		entries[i], entries[j] = entries[j], entries[i]
	}
}

// BuildCycle quantises scenes onto the segment grid, preserving input order.
//
// Scenes shorter than one segment are dropped: they would occupy zero segments
// and a zero-length programme would make Locate's search ambiguous. The tail of
// every other scene is truncated by up to SegmentSeconds-1 seconds, which is
// deliberate — it guarantees every segment the schedule refers to actually
// exists in the transcoder's output, so a channel can never request a segment
// past the end of a file.
func BuildCycle(channelID int, scenes []SceneEntry) *Cycle {
	c := &Cycle{
		ChannelID: channelID,
		Programs:  make([]Program, 0, len(scenes)),
		BuiltAt:   time.Now(),
	}

	for _, s := range scenes {
		if s.Duration <= 0 {
			continue
		}
		segments := int(s.Duration) / SegmentSeconds
		if segments < 1 {
			continue
		}

		c.Programs = append(c.Programs, Program{
			SceneID:  s.SceneID,
			Title:    s.Title,
			Details:  s.Details,
			Date:     s.Date,
			Duration: s.Duration,
			Segments: segments,
			StartSeg: c.TotalSegs,
		})
		c.TotalSegs += segments
	}

	return c
}

// Empty reports whether the cycle has no playable programmes.
func (c *Cycle) Empty() bool {
	return c == nil || c.TotalSegs == 0 || len(c.Programs) == 0
}

// Locate maps an absolute segment number onto the programme covering it.
func (c *Cycle) Locate(absSeg int64) (Slot, bool) {
	if c.Empty() {
		return Slot{}, false
	}

	total := int64(c.TotalSegs)
	loop := floorDiv(absSeg, total)
	cycleSeg := int(absSeg - loop*total)

	// First programme whose end lies strictly past cycleSeg.
	idx := sort.Search(len(c.Programs), func(i int) bool {
		p := c.Programs[i]
		return p.StartSeg+p.Segments > cycleSeg
	})
	if idx >= len(c.Programs) {
		return Slot{}, false
	}

	p := c.Programs[idx]
	return Slot{
		ProgramIdx: idx,
		Program:    p,
		LocalSeg:   cycleSeg - p.StartSeg,
		LoopNumber: loop,
	}, true
}

// DiscontinuitySeq returns the number of programme boundaries crossed since
// Epoch. HLS requires EXT-X-DISCONTINUITY-SEQUENCE to increase by exactly one
// per discontinuity that has scrolled off the top of the playlist, which this
// satisfies because every programme change is exactly one discontinuity.
func (c *Cycle) DiscontinuitySeq(s Slot) int64 {
	if c.Empty() {
		return 0
	}
	return s.LoopNumber*int64(len(c.Programs)) + int64(s.ProgramIdx)
}

// Airing is a programme placed on the absolute wall-clock timeline.
type Airing struct {
	Program Program
	Start   time.Time
	End     time.Time
}

// Airings walks the cycle forward from `from`, returning every programme that
// overlaps [from, to). The returned slice is capped at max entries so a channel
// full of very short scenes cannot generate an unbounded EPG.
func (c *Cycle) Airings(from, to time.Time, max int) []Airing {
	if c.Empty() || !to.After(from) || max <= 0 {
		return nil
	}

	slot, ok := c.Locate(AbsSegment(from))
	if !ok {
		return nil
	}

	// Absolute segment at which the located programme began.
	cursor := slot.LoopNumber*int64(c.TotalSegs) + int64(slot.Program.StartSeg)
	idx := slot.ProgramIdx

	out := make([]Airing, 0, 16)
	for len(out) < max {
		p := c.Programs[idx]

		start := SegmentTime(cursor)
		if !start.Before(to) {
			break
		}

		out = append(out, Airing{
			Program: p,
			Start:   start,
			End:     SegmentTime(cursor + int64(p.Segments)),
		})

		cursor += int64(p.Segments)
		idx++
		if idx >= len(c.Programs) {
			idx = 0
		}
	}

	return out
}

// AbsSegment returns the absolute segment index for a wall-clock instant.
func AbsSegment(t time.Time) int64 {
	return floorDiv(int64(t.Sub(Epoch)), int64(SegmentSeconds*time.Second))
}

// SegmentTime is the inverse of AbsSegment.
func SegmentTime(absSeg int64) time.Time {
	return Epoch.Add(time.Duration(absSeg) * SegmentSeconds * time.Second)
}

// floorDiv rounds towards negative infinity, unlike Go's / which truncates
// towards zero. Without this a clock set before Epoch would map to the wrong
// programme and, worse, produce a non-monotonic media sequence.
func floorDiv(a, b int64) int64 {
	q := a / b
	if a%b != 0 && (a < 0) != (b < 0) {
		q--
	}
	return q
}
