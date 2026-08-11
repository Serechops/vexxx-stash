package videophash

import (
	"image"
	"image/color"
	"testing"
)

// colorFor gives every pixel of the test strip a distinct value, so a tile
// taken from the wrong rows cannot pass by coincidence.
func colorFor(x, y int) color.RGBA {
	return color.RGBA{R: uint8(x), G: uint8(y), B: uint8(x ^ y), A: 255}
}

func TestBatchSizeFor(t *testing.T) {
	tests := []struct {
		name          string
		width, height int
		want          int
	}{
		{"unknown dimensions", 0, 0, 4},
		{"negative", -1, 100, 4},
		{"640x358", 640, 358, 25},
		{"1920x1080", 1920, 1080, 25},
		{"3840x1920", 3840, 1920, 7},
		{"4320x2160", 4320, 2160, 5},
		{"8192x8192", 8192, 8192, 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := batchSizeFor(tt.width, tt.height); got != tt.want {
				t.Errorf("batchSizeFor(%d, %d) = %d, want %d", tt.width, tt.height, got, tt.want)
			}
		})
	}
}

// TestSliceStrip checks that cutting a strip apart gives back exactly the rows
// that went into it, at the origin, since that is what makes the batched sprite
// identical to the per-frame one.
func TestSliceStrip(t *testing.T) {
	const (
		w = 160
		h = 8
		n = 5
	)

	strip := image.NewRGBA(image.Rect(0, 0, w, h*n))
	for y := 0; y < h*n; y++ {
		for x := 0; x < w; x++ {
			strip.SetRGBA(x, y, colorFor(x, y))
		}
	}

	tiles, err := sliceStrip(strip, n)
	if err != nil {
		t.Fatalf("sliceStrip: %v", err)
	}
	if len(tiles) != n {
		t.Fatalf("got %d tiles, want %d", len(tiles), n)
	}

	for i, tile := range tiles {
		if got := tile.Bounds(); got != image.Rect(0, 0, w, h) {
			t.Errorf("tile %d bounds = %v, want origin-anchored %dx%d", i, got, w, h)
		}
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				wantR, wantG, wantB, wantA := strip.At(x, i*h+y).RGBA()
				gotR, gotG, gotB, gotA := tile.At(x, y).RGBA()
				if gotR != wantR || gotG != wantG || gotB != wantB || gotA != wantA {
					t.Fatalf("tile %d pixel (%d,%d) = %v,%v,%v,%v want %v,%v,%v,%v",
						i, x, y, gotR, gotG, gotB, gotA, wantR, wantG, wantB, wantA)
				}
			}
		}
	}
}

func TestSliceStripUneven(t *testing.T) {
	strip := image.NewRGBA(image.Rect(0, 0, 160, 41))
	if _, err := sliceStrip(strip, 5); err == nil {
		t.Fatal("expected an error slicing a 41px strip into 5 tiles")
	}
}
