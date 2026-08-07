package iptv

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
)

// squareSVG is the simplest thing that draws: a filled rect covering the whole
// viewBox, so any successful render is unambiguously non-blank.
const squareSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">` +
	`<rect x="0" y="0" width="100" height="50" fill="#ff0000"/></svg>`

func decodePNG(t *testing.T, data []byte) image.Image {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("result is not a decodable PNG: %v", err)
	}
	return img
}

func TestIsSVG(t *testing.T) {
	cases := []struct {
		name string
		data string
		want bool
	}{
		{"bare root", squareSVG, true},
		{"xml declaration and doctype first", `<?xml version="1.0"?><!DOCTYPE svg><svg viewBox="0 0 1 1"/>`, true},
		{"uppercase", `<SVG VIEWBOX="0 0 1 1"/>`, true},
		{"png magic", "\x89PNG\r\n\x1a\n", false},
		{"unrelated xml", `<?xml version="1.0"?><rss><channel/></rss>`, false},
		{"empty", "", false},
	}

	for _, c := range cases {
		if got := IsSVG([]byte(c.data)); got != c.want {
			t.Errorf("%s: IsSVG = %v, want %v", c.name, got, c.want)
		}
	}
}

// An <svg> buried past the sniff window is not something a real file does, and
// scanning an entire multi-megabyte blob for it would be wasteful.
func TestIsSVGIgnoresLateRoot(t *testing.T) {
	data := append(bytes.Repeat([]byte(" "), svgSniffLimit+10), []byte("<svg/>")...)
	if IsSVG(data) {
		t.Error("root element beyond the sniff limit should not count as SVG")
	}
}

func TestRasterizePreservesAspectAndFitsMaxDim(t *testing.T) {
	out, err := RasterizeSVG([]byte(squareSVG), 200)
	if err != nil {
		t.Fatalf("rasterize: %v", err)
	}

	b := decodePNG(t, out).Bounds()
	if b.Dx() != 200 || b.Dy() != 100 {
		t.Errorf("got %dx%d, want 200x100 — a 2:1 viewBox scaled to its longest side", b.Dx(), b.Dy())
	}
}

// Scaling up matters as much as scaling down: SVG is resolution independent, so
// a tiny viewBox should still arrive as a full-size tile rather than a 16px one.
func TestRasterizeScalesSmallViewBoxUp(t *testing.T) {
	tiny := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#fff"/></svg>`

	out, err := RasterizeSVG([]byte(tiny), 320)
	if err != nil {
		t.Fatalf("rasterize: %v", err)
	}
	if b := decodePNG(t, out).Bounds(); b.Dx() != 320 {
		t.Errorf("16px viewBox rendered at %dpx, want 320", b.Dx())
	}
}

