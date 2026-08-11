package nativegen

import (
	"fmt"
	"image"
	"math"
	"runtime"
	"sync"
)

// VR footage is not stored as a picture. It is stored as a mapping from the
// sphere onto a rectangle — equirectangular, half-equirectangular or fisheye,
// usually with one such mapping per eye — and a thumbnail of it taken as-is
// shows a fisheye blob or a pair of smeared hemispheres rather than the scene.
//
// The ffmpeg path solves this with the v360 filter, rendering a rectilinear
// view looking straight ahead and scaling that down to tile size. This file
// reproduces that view.
//
// The cost of v360 is not the arithmetic but that it is arithmetic per pixel:
// an inverse trigonometric mapping evaluated for every output pixel of every
// frame, and, because the ffmpeg path runs one process per tile, its map is
// rebuilt from scratch eighty-one times over. The mapping does not depend on
// the frame. It depends only on the projection and the two frame sizes, all of
// which are fixed for a whole sheet, so here it is computed once as a table of
// sample positions and then applied to each frame as a handful of multiplies.
const (
	// vrFlatWidth, vrFlatHeight and vrDFov are the rectilinear view the ffmpeg
	// path renders, out of which the field of view is derived. The tiles this
	// package produces are smaller than that, but they must frame the same view,
	// and v360 takes its horizontal and vertical field of view from the aspect
	// ratio of these dimensions rather than of the final tile.
	vrFlatWidth  = 1280
	vrFlatHeight = 720
	vrDFov       = 120.0

	// vrSupersample is how many samples per axis are averaged into each output
	// pixel.
	//
	// A tile is a heavy reduction of the source — around eight source pixels per
	// output pixel along each axis at the centre of the view — and a single
	// bilinear tap per pixel would sample that far too sparsely, so edges would
	// crawl from tile to tile. The ffmpeg path avoids this by accident rather
	// than by design: it renders the full 1280x720 view and then lets the
	// scaler's downscale average roughly sixteen of those pixels into each final
	// one. Sampling 2x2 per output pixel here, on top of a source the GPU has
	// already scaled down with a proper filter, gets to the same place for a
	// sixteenth of the sampling work.
	vrSupersample = 2
)

// A projection describes how one frame of VR footage packs a view of the sphere
// into a rectangle.
//
// Stereoscopic footage carries two such views, side by side or one above the
// other. Only the first is used: a tile is a flat, single-eye preview, and the
// two eyes differ by an interocular parallax that is invisible at tile size.
type projection struct {
	// eyeFracX and eyeFracY are how much of the frame the first eye occupies.
	// The first eye always begins at the frame's origin, so a fraction is
	// enough to locate it.
	eyeFracX, eyeFracY float64

	// hFov and vFov are the degrees of the sphere that eye covers.
	hFov, vFov float64

	// fisheye selects the angular mapping. Equirectangular footage is a
	// separable mapping of longitude and latitude onto x and y; fisheye is a
	// radial mapping of the angle from the view axis. They are different
	// enough to be different functions and similar enough to share everything
	// around them.
	fisheye bool
}

// projections lists the modes scenes can be tagged with, matching the v360
// invocations in pkg/ffmpeg/transcoder. A mode absent from this table is one
// the native path must decline rather than guess at: rendering the wrong
// projection produces a plausible-looking tile of the wrong part of the scene.
var projections = map[string]projection{
	// Half-equirectangular, one 180x180 degree hemisphere per eye, side by side.
	"LR180": {eyeFracX: 0.5, eyeFracY: 1, hFov: 180, vFov: 180},

	// Full equirectangular, one 360x180 degree sphere per eye, stacked.
	"TB360": {eyeFracX: 1, eyeFracY: 0.5, hFov: 360, vFov: 180},

	// Full equirectangular, monoscopic, so the single view is the whole frame.
	"MONO360": {eyeFracX: 1, eyeFracY: 1, hFov: 360, vFov: 180},

	// Fisheye, 190 degrees in both axes, side by side.
	"FISHEYE190": {eyeFracX: 0.5, eyeFracY: 1, hFov: 190, vFov: 190, fisheye: true},
}

