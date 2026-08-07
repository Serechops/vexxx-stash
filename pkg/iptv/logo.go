package iptv

// Channel logos have to survive a trip through an Android TV app, which is a
// narrower pipe than a browser. Roughly half the studio logos in a typical
// library are SVG, and none of the clients this feature targets can display one:
// TiviMate, IPTV Smarters and OTT Navigator all load images through Glide or
// Coil, neither of which ships an SVG decoder. The logo simply never appears and
// nothing is logged anywhere. So SVG is rasterised to PNG before it is handed
// out, and PNG/JPEG pass through untouched.

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	_ "image/gif"  // registered so a GIF logo decodes for resizing
	_ "image/jpeg" // ditto
	"image/png"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/srwiley/oksvg"
	"github.com/srwiley/rasterx"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // ditto
)

// LogoMaxDim bounds a rasterised logo's longest side. Every one of these clients
// draws the logo into a small tile beside the channel name, so anything larger
// is bytes nobody ever sees.
const LogoMaxDim = 320

// svgSniffLimit is how far into a blob to look for the root element. A real SVG
// puts it within a few hundred bytes, after at most an XML declaration, a
// doctype and a comment.
const svgSniffLimit = 2048

// ErrBlankSVG means the file parsed but drew nothing. Callers should treat it
// like a missing logo rather than serving the result: a fully transparent PNG
// renders as an empty box on the client, which looks like a bug rather than an
// absent image.
var ErrBlankSVG = errors.New("svg rendered blank")

// IsSVG reports whether data looks like an SVG document.
//
// http.DetectContentType is no help here — it classifies SVG as text/xml or
// even text/plain, which is indistinguishable from any other XML blob.
func IsSVG(data []byte) bool {
	head := data
	if len(head) > svgSniffLimit {
		head = head[:svgSniffLimit]
	}
	return bytes.Contains(bytes.ToLower(head), []byte("<svg"))
}

// LogoImage converts a stored studio logo into something a TV client can
// actually decode, returning the bytes and the content type to serve them with.
//
// PNG and JPEG are handed back untouched — every client decodes them, and
// re-encoding would only cost quality. Only SVG is converted.
func LogoImage(data []byte, maxDim int) ([]byte, string, error) {
	if len(data) == 0 {
		return nil, "", errors.New("no image data")
	}

	if !IsSVG(data) {
		return fitRaster(data, maxDim)
	}

	// An SVG that is really just a wrapper around a bitmap is common among
	// scraped logos, and oksvg has no <image> support whatsoever — it would
	// render the decorative vector bits and silently drop the actual logo. The
	// embedded bitmap is the image.
	if raster := embeddedRaster(data); raster != nil {
		return fitRaster(raster, maxDim)
	}

	rendered, err := RasterizeSVG(data, maxDim)
	if err != nil {
		return nil, "", err
	}
	return rendered, "image/png", nil
}

// fitRaster shrinks an oversized bitmap to maxDim, returning it and its content
// type. An image already within bounds — or one that cannot be decoded — is
// passed through byte for byte, since re-encoding could only lose quality.
//
// Size matters here because a client refetches every channel's logo whenever it
// refreshes the guide, and a logo lifted out of an SVG wrapper is often the
// full-resolution original: one library had a 1656px-wide PNG behind a studio
// tile a few dozen pixels across.
func fitRaster(data []byte, maxDim int) ([]byte, string, error) {
	if maxDim <= 0 {
		maxDim = LogoMaxDim
	}
	contentType := http.DetectContentType(data)

	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data, contentType, nil
	}

	b := src.Bounds()
	longest := b.Dx()
	if b.Dy() > longest {
		longest = b.Dy()
	}
	if longest <= maxDim || longest == 0 {
		return data, contentType, nil
	}

	scale := float64(maxDim) / float64(longest)
	w := int(math.Round(float64(b.Dx()) * scale))
	h := int(math.Round(float64(b.Dy()) * scale))
	if w < 1 {
		w = 1
	}
	if h < 1 {
		h = 1
	}

	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, b, xdraw.Over, nil)

	var buf bytes.Buffer
	if err := png.Encode(&buf, dst); err != nil {
		return data, contentType, nil // the original is still perfectly serveable
	}
	return buf.Bytes(), "image/png", nil
}

