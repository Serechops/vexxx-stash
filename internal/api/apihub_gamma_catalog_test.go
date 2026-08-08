package api

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

// Tests for the platform mechanics Adult Time and EvilAngel share. Anything
// site-specific lives in apihub_{adulttime,evilangel}_catalog_test.go.

// ─── window.env extraction ────────────────────────────────────────────────────

func TestExtractWindowEnvHandlesBracesInsideStrings(t *testing.T) {
	// A regex cannot do this, which is why the extractor counts braces: the
	// page really does carry brace characters inside string values.
	html := `<script>window.env = {"api":{"algolia":{"apiKey":"a}b{c","applicationID":"X"}},"n":1};</script>`

	got, ok := gammaExtractWindowEnv(html)
	if !ok {
		t.Fatal("window.env not found")
	}
	if !strings.HasSuffix(got, `"n":1}`) {
		t.Errorf("stopped at a brace inside a string literal: %s", got)
	}
}

func TestExtractWindowEnvRefusesAnUnterminatedObject(t *testing.T) {
	if _, ok := gammaExtractWindowEnv(`window.env = {"api":{`); ok {
		t.Error("a truncated page should fail rather than yield a half object")
	}
	if _, ok := gammaExtractWindowEnv(`<html>nothing here</html>`); ok {
		t.Error("a page with no window.env should report as much")
	}
}

func TestKeyExpiryIsReadFromTheKeyItself(t *testing.T) {
	// Shape of a real secured key: hmac then urlencoded params, base64'd.
	raw := "deadbeef" + "validUntil=1786166359&restrictIndices=all%2A"
	key := base64.StdEncoding.EncodeToString([]byte(raw))

	got := gammaKeyExpiry(key)
	if want := time.Unix(1786166359, 0); !got.Equal(want) {
		t.Errorf("expiry = %s, want %s", got, want)
	}
}

func TestUnreadableKeyIsAssumedShortLived(t *testing.T) {
	// Guessing high would mean serving every request with a dead key until they
	// all failed; guessing low costs one extra scrape.
	got := gammaKeyExpiry("not base64 at all !!")
	if d := time.Until(got); d > time.Hour {
		t.Errorf("an unreadable key was trusted for %s", d)
	}
}

// ─── date banding ─────────────────────────────────────────────────────────────

func TestBandsCoverTheWholeCatalogWithoutGaps(t *testing.T) {
	bands := gammaBands(2026)
	if len(bands) != gammaSampleBands {
		t.Fatalf("got %d bands, want %d", len(bands), gammaSampleBands)
	}

	first := time.Date(gammaFirstYear, time.January, 1, 0, 0, 0, 0, time.UTC).Unix()
	if bands[0].from != first {
		t.Errorf("first band starts at %d, want %d", bands[0].from, first)
	}
	for i := 1; i < len(bands); i++ {
		if bands[i].from != bands[i-1].to {
			t.Errorf("gap or overlap between band %d and %d", i-1, i)
		}
	}

	// A scene released today must land in the last band, and so must one dated
	// slightly ahead of today — the index carries those.
	last := bands[len(bands)-1]
	for _, ts := range []int64{time.Now().Unix(), time.Now().AddDate(0, 2, 0).Unix()} {
		if ts < last.from || ts >= last.to {
			t.Errorf("timestamp %d falls outside every band", ts)
		}
	}
}

func TestBandFilterIsAHalfOpenRangeAndCarriesTheBaseFilter(t *testing.T) {
	b := gammaBand{from: 100, to: 200}
	want := gammaBaseFilter + " AND date >= 100 AND date < 200"
	if got := b.filter(); got != want {
		t.Errorf("filter = %q, want %q", got, want)
	}
}