// VRFlatWidth is the natural width of the rectilinear view VR footage is
// flattened to, which is what a caller wanting a VR frame at some other size
// should ask for before scaling the result. Asking for the size it wants
// instead would build a reprojection table of that size, and a caller wanting
// the source's full width would build a very large one.
const VRFlatWidth = vrFlatWidth

// IsVRProjection reports whether a scene's VR mode names a projection this
// package can flatten.
func IsVRProjection(mode string) bool {
	_, ok := projections[mode]
	return ok
}

// A remapper turns frames of a VR projection into the flat view a tile shows.
//
// It holds one sample position per supersample of the output, which is a few
// megabytes and is built once for a whole sheet.
type remapper struct {
	srcW, srcH int
	outW, outH int
	taps       []tap
}

// A tap is one bilinear sample: where in the source frame it reads, and how far
// between texels it falls.
//
// The source position is held as a byte offset rather than as a coordinate pair
// because that is what applying it needs, and resolving it at build time takes
// a multiply out of the inner loop of every frame.
type tap struct {
	off    int32
	fx, fy float32
}

// newRemapper builds the mapping from a VR frame of the given coded size to a
// flat tile.
//
// The returned remapper does not read frames at their coded size. srcSize
// reports the smaller size it wants them scaled to, which the caller should ask
// the decoder for: the GPU is already scaling every frame on its way out, and
// having it scale to a size matched to the tile means the mapping here samples
// a frame that is a few megapixels rather than thirty-two, and that the
// reduction is done by the hardware's filter rather than by point sampling.
func newRemapper(mode string, codedW, codedH, outW, outH int) (*remapper, error) {
	proj, ok := projections[mode]
	if !ok {
		return nil, fmt.Errorf("nativegen: unknown VR projection %q", mode)
	}
	if codedW <= 0 || codedH <= 0 {
		return nil, fmt.Errorf("nativegen: invalid coded size %dx%d", codedW, codedH)
	}
	if outW <= 0 || outH <= 0 {
		return nil, fmt.Errorf("nativegen: invalid tile size %dx%d", outW, outH)
	}

	srcW, srcH := workingSize(proj, codedW, codedH, outW, outH)

	r := &remapper{srcW: srcW, srcH: srcH, outW: outW, outH: outH}
	r.build(proj)
	return r, nil
}

// srcSize returns the frame size this remapper expects to be given.
func (r *remapper) srcSize() (int, int) { return r.srcW, r.srcH }

// flatRanges returns the half-extents of the rectilinear view at unit distance,
// which is to say the tangents of half its horizontal and vertical fields of
// view.
//
// v360 is given a diagonal field of view and splits it between the axes in
// proportion to the output's diagonal, so the horizontal half-angle satisfies
// tan(h_fov/2) = tan(d_fov/2) * w / hypot(w, h) — and since the half-extent at
// unit distance is that tangent, no inverse trigonometry is needed to get it.
func flatRanges() (float64, float64) {
	da := math.Tan(0.5 * vrDFov * math.Pi / 180)
	d := math.Hypot(vrFlatWidth, vrFlatHeight)
	return da * vrFlatWidth / d, da * vrFlatHeight / d
}

// workingSize picks the frame size to have the decoder scale to.
//
// The requirement is that the eye's sub-image still carries enough angular
// detail to feed the supersampled output: at least vrSupersample samples per
// output pixel along each axis, at the centre of the view where a rectilinear
// projection is at its most compressed. Anything beyond that is detail the tile
// cannot show, and every pixel of it costs a copy across PCIe.
//
// The result is never larger than the coded size, so a source that is already
// small is decoded as-is rather than being scaled up to satisfy an appetite the
// footage cannot meet.
func workingSize(proj projection, codedW, codedH, outW, outH int) (int, int) {
	rangeX, rangeY := flatRanges()
	hFovOut := 2 * math.Atan(rangeX) * 180 / math.Pi
	vFovOut := 2 * math.Atan(rangeY) * 180 / math.Pi

	// How many pixels the eye's sub-image needs, spread over the whole sphere
	// it covers, for the view to be sampled densely enough.
	wantEyeW := vrSupersample * float64(outW) * proj.hFov / hFovOut
	wantEyeH := vrSupersample * float64(outH) * proj.vFov / vFovOut

	haveEyeW := float64(codedW) * proj.eyeFracX
	haveEyeH := float64(codedH) * proj.eyeFracY

	scale := math.Max(wantEyeW/haveEyeW, wantEyeH/haveEyeH)
	if scale >= 1 {
		return codedW, codedH
	}

	// Both axes must stay even so that a half-frame eye split lands on a whole
	// pixel, and because the decoder's NV12 intermediate has no representation
	// for an odd one.
	return evenAtLeast(float64(codedW)*scale, 2), evenAtLeast(float64(codedH)*scale, 2)
}