func TestRasterizeKeepsTransparency(t *testing.T) {
	// A rect covering only the left half leaves the right half untouched.
	half := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="50" height="100" fill="#000"/></svg>`

	out, err := RasterizeSVG([]byte(half), 100)
	if err != nil {
		t.Fatalf("rasterize: %v", err)
	}

	img := decodePNG(t, out)
	if _, _, _, a := img.At(90, 50).RGBA(); a != 0 {
		t.Errorf("uncovered pixel has alpha %d, want 0 — logos must stay transparent", a)
	}
	if _, _, _, a := img.At(10, 50).RGBA(); a == 0 {
		t.Error("covered pixel is transparent, so nothing was actually drawn")
	}
}

// The regression this whole normalisation step exists for. oksvg parses width
// with a bare ParseFloat and returns on the first error, so `width="100%"` makes
// it abandon the tag before ever reading the viewBox that follows.
func TestRasterizeHandlesPercentageRootDimensions(t *testing.T) {
	svg := `<svg width="100%" height="100%" viewBox="0 0 1280 136" xmlns="http://www.w3.org/2000/svg">` +
		`<rect width="1280" height="136" fill="#fff"/></svg>`

	out, err := RasterizeSVG([]byte(svg), 320)
	if err != nil {
		t.Fatalf(`width="100%%" should not defeat the viewBox: %v`, err)
	}
	if b := decodePNG(t, out).Bounds(); b.Dx() != 320 {
		t.Errorf("width %d, want 320 (viewBox aspect preserved)", b.Dx())
	}
}

// Same failure mode, different trigger: a unit suffix is equally unparseable.
func TestRasterizeHandlesUnitSuffixedRootDimensions(t *testing.T) {
	for _, dim := range []string{"200px", "10em", "5.5pt", "3in"} {
		svg := `<svg width="` + dim + `" height="` + dim + `" xmlns="http://www.w3.org/2000/svg">` +
			`<rect width="200" height="200" fill="#fff"/></svg>`

		if _, err := RasterizeSVG([]byte(svg), 100); err != nil {
			t.Errorf("width=%q: %v", dim, err)
		}
	}
}

func TestRasterizeRejectsDimensionlessSVG(t *testing.T) {
	// No viewBox, and percentage width/height that carry no absolute size.
	svg := `<svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><rect fill="#fff"/></svg>`

	if _, err := RasterizeSVG([]byte(svg), 100); err == nil {
		t.Error("an SVG with no derivable size should error, not render a NaN-sized blank")
	}
}

func TestRasterizeReportsBlankRender(t *testing.T) {
	// Valid and parseable, but draws nothing at all.
	svg := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>`

	if _, err := RasterizeSVG([]byte(svg), 100); err != ErrBlankSVG {
		t.Errorf("got %v, want ErrBlankSVG — a fully transparent logo must be reported so the caller can fall back", err)
	}
}

// <defs><symbol id="x">…</symbol></defs><use href="#x"/> is what any site that
// inlines an icon sprite emits, and "symbol" is not in oksvg's element table, so
// the logo renders completely blank without the rewrite.
func TestRasterizeHandlesSymbolSprites(t *testing.T) {
	svg := `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100">` +
		`<defs><symbol id="logo" viewBox="0 0 100 100"><rect width="100" height="100" fill="#fff"/></symbol></defs>` +
		`<use xlink:href="#logo"></use></svg>`

	if _, err := RasterizeSVG([]byte(svg), 100); err != nil {
		t.Fatalf("symbol sprite failed to render: %v", err)
	}
}

func TestLogoImagePassesRasterThrough(t *testing.T) {
	var buf bytes.Buffer
	src := image.NewRGBA(image.Rect(0, 0, 40, 40))
	src.Set(0, 0, color.RGBA{1, 2, 3, 255})
	if err := png.Encode(&buf, src); err != nil {
		t.Fatal(err)
	}
	original := buf.Bytes()

	out, contentType, err := LogoImage(original, LogoMaxDim)
	if err != nil {
		t.Fatalf("LogoImage: %v", err)
	}
	if contentType != "image/png" {
		t.Errorf("content type %q, want image/png", contentType)
	}
	if !bytes.Equal(out, original) {
		t.Error("a raster already within bounds must be returned byte for byte, not re-encoded")
	}
}

func TestLogoImageShrinksOversizedRaster(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 1656, 153))); err != nil {
		t.Fatal(err)
	}

	out, _, err := LogoImage(buf.Bytes(), 320)
	if err != nil {
		t.Fatalf("LogoImage: %v", err)
	}

	b := decodePNG(t, out).Bounds()
	if b.Dx() != 320 {
		t.Errorf("width %d, want 320", b.Dx())
	}
	if b.Dy() != 30 {
		t.Errorf("height %d, want 30 — aspect ratio must survive the shrink", b.Dy())
	}
}

