package api

import (
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stashapp/stash/pkg/iptv"
	"github.com/stashapp/stash/pkg/models"
)

func testCycle(durations ...float64) *iptv.Cycle {
	entries := make([]iptv.SceneEntry, 0, len(durations))
	for i, d := range durations {
		entries = append(entries, iptv.SceneEntry{
			SceneID:  500 + i,
			Title:    "Programme " + strconv.Itoa(i),
			Duration: d,
		})
	}
	return iptv.BuildCycle(7, entries)
}

// argIndex returns the position of an exact argument, or -1.
func argIndex(args []string, want string) int {
	for i, a := range args {
		if a == want {
			return i
		}
	}
	return -1
}

func hasArg(args []string, want string) bool { return argIndex(args, want) >= 0 }

// argValue returns the argument following a flag.
func argValue(args []string, flag string) (string, bool) {
	i := argIndex(args, flag)
	if i < 0 || i+1 >= len(args) {
		return "", false
	}
	return args[i+1], true
}

func copySource() programSource {
	return programSource{Path: "/media/a.mp4", VideoCodec: "h264", AudioCodec: "aac", Height: 1080}
}

func defaultSettings() iptvSettings {
	return iptvSettings{Resolution: string(models.StreamingResolutionEnumStandardHd)}
}

// ─── stream arguments ─────────────────────────────────────────────────────────

// The single most important property for cost: an ordinary library file must
// never reach an encoder.
func TestStreamArgsRemuxesOrdinaryFiles(t *testing.T) {
	args := iptvStreamArgs(copySource(), 0, 60, iptv.ModeCopy, defaultSettings())

	if v, _ := argValue(args, "-c"); v != "copy" {
		t.Errorf("expected -c copy, got %q in %v", v, args)
	}
	for _, encoder := range []string{"libx264", "libx265", "aac"} {
		if hasArg(args, encoder) {
			t.Errorf("copy mode must not invoke %s: %v", encoder, args)
		}
	}
}

// Without -re ffmpeg drains the file as fast as the socket allows, so the
// client burns through a scene in seconds and the channel outruns its guide.
func TestStreamArgsPacesInRealTime(t *testing.T) {
	args := iptvStreamArgs(copySource(), 0, 60, iptv.ModeCopy, defaultSettings())

	if !hasArg(args, "-re") {
		t.Fatalf("live stream must be paced with -re: %v", args)
	}
}

// -ss must precede -i. After -i it becomes an output option and ffmpeg decodes
// and discards everything up to the offset — tuning into the middle of a long
// scene would take minutes instead of being instant.
func TestStreamArgsSeeksBeforeInput(t *testing.T) {
	args := iptvStreamArgs(copySource(), 754.5, 60, iptv.ModeCopy, defaultSettings())

	ss := argIndex(args, "-ss")
	in := argIndex(args, "-i")
	if ss < 0 {
		t.Fatalf("expected a seek for a mid-programme join: %v", args)
	}
	if ss > in {
		t.Fatalf("-ss (%d) must come before -i (%d): %v", ss, in, args)
	}

	if v, _ := argValue(args, "-ss"); v != "754.500" {
		t.Errorf("seek offset = %q, want 754.500", v)
	}
}

func TestStreamArgsOmitsSeekAtProgrammeStart(t *testing.T) {
	args := iptvStreamArgs(copySource(), 0, 60, iptv.ModeCopy, defaultSettings())

	if hasArg(args, "-ss") {
		t.Errorf("no seek should be issued at offset 0: %v", args)
	}
}

// -t is only a backstop; pipeProgram ends a programme on a wall-clock deadline.
// It is passed the slot length plus a grace margin precisely because ffmpeg
// cannot be trusted to measure it: with -c copy an -ss snaps back to the
// previous keyframe and -t then counts from there, so on a 10s-GOP file a 4s
// slot emits 6.5s. -t must therefore never be the thing that cuts the stream.
func TestStreamArgsPassesDurationBackstop(t *testing.T) {
	args := iptvStreamArgs(copySource(), 10, 123.25, iptv.ModeCopy, defaultSettings())

	v, ok := argValue(args, "-t")
	if !ok {
		t.Fatalf("expected a -t backstop: %v", args)
	}
	if v != "123.250" {
		t.Errorf("duration = %q, want 123.250", v)
	}
}

// The grace margin has to exceed any plausible keyframe interval, or -t would
// cut a programme short before the deadline gets a chance to end it cleanly.
func TestSlotGraceExceedsPlausibleGOP(t *testing.T) {
	const longestPlausibleGOPSeconds = 15.0

	if iptvSlotGraceSeconds <= longestPlausibleGOPSeconds {
		t.Errorf("grace of %.0fs is too small to absorb a %.0fs keyframe interval",
			iptvSlotGraceSeconds, longestPlausibleGOPSeconds)
	}
}

