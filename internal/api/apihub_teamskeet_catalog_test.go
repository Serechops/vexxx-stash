package api

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

// ─── tokens ───────────────────────────────────────────────────────────────────

func teamSkeetTestJWT(t *testing.T, exp time.Time) string {
	t.Helper()
	payload, err := json.Marshal(map[string]int64{"exp": exp.Unix()})
	if err != nil {
		t.Fatal(err)
	}
	return "header." + base64.RawURLEncoding.EncodeToString(payload) + ".signature"
}

func TestJWTExpiryIsReadFromTheClaim(t *testing.T) {
	want := time.Now().Add(30 * time.Minute).Truncate(time.Second)

	got, ok := teamSkeetJWTExpiry(teamSkeetTestJWT(t, want))
	if !ok {
		t.Fatal("could not read the exp claim")
	}
	if !got.Equal(want) {
		t.Errorf("expiry = %s, want %s", got, want)
	}
}

func TestUnreadableJWTIsReportedRatherThanGuessed(t *testing.T) {
	// A guess either way is wrong: assuming expired forces a needless refresh,
	// assuming valid sends a dead token. Callers need to know it is unknown.
	for _, token := range []string{"", "not-a-jwt", "a.b", "a.!!!notbase64!!!.c"} {
		if _, ok := teamSkeetJWTExpiry(token); ok {
			t.Errorf("claimed to read an expiry out of %q", token)
		}
	}
}

func TestTokenSetShapeMatchesWhatThePluginPersists(t *testing.T) {
	// The plugin writes this blob (teamskeet/auth.ts TSTokenSet) and this only
	// ever reads it. A field-name drift would not fail to compile — it would look
	// exactly like "TeamSkeet is not connected".
	raw := `{"accessToken":"a.b.c","refreshToken":"d.e.f","expiresAt":1786160976000}`

	var ts teamSkeetTokenSet
	if err := json.Unmarshal([]byte(raw), &ts); err != nil {
		t.Fatal(err)
	}
	if ts.AccessToken != "a.b.c" || ts.RefreshToken != "d.e.f" || ts.ExpiresAt != 1786160976000 {
		t.Errorf("decoded %+v; the plugin's field names have drifted", ts)
	}
}

// ─── queries ──────────────────────────────────────────────────────────────────

func TestMovieQueryKeepsTierZeroInScope(t *testing.T) {
	// A movie with tiers [0, 12] was confirmed to stream, so tier 0 is a real
	// entitlement this account holds. Narrowing to tiers:1 silently drops that
	// content — a mistake the plugin already made once.
	q := teamSkeetMovieQuery("")

	if !strings.Contains(q, "(tiers:0 OR tiers:1)") {
		t.Errorf("query %q does not keep tier 0 in scope", q)
	}
	if !strings.Contains(q, "NOT isUpcoming:true") {
		t.Errorf("query %q would schedule unreleased teasers, which have no stream", q)
	}
	if !strings.Contains(q, "type:movies") {
		t.Errorf("query %q is not restricted to movie documents", q)
	}
}

func TestMovieQueryJoinsASeriesOnItsName(t *testing.T) {
	// A series document's `name` is exactly what a movie carries in
	// site.siteName, which is what lets the two be joined with no id lookup.
	q := teamSkeetMovieQuery("Exxxtra Small")
	if !strings.Contains(q, `site.siteName:"Exxxtra Small"`) {
		t.Errorf("query %q does not scope to the series", q)
	}
}