// An SVG that is only a wrapper around a bitmap is common among scraped logos,
// and oksvg cannot draw <image> at all — it would render whatever decorative
// paths surround it and silently drop the actual logo.
func TestLogoImagePrefersEmbeddedRaster(t *testing.T) {
	var buf bytes.Buffer
	inner := image.NewRGBA(image.Rect(0, 0, 64, 32))
	inner.Set(1, 1, color.RGBA{9, 9, 9, 255})
	if err := png.Encode(&buf, inner); err != nil {
		t.Fatal(err)
	}
	encoded := base64.StdEncoding.EncodeToString(buf.Bytes())

	svg := `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 32">` +
		`<path d="m0 0h1v1h-1z"/>` +
		`<image width="64" height="32" xlink:href="data:image/png;base64,` + encoded + `"/></svg>`

	out, contentType, err := LogoImage([]byte(svg), LogoMaxDim)
	if err != nil {
		t.Fatalf("LogoImage: %v", err)
	}
	if contentType != "image/png" {
		t.Errorf("content type %q, want image/png", contentType)
	}
	if !bytes.Equal(out, buf.Bytes()) {
		t.Error("the embedded bitmap should be served, not the vector fragments around it")
	}
}

// Real data URIs are line-wrapped by the tools that write them, and base64
// decoding is whitespace-intolerant.
func TestEmbeddedRasterToleratesWrappedBase64(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 8, 8))); err != nil {
		t.Fatal(err)
	}

	encoded := base64.StdEncoding.EncodeToString(buf.Bytes())
	var wrapped strings.Builder
	for i := 0; i < len(encoded); i += 40 {
		end := i + 40
		if end > len(encoded) {
			end = len(encoded)
		}
		wrapped.WriteString(encoded[i:end] + "\n            ")
	}

	svg := `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="data:image/png;base64,` +
		wrapped.String() + `"/></svg>`

	if got := embeddedRaster([]byte(svg)); !bytes.Equal(got, buf.Bytes()) {
		t.Errorf("wrapped data URI decoded to %d bytes, want %d", len(got), buf.Len())
	}
}

// A wrapper often also carries a tiny spacer or favicon; the one that matters is
// the big one.
func TestEmbeddedRasterPicksTheLargest(t *testing.T) {
	small := base64.StdEncoding.EncodeToString([]byte("tiny"))
	large := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("L"), 500))

	svg := `<svg xmlns:xlink="http://www.w3.org/1999/xlink">` +
		`<image xlink:href="data:image/png;base64,` + small + `"/>` +
		`<image xlink:href="data:image/png;base64,` + large + `"/></svg>`

	if got := embeddedRaster([]byte(svg)); len(got) != 500 {
		t.Errorf("picked a %d-byte image, want the 500-byte one", len(got))
	}
}

func TestEmbeddedRasterAbsentFromPlainSVG(t *testing.T) {
	if got := embeddedRaster([]byte(squareSVG)); got != nil {
		t.Errorf("pure vector SVG reported a %d-byte embedded raster", len(got))
	}
}

func TestLogoImageRejectsEmptyInput(t *testing.T) {
	if _, _, err := LogoImage(nil, LogoMaxDim); err == nil {
		t.Error("empty input should error so the caller falls back to the default logo")
	}
}

func TestNormalizeSVGRootLeavesNumericDimensionsAlone(t *testing.T) {
	svg := []byte(`<svg width="100" height="50" viewBox="0 0 100 50"><rect/></svg>`)

	if got := normalizeSVGRoot(svg); !bytes.Equal(got, svg) {
		t.Errorf("already-valid root was rewritten:\n got %s\nwant %s", got, svg)
	}
}

// Only the root element decides the output size, and rewriting dimensions on
// child elements would corrupt the drawing.
func TestNormalizeSVGRootIgnoresChildElements(t *testing.T) {
	svg := []byte(`<svg viewBox="0 0 10 10"><rect width="100%" height="100%"/></svg>`)

	if got := normalizeSVGRoot(svg); !bytes.Contains(got, []byte(`<rect width="100%" height="100%"/>`)) {
		t.Errorf("child element was rewritten: %s", got)
	}
}
