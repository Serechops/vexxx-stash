package nativegen

import (
	"image"
	"math"
	"testing"
)

func TestFlatRanges(t *testing.T) {
	rangeX, rangeY := flatRanges()

	hFov := 2 * math.Atan(rangeX) * 180 / math.Pi
	vFov := 2 * math.Atan(rangeY) * 180 / math.Pi

	// The diagonal has to come back out at what was asked for, and the two axes
	// have to be split in proportion to the output's own diagonal. Between them
	// these pin the split completely, without restating the arithmetic that
	// produced it.
	dFov := 2 * math.Atan(math.Hypot(rangeX, rangeY)) * 180 / math.Pi
	if math.Abs(dFov-vrDFov) > 0.01 {
		t.Errorf("diagonal field of view = %.4f degrees, want %.0f", dFov, vrDFov)
	}
	if got, want := rangeX/rangeY, float64(vrFlatWidth)/float64(vrFlatHeight); math.Abs(got-want) > 1e-9 {
		t.Errorf("the view is %.6f times wider than tall, want %.6f", got, want)
	}

	// The angles that follow, recorded so that a change to the constants above
	// has to be a deliberate one: these are what the tiles frame.
	if math.Abs(hFov-112.9573) > 0.001 {
		t.Errorf("horizontal field of view = %.4f degrees, want 112.9573", hFov)
	}
	if math.Abs(vFov-80.6730) > 0.001 {
		t.Errorf("vertical field of view = %.4f degrees, want 80.6730", vFov)
	}
}

func TestVRTileSize(t *testing.T) {
	// A VR tile's shape comes from the rectilinear view, not from the source,
	// so every one of these is 16:9 however the footage was stored.
	for _, width := range []int{160, 320, 640} {
		w, h := vrTileSize(width)
		if w != width {
			t.Errorf("vrTileSize(%d) width = %d", width, w)
		}
		if got, want := float64(w)/float64(h), 16.0/9.0; math.Abs(got-want) > 0.01 {
			t.Errorf("vrTileSize(%d) = %dx%d, aspect %.3f, want %.3f", width, w, h, got, want)
		}
		if h%2 != 0 {
			t.Errorf("vrTileSize(%d) height %d is odd", width, h)
		}
	}

	if w, h := vrTileSize(320); w != 320 || h != 180 {
		t.Errorf("vrTileSize(320) = %dx%d, want 320x180", w, h)
	}
}

func TestCentreRayHitsCentreOfEye(t *testing.T) {
	// The tile looks straight ahead, and straight ahead is the middle of the
	// eye's sub-image in every one of these projections. It is the one point of
	// the mapping that can be asserted without reproducing the mapping.
	for mode, proj := range projections {
		t.Run(mode, func(t *testing.T) {
			const eyeW, eyeH = 1000.0, 800.0

			var u, v float64
			if proj.fisheye {
				u, v = proj.fisheyeUV(0, 0, eyeW, eyeH)
			} else {
				u, v = proj.equirectUV(0, 0, eyeW, eyeH)
			}

			if math.Abs(u-eyeW/2) > 1e-9 || math.Abs(v-eyeH/2) > 1e-9 {
				t.Errorf("the ray straight ahead maps to (%.3f, %.3f), want (%.1f, %.1f)",
					u, v, eyeW/2, eyeH/2)
			}
		})
	}
}

