package nativegen

import (
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/disintegration/imaging"
)

// TestSpriteRealFile drives the whole native path — demux, keyframe selection,
// GPU decode, scale, readback — over a real file and writes the finished sheet.
// It is the end-to-end check that the pieces fit together in the shape the
// generator actually calls them in.
//
// Opt in with:
//
//	STASH_NATIVEGEN_TEST_MP4=<path> go test ./pkg/nativegen/ -run RealFile -v
//
// Set STASH_NATIVEGEN_TEST_OUT to keep the sheet somewhere you can look at it,
// and STASH_NATIVEGEN_TEST_VRMODE to a projection to exercise the VR path, which
// adds the reprojection and has the decoder scale to an intermediate size rather
// than straight to a tile.
func TestSpriteRealFile(t *testing.T) {
	path := os.Getenv("STASH_NATIVEGEN_TEST_MP4")
	if path == "" {
		t.Skip("set STASH_NATIVEGEN_TEST_MP4 to run")
	}
	if !Available() {
		t.Skip("no native hardware backend on this machine")
	}
	t.Logf("backend: %s", Describe())

	// The real sheet the generator builds: 9x9 tiles, at the flat sprite width
	// or the wider one VR footage uses.
	const rows, cols = 9, 9
	const count = rows * cols

	vrMode := os.Getenv("STASH_NATIVEGEN_TEST_VRMODE")
	width := 160
	name := "native_sprite.png"
	if vrMode != "" {
		width = 320
		name = "native_sprite_" + vrMode + ".png"
		t.Logf("projection: %s", vrMode)
	}

	start := time.Now()
	tiles, err := Sprite(context.Background(), SpriteOptions{
		Path:   path,
		Count:  count,
		Width:  width,
		VRMode: vrMode,
	})
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("Sprite: %v", err)
	}
	if len(tiles) != count {
		t.Fatalf("got %d tiles, want %d", len(tiles), count)
	}

	t.Logf("%s: %d tiles in %v (%.1f ms/tile)", filepath.Base(path), len(tiles),
		elapsed.Round(time.Millisecond), float64(elapsed.Microseconds())/1000/count)

	// Every tile must be present and the same size, because the sheet is
	// assembled by multiplying one tile's dimensions by the grid.
	want := tiles[0].Bounds().Size()
	for i, tile := range tiles {
		if tile == nil {
			t.Fatalf("tile %d is missing", i)
		}
		if got := tile.Bounds().Size(); got != want {
			t.Fatalf("tile %d is %v, want %v", i, got, want)
		}
	}
	t.Logf("tile size %dx%d", want.X, want.Y)

	// A sheet of 81 identical tiles would pass every check above while being
	// useless, which is the failure mode of a decoder that returns the same
	// surface repeatedly. Distinct mean brightness is weak evidence but it is
	// enough to catch that.
	if distinct := countDistinct(tiles); distinct < count/2 {
		t.Errorf("only %d of %d tiles are visually distinct", distinct, count)
	}

	out := os.Getenv("STASH_NATIVEGEN_TEST_OUT")
	if out == "" {
		out = t.TempDir()
	}
	sheet := filepath.Join(out, name)
	if err := writeSheet(sheet, tiles, rows, cols); err != nil {
		t.Fatalf("writing sheet: %v", err)
	}
	t.Logf("wrote %s", sheet)
}

// countDistinct counts how many tiles have a fingerprint not shared by an
// earlier tile.
//
// A single scalar such as mean brightness is not enough: 81 frames from one
// scene routinely share an average. The fingerprint is instead a coarse grid of
// block luminances, which distinguishes frames by where the light is rather
// than only by how much of it there is, while staying far too blunt to be moved
// by compression noise.
func countDistinct(tiles []image.Image) int {
	seen := make(map[fingerprint]bool, len(tiles))
	for _, tile := range tiles {
		seen[fingerprintOf(tile)] = true
	}
	return len(seen)
}

const fingerprintGrid = 4

type fingerprint [fingerprintGrid * fingerprintGrid]uint8

func fingerprintOf(img image.Image) fingerprint {
	b := img.Bounds()
	var sums [fingerprintGrid * fingerprintGrid]float64
	var counts [fingerprintGrid * fingerprintGrid]int

	for y := b.Min.Y; y < b.Max.Y; y++ {
		row := (y - b.Min.Y) * fingerprintGrid / b.Dy()
		for x := b.Min.X; x < b.Max.X; x++ {
			col := (x - b.Min.X) * fingerprintGrid / b.Dx()
			r, g, bb, _ := img.At(x, y).RGBA()
			cell := row*fingerprintGrid + col
			sums[cell] += 0.299*float64(r>>8) + 0.587*float64(g>>8) + 0.114*float64(bb>>8)
			counts[cell]++
		}
	}

	var fp fingerprint
	for i := range sums {
		if counts[i] == 0 {
			continue
		}
		// Quantise to 32 levels: coarse enough that re-encoding the same frame
		// lands in the same bucket, fine enough to separate different ones.
		fp[i] = uint8(math.Round(sums[i]/float64(counts[i])) / 8)
	}
	return fp
}

// writeSheet assembles the tiles into a grid the same way the generator does,
// so the file on disk is what the player would be handed.
func writeSheet(path string, tiles []image.Image, rows, cols int) error {
	tw := tiles[0].Bounds().Size().X
	th := tiles[0].Bounds().Size().Y

	sheet := imaging.New(tw*cols, th*rows, color.NRGBA{})
	for i, tile := range tiles {
		sheet = imaging.Paste(sheet, tile, image.Pt(tw*(i%cols), th*(i/cols)))
	}

	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	if err := png.Encode(f, sheet); err != nil {
		return errors.Join(err, f.Close())
	}
	return nil
}
