package api

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

// ─── the interstitial gate ────────────────────────────────────────────────────

func TestCookieCarriesTheInterstitialDismissal(t *testing.T) {
	// Not a bypass of anything protective: these are the cookies the gate's own
	// redirect sets, and without sending them back every members.adulttime.com
	// path 302s to a page that redirects to itself. This cost a session to
	// diagnose once — the test exists so it cannot be quietly dropped.
	for _, name := range []string{"interstitialPageShown", "interstitialCountXhours", "interstitialCountXweek"} {
		if !strings.Contains(adultTimeInterstitialCookies, name+"=") {
			t.Errorf("gate cookie %q missing; the members area will redirect forever without it", name)
		}
	}
}

// ─── window.env extraction ────────────────────────────────────────────────────

func TestExtractWindowEnvHandlesBracesInsideStrings(t *testing.T) {
	// A regex cannot do this, which is why the extractor counts braces: the
	// page really does carry brace characters inside string values.
	html := `<script>window.env = {"api":{"algolia":{"apiKey":"a}b{c","applicationID":"X"}},"n":1};</script>`

	got, ok := adultTimeExtractWindowEnv(html)
	if !ok {
		t.Fatal("window.env not found")
	}
	if !strings.HasSuffix(got, `"n":1}`) {
		t.Errorf("stopped at a brace inside a string literal: %s", got)
	}
}

func TestExtractWindowEnvRefusesAnUnterminatedObject(t *testing.T) {
	if _, ok := adultTimeExtractWindowEnv(`window.env = {"api":{`); ok {
		t.Error("a truncated page should fail rather than yield a half object")
	}
	if _, ok := adultTimeExtractWindowEnv(`<html>nothing here</html>`); ok {
		t.Error("a page with no window.env should report as much")
	}
}

func TestKeyExpiryIsReadFromTheKeyItself(t *testing.T) {
	// Shape of a real secured key: hmac then urlencoded params, base64'd.
	raw := "deadbeef" + "validUntil=1786166359&restrictIndices=all%2A"
	key := base64.StdEncoding.EncodeToString([]byte(raw))

	got := adultTimeKeyExpiry(key)
	if want := time.Unix(1786166359, 0); !got.Equal(want) {
		t.Errorf("expiry = %s, want %s", got, want)
	}
}

func TestUnreadableKeyIsAssumedShortLived(t *testing.T) {
	// Guessing high would mean serving every request with a dead key until they
	// all failed; guessing low costs one extra scrape.
	got := adultTimeKeyExpiry("not base64 at all !!")
	if d := time.Until(got); d > time.Hour {
		t.Errorf("an unreadable key was trusted for %s", d)
	}
}

// ─── date banding ─────────────────────────────────────────────────────────────

func TestBandsCoverTheWholeCatalogWithoutGaps(t *testing.T) {
	bands := adultTimeBands(2026)
	if len(bands) != adultTimeSampleBands {
		t.Fatalf("got %d bands, want %d", len(bands), adultTimeSampleBands)
	}

	first := time.Date(adultTimeFirstYear, time.January, 1, 0, 0, 0, 0, time.UTC).Unix()
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
	b := adultTimeBand{from: 100, to: 200}
	want := adultTimeBaseFilter + " AND date >= 100 AND date < 200"
	if got := b.filter(); got != want {
		t.Errorf("filter = %q, want %q", got, want)
	}
}

func TestVRIsExcludedByNumericEqualityNotABooleanForm(t *testing.T) {
	// isVR is a 0/1 number. `isVR:false` matches nothing and `NOT isVR:true`
	// matches the entire catalog — both look like working filters and neither
	// is, so the working form is pinned here.
	if adultTimeBaseFilter != "isVR=0" {
		t.Errorf("base filter is %q; the boolean-looking forms silently do nothing", adultTimeBaseFilter)
	}
}

func TestUsableRejectsVREvenIfAQueryLetItThrough(t *testing.T) {
	// Side-by-side stereo on a television is two squashed half-width copies,
	// not a lesser version of the scene. The query-level filter is the real
	// defence; this is the one that survives someone editing that filter.
	hit := adultTimeHit{Length: 1800, IsVR: 1}
	if adultTimeUsable(hit) {
		t.Error("a VR scene should never be scheduled on a flat channel")
	}
}

