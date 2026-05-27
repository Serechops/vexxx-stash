// Package embedding provides lightweight visual similarity helpers.
// It computes a 64-bin HSV colour histogram from image bytes and offers
// cosine-similarity comparison — no external ML libraries required.
package embedding

import (
	"bytes"
	"image"
	_ "image/jpeg" // register JPEG decoder
	_ "image/png"  // register PNG decoder
	"math"
)

const HistBins = 64

// ComputeFromImage decodes image bytes (JPEG or PNG) and returns a 64-bin
// HSV colour histogram normalised to a probability distribution (L1 norm).
// Returns nil if the data cannot be decoded.
func ComputeFromImage(data []byte) []float32 {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil
	}
	return computeHistogram(img)
}

// Cosine returns the cosine similarity (0–1) between two equal-length vectors.
// Returns 0 when either vector is zero-length or the slices differ in size.
func Cosine(a, b []float32) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, normA, normB float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		normA += float64(a[i]) * float64(a[i])
		normB += float64(b[i]) * float64(b[i])
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return dot / (math.Sqrt(normA) * math.Sqrt(normB))
}

// computeHistogram builds a 64-bin HSV histogram from an image by sampling
// every 4th pixel in both dimensions (16× down-sample for speed).
//
// Bin layout: hBin×8 + sBin×2 + vBin
//
//	hBin ∈ [0,7]  — 8 hue sectors of 45° each
//	sBin ∈ [0,3]  — 4 saturation quartiles
//	vBin ∈ [0,1]  — 2 value (brightness) halves
func computeHistogram(img image.Image) []float32 {
	hist := make([]float32, HistBins)
	bounds := img.Bounds()
	count := 0

	for y := bounds.Min.Y; y < bounds.Max.Y; y += 4 {
		for x := bounds.Min.X; x < bounds.Max.X; x += 4 {
			r, g, bb, _ := img.At(x, y).RGBA()
			h, s, v := rgbToHSV(float64(r>>8)/255.0, float64(g>>8)/255.0, float64(bb>>8)/255.0)

			hBin := int(h / 45.0)
			sBin := int(s * 4.0)
			vBin := int(v * 2.0)

			if hBin > 7 {
				hBin = 7
			}
			if sBin > 3 {
				sBin = 3
			}
			if vBin > 1 {
				vBin = 1
			}

			hist[hBin*8+sBin*2+vBin]++
			count++
		}
	}

	// L1-normalise to a probability distribution
	if count > 0 {
		total := float32(count)
		for i := range hist {
			hist[i] /= total
		}
	}

	return hist
}

// rgbToHSV converts linearised RGB (each 0–1) to HSV.
// Returns h ∈ [0, 360), s ∈ [0, 1], v ∈ [0, 1].
func rgbToHSV(r, g, b float64) (h, s, v float64) {
	max := math.Max(r, math.Max(g, b))
	min := math.Min(r, math.Min(g, b))
	delta := max - min

	v = max
	if max == 0 {
		s = 0
	} else {
		s = delta / max
	}

	if delta == 0 {
		h = 0
	} else if max == r {
		h = 60 * math.Mod((g-b)/delta, 6)
	} else if max == g {
		h = 60 * ((b-r)/delta + 2)
	} else {
		h = 60 * ((r-g)/delta + 4)
	}

	if h < 0 {
		h += 360
	}
	return
}