func TestStreamArgsAudioOnlyTranscodeKeepsVideoFrames(t *testing.T) {
	src := copySource()
	src.AudioCodec = "opus"

	args := iptvStreamArgs(src, 0, 60, iptv.ModeTranscodeAudio, defaultSettings())

	if v, _ := argValue(args, "-c:v"); v != "copy" {
		t.Errorf("video must still be copied, got -c:v %q: %v", v, args)
	}
	if v, _ := argValue(args, "-c:a"); v != "aac" {
		t.Errorf("audio should be re-encoded to aac, got %q", v)
	}
	if hasArg(args, "libx264") {
		t.Errorf("audio-only fallback must not re-encode video: %v", args)
	}
}

func TestStreamArgsFullTranscodeScalesDownOnly(t *testing.T) {
	s := defaultSettings() // STANDARD_HD -> 720

	tall := programSource{Path: "/media/b.webm", VideoCodec: "vp9", AudioCodec: "opus", Height: 2160}
	args := iptvStreamArgs(tall, 0, 60, iptv.ModeTranscodeAll, s)
	if !hasArg(args, "libx264") {
		t.Fatalf("expected a video encoder: %v", args)
	}
	vf, ok := argValue(args, "-vf")
	if !ok || !strings.Contains(vf, "720") {
		t.Errorf("expected a scale filter down to 720, got %q", vf)
	}

	short := programSource{Path: "/media/c.webm", VideoCodec: "vp9", AudioCodec: "opus", Height: 480}
	args = iptvStreamArgs(short, 0, 60, iptv.ModeTranscodeAll, s)
	if hasArg(args, "-vf") {
		t.Errorf("a 480p source must not be upscaled to 720: %v", args)
	}
}

// A scene with no audio track must not abort the run.
func TestStreamArgsTreatsAudioAsOptional(t *testing.T) {
	args := iptvStreamArgs(copySource(), 0, 60, iptv.ModeCopy, defaultSettings())

	v, ok := argValue(args, "-map")
	if !ok {
		t.Fatal("expected explicit stream mapping")
	}
	if v != "0:v:0" {
		t.Errorf("first map = %q, want the video stream", v)
	}

	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "0:a:0?") {
		t.Errorf("audio mapping must be optional (trailing ?): %v", args)
	}
}

func TestStreamArgsMuxesToMpegTSOnStdout(t *testing.T) {
	args := iptvStreamArgs(copySource(), 0, 60, iptv.ModeCopy, defaultSettings())

	if v, _ := argValue(args, "-f"); v != "mpegts" {
		t.Errorf("output format = %q, want mpegts", v)
	}
	if args[len(args)-1] != "pipe:1" {
		t.Errorf("output must be stdout, got %q", args[len(args)-1])
	}
	// Subtitle/data streams abort the mpegts muxer.
	if !hasArg(args, "-sn") || !hasArg(args, "-dn") {
		t.Errorf("expected subtitle and data streams to be dropped: %v", args)
	}
}

func TestStreamArgsInputPathIsPassedVerbatim(t *testing.T) {
	src := copySource()
	src.Path = `C:\media\Some Scene (2024) - "cut".mkv`

	args := iptvStreamArgs(src, 0, 60, iptv.ModeCopy, defaultSettings())

	v, ok := argValue(args, "-i")
	if !ok {
		t.Fatal("no input argument")
	}
	// Args go straight to exec with no shell, so the path must not be quoted
	// or escaped — doing so would make ffmpeg look for a file that isn't there.
	if v != src.Path {
		t.Errorf("input path = %q, want it verbatim (%q)", v, src.Path)
	}
}

// ─── on-air resolution ────────────────────────────────────────────────────────

func TestOnAirReportsSubSecondOffset(t *testing.T) {
	c := testCycle(600, 600) // two 300-segment programmes

	// 100.75s into the cycle: inside the first programme.
	now := iptv.Epoch.Add(100750 * time.Millisecond)
	program, offset, ok := iptvOnAir(c, now)
	if !ok {
		t.Fatal("nothing on air")
	}

	if program.SceneID != 500 {
		t.Errorf("on air scene = %d, want 500", program.SceneID)
	}
	// The offset must carry the fraction, not be rounded to the segment grid —
	// a whole-segment offset would let viewers drift up to two seconds apart.
	if offset < 100.7 || offset > 100.8 {
		t.Errorf("offset = %v, want ~100.75", offset)
	}
}

func TestOnAirCrossesIntoNextProgramme(t *testing.T) {
	c := testCycle(600, 600)

	// One second past the end of the first programme.
	now := iptv.Epoch.Add(601 * time.Second)
	program, offset, ok := iptvOnAir(c, now)
	if !ok {
		t.Fatal("nothing on air")
	}

	if program.SceneID != 501 {
		t.Errorf("on air scene = %d, want 501 (the second programme)", program.SceneID)
	}
	if offset < 0.9 || offset > 1.1 {
		t.Errorf("offset into second programme = %v, want ~1", offset)
	}
}