func TestVRIsExcludedByNumericEqualityNotABooleanForm(t *testing.T) {
	// isVR is a 0/1 number. `isVR:false` matches nothing and `NOT isVR:true`
	// matches the entire catalog — both look like working filters and neither
	// is, so the working form is pinned here.
	if gammaBaseFilter != "isVR=0" {
		t.Errorf("base filter is %q; the boolean-looking forms silently do nothing", gammaBaseFilter)
	}
}

func TestUsableRejectsVREvenIfAQueryLetItThrough(t *testing.T) {
	// Side-by-side stereo on a television is two squashed half-width copies,
	// not a lesser version of the scene. The query-level filter is the real
	// defence; this is the one that survives someone editing that filter.
	hit := gammaHit{Length: 1800, IsVR: 1}
	if gammaUsable(hit) {
		t.Error("a VR scene should never be scheduled on a flat channel")
	}
}

// ─── quota allocation ─────────────────────────────────────────────────────────

func TestAllocationSpreadsAcrossBands(t *testing.T) {
	counts := []int{500, 500, 500, 500}
	quotas := gammaAllocate(counts, 40)

	total := 0
	for i, q := range quotas {
		if q == 0 {
			t.Errorf("band %d got nothing despite having %d scenes", i, counts[i])
		}
		total += q
	}
	if total != 40 {
		t.Errorf("allocated %d, want 40", total)
	}
}

func TestAllocationRedistributesWhatSmallBandsCannotSupply(t *testing.T) {
	// The case that matters: a channel whose catalog sits almost entirely in
	// one era. Without redistribution this returns a fraction of what was asked
	// for, and the channel airs a rotation of five scenes.
	counts := []int{1, 2, 0, 5000}
	quotas := gammaAllocate(counts, 50)

	total := 0
	for i, q := range quotas {
		if q > counts[i] {
			t.Errorf("band %d over-allocated: %d > %d available", i, q, counts[i])
		}
		total += q
	}
	if total != 50 {
		t.Errorf("allocated %d of 50; the surplus was not redistributed", total)
	}
	if quotas[2] != 0 {
		t.Errorf("empty band was allocated %d", quotas[2])
	}
}

func TestAllocationStopsWhenTheCatalogIsSmallerThanAsked(t *testing.T) {
	counts := []int{3, 2}
	quotas := gammaAllocate(counts, 50)

	total := 0
	for _, q := range quotas {
		total += q
	}
	if total != 5 {
		t.Errorf("allocated %d, want all 5 available scenes", total)
	}
}

func TestAllocationHandlesAnEmptyCatalog(t *testing.T) {
	// Must terminate rather than spin looking for headroom that is not there.
	quotas := gammaAllocate([]int{0, 0, 0}, 50)
	for i, q := range quotas {
		if q != 0 {
			t.Errorf("band %d allocated %d from an empty catalog", i, q)
		}
	}
}

// ─── schedulability ───────────────────────────────────────────────────────────

func gammaFormats(codecs ...string) []struct {
	Codec  string `json:"codec"`
	Format string `json:"format"`
} {
	out := make([]struct {
		Codec  string `json:"codec"`
		Format string `json:"format"`
	}, 0, len(codecs))
	for _, c := range codecs {
		out = append(out, struct {
			Codec  string `json:"codec"`
			Format string `json:"format"`
		}{Codec: c, Format: "1080p"})
	}
	return out
}

func TestUsableRejectsWhatCannotFillASlot(t *testing.T) {
	h264 := gammaFormats("h264")

	if gammaUsable(gammaHit{Length: 0, VideoFormats: h264}) {
		t.Error("a zero-length scene cannot be scheduled")
	}
	if gammaUsable(gammaHit{Length: 1800, Upcoming: 1, VideoFormats: h264}) {
		t.Error("an unreleased scene must not be scheduled")
	}
	if !gammaUsable(gammaHit{Length: 1800, VideoFormats: h264}) {
		t.Error("a normal h264 scene should air")
	}
}