func evenAtLeast(v float64, min int) int {
	n := int(math.Round(v/2)) * 2
	if n < min {
		n = min
	}
	return n
}

// build fills in the sample table.
//
// The output is scanned in the supersampled grid's own raster order, so that
// applying the table is a single forward pass over it.
func (r *remapper) build(proj projection) {
	rangeX, rangeY := flatRanges()

	eyeW := float64(r.srcW) * proj.eyeFracX
	eyeH := float64(r.srcH) * proj.eyeFracY

	// The last texel a bilinear tap may start on, so that the tap's other three
	// texels stay inside the eye and never reach across the seam into the
	// neighbouring one.
	maxU := int32(eyeW) - 2
	maxV := int32(eyeH) - 2
	if maxU < 0 {
		maxU = 0
	}
	if maxV < 0 {
		maxV = 0
	}

	sw := r.outW * vrSupersample
	sh := r.outH * vrSupersample
	stride := int32(r.srcW * 4)

	r.taps = make([]tap, sw*sh)
	for j := 0; j < sh; j++ {
		// The ray through this row of the flat view. Note that y increases
		// downwards, matching the image coordinates on both sides of the
		// mapping, which is what keeps the whole thing free of sign flips.
		y := rangeY * ((2*float64(j)+1)/float64(sh) - 1)

		for i := 0; i < sw; i++ {
			x := rangeX * ((2*float64(i)+1)/float64(sw) - 1)

			var u, v float64
			if proj.fisheye {
				u, v = proj.fisheyeUV(x, y, eyeW, eyeH)
			} else {
				u, v = proj.equirectUV(x, y, eyeW, eyeH)
			}

			u0 := int32(math.Floor(u))
			v0 := int32(math.Floor(v))
			fx := float32(u - float64(u0))
			fy := float32(v - float64(v0))

			// Clamping the texel rather than the angle means a ray that leaves
			// the footage repeats its edge, which is what the equivalent
			// ffmpeg filter does. In practice the flat view is narrower than
			// every projection here, so this never fires on real frames.
			if u0 < 0 {
				u0, fx = 0, 0
			} else if u0 > maxU {
				u0, fx = maxU, 0
			}
			if v0 < 0 {
				v0, fy = 0, 0
			} else if v0 > maxV {
				v0, fy = maxV, 0
			}

			r.taps[j*sw+i] = tap{off: v0*stride + u0*4, fx: fx, fy: fy}
		}
	}
}

// equirectUV maps a ray to a position in an equirectangular eye.
//
// Longitude is measured about the vertical axis from straight ahead and
// latitude from the horizon, and each is scaled by the half-field the footage
// covers, so the same function serves the full 360x180 sphere and the 180x180
// hemisphere of half-equirectangular footage.
func (p projection) equirectUV(x, y float64, eyeW, eyeH float64) (float64, float64) {
	norm := math.Sqrt(x*x + y*y + 1)

	lon := math.Atan2(x, 1)
	lat := math.Asin(y / norm)

	u := (lon/(0.5*p.hFov*math.Pi/180) + 1) * eyeW / 2
	v := (lat/(0.5*p.vFov*math.Pi/180) + 1) * eyeH / 2
	return u, v
}

