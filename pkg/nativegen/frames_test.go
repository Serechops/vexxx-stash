package nativegen

import (
	"testing"

	"github.com/stashapp/stash/pkg/nativegen/container"
)

// track builds a track at 1000 ticks per second with frames every 100 ticks,
// i.e. ten a second, optionally reordered so that presentation order differs
// from storage order.
func track(count int, sync int, reorder bool) *container.VideoTrack {
	t := &container.VideoTrack{Timescale: 1000, Samples: make([]container.Sample, count)}
	for i := range t.Samples {
		t.Samples[i] = container.Sample{
			DTS:  int64(i) * 100,
			PTS:  int64(i) * 100,
			Sync: sync > 0 && i%sync == 0,
		}
	}
	if reorder && count >= 3 {
		// A minimal B-frame pattern: the third frame is coded before the second
		// but shown after it, so index order and presentation order disagree.
		t.Samples[1].PTS, t.Samples[2].PTS = t.Samples[2].PTS, t.Samples[1].PTS
	}
	t.Duration = uint64(count) * 100
	return t
}

func TestSamplesAtPicksTheFrameShownAtTheTime(t *testing.T) {
	tr := track(100, 10, false)

	tests := []struct {
		name string
		time float64
		want int
	}{
		// Frames sit at 0.0, 0.1, 0.2 ... so a time landing exactly on one
		// takes that frame.
		{"exactly on a frame", 0.5, 5},
		// ffmpeg's accurate seek settles on the first frame at or after the
		// time, never the one before it.
		{"between frames", 0.55, 6},
		{"just before a frame", 0.4999, 5},
		{"the start", 0, 0},
		// A time past the end has no frame after it; the last one stands in
		// rather than the request failing.
		{"past the end", 999, 99},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := samplesAt(tr, []float64{tt.time})
			if err != nil {
				t.Fatalf("samplesAt: %v", err)
			}
			if got[0].sample != tt.want {
				t.Errorf("time %v resolved to sample %d, want %d", tt.time, got[0].sample, tt.want)
			}
		})
	}
}

func TestSamplesAtIgnoresTheTracksOwnStartTime(t *testing.T) {
	// Measured against ffmpeg: a time is compared against the raw presentation
	// timestamp, without the track's start being added first. This track starts
	// at 0.06s, so 0.5s must still land on the frame whose timestamp is 0.5 and
	// not on the one 0.06 further along.
	tr := track(100, 10, false)
	for i := range tr.Samples {
		tr.Samples[i].PTS += 60
		tr.Samples[i].DTS += 60
	}

	got, err := samplesAt(tr, []float64{0.5})
	if err != nil {
		t.Fatalf("samplesAt: %v", err)
	}
	// Timestamps are now 60, 160, 260, 360, 460, 560 ... so the first at or
	// after 500 is 560, which is sample 5.
	if got[0].sample != 5 {
		t.Errorf("0.5s resolved to sample %d (pts %d), want sample 5",
			got[0].sample, tr.Samples[got[0].sample].PTS)
	}
}

func TestSamplesAtReturnsWorkInFileOrder(t *testing.T) {
	tr := track(100, 10, false)

	// However the caller orders its request, decoding runs forward through the
	// file once, and each entry has to carry the slot it fills so the results
	// can be put back in the order asked for.
	got, err := samplesAt(tr, []float64{5.0, 1.0, 3.0})
	if err != nil {
		t.Fatalf("samplesAt: %v", err)
	}

	for i := 1; i < len(got); i++ {
		if got[i].sample < got[i-1].sample {
			t.Fatalf("samples are not in file order: %+v", got)
		}
	}

	slots := map[int]int{}
	for _, w := range got {
		slots[w.slot] = w.sample
	}
	if slots[0] != 50 || slots[1] != 10 || slots[2] != 30 {
		t.Errorf("slots map to the wrong samples: %v", slots)
	}
}

func TestSamplesAtKeepsEveryRequestWhenTimesShareAFrame(t *testing.T) {
	tr := track(100, 10, false)

	// Two times inside one frame's interval, and two past the end, all resolve
	// to the same sample. Every one of them still has to be answered — an
	// earlier version kept only the last, and the caller silently got fewer
	// frames than it asked for.
	got, err := samplesAt(tr, []float64{0.51, 0.55, 999, 1000})
	if err != nil {
		t.Fatalf("samplesAt: %v", err)
	}
	if len(got) != 4 {
		t.Fatalf("got %d entries for 4 times", len(got))
	}

	seen := map[int]bool{}
	for _, w := range got {
		if seen[w.slot] {
			t.Errorf("slot %d appears twice", w.slot)
		}
		seen[w.slot] = true
	}
	for slot := 0; slot < 4; slot++ {
		if !seen[slot] {
			t.Errorf("slot %d was dropped", slot)
		}
	}
}

func TestPresentationOrderSortsReorderedFrames(t *testing.T) {
	tr := track(10, 10, true)

	order := presentationOrder(tr)
	for i := 1; i < len(order); i++ {
		if tr.Samples[order[i]].PTS < tr.Samples[order[i-1]].PTS {
			t.Fatalf("presentation order is not sorted by timestamp: %v", order)
		}
	}

	// The reordered pair must come back the other way round from how it is
	// stored, which is the whole point of distinguishing the two orders.
	if order[1] != 2 || order[2] != 1 {
		t.Errorf("reordered frames came back as %v, want sample 2 shown before sample 1", order[1:3])
	}
}

func TestSamplesAtWithReorderedFrames(t *testing.T) {
	tr := track(10, 10, true)

	// Sample 1 is shown at 0.2s and sample 2 at 0.1s, so asking for 0.1s must
	// give sample 2 even though sample 1 is stored first.
	got, err := samplesAt(tr, []float64{0.1})
	if err != nil {
		t.Fatalf("samplesAt: %v", err)
	}
	if got[0].sample != 2 {
		t.Errorf("0.1s resolved to sample %d, want 2", got[0].sample)
	}
}

func TestSyncBefore(t *testing.T) {
	tr := track(100, 10, false) // keyframes at 0, 10, 20, ...

	tests := []struct {
		sample, want int
	}{
		{0, 0},
		{5, 0},
		{10, 10},
		{19, 10},
		{99, 90},
	}

	for _, tt := range tests {
		// A frame can only be reconstructed from the keyframe at or before it,
		// so this is what bounds how much has to be decoded to reach it.
		if got := syncBefore(tr, tt.sample); got != tt.want {
			t.Errorf("syncBefore(%d) = %d, want %d", tt.sample, got, tt.want)
		}
	}
}

func TestFramesRejectsBadRequests(t *testing.T) {
	if _, err := Frames(t.Context(), FrameOptions{Path: "x.mp4", Width: 160}); err == nil {
		t.Error("Frames accepted a request with no times")
	}
	if _, err := Frames(t.Context(), FrameOptions{Path: "x.mp4", Times: []float64{1}}); err == nil {
		t.Error("Frames accepted a request with no width")
	}
}