func TestSeriesNamesWithLuceneMetacharactersAreEscaped(t *testing.T) {
	// Unescaped, a name carrying one of these would break the clause or graft on
	// a sub-query — and series names are upstream data, not ours.
	name := `Foo (Bar) / Baz-Qux`
	escaped := teamSkeetEscapeLucene(name)

	// Every metacharacter must be backslash-prefixed. Checked this way rather
	// than by looking for absent substrings, since "\/" still contains "/".
	for _, meta := range []string{"(", ")", "/", "-"} {
		if strings.Contains(escaped, meta) && !strings.Contains(escaped, `\`+meta) {
			t.Errorf("escape(%q) = %q left %q unescaped", name, escaped, meta)
		}
	}
	if escaped != `Foo \(Bar\) \/ Baz\-Qux` {
		t.Errorf("escape(%q) = %q", name, escaped)
	}

	// And the escaped form is what actually reaches the query.
	if q := teamSkeetMovieQuery(name); !strings.Contains(q, escaped) {
		t.Errorf("query %q does not carry the escaped name", q)
	}
}

func TestEscapeLuceneLeavesOrdinaryNamesAlone(t *testing.T) {
	for _, name := range []string{"Exxxtra Small", "Innocent High", "BFFS", "POV Life"} {
		if got := teamSkeetEscapeLucene(name); got != name {
			t.Errorf("escape(%q) = %q; an ordinary name should pass through", name, got)
		}
	}
}

func TestEachDocumentTypeAsksForItsOwnFields(t *testing.T) {
	// The index is polymorphic — movies, series, models and categories all live in
	// it with different shapes — so one shared _source_includes list is wrong for
	// at least one of them. Trimming series documents to the movie fields returns
	// docs with no `name` and no `movieCount`, which does not error: every series
	// is silently discarded and the lineup collapses to a single channel. That is
	// exactly what happened, hence this test.
	for _, field := range []string{"name", "movieCount"} {
		if !strings.Contains(teamSkeetSeriesFields, field) {
			t.Errorf("series fields %q omit %q; discovery would find no channels",
				teamSkeetSeriesFields, field)
		}
	}
	for _, field := range []string{"id", "title", "publishedDate", "site.siteName"} {
		if !strings.Contains(teamSkeetMovieFields, field) {
			t.Errorf("movie fields %q omit %q", teamSkeetMovieFields, field)
		}
	}
	if teamSkeetSeriesFields == teamSkeetMovieFields {
		t.Error("the two document types cannot share one field list")
	}
}

// ─── durations ────────────────────────────────────────────────────────────────

func TestMPDDurationParsesTheFormTheCatalogActuallyUses(t *testing.T) {
	// The observed shape: a bare seconds value.
	mpd := `<MPD type="static" mediaPresentationDuration="PT2466.299S" minBufferTime="PT2.0S">`

	got, ok := teamSkeetParseMPDDuration(mpd)
	if !ok {
		t.Fatal("could not read the duration")
	}
	if got < 2466.2 || got > 2466.4 {
		t.Errorf("duration = %v, want ~2466.3", got)
	}
}

func TestMPDDurationParsesTheFullISOForm(t *testing.T) {
	// Legal in the same attribute even though it has not been seen here, so it is
	// handled rather than assumed away.
	cases := map[string]float64{
		`mediaPresentationDuration="PT1H2M3S"`:    3723,
		`mediaPresentationDuration="PT41M6.2S"`:   2466.2,
		`mediaPresentationDuration="PT2H"`:        7200,
		`mediaPresentationDuration="PT90.5S"`:     90.5,
		`mediaPresentationDuration="PT1H0M30.0S"`: 3630,
	}
	for mpd, want := range cases {
		got, ok := teamSkeetParseMPDDuration(mpd)
		if !ok {
			t.Errorf("%s: not parsed", mpd)
			continue
		}
		if diff := got - want; diff > 0.01 || diff < -0.01 {
			t.Errorf("%s: got %v, want %v", mpd, got, want)
		}
	}
}

func TestMPDDurationRefusesWhatItCannotRead(t *testing.T) {
	// A guessed duration would put the whole channel's schedule out of step with
	// what is actually playing, so an unreadable manifest must fail loudly.
	for _, mpd := range []string{
		`<MPD type="static">`,
		`mediaPresentationDuration="PT0S"`,
		`mediaPresentationDuration=""`,
		`mediaPresentationDuration="garbage"`,
		"",
	} {
		if got, ok := teamSkeetParseMPDDuration(mpd); ok {
			t.Errorf("%q yielded %v; it should have been rejected", mpd, got)
		}
	}
}

// ─── renditions ───────────────────────────────────────────────────────────────

const (
	teamSkeetModernManifest = "https://vod1.cachefly.net/dG9rZW4=/dash/vod/teamskeet/tomboyz/lulu_chu/videos/full/AVC_,1080,720,480,360,240,.mp4.urlset/manifest.mpd"
	teamSkeetModernFallback = "https://vod1.cachefly.net/b3RoZXI=/vod/teamskeet/tomboyz/lulu_chu/videos/full/AVC_720.mp4"
	teamSkeetArchiveMani    = "https://vod1.cachefly.net/dG9rZW4=/dash/vod/teamskeet/innocenthigh/samantha_sharp/videos/full/AVC_,480,360,240,.mp4.urlset/manifest.mpd"
	teamSkeetArchiveFall    = "https://vod1.cachefly.net/b3RoZXI=/vod/teamskeet/innocenthigh/samantha_sharp/videos/full/AVC_480.mp4"
)

func teamSkeetWatchFor(dash, fallback string) teamSkeetWatch {
	var w teamSkeetWatch
	w.Stream2.AVC.Dash = dash
	w.Stream2.AVC.Fallback = fallback
	return w
}

func TestRenditionsAreReadFromTheManifestPath(t *testing.T) {
	got := teamSkeetRenditions(teamSkeetModernManifest)
	want := []int{1080, 720, 480, 360, 240}

	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v (tallest first)", got, want)
		}
	}
}

func TestRenditionsReportsNothingWhenThePathHidesThem(t *testing.T) {
	for _, url := range []string{"", "https://example.test/vod/full/master.m3u8", "https://x/AVC_720.mp4"} {
		if got := teamSkeetRenditions(url); len(got) != 0 {
			t.Errorf("renditions(%q) = %v, want none", url, got)
		}
	}
}

func TestProgressiveURLPicksTheTallestUpToTheCap(t *testing.T) {
	// The signed token covers the directory, so swapping the number in the
	// fallback path reaches the other renditions. 1080 exists here.
	url, height := teamSkeetProgressiveURL(teamSkeetWatchFor(teamSkeetModernManifest, teamSkeetModernFallback))

	if height != 1080 {
		t.Errorf("height = %d, want 1080", height)
	}
	if !strings.HasSuffix(url, "/AVC_1080.mp4") {
		t.Errorf("url = %q, want the 1080p rendition", url)
	}
	// Crucially it must rewrite the FALLBACK url, not the manifest one — each
	// carries its own signed token, and the manifest's does not cover the mp4.
	if !strings.Contains(url, "b3RoZXI=") {
		t.Errorf("url = %q was built from the manifest's token, which will not authorise it", url)
	}
}

func TestProgressiveURLNeverAsksForAHeightTheSceneLacks(t *testing.T) {
	// The archive release tops out at 480p, and AVC_1080.mp4 there is a confirmed
	// 404. Consulting the manifest list rather than assuming 1080p is what keeps
	// old scenes playable.
	url, height := teamSkeetProgressiveURL(teamSkeetWatchFor(teamSkeetArchiveMani, teamSkeetArchiveFall))

	if height != 480 {
		t.Errorf("height = %d, want 480", height)
	}
	if !strings.HasSuffix(url, "/AVC_480.mp4") {
		t.Errorf("url = %q, want the 480p rendition", url)
	}
}

func TestProgressiveURLCapsAt1080(t *testing.T) {
	// 4k triples the bandwidth of a channel nobody is inspecting frame by frame.
	mani := strings.Replace(teamSkeetModernManifest, "AVC_,1080,", "AVC_,2160,1080,", 1)

	url, height := teamSkeetProgressiveURL(teamSkeetWatchFor(mani, teamSkeetModernFallback))
	if height != teamSkeetMaxHeight {
		t.Errorf("height = %d, want the %d cap", height, teamSkeetMaxHeight)
	}
	if strings.Contains(url, "2160") {
		t.Errorf("url = %q ignored the height cap", url)
	}
}

func TestProgressiveURLFallsBackToTheURLAsGiven(t *testing.T) {
	// No readable rendition list: the fallback's own height is the one height
	// known to exist, so it is used verbatim rather than guessed at.
	url, height := teamSkeetProgressiveURL(teamSkeetWatchFor("", teamSkeetModernFallback))
	if url != teamSkeetModernFallback {
		t.Errorf("url = %q, want the fallback unchanged", url)
	}
	if height != 720 {
		t.Errorf("height = %d, want the fallback's own 720", height)
	}

	// An unexpected filename shape must be passed through, not mangled.
	odd := "https://vod1.cachefly.net/token/vod/full/something-else.mp4"
	url, height = teamSkeetProgressiveURL(teamSkeetWatchFor(teamSkeetModernManifest, odd))
	if url != odd {
		t.Errorf("url = %q, want the unrecognised url unchanged", url)
	}
	if height != 0 {
		t.Errorf("height = %d, want 0 (unspecified)", height)
	}
}

func TestProgressiveURLReportsNoAVCRendition(t *testing.T) {
	// vp9/av1-only scenes exist. Both would need a re-encode to reach MPEG-TS,
	// so the slot is lost deliberately rather than paying for a transcode.
	if url, _ := teamSkeetProgressiveURL(teamSkeetWatch{}); url != "" {
		t.Errorf("url = %q, want none when there is no AVC rendition", url)
	}
}

// ─── release dates and descriptions ───────────────────────────────────────────

func TestReleaseDateRendersTheEpochAsADay(t *testing.T) {
	m := teamSkeetMovie{PublishedDate: 1786161600}
	if got := m.ReleaseDate(); got != "2026-08-08" {
		t.Errorf("ReleaseDate = %q, want 2026-08-08", got)
	}
	if got := (teamSkeetMovie{}).ReleaseDate(); got != "" {
		t.Errorf("ReleaseDate = %q for a movie with no date, want empty", got)
	}
}

func TestDescriptionsAreStrippedOfMarkupForTheGuide(t *testing.T) {
	// The catalog field is an HTML fragment and this ends up in an XMLTV <desc>,
	// where tags would be escaped and shown to the viewer as literal markup.
	got := teamSkeetPlainText("<p>She &amp; her <b>friend</b>&nbsp;arrive.</p>\n<p>Then   things happen.</p>")
	want := "She & her friend arrive. Then things happen."

	if got != want {
		t.Errorf("plain text = %q, want %q", got, want)
	}
	if teamSkeetPlainText("") != "" {
		t.Error("an empty description should stay empty")
	}
}

// ─── the sweep ────────────────────────────────────────────────────────────────

func TestOnlyOneSweepRunsAtATime(t *testing.T) {
	// A second concurrent sweep would measure the same scenes over again, which
	// is the one thing the permanent store exists to avoid.
	s := &teamSkeetSweepState{}

	if !s.begin() {
		t.Fatal("the first sweep should be allowed to start")
	}
	if s.begin() {
		t.Error("a second sweep started while the first was still running")
	}

	s.end(nil)
	if s.begin() {
		t.Error("a sweep restarted immediately after one finished; every scene it would visit was just measured")
	}
}

func TestASweepIsWorthRunningAgainOnceItsResultsCanHaveAged(t *testing.T) {
	s := &teamSkeetSweepState{}
	s.begin()
	s.end(nil)

	// Pretend the idle period elapsed rather than sleeping through it. New
	// releases are the only thing a later sweep can find.
	s.endedAt = time.Now().Add(-2 * teamSkeetSweepIdle)

	if !s.begin() {
		t.Error("a sweep should run again once enough time has passed for new releases to exist")
	}
}

func TestAFailedSweepIsRetriedSoonNotTreatedAsFinished(t *testing.T) {
	// A sweep that cannot reach the catalog ends in milliseconds having measured
	// nothing. Stamping that with the six-hour idle period would read as "the
	// catalog is fully measured" and stop the lineup dead over a blip.
	s := &teamSkeetSweepState{}
	s.begin()
	s.end(errors.New("could not list scenes"))

	if s.begin() {
		t.Error("a failed sweep restarted immediately; a provider that is properly down would be asked on every request")
	}

	s.retryAt = time.Now().Add(-time.Second)
	if !s.begin() {
		t.Error("a failed sweep must be retried on its short cooldown, not held for the idle period")
	}

	// And a run that succeeds clears the failure cooldown rather than leaving it
	// to expire underneath the idle timer.
	s.end(nil)
	if !s.retryAt.IsZero() {
		t.Error("a successful sweep left a stale retry deadline behind")
	}
}

func TestSweepProgressReportsTheRunNotTheStore(t *testing.T) {
	// The panel shows this, and a number that creeps by fractions of a percent
	// reads as a stall — so it counts what this run has to do, not the catalog.
	s := &teamSkeetSweepState{}
	s.begin()
	s.setTotal(100)

	for i := 0; i < 30; i++ {
		s.record(true)
	}
	s.record(false)

	running, done, total, failed := s.progress()
	if !running {
		t.Error("the sweep is still going")
	}
	if done != 30 || total != 100 || failed != 1 {
		t.Errorf("progress = %d of %d with %d failed, want 30 of 100 with 1 failed", done, total, failed)
	}
}

func TestEachSweepStartsItsCountersFromZero(t *testing.T) {
	// Carrying a previous run's totals forward would make the second sweep of an
	// install open at "8,000 of 12" and never make sense again.
	s := &teamSkeetSweepState{}
	s.begin()
	s.setTotal(50)
	s.record(true)
	s.record(false)
	s.end(nil)

	s.endedAt = time.Now().Add(-2 * teamSkeetSweepIdle)
	s.begin()

	if _, done, total, failed := s.progress(); done != 0 || total != 0 || failed != 0 {
		t.Errorf("second sweep opened at %d of %d with %d failed, want zeroes", done, total, failed)
	}
}

// ─── warming is not emptiness ─────────────────────────────────────────────────

func TestWarmingIsNotMistakenForALapsedSessionOrAnEmptyChannel(t *testing.T) {
	// Both distinctions are load-bearing. Reported as no-session, a warming
	// channel would abort the whole refresh run; reported as empty, it would be
	// dropped from the lineup for a day rather than retried in minutes.
	if (teamSkeetNetwork{}).IsNoSession(errTeamSkeetWarming) {
		t.Error("warming must not be read as a lapsed session")
	}
	if !(teamSkeetNetwork{}).IsNoSession(errTeamSkeetNoSession) {
		t.Error("a lapsed session must be recognised as one")
	}

	// And an error — any error — is what keeps the channel on the short retry
	// schedule instead of being treated as an answer.
	entry := iptvNetCatalogEntry{err: errTeamSkeetWarming}
	if entry.dead() {
		t.Error("a warming channel was classed as having nothing to air")
	}
}