// fisheyeUV maps a ray to a position in a fisheye eye.
//
// A fisheye stores the angle from the view axis as a radius and the direction
// around that axis as an angle, so the ray's distance off-axis becomes distance
// from the image centre while its bearing is carried through unchanged.
func (p projection) fisheyeUV(x, y float64, eyeW, eyeH float64) (float64, float64) {
	off := math.Hypot(x, y)

	// Straight ahead is the one ray with no bearing at all; it is the centre of
	// the image whichever direction is picked for it.
	if off == 0 {
		return eyeW / 2, eyeH / 2
	}

	// The angle from the view axis, as a fraction of a half-turn, which is the
	// same unit the fields of view below are expressed in.
	r := math.Atan2(off, 1) / math.Pi

	u := (x/off*r/(p.hFov/360) + 1) * eyeW / 2
	v := (y/off*r/(p.vFov/360) + 1) * eyeH / 2
	return u, v
}

// remap renders one frame into a flat tile.
//
// src must be the size srcSize reported; anything else means the decoder was
// configured from a different remapper than the one applying the table, and the
// offsets in it would read the wrong pixels.
func (r *remapper) remap(src *image.RGBA) (*image.RGBA, error) {
	b := src.Bounds()
	if b.Dx() != r.srcW || b.Dy() != r.srcH {
		return nil, fmt.Errorf("nativegen: frame is %dx%d, remapper built for %dx%d",
			b.Dx(), b.Dy(), r.srcW, r.srcH)
	}

	dst := image.NewRGBA(image.Rect(0, 0, r.outW, r.outH))

	// Output rows are independent, and splitting on them rather than on the
	// supersampled rows that feed them is what keeps them independent: the
	// several source rows contributing to one output row all land in the same
	// accumulator, so a worker has to own the whole of it.
	//
	// This is worth parallelising rather than leaving simple. A preview runs the
	// remapper over every frame it keeps, not the eighty-one a sprite sheet
	// needs, and measured on an 8K stereo file it was four seconds of the
	// sixteen a whole preview took.
	workers := runtime.GOMAXPROCS(0)
	if workers > r.outH {
		workers = r.outH
	}
	if workers < 1 {
		workers = 1
	}

	var wg sync.WaitGroup
	band := (r.outH + workers - 1) / workers
	for lo := 0; lo < r.outH; lo += band {
		hi := min(lo+band, r.outH)
		wg.Add(1)
		go func(lo, hi int) {
			defer wg.Done()
			r.remapRows(src, dst, lo, hi)
		}(lo, hi)
	}
	wg.Wait()

	return dst, nil
}

// remapRows renders output rows [lo, hi) of one frame.
func (r *remapper) remapRows(src, dst *image.RGBA, lo, hi int) {
	sw := r.outW * vrSupersample
	stride := src.Stride
	pix := src.Pix
	n := float32(vrSupersample * vrSupersample)

	// Supersamples are accumulated per channel and divided at the end, rather
	// than each being rounded to a byte on the way in. One row's worth is enough
	// to hold, and small enough to stay in cache.
	acc := make([]float32, r.outW*3)

	for oy := lo; oy < hi; oy++ {
		for i := range acc {
			acc[i] = 0
		}

		for s := 0; s < vrSupersample; s++ {
			taps := r.taps[(oy*vrSupersample+s)*sw:][:sw]

			for i, t := range taps {
				out := (i / vrSupersample) * 3

				o := int(t.off)
				w11 := t.fx * t.fy
				w01 := t.fy - w11     // (1-fx)*fy
				w10 := t.fx - w11     // fx*(1-fy)
				w00 := 1 - t.fx - w01 // (1-fx)*(1-fy)

				for c := 0; c < 3; c++ {
					acc[out+c] += w00*float32(pix[o+c]) +
						w10*float32(pix[o+4+c]) +
						w01*float32(pix[o+stride+c]) +
						w11*float32(pix[o+stride+4+c])
				}
			}
		}

		row := dst.Pix[oy*dst.Stride:]
		for x := 0; x < r.outW; x++ {
			for c := 0; c < 3; c++ {
				row[x*4+c] = clampByte(acc[x*3+c] / n)
			}
			row[x*4+3] = 0xff
		}
	}
}

func clampByte(v float32) uint8 {
	switch {
	case v <= 0:
		return 0
	case v >= 255:
		return 255
	}
	return uint8(v + 0.5)
}