// svgDataURIRE matches an embedded base64 bitmap on any element that takes an
// href, which in practice means <image>.
var svgDataURIRE = regexp.MustCompile(`(?is)(?:xlink:)?href\s*=\s*["']\s*data:image/(?:png|jpe?g|gif|webp|bmp)\s*;\s*base64\s*,([A-Za-z0-9+/=\s]+)["']`)

// embeddedRaster returns the largest bitmap embedded in an SVG as a data URI,
// or nil if there is none. Largest, because a logo wrapper often also carries a
// tiny favicon or spacer, and the one that matters is the big one.
func embeddedRaster(data []byte) []byte {
	var best []byte

	for _, m := range svgDataURIRE.FindAllSubmatch(data, -1) {
		// Data URIs in real files are wrapped across lines; base64 decoding is
		// whitespace-intolerant.
		clean := bytes.Map(func(r rune) rune {
			if unicode.IsSpace(r) {
				return -1
			}
			return r
		}, m[1])

		decoded := make([]byte, base64.StdEncoding.DecodedLen(len(clean)))
		n, err := base64.StdEncoding.Decode(decoded, clean)
		if err != nil || n == 0 {
			continue
		}
		if n > len(best) {
			best = decoded[:n]
		}
	}

	return best
}

// RasterizeSVG renders an SVG to PNG with its longest side at maxDim, preserving
// both the source aspect ratio and its transparency.
//
// Scaling up is free and worth doing: the source is resolution independent, so a
// 16px-viewBox icon and a 1000px one should both arrive as a crisp tile.
func RasterizeSVG(data []byte, maxDim int) ([]byte, error) {
	if maxDim <= 0 {
		maxDim = LogoMaxDim
	}

	// IgnoreErrorMode, deliberately. Studio logos are scraped from all over the
	// web and routinely contain constructs oksvg has no support for — filters,
	// embedded fonts, nested SVG. Dropping those elements still yields a usable
	// logo; rejecting the whole file yields none, and the blank check below
	// catches the case where too much was dropped to be worth serving.
	icon, err := oksvg.ReadIconStream(bytes.NewReader(normalizeSVG(data)), oksvg.IgnoreErrorMode)
	if err != nil {
		return nil, fmt.Errorf("parsing svg: %w", err)
	}

	vbW, vbH := icon.ViewBox.W, icon.ViewBox.H
	if vbW <= 0 || vbH <= 0 || math.IsNaN(vbW) || math.IsNaN(vbH) {
		// No viewBox and no width/height. SetTarget divides by these, so letting
		// it through would make every coordinate NaN and produce a blank image
		// instead of an error.
		return nil, errors.New("svg has no usable dimensions")
	}

	scale := float64(maxDim) / math.Max(vbW, vbH)
	w := int(math.Round(vbW * scale))
	h := int(math.Round(vbH * scale))
	if w < 1 {
		w = 1
	}
	if h < 1 {
		h = 1
	}

	img := image.NewRGBA(image.Rect(0, 0, w, h))
	icon.SetTarget(0, 0, float64(w), float64(h))
	icon.Draw(rasterx.NewDasher(w, h, rasterx.NewScannerGV(w, h, img, img.Bounds())), 1.0)

	if isFullyTransparent(img) {
		return nil, ErrBlankSVG
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("encoding png: %w", err)
	}
	return buf.Bytes(), nil
}

// normalizeSVG rewrites the handful of perfectly valid constructs that oksvg
// cannot read, without changing what the image is meant to look like.
func normalizeSVG(data []byte) []byte {
	return rewriteSymbols(normalizeSVGRoot(data))
}

