package nativegen

import (
	"math"
	"testing"

	"github.com/stashapp/stash/pkg/nativegen/container"
)

func TestFrameRateIsExact(t *testing.T) {
	tests := []struct {
		name           string
		timescale      uint32
		delta          int64
		wantNum        int
		wantDen        int
		wantApproxRate float64
	}{
		// The reason this is reported as a ratio rather than a number: 30000/1001
		// has no exact decimal form, and a preview written at 29.97 drifts against
		// a source written at the real thing.
		{"NTSC 29.97", 30000, 1001, 30000, 1001, 29.97},
		{"NTSC 59.94", 60000, 1001, 60000, 1001, 59.94},
		{"a round 30", 30000, 1000, 30000, 1000, 30},
		{"a round 25", 25, 1, 25, 1, 25},
		{"the usual 90kHz clock at 24fps", 90000, 3750, 90000, 3750, 24},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tr := &container.VideoTrack{Timescale: tt.timescale, Samples: make([]container.Sample, 50)}
			for i := range tr.Samples {
				tr.Samples[i] = container.Sample{PTS: int64(i) * tt.delta, DTS: int64(i) * tt.delta}
			}

			num, den, err := frameRate(tr)
			if err != nil {
				t.Fatalf("frameRate: %v", err)
			}
			if num != tt.wantNum || den != tt.wantDen {
				t.Errorf("frame rate is %d/%d, want %d/%d", num, den, tt.wantNum, tt.wantDen)
			}
			if got := float64(num) / float64(den); got < tt.wantApproxRate-0.01 || got > tt.wantApproxRate+0.01 {
				t.Errorf("frame rate works out to %v, want about %v", got, tt.wantApproxRate)
			}
		})
	}
}

// TestFrameRateIgnoresAnOddFrameOut checks the rate comes from the most common
// gap rather than an average, so that a file whose last frame is held a little
// longer still reports the rate it was shot at.
func TestFrameRateIgnoresAnOddFrameOut(t *testing.T) {
	tr := &container.VideoTrack{Timescale: 30000, Samples: make([]container.Sample, 50)}
	pts := int64(0)
	for i := range tr.Samples {
		tr.Samples[i] = container.Sample{PTS: pts, DTS: pts}
		pts += 1001
		if i == 40 {
			pts += 5000 // a gap in the middle
		}
	}

	num, den, err := frameRate(tr)
	if err != nil {
		t.Fatalf("frameRate: %v", err)
	}
	if num != 30000 || den != 1001 {
		t.Errorf("frame rate is %d/%d, want 30000/1001", num, den)
	}
}

func TestFrameRateDeclinesWhatIsNotVideo(t *testing.T) {
	tests := []struct {
		name  string
		track *container.VideoTrack
	}{
		{"no timescale", &container.VideoTrack{Samples: make([]container.Sample, 10)}},
		{"a single frame", &container.VideoTrack{Timescale: 30, Samples: make([]container.Sample, 1)}},
		// Frames a second and a half apart are a slideshow or a misparsed
		// timescale; either way the preview would not be watchable.
		{"a slideshow", func() *container.VideoTrack {
			tr := &container.VideoTrack{Timescale: 1000, Samples: make([]container.Sample, 10)}
			for i := range tr.Samples {
				tr.Samples[i].PTS = int64(i) * 1500
			}
			return tr
		}()},
		{"every frame at the same time", func() *container.VideoTrack {
			return &container.VideoTrack{Timescale: 1000, Samples: make([]container.Sample, 10)}
		}()},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, _, err := frameRate(tt.track); err == nil {
				t.Error("frameRate accepted a track that has no frame rate")
			}
		})
	}
}

func TestSegmentSamplesCoversTheRequestedSpan(t *testing.T) {
	// Ten frames a second, keyframes every ten frames, so exactly one a second.
	tr := track(300, 10, false)

	segs, err := segmentSamples(tr, []float64{5.0, 15.0}, 0.75)
	if err != nil {
		t.Fatalf("segmentSamples: %v", err)
	}
	if len(segs) != 2 {
		t.Fatalf("got %d segments, want 2", len(segs))
	}

	// Frames sit at 0.0, 0.1, ... so 5.0 to 5.75 covers the frames at 5.0
	// through 5.7: samples 50 to 57.
	if got := len(segs[0].show); got != 8 {
		t.Errorf("first segment shows %d frames, want 8", got)
	}
	if segs[0].show[0] != 50 {
		t.Errorf("first segment starts at sample %d, want 50", segs[0].show[0])
	}
	// It has to be decoded from the keyframe at or before its first frame.
	if segs[0].from != 50 {
		t.Errorf("first segment decodes from %d, want the keyframe at 50", segs[0].from)
	}
	if segs[0].last() != 57 {
		t.Errorf("first segment ends at sample %d, want 57", segs[0].last())
	}
}

// TestSegmentSamplesStartsFromAKeyframe is the property that makes a segment
// decodable at all: nothing can be reconstructed without the keyframe it depends
// on, so the run has to begin there however far back that is.
func TestSegmentSamplesStartsFromAKeyframe(t *testing.T) {
	tr := track(300, 25, false) // keyframes every 25 frames

	// sample 30, whose keyframe is 25
	segs, err := segmentSamples(tr, []float64{3.0}, 0.5)
	if err != nil {
		t.Fatalf("segmentSamples: %v", err)
	}
	if segs[0].from != 25 {
		t.Errorf("segment decodes from %d, want the keyframe at 25", segs[0].from)
	}
	if segs[0].show[0] != 30 {
		t.Errorf("segment shows from sample %d, want 30", segs[0].show[0])
	}
	// The frames between the keyframe and the start are decoded but not shown.
	for _, i := range segs[0].show {
		if i < 30 {
			t.Errorf("segment shows sample %d, which is before it starts", i)
		}
	}
}