func TestProjectionsAreEqualAngleOnTheAxes(t *testing.T) {
	// Both mappings are meant to be equal-angle along the horizontal and
	// vertical through the centre: a ray a given number of degrees off-axis
	// should land that same fraction of the way to the edge of the sub-image,
	// scaled by the field of view the footage covers. This is what makes the
	// field of view mean anything, and it is what a half-field mistaken for a
	// full one would break.
	//
	// The angles are ones a flat view can actually produce. It looks along a
	// fixed axis, so it can never see a ray at, say, the 180 degrees that
	// bounds an equirectangular frame — which is also why the tiles never reach
	// the edge of the footage.
	for mode, proj := range projections {
		t.Run(mode, func(t *testing.T) {
			const eyeW, eyeH = 1000.0, 800.0
			const angle = 30.0

			uv := proj.equirectUV
			if proj.fisheye {
				uv = proj.fisheyeUV
			}

			offAxis := math.Tan(angle * math.Pi / 180)

			u, _ := uv(offAxis, 0, eyeW, eyeH)
			wantU := (angle/(proj.hFov/2) + 1) * eyeW / 2
			if math.Abs(u-wantU) > 0.5 {
				t.Errorf("a ray %.0f degrees to the right maps to u=%.2f, want %.2f "+
					"for footage covering %.0f degrees", angle, u, wantU, proj.hFov)
			}

			_, v := uv(0, offAxis, eyeW, eyeH)
			wantV := (angle/(proj.vFov/2) + 1) * eyeH / 2
			if math.Abs(v-wantV) > 0.5 {
				t.Errorf("a ray %.0f degrees below maps to v=%.2f, want %.2f "+
					"for footage covering %.0f degrees", angle, v, wantV, proj.vFov)
			}
		})
	}
}

func TestWorkingSizeNeverExceedsSource(t *testing.T) {
	sizes := [][2]int{{8000, 4000}, {5760, 2880}, {3840, 1920}, {1920, 960}, {640, 320}}

	for mode, proj := range projections {
		for _, s := range sizes {
			w, h := workingSize(proj, s[0], s[1], 320, 180)

			if w > s[0] || h > s[1] {
				t.Errorf("%s %dx%d: working size %dx%d is larger than the source",
					mode, s[0], s[1], w, h)
			}
			if w%2 != 0 || h%2 != 0 {
				t.Errorf("%s %dx%d: working size %dx%d has an odd axis, which cannot hold "+
					"an even eye split or an NV12 chroma plane", mode, s[0], s[1], w, h)
			}
		}
	}
}

func TestWorkingSizeFollowsHowMuchSphereTheEyeHolds(t *testing.T) {
	const codedW, codedH = 8000, 4000

	lr, _ := workingSize(projections["LR180"], codedW, codedH, 320, 180)
	mono, _ := workingSize(projections["MONO360"], codedW, codedH, 320, 180)
	_, tb := workingSize(projections["TB360"], codedW, codedH, 320, 180)
	_, monoH := workingSize(projections["MONO360"], codedW, codedH, 320, 180)

	// LR180's eye is half the frame but covers half the longitude, so per degree
	// the two come out the same width.
	if lr != mono {
		t.Errorf("LR180 wants %d wide and MONO360 %d, but their eyes carry the "+
			"same detail per degree", lr, mono)
	}

	// TB360 packs its eyes vertically, so each holds 180 degrees of latitude in
	// half the rows and the frame has to be taller to compensate.
	if tb <= monoH {
		t.Errorf("TB360 wants %d rows and MONO360 %d, but TB360's eye has only "+
			"half of them", tb, monoH)
	}
}

func TestRemapTapsStayInsideTheEye(t *testing.T) {
	// Taps are byte offsets applied without bounds checks to every frame, so
	// this is the property that keeps the inner loop safe. It also has to hold
	// more strictly than safety alone requires: a tap that strayed past the eye
	// would read the neighbouring one, which is a picture of the same scene from
	// the other eye and so would not look wrong.
	for mode, proj := range projections {
		t.Run(mode, func(t *testing.T) {
			rm, err := newRemapper(mode, 8000, 4000, 320, 180)
			if err != nil {
				t.Fatalf("newRemapper: %v", err)
			}

			stride := int32(rm.srcW * 4)
			eyeW := int32(float64(rm.srcW) * proj.eyeFracX)
			eyeH := int32(float64(rm.srcH) * proj.eyeFracY)

			for i, tp := range rm.taps {
				u := (tp.off % stride) / 4
				v := tp.off / stride

				if u < 0 || u > eyeW-2 || v < 0 || v > eyeH-2 {
					t.Fatalf("tap %d reads (%d, %d), outside the %dx%d eye", i, u, v, eyeW, eyeH)
				}
				if tp.fx < 0 || tp.fx > 1 || tp.fy < 0 || tp.fy > 1 {
					t.Fatalf("tap %d has weights (%v, %v) outside [0,1]", i, tp.fx, tp.fy)
				}
			}
		})
	}
}