// ─── quota allocation ─────────────────────────────────────────────────────────

func TestAllocationSpreadsAcrossBands(t *testing.T) {
	counts := []int{500, 500, 500, 500}
	quotas := adultTimeAllocate(counts, 40)

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
	quotas := adultTimeAllocate(counts, 50)

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
	quotas := adultTimeAllocate(counts, 50)

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
	quotas := adultTimeAllocate([]int{0, 0, 0}, 50)
	for i, q := range quotas {
		if q != 0 {
			t.Errorf("band %d allocated %d from an empty catalog", i, q)
		}
	}
}

// ─── schedulability ───────────────────────────────────────────────────────────

func TestUsableRejectsWhatCannotFillASlot(t *testing.T) {
	h264 := []struct {
		Codec  string `json:"codec"`
		Format string `json:"format"`
	}{{Codec: "h264", Format: "1080p"}}

	if adultTimeUsable(adultTimeHit{Length: 0, VideoFormats: h264}) {
		t.Error("a zero-length scene cannot be scheduled")
	}
	if adultTimeUsable(adultTimeHit{Length: 1800, Upcoming: 1, VideoFormats: h264}) {
		t.Error("an unreleased scene must not be scheduled")
	}
	if !adultTimeUsable(adultTimeHit{Length: 1800, VideoFormats: h264}) {
		t.Error("a normal h264 scene should air")
	}
}

func TestUsableKeepsScenesWithNoRenditionListed(t *testing.T) {
	// Mirrors the Aylo client: an absent rendition list is missing metadata,
	// not a rejection. The per-programme resolve decides properly at play time.
	if !adultTimeUsable(adultTimeHit{Length: 1800}) {
		t.Error("a scene with no rendition list should be given the benefit of the doubt")
	}
}

func TestUsableRejectsCodecsThatWouldNeedAReencode(t *testing.T) {
	// Re-encoding a remote source costs a download *and* a transcode, per
	// viewer, so it is refused at schedule time rather than aired expensively.
	hit := adultTimeHit{Length: 1800, VideoFormats: []struct {
		Codec  string `json:"codec"`
		Format string `json:"format"`
	}{{Codec: "av1", Format: "1080p"}}}

	if adultTimeUsable(hit) {
		t.Error("an AV1-only scene should not be scheduled")
	}
}

// ─── selectors ────────────────────────────────────────────────────────────────

func TestNetworkWideSelectorDoesNotFilterByChannel(t *testing.T) {
	filters := adultTimeSelector{}.facetFilters()
	if len(filters) != 1 {
		t.Fatalf("network-wide selector produced %d filter groups, want 1", len(filters))
	}
	if filters[0][0] != "upcoming:0" {
		t.Errorf("unreleased scenes are not being excluded: %v", filters)
	}
}

func TestChannelSelectorFiltersOnTheStudioFacet(t *testing.T) {
	filters := adultTimeSelector{channel: "Pure Taboo"}.facetFilters()
	if len(filters) != 2 {
		t.Fatalf("got %d filter groups, want 2", len(filters))
	}
	// Nested arrays are an AND of ORs; each group must hold exactly one term or
	// the two conditions become alternatives.
	if got, want := filters[1][0], adultTimeChannelFacet+":Pure Taboo"; got != want {
		t.Errorf("channel filter = %q, want %q", got, want)
	}
}

// ─── renditions ───────────────────────────────────────────────────────────────

func TestHeightIsParsedFromTheRenditionName(t *testing.T) {
	for name, want := range map[string]int{"1080p": 1080, "720p": 720, "576p": 576, "auto": 0, "": 0} {
		if got := adultTimeHeight(name); got != want {
			t.Errorf("height(%q) = %d, want %d", name, got, want)
		}
	}
}

func TestPreferenceOrderCapsAt1080p(t *testing.T) {
	// 4k triples the bandwidth of a channel nobody is inspecting frame by
	// frame, and every client that can show it can show 1080p.
	for _, f := range adultTimeStreamPreference {
		if f == "2160p" || f == "4k" {
			t.Errorf("%q should not be a preferred rendition for a TV channel", f)
		}
	}
	if adultTimeStreamPreference[0] != "1080p" {
		t.Errorf("best preferred rendition is %q, want 1080p", adultTimeStreamPreference[0])
	}
}