func TestSegmentSamplesUsesPresentationOrder(t *testing.T) {
	// Samples 1 and 2 are stored in the opposite order from the one they are
	// shown in, so a segment covering them has to list them the way they are
	// shown or the preview would play them backwards.
	tr := track(30, 30, true)

	segs, err := segmentSamples(tr, []float64{0.0}, 0.35)
	if err != nil {
		t.Fatalf("segmentSamples: %v", err)
	}

	show := segs[0].show
	for i := 1; i < len(show); i++ {
		if tr.Samples[show[i]].PTS < tr.Samples[show[i-1]].PTS {
			t.Fatalf("segment lists frames out of presentation order: %v", show)
		}
	}
	if len(show) < 3 || show[1] != 2 || show[2] != 1 {
		t.Errorf("segment is %v, want the reordered pair as 2 then 1", show)
	}
}

func TestSegmentSamplesDeclinesAnEmptySpan(t *testing.T) {
	tr := track(100, 10, false) // ten seconds of video

	// A segment starting past the end has no frames in it, and a preview short
	// of a segment is not the preview that was asked for.
	if _, err := segmentSamples(tr, []float64{50}, 0.75); err == nil {
		t.Error("segmentSamples accepted a segment past the end of the track")
	}
}

func TestSnapStartsMovesSegmentsOntoKeyframes(t *testing.T) {
	// Ten frames a second, keyframes every ten frames: one a second.
	tr := track(300, 10, false)

	starts := snapStarts(tr, PreviewOptions{
		Starts:          []float64{5.3, 15.8, 25.4},
		SegmentDuration: 0.75,
		SnapToKeyframes: true,
	})

	want := []float64{5, 16, 25}
	for i, w := range want {
		if math.Abs(starts[i]-w) > 1e-9 {
			t.Errorf("segment %d starts at %.2f, want the keyframe at %.0f", i, starts[i], w)
		}
	}
}

func TestSnapStartsLeavesStartsAloneWhenNotAsked(t *testing.T) {
	tr := track(300, 10, false)

	want := []float64{5.3, 15.8}
	starts := snapStarts(tr, PreviewOptions{Starts: want, SegmentDuration: 0.75})
	for i := range want {
		if starts[i] != want[i] {
			t.Errorf("segment %d moved to %.2f without being asked", i, starts[i])
		}
	}
}

// A marker's preview is a single segment and has to begin at the marker, so it
// is never moved however near a keyframe sits.
func TestSnapStartsLeavesASingleSegmentAlone(t *testing.T) {
	tr := track(300, 10, false)

	starts := snapStarts(tr, PreviewOptions{
		Starts:          []float64{5.3},
		SegmentDuration: 20,
		SnapToKeyframes: true,
	})
	if starts[0] != 5.3 {
		t.Errorf("single segment moved to %.2f, want 5.30", starts[0])
	}
}

// Snapping must not be able to reorder segments or make two of them show the
// same footage, so a move is bounded by half the gap to the neighbouring
// segment. Here the keyframes are far enough apart that the nearest one is
// outside that bound and the start stays put.
func TestSnapStartsWillNotMoveASegmentTooFar(t *testing.T) {
	// Keyframes every 100 frames, so one every ten seconds.
	tr := track(1000, 100, false)

	starts := snapStarts(tr, PreviewOptions{
		// Three seconds is the closest these come, so a start may move 1.5.
		Starts:          []float64{20, 24, 27},
		SegmentDuration: 0.75,
		SnapToKeyframes: true,
	})

	// Keyframes fall at 20, 30, 40. The first start is already on one; the
	// others are four and three seconds from the nearest, both further than the
	// bound allows.
	want := []float64{20, 24, 27}
	for i, w := range want {
		if math.Abs(starts[i]-w) > 1e-9 {
			t.Errorf("segment %d moved to %.2f, want %.0f: the nearest keyframe is too far", i, starts[i], w)
		}
	}
}

// Whatever the snapping does, the segments it produces must stay in order and
// must not overlap — two segments showing the same footage is a broken preview,
// not a slightly different one.
func TestSnapStartsKeepsSegmentsOrderedAndDisjoint(t *testing.T) {
	tr := track(3000, 7, false) // keyframes every 7 frames, an awkward spacing

	var starts []float64
	for i := 0; i < 12; i++ {
		starts = append(starts, 5+float64(i)*20.3)
	}

	got := snapStarts(tr, PreviewOptions{
		Starts:          starts,
		SegmentDuration: 0.75,
		SnapToKeyframes: true,
	})

	for i := 1; i < len(got); i++ {
		if got[i] < got[i-1]+0.75 {
			t.Fatalf("segments %d and %d overlap: %.3f then %.3f", i-1, i, got[i-1], got[i])
		}
	}
}

func TestPreviewRejectsBadRequests(t *testing.T) {
	tests := []struct {
		name string
		opts PreviewOptions
	}{
		{"no segments", PreviewOptions{Path: "x.mp4", SegmentDuration: 0.75, Width: 640}},
		{"no duration", PreviewOptions{Path: "x.mp4", Starts: []float64{1}, Width: 640}},
		{"no width", PreviewOptions{Path: "x.mp4", Starts: []float64{1}, SegmentDuration: 0.75}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := Preview(t.Context(), tt.opts, nil); err == nil {
				t.Error("Preview accepted an invalid request")
			}
		})
	}
}