func TestRemapDoesNotNeedClamping(t *testing.T) {
	// The flat view is narrower than every projection in the table, so no ray
	// should ever leave the footage and need clamping to its edge. If one did,
	// the tile would have a smeared border, and the clamp in build would be
	// load-bearing rather than defensive.
	for mode, proj := range projections {
		t.Run(mode, func(t *testing.T) {
			rm, err := newRemapper(mode, 8000, 4000, 320, 180)
			if err != nil {
				t.Fatalf("newRemapper: %v", err)
			}

			stride := int32(rm.srcW * 4)
			eyeW := int32(float64(rm.srcW) * proj.eyeFracX)
			eyeH := int32(float64(rm.srcH) * proj.eyeFracY)

			for i, tp := range rm.taps {
				u := (tp.off % stride) / 4
				v := tp.off / stride

				if u == 0 || u >= eyeW-2 || v == 0 || v >= eyeH-2 {
					t.Fatalf("tap %d sits on the edge of the eye at (%d, %d) in a %dx%d eye, "+
						"so the view is reaching outside the footage", i, u, v, eyeW, eyeH)
				}
			}
		})
	}
}

func TestRemapRejectsAFrameOfTheWrongSize(t *testing.T) {
	rm, err := newRemapper("LR180", 8000, 4000, 320, 180)
	if err != nil {
		t.Fatalf("newRemapper: %v", err)
	}

	// A frame that is not the size the table was built for would be read at the
	// wrong offsets, and for a smaller one, past its end.
	if _, err := rm.remap(image.NewRGBA(image.Rect(0, 0, 640, 360))); err == nil {
		t.Error("remap accepted a frame that is not the size it asked for")
	}
}

func TestRemapAveragesTheSourceItReads(t *testing.T) {
	rm, err := newRemapper("MONO360", 4000, 2000, 320, 180)
	if err != nil {
		t.Fatalf("newRemapper: %v", err)
	}

	// A uniform source must come back uniform: any weight that did not sum to
	// one, or any accumulator that double-counted a supersample, would show up
	// here as a shift in level.
	srcW, srcH := rm.srcSize()
	src := image.NewRGBA(image.Rect(0, 0, srcW, srcH))
	for i := 0; i < len(src.Pix); i += 4 {
		src.Pix[i], src.Pix[i+1], src.Pix[i+2], src.Pix[i+3] = 40, 130, 220, 0xff
	}

	tile, err := rm.remap(src)
	if err != nil {
		t.Fatalf("remap: %v", err)
	}

	if b := tile.Bounds(); b.Dx() != 320 || b.Dy() != 180 {
		t.Fatalf("tile is %v, want 320x180", b)
	}
	for i := 0; i < len(tile.Pix); i += 4 {
		if tile.Pix[i] != 40 || tile.Pix[i+1] != 130 || tile.Pix[i+2] != 220 || tile.Pix[i+3] != 0xff {
			t.Fatalf("pixel %d is (%d, %d, %d, %d), want (40, 130, 220, 255)",
				i/4, tile.Pix[i], tile.Pix[i+1], tile.Pix[i+2], tile.Pix[i+3])
		}
	}
}

func TestUnknownProjectionIsDeclined(t *testing.T) {
	if IsVRProjection("SPHERICAL270") {
		t.Error("IsVRProjection accepted a mode with no entry in the table")
	}
	if !IsVRProjection("LR180") {
		t.Error("IsVRProjection rejected LR180")
	}

	if _, err := newRemapper("SPHERICAL270", 8000, 4000, 320, 180); err == nil {
		t.Error("newRemapper built a mapping for a projection it does not know")
	}
}