var (
	svgSymbolOpenRE  = regexp.MustCompile(`(?is)<symbol\b`)
	svgSymbolCloseRE = regexp.MustCompile(`(?is)</\s*symbol\s*>`)
)

// rewriteSymbols turns <symbol> into <g>.
//
// The icon-sprite idiom — <defs><symbol id="x">…</symbol></defs><use href="#x"/>
// — is what any site that inlines its logo emits, but "symbol" is not in oksvg's
// element table, so its children are never collected and <use> resolves to
// nothing. The whole logo renders blank. A <g> is close enough: oksvg groups and
// resolves it correctly, and the only thing lost is the symbol's own viewBox,
// which on a single-icon sprite matches the root's anyway.
func rewriteSymbols(data []byte) []byte {
	if !svgSymbolOpenRE.Match(data) {
		return data
	}
	data = svgSymbolOpenRE.ReplaceAll(data, []byte("<g"))
	return svgSymbolCloseRE.ReplaceAll(data, []byte("</g>"))
}

// svgRootRE matches the opening <svg> tag, which is the only element whose
// width and height attributes decide the output size.
var svgRootRE = regexp.MustCompile(`(?is)<svg\b[^>]*>`)

// svgDimRE matches a width or height attribute inside that tag.
var svgDimRE = regexp.MustCompile(`(?is)\s(width|height)\s*=\s*"([^"]*)"|\s(width|height)\s*=\s*'([^']*)'`)

// normalizeSVGRoot rewrites the root element's width and height into the plain
// numbers oksvg insists on.
//
// oksvg parses those attributes with a bare ParseFloat and returns on the first
// error, abandoning the rest of the tag. So `width="100%"` — extremely common,
// and always paired with a perfectly good viewBox — makes it give up *before*
// reading that viewBox, leaving the icon with no dimensions at all. `width="24px"`
// fails identically. Three of the studio logos in a real library hit this.
//
// A unit-bearing length keeps its number, since for these purposes px, pt and em
// are all just "some units"; a percentage is dropped entirely, because it is
// meaningless without a viewport and the viewBox is the better answer anyway.
func normalizeSVGRoot(data []byte) []byte {
	loc := svgRootRE.FindIndex(data)
	if loc == nil {
		return data
	}

	tag := data[loc[0]:loc[1]]
	fixed := svgDimRE.ReplaceAllFunc(tag, func(attr []byte) []byte {
		m := svgDimRE.FindSubmatch(attr)

		name, value := m[1], m[2]
		if len(name) == 0 {
			name, value = m[3], m[4] // single-quoted form
		}

		num := leadingNumber(string(value))
		if num == "" || bytes.Contains(value, []byte("%")) {
			return []byte(" ") // drop it; keep the tokens either side apart
		}
		return []byte(fmt.Sprintf(` %s="%s"`, name, num))
	})

	out := make([]byte, 0, len(data)+len(fixed)-len(tag))
	out = append(out, data[:loc[0]]...)
	out = append(out, fixed...)
	return append(out, data[loc[1]:]...)
}

// leadingNumber returns the numeric prefix of a CSS length, or "" if there
// isn't one.
func leadingNumber(s string) string {
	s = strings.TrimSpace(s)
	end := 0
	for end < len(s) {
		c := s[end]
		if (c >= '0' && c <= '9') || c == '.' || (end == 0 && (c == '-' || c == '+')) {
			end++
			continue
		}
		break
	}
	if _, err := strconv.ParseFloat(s[:end], 64); err != nil {
		return ""
	}
	return s[:end]
}

// isFullyTransparent reports whether nothing at all was drawn. Reading the alpha
// bytes directly walks the buffer once with no per-pixel interface calls, which
// keeps this negligible against the cost of rasterising.
func isFullyTransparent(img *image.RGBA) bool {
	for i := 3; i < len(img.Pix); i += 4 {
		if img.Pix[i] != 0 {
			return false
		}
	}
	return true
}
