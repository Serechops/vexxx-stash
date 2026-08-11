package nativegen

import (
	"context"
	"errors"
	"testing"

	"github.com/stashapp/stash/pkg/nativegen/container"
)

func TestTileSize(t *testing.T) {
	tests := []struct {
		name         string
		width        int
		srcW, srcH   int
		wantW, wantH int
	}{
		{"16:9", 160, 1920, 1080, 160, 90},
		{"8K VR 2:1", 320, 8000, 4000, 320, 160},
		{"portrait", 160, 1080, 1920, 160, 284},
		{"square", 160, 512, 512, 160, 160},
		// 640x360 scaled to 159 wide is 89.4 tall; ffmpeg's scale=w:-2 rounds to
		// the nearest multiple of two, not up, so this is 90 and not 92.
		{"rounds to nearest even", 159, 640, 360, 159, 90},
		// A source whose dimensions never made it out of the container must
		// still yield something a decoder will accept.
		{"unknown source size", 160, 0, 0, 160, 160},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w, h := tileSize(tt.width, tt.srcW, tt.srcH)
			if w != tt.wantW || h != tt.wantH {
				t.Errorf("tileSize(%d, %d, %d) = %dx%d, want %dx%d",
					tt.width, tt.srcW, tt.srcH, w, h, tt.wantW, tt.wantH)
			}
			if h%2 != 0 {
				t.Errorf("tile height %d is odd; NV12 has no representation for it", h)
			}
		})
	}
}

func TestTileTimes(t *testing.T) {
	track := &container.VideoTrack{Timescale: 1000, Duration: 100_000} // 100s

	t.Run("spread across the whole file", func(t *testing.T) {
		times, err := tileTimes(track, SpriteOptions{Count: 4})
		if err != nil {
			t.Fatalf("tileTimes: %v", err)
		}
		want := []float64{0, 25, 50, 75}
		assertTimes(t, times, want)
	})

	t.Run("start offset shifts without rescaling", func(t *testing.T) {
		// This mirrors the ffmpeg path exactly: the step comes from the full
		// duration and the offset is added to each tile, rather than the
		// remaining span being divided up.
		times, err := tileTimes(track, SpriteOptions{Count: 4, StartOffset: 10})
		if err != nil {
			t.Fatalf("tileTimes: %v", err)
		}
		assertTimes(t, times, []float64{10, 35, 60, 85})
	})

	t.Run("explicit duration wins", func(t *testing.T) {
		times, err := tileTimes(track, SpriteOptions{Count: 4, StartOffset: 10, Duration: 40})
		if err != nil {
			t.Fatalf("tileTimes: %v", err)
		}
		assertTimes(t, times, []float64{10, 20, 30, 40})
	})

	t.Run("caller's duration beats the container's", func(t *testing.T) {
		times, err := tileTimes(track, SpriteOptions{Count: 2, StreamDuration: 200})
		if err != nil {
			t.Fatalf("tileTimes: %v", err)
		}
		assertTimes(t, times, []float64{0, 100})
	})

	t.Run("no duration anywhere is declined", func(t *testing.T) {
		empty := &container.VideoTrack{Timescale: 1000}
		_, err := tileTimes(empty, SpriteOptions{Count: 4})
		if !errors.Is(err, container.ErrUnsupported) {
			t.Errorf("tileTimes with no duration = %v, want ErrUnsupported", err)
		}
	})
}

func assertTimes(t *testing.T, got, want []float64) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d times, want %d", len(got), len(want))
	}
	for i := range want {
		if diff := got[i] - want[i]; diff > 1e-9 || diff < -1e-9 {
			t.Errorf("time %d = %v, want %v", i, got[i], want[i])
		}
	}
}

func TestSpriteRejectsBadRequests(t *testing.T) {
	tests := []struct {
		name string
		opts SpriteOptions
	}{
		{"no tiles", SpriteOptions{Path: "x.mp4", Count: 0, Width: 160}},
		{"no width", SpriteOptions{Path: "x.mp4", Count: 9, Width: 0}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// These must be rejected before the file is opened, so a bad request
			// costs nothing and cannot be mistaken for an unreadable file.
			if _, err := Sprite(context.Background(), tt.opts); err == nil {
				t.Error("Sprite accepted an invalid request")
			}
		})
	}
}

func TestSpriteRejectsMissingFile(t *testing.T) {
	_, err := Sprite(context.Background(), SpriteOptions{
		Path:  "this-file-does-not-exist.mp4",
		Count: 9,
		Width: 160,
	})
	if err == nil {
		t.Fatal("Sprite succeeded on a file that does not exist")
	}
}

func TestDistinctSamples(t *testing.T) {
	tests := []struct {
		name    string
		samples []int
		want    int
	}{
		{"all different", []int{0, 5, 9, 14}, 4},
		{"scarce keyframes repeat", []int{0, 0, 0, 3, 3, 3}, 2},
		{"empty", nil, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := distinctSamples(tt.samples); got != tt.want {
				t.Errorf("distinctSamples(%v) = %d, want %d", tt.samples, got, tt.want)
			}
		})
	}
}