func TestUsableKeepsScenesWithNoRenditionListed(t *testing.T) {
	// Mirrors the Aylo client: an absent rendition list is missing metadata,
	// not a rejection. The per-programme resolve decides properly at play time.
	if !gammaUsable(gammaHit{Length: 1800}) {
		t.Error("a scene with no rendition list should be given the benefit of the doubt")
	}
}

func TestUsableRejectsCodecsThatWouldNeedAReencode(t *testing.T) {
	// Re-encoding a remote source costs a download *and* a transcode, per
	// viewer, so it is refused at schedule time rather than aired expensively.
	if gammaUsable(gammaHit{Length: 1800, VideoFormats: gammaFormats("av1")}) {
		t.Error("an AV1-only scene should not be scheduled")
	}
}

// ─── renditions ───────────────────────────────────────────────────────────────

func TestHeightIsParsedFromTheRenditionName(t *testing.T) {
	for name, want := range map[string]int{"1080p": 1080, "720p": 720, "576p": 576, "auto": 0, "": 0} {
		if got := gammaHeight(name); got != want {
			t.Errorf("height(%q) = %d, want %d", name, got, want)
		}
	}
}

func TestPreferenceOrderCapsAt1080p(t *testing.T) {
	// 4k triples the bandwidth of a channel nobody is inspecting frame by
	// frame, and every client that can show it can show 1080p. Both sites do
	// offer 2160p, so this is doing real work.
	for _, f := range gammaStreamPreference {
		if f == "2160p" || f == "4k" {
			t.Errorf("%q should not be a preferred rendition for a TV channel", f)
		}
	}
	if gammaStreamPreference[0] != "1080p" {
		t.Errorf("best preferred rendition is %q, want 1080p", gammaStreamPreference[0])
	}
}

// ─── slugs and collisions ─────────────────────────────────────────────────────

func TestSlugCollapsesRunsSoADoubledDashStaysReserved(t *testing.T) {
	// The network-wide channel keys ("at--all", "ea--all") rely on this: if a
	// slug could ever contain two dashes in a row, a facet value could collide
	// with the umbrella channel and silently replace it.
	for _, name := range []string{
		"Evil Anal", "21 Sextury", "  leading and trailing  ",
		"Rocco -- Siffredi", "A & B / C", "All", "-all", "- all -",
	} {
		slug := gammaSlug(name)
		if strings.Contains(slug, "--") {
			t.Errorf("gammaSlug(%q) = %q contains a doubled dash", name, slug)
		}
		if strings.HasPrefix(slug, "-") || strings.HasSuffix(slug, "-") {
			t.Errorf("gammaSlug(%q) = %q has a stray edge dash", name, slug)
		}
	}
}

func TestUniqueBySlugKeepsTheFirstAndReportsTheRest(t *testing.T) {
	// Slugging is lossy, so two different names can land on one key. Two
	// channels sharing a key means the second's schedule overwrites the first's
	// and the playlist carries a duplicate id — so the collision is dropped, not
	// tolerated.
	values := []gammaFacetValue{
		{Name: "Evil Anal", Count: 100},
		{Name: "Evil-Anal", Count: 20},
		{Name: "Euro Angels", Count: 50},
		{Name: "!!!", Count: 5}, // slugs to "", which is not a usable key either
	}

	kept, dropped := gammaUniqueBySlug(values)
	if len(kept) != 2 {
		t.Fatalf("kept %d values, want 2: %v", len(kept), kept)
	}
	if kept[0].Name != "Evil Anal" || kept[1].Name != "Euro Angels" {
		t.Errorf("kept the wrong values: %v", kept)
	}
	if len(dropped) != 2 {
		t.Errorf("dropped %d values, want 2: %v", len(dropped), dropped)
	}
	// Order in must decide which survives, or the lineup reshuffles between
	// refreshes for no reason.
	seen := map[string]bool{}
	for _, k := range kept {
		slug := gammaSlug(k.Name)
		if seen[slug] {
			t.Errorf("duplicate slug %q survived", slug)
		}
		seen[slug] = true
	}
}