// A negative offset would make ffmpeg seek before the start of the file.
func TestOnAirNeverReturnsNegativeOffset(t *testing.T) {
	c := testCycle(600, 600)

	for _, delta := range []time.Duration{0, -time.Millisecond, -time.Hour, -99 * time.Hour} {
		_, offset, ok := iptvOnAir(c, iptv.Epoch.Add(delta))
		if !ok {
			t.Fatalf("nothing on air at %v", delta)
		}
		if offset < 0 {
			t.Errorf("offset at %v = %v, must never be negative", delta, offset)
		}
	}
}

func TestOnAirFailsOnEmptyCycle(t *testing.T) {
	if _, _, ok := iptvOnAir(testCycle(1, 1), time.Now()); ok {
		t.Error("a cycle with no schedulable programmes should report nothing on air")
	}
}

// ─── formatting helpers ───────────────────────────────────────────────────────

// M3U attributes are double-quoted with no escape mechanism, so a quote or a
// comma in a studio or scene name would corrupt the rest of the entry.
func TestEscapeAttrNeutralisesFormatBreakers(t *testing.T) {
	got := iptvEscapeAttr(` Bad "name", with	stuff` + "\n" + "trailing ")

	for _, bad := range []string{`"`, ",", "\n", "\r"} {
		if strings.Contains(got, bad) {
			t.Errorf("escaped value still contains %q: %q", bad, got)
		}
	}
	if strings.HasPrefix(got, " ") || strings.HasSuffix(got, " ") {
		t.Errorf("escaped value not trimmed: %q", got)
	}
}

func TestEscapeXMLEscapesMarkup(t *testing.T) {
	got := iptvEscapeXML(`Tom & Jerry <b>"x"</b>`)

	if strings.Contains(got, "<b>") {
		t.Errorf("XML not escaped: %q", got)
	}
	if !strings.Contains(got, "&amp;") {
		t.Errorf("ampersand not escaped: %q", got)
	}
}

func TestMaxHeightRejectsUnknownResolution(t *testing.T) {
	if got := iptvMaxHeight("STANDARD_HD"); got != 720 {
		t.Errorf("STANDARD_HD = %d, want 720", got)
	}
	if got := iptvMaxHeight("nonsense"); got != 0 {
		t.Errorf("unknown resolution = %d, want 0 (no scaling)", got)
	}
}

func TestURLAppendsAPIKeyOnlyWhenSet(t *testing.T) {
	if got := iptvURL("http://tv.local", "/iptv/ch/7.ts", "KEY"); got != "http://tv.local/iptv/ch/7.ts?apikey=KEY" {
		t.Errorf("got %q", got)
	}
	if got := iptvURL("http://tv.local", "/iptv/ch/7.ts", ""); got != "http://tv.local/iptv/ch/7.ts" {
		t.Errorf("no key configured, got %q", got)
	}
}

// ─── channel logos ────────────────────────────────────────────────────────────

func testLogoRoutes() iptvRoutes {
	return iptvRoutes{logos: &iptvLogoCache{entries: make(map[string]iptvLogoEntry)}}
}

func TestLogoCacheReturnsFreshEntries(t *testing.T) {
	rs := testLogoRoutes()
	rs.logos.entries["3"] = iptvLogoEntry{data: []byte("x"), contentType: "image/png", built: time.Now()}

	if _, ok := rs.cachedLogo("3"); !ok {
		t.Error("a just-built logo should come back from the cache")
	}
	if _, ok := rs.cachedLogo("4"); ok {
		t.Error("an unknown studio should miss")
	}
}

func TestLogoCacheExpires(t *testing.T) {
	rs := testLogoRoutes()
	rs.logos.entries["3"] = iptvLogoEntry{
		data:  []byte("x"),
		built: time.Now().Add(-iptvLogoTTL - time.Minute),
	}

	if _, ok := rs.cachedLogo("3"); ok {
		t.Error("an entry past its TTL should miss so a changed logo eventually appears")
	}
}

// Clients refetch every channel's logo on each guide refresh, so a lineup of
// sixty studios means sixty requests per refresh. Rasterising an SVG on each of
// those would be pointless work, hence a TTL far longer than the schedule's.
func TestLogoTTLOutlastsScheduleCaches(t *testing.T) {
	if iptvLogoTTL <= iptvChannelTTL {
		t.Errorf("logo TTL %v should comfortably exceed the channel TTL %v", iptvLogoTTL, iptvChannelTTL)
	}
}

func TestWriteLogoSetsCacheableHeaders(t *testing.T) {
	rec := httptest.NewRecorder()
	iptvWriteLogo(rec, iptvLogoEntry{data: []byte("abcd"), contentType: "image/png"})

	if got := rec.Header().Get("Content-Type"); got != "image/png" {
		t.Errorf("Content-Type %q, want image/png", got)
	}
	if got := rec.Header().Get("Content-Length"); got != "4" {
		t.Errorf("Content-Length %q, want 4", got)
	}
	if got := rec.Header().Get("Cache-Control"); !strings.Contains(got, "max-age=") {
		t.Errorf("Cache-Control %q should let the client keep the logo between guide refreshes", got)
	}
	if rec.Body.String() != "abcd" {
		t.Errorf("body %q, want abcd", rec.Body.String())
	}
}
