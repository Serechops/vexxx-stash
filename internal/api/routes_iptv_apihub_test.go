package api

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/stashapp/stash/pkg/iptv"
)

// releaseWithFiles builds a release whose `files` is a JSON array, the shape the
// full track uses.
func releaseWithFiles(t *testing.T, length float64, files ...ayloVideoFile) *ayloRelease {
	t.Helper()

	raw, err := json.Marshal(files)
	if err != nil {
		t.Fatalf("marshalling renditions: %v", err)
	}

	r := &ayloRelease{ID: 1, Title: "Test"}
	r.Videos.Full = &ayloVideoTrack{Length: length, Files: raw}
	return r
}

func hlsFile(codec string, height int) ayloVideoFile {
	f := ayloVideoFile{Type: "hls", Codec: codec, Height: height}
	f.URLs.View = "https://cdn.example/" + codec + ".m3u8"
	return f
}

func httpFile(codec string, height int) ayloVideoFile {
	f := ayloVideoFile{Type: "http", Codec: codec, Height: height}
	f.URLs.View = "https://cdn.example/" + codec + ".mp4"
	return f
}

// ─── rendition selection ──────────────────────────────────────────────────────

// h264 has to outrank a taller AV1: AV1 cannot be remuxed, so picking it would
// turn a nearly-free channel into a per-viewer re-encode of a remote stream.
func TestPickStreamPrefersH264OverTallerAV1(t *testing.T) {
	r := releaseWithFiles(t, 600,
		hlsFile("av1", 2160),
		hlsFile("h264", 720),
	)

	got, ok := ayloPickStream(r)
	if !ok {
		t.Fatal("expected a playable rendition")
	}
	if got.Codec != "h264" {
		t.Errorf("picked %q; a taller AV1 must never beat h264", got.Codec)
	}
}

func TestPickStreamPrefersProgressiveOverHLSAtEqualCodec(t *testing.T) {
	r := releaseWithFiles(t, 600,
		hlsFile("h264", 1080),
		httpFile("h264", 1080),
	)

	got, ok := ayloPickStream(r)
	if !ok {
		t.Fatal("expected a playable rendition")
	}
	if got.IsHLS {
		t.Error("a progressive rendition should win when the codec and height match")
	}
}

func TestPickStreamPrefersTallestWithinACodec(t *testing.T) {
	r := releaseWithFiles(t, 600,
		hlsFile("h264", 480),
		hlsFile("h264", 1080),
		hlsFile("h264", 720),
	)

	got, _ := ayloPickStream(r)
	if got.Height != 1080 {
		t.Errorf("height = %d, want the tallest (1080)", got.Height)
	}
}

// A rendition with no URL is unplayable, and an expired session is exactly how
// that arrives — the API returns the rendition list with the URLs stripped.
func TestPickStreamIgnoresRenditionsWithoutAURL(t *testing.T) {
	r := releaseWithFiles(t, 600,
		ayloVideoFile{Type: "hls", Codec: "h264", Height: 1080},
	)

	if _, ok := ayloPickStream(r); ok {
		t.Error("a rendition with no urls.view must not be treated as playable")
	}
}

func TestPickStreamIgnoresUnknownTransportTypes(t *testing.T) {
	f := ayloVideoFile{Type: "dash", Codec: "h264", Height: 1080}
	f.URLs.View = "https://cdn.example/manifest.mpd"

	if _, ok := ayloPickStream(releaseWithFiles(t, 600, f)); ok {
		t.Error("only http and hls are handled; anything else must be skipped")
	}
}

func TestPickStreamHandlesMissingTrack(t *testing.T) {
	if _, ok := ayloPickStream(&ayloRelease{ID: 1}); ok {
		t.Error("a release with no full track has nothing to play")
	}
	if _, ok := ayloPickStream(nil); ok {
		t.Error("a nil release has nothing to play")
	}
}

// ─── rendition list shapes ────────────────────────────────────────────────────

// `files` is an array on full tracks but a resolution-keyed object on others.
// Decoding only the array shape would silently yield zero renditions.
func TestFilesAcceptsObjectShape(t *testing.T) {
	track := &ayloVideoTrack{
		Length: 600,
		Files: json.RawMessage(`{
			"720":  {"type":"hls","codec":"h264","height":720,"urls":{"view":"https://cdn/720.m3u8"}},
			"1080": {"type":"hls","codec":"h264","height":1080,"urls":{"view":"https://cdn/1080.m3u8"}}
		}`),
	}

	if got := len(track.files()); got != 2 {
		t.Fatalf("got %d renditions from the object shape, want 2", got)
	}
}

// Go randomises map iteration, so decoding the object shape has to impose an
// order — otherwise an equally-ranked pair could resolve differently on every
// call and a channel's schedule would stop being reproducible.
func TestFilesIsDeterministicForTheObjectShape(t *testing.T) {
	track := &ayloVideoTrack{
		Files: json.RawMessage(`{
			"a": {"type":"hls","codec":"h264","height":720,"urls":{"view":"https://cdn/a.m3u8"}},
			"b": {"type":"hls","codec":"h264","height":720,"urls":{"view":"https://cdn/b.m3u8"}},
			"c": {"type":"hls","codec":"h264","height":720,"urls":{"view":"https://cdn/c.m3u8"}}
		}`),
	}

	first := track.files()
	for i := 0; i < 50; i++ {
		got := track.files()
		for j := range got {
			if got[j].URLs.View != first[j].URLs.View {
				t.Fatalf("rendition order varies between calls at index %d", j)
			}
		}
	}
}

func TestFilesToleratesMissingAndUnparsableLists(t *testing.T) {
	if got := (*ayloVideoTrack)(nil).files(); got != nil {
		t.Error("a nil track should yield no renditions")
	}
	if got := (&ayloVideoTrack{}).files(); got != nil {
		t.Error("an absent files field should yield no renditions")
	}
	if got := (&ayloVideoTrack{Files: json.RawMessage(`"nonsense"`)}).files(); got != nil {
		t.Error("an unparsable files field should yield no renditions, not panic")
	}
}

// ─── schedulability ───────────────────────────────────────────────────────────

func TestUsableRejectsUnschedulableDurations(t *testing.T) {
	if ayloUsable(releaseWithFiles(t, 0, hlsFile("h264", 720))) {
		t.Error("a release with no duration cannot be placed on the grid")
	}
	if ayloUsable(releaseWithFiles(t, 1, hlsFile("h264", 720))) {
		t.Error("a release shorter than one segment occupies zero segments")
	}
}

func TestUsableRejectsCodecsThatWouldNeedAReEncode(t *testing.T) {
	if ayloUsable(releaseWithFiles(t, 600, hlsFile("av1", 2160))) {
		t.Error("AV1-only releases must be left out rather than aired via a re-encode")
	}
}

// List responses do not always populate the rendition list. Dropping those would
// silently shrink a channel to whatever subset happened to carry renditions, so
// they are kept and resolved properly at play time instead.
func TestUsableKeepsReleasesWithNoRenditionsListed(t *testing.T) {
	r := &ayloRelease{ID: 7}
	r.Videos.Full = &ayloVideoTrack{Length: 600}

	if !ayloUsable(r) {
		t.Error("a release with a duration but no listed renditions should still be scheduled")
	}
}

func TestUsableAcceptsOrdinaryH264(t *testing.T) {
	if !ayloUsable(releaseWithFiles(t, 600, hlsFile("h264", 1080))) {
		t.Error("a normal h264 release should be schedulable")
	}
}

// ─── release metadata ─────────────────────────────────────────────────────────

func TestReleaseDateNarrowsToADay(t *testing.T) {
	r := &ayloRelease{DateReleased: "2026-03-14T00:00:00+00:00"}
	if got := r.ReleaseDate(); got != "2026-03-14" {
		t.Errorf("ReleaseDate() = %q, want 2026-03-14", got)
	}
}

// A malformed date is dropped rather than passed through: some clients fail to
// parse the whole guide when one programme carries a bad one.
func TestReleaseDateDropsUnparsableValues(t *testing.T) {
	for _, in := range []string{"", "not-a-date", "20260314"} {
		r := &ayloRelease{DateReleased: in}
		if got := r.ReleaseDate(); got != "" {
			t.Errorf("ReleaseDate(%q) = %q, want empty", in, got)
		}
	}
}

// ─── channel identity ─────────────────────────────────────────────────────────

// Studio ids are small positive ints. A network seed colliding with one would
// give two channels the same rotation, which is harmless but looks like a bug.
func TestChannelSeedStaysClearOfStudioIDs(t *testing.T) {
	for _, b := range ayloBrands {
		if got := iptvNetChannelSeed(b.Slug); got < 1_000_000 {
			t.Errorf("seed for %q = %d, want well above the studio id range", b.Slug, got)
		}
	}
}

func TestChannelSeedIsStableAndDistinct(t *testing.T) {
	seen := map[int]string{}
	for _, b := range ayloBrands {
		got := iptvNetChannelSeed(b.Slug)
		if got != iptvNetChannelSeed(b.Slug) {
			t.Fatalf("seed for %q is not stable", b.Slug)
		}
		if prev, dup := seen[got]; dup {
			t.Errorf("%q and %q share seed %d, so they would air the same rotation", prev, b.Slug, got)
		}
		seen[got] = b.Slug
	}
}

func TestBrandLookupBySlug(t *testing.T) {
	if _, ok := ayloBrandBySlug("brazzers"); !ok {
		t.Error("a known slug should resolve")
	}
	if _, ok := ayloBrandBySlug("nonesuch"); ok {
		t.Error("an unknown slug must not resolve to a brand")
	}
}

// Network channels sit in their own category so a handful of them are not
// buried among hundreds of library channels in the client's folder list.
func TestGroupTitleSeparatesNetworksFromTheLibrary(t *testing.T) {
	s := iptvSettings{GroupTitle: "Vexxx TV"}

	library := iptvGroupTitle(iptvChannel{Source: iptvSourceLibrary}, s)
	network := iptvGroupTitle(iptvChannel{Source: iptvSourceAylo}, s)

	if library != "Vexxx TV" {
		t.Errorf("library group = %q, want the configured title unchanged", library)
	}
	if network == library {
		t.Error("network channels should not share the library's group")
	}
	if !strings.HasPrefix(network, "Vexxx TV") {
		t.Errorf("network group %q should still be recognisable as the same lineup", network)
	}
}

// ─── stream arguments ─────────────────────────────────────────────────────────

// Every one of these is an input option, so ffmpeg ignores any that lands after
// -i. A misplaced -user_agent in particular fails in the worst way: the CDN
// serves a 403 and the channel just looks broken.
func TestRemoteStreamArgsPrecedeTheInput(t *testing.T) {
	src := programSource{Path: "https://cdn.example/master.m3u8", VideoCodec: "h264", Remote: true}
	args := iptvStreamArgs(src, 30, 120, iptv.ModeCopy, iptvSettings{})

	inputAt := indexOf(args, "-i")
	if inputAt < 0 {
		t.Fatal("no -i in the argument list")
	}

	for _, flag := range []string{"-reconnect", "-reconnect_streamed", "-reconnect_delay_max", "-user_agent", "-ss"} {
		at := indexOf(args, flag)
		if at < 0 {
			t.Errorf("%s missing from a remote invocation", flag)
			continue
		}
		if at > inputAt {
			t.Errorf("%s appears after -i, where ffmpeg ignores it", flag)
		}
	}
}

// Local files must not pick up the network flags: -reconnect on a file input is
// meaningless, and the whole point of the split is that library channels behave
// exactly as they did before networks existed.
func TestLocalStreamArgsCarryNoNetworkFlags(t *testing.T) {
	src := programSource{Path: `C:\media\scene.mp4`, VideoCodec: "h264"}
	args := iptvStreamArgs(src, 30, 120, iptv.ModeCopy, iptvSettings{})

	for _, flag := range []string{"-reconnect", "-user_agent", "-multiple_requests"} {
		if indexOf(args, flag) >= 0 {
			t.Errorf("%s should not appear for a local file", flag)
		}
	}
}

func TestRemoteH264RemuxesRatherThanReEncodes(t *testing.T) {
	// The audio codec is deliberately empty for remote sources — the API does
	// not report one — so this pins the behaviour that empty means "remux",
	// not "re-encode to be safe".
	if got := iptv.ChooseMode("h264", ""); got != iptv.ModeCopy {
		t.Errorf("ChooseMode = %v, want copy; a remote re-encode is the expensive path", got)
	}
}

// ─── page assembly ────────────────────────────────────────────────────────────
//
// Pages are fetched concurrently, so the assembly step is the only thing keeping
// the catalog ordered and correctly truncated. These pin it.

func ayloTestPage(ids ...int) []ayloRelease {
	out := make([]ayloRelease, 0, len(ids))
	for _, id := range ids {
		out = append(out, ayloRelease{ID: id})
	}
	return out
}

func ayloTestIDs(rs []ayloRelease) []int {
	out := make([]int, 0, len(rs))
	for _, r := range rs {
		out = append(out, r.ID)
	}
	return out
}

func TestMergeSampleKeepsBandOrderAndDropsDuplicates(t *testing.T) {
	// Order is the slice's, never arrival order — a schedule built from a
	// differently-ordered catalog would not reproduce across restarts.
	got := ayloMergeSample([][]ayloRelease{
		ayloTestPage(1, 2),
		ayloTestPage(2, 3), // 2 repeats: the catalog grew and shifted the offsets
		ayloTestPage(4),
	}, 10, nil)

	if want := []int{1, 2, 3, 4}; !reflect.DeepEqual(ayloTestIDs(got), want) {
		t.Errorf("got %v, want %v", ayloTestIDs(got), want)
	}
}

func TestMergeSampleStopsAtWant(t *testing.T) {
	got := ayloMergeSample([][]ayloRelease{ayloTestPage(1, 2, 3), ayloTestPage(4, 5)}, 4, nil)
	if len(got) != 4 {
		t.Errorf("got %d releases, want 4", len(got))
	}
}

func TestMergeSampleSurvivesAFailedPage(t *testing.T) {
	// A page that failed is a nil slot, not a shorter slice. Losing a quarter of
	// a schedule is survivable; dropping the channel over one timeout is not.
	got := ayloMergeSample([][]ayloRelease{ayloTestPage(1, 2), nil, ayloTestPage(5)}, 10, nil)
	if want := []int{1, 2, 5}; !reflect.DeepEqual(ayloTestIDs(got), want) {
		t.Errorf("got %v, want %v", ayloTestIDs(got), want)
	}
}

// ─── sampling offsets ─────────────────────────────────────────────────────────

func TestSampleOffsetsCoverTheWholeCatalog(t *testing.T) {
	// The point of banding: 4 pages out of 3873 scenes must not all land in the
	// same era, which is what a plain random pick would sometimes do.
	const total, pageSize, pages = 3873, 25, 4
	offsets := ayloSampleOffsets(total, pageSize, pages, 99)

	if len(offsets) != pages {
		t.Fatalf("got %d offsets, want %d", len(offsets), pages)
	}
	band := total / pages
	for i, off := range offsets {
		if off < i*band || off >= (i+1)*band {
			t.Errorf("offset %d (%d) escaped its band [%d,%d)", i, off, i*band, (i+1)*band)
		}
	}
}

func TestSampleOffsetsNeverOverlapOrRunPastTheEnd(t *testing.T) {
	// Overlapping pages would put the same scene on a channel twice; running
	// past the end would waste a read on an empty page.
	const pageSize = 25
	for _, total := range []int{200, 1000, 3873, 10731} {
		for _, pages := range []int{2, 4, 8} {
			offsets := ayloSampleOffsets(total, pageSize, pages, uint64(total))
			for i, off := range offsets {
				if off+pageSize > total {
					t.Errorf("total=%d pages=%d: offset %d runs past the end", total, pages, off)
				}
				if i > 0 && off < offsets[i-1]+pageSize {
					t.Errorf("total=%d pages=%d: offsets %d and %d overlap", total, pages, offsets[i-1], off)
				}
			}
		}
	}
}

func TestSampleOffsetsAreReproducible(t *testing.T) {
	// A channel that re-sampled differently on every refresh would reshuffle
	// what is on air for no reason.
	a := ayloSampleOffsets(3873, 25, 4, 12345)
	b := ayloSampleOffsets(3873, 25, 4, 12345)
	if !reflect.DeepEqual(a, b) {
		t.Errorf("same seed gave %v then %v", a, b)
	}
	if c := ayloSampleOffsets(3873, 25, 4, 54321); reflect.DeepEqual(a, c) {
		t.Errorf("different seeds gave the same offsets %v", a)
	}
}

func TestSampleOffsetsReadSmallCatalogsWhole(t *testing.T) {
	// 60 scenes over 4 pages of 25 is the whole collection twice over, so
	// spreading would only skip scenes that could have aired.
	offsets := ayloSampleOffsets(60, 25, 4, 7)
	if want := []int{0, 25, 50}; !reflect.DeepEqual(offsets, want) {
		t.Errorf("got %v, want %v", offsets, want)
	}
}

func TestSampleOffsetsToleratesDegenerateInput(t *testing.T) {
	for _, tc := range []struct{ total, pageSize, pages int }{
		{0, 25, 4}, {100, 25, 0}, {100, 0, 4}, {-1, 25, 4},
	} {
		if got := ayloSampleOffsets(tc.total, tc.pageSize, tc.pages, 1); got != nil {
			t.Errorf("%+v: got %v, want nil", tc, got)
		}
	}
}

// ─── channel keys ─────────────────────────────────────────────────────────────

func TestCollectionChannelKeysAreDistinctAndStable(t *testing.T) {
	// Keys go into playlists a TV has already stored, so they are built from the
	// collection id rather than its name — an upstream rename must not silently
	// become a different channel.
	brand := ayloCollectionChannelKey("brazzers", 96)
	if brand != "aylo-brazzers-96" {
		t.Errorf("got %q", brand)
	}
	if ayloCollectionChannelKey("brazzers", 96) != brand {
		t.Error("key is not stable")
	}
	if ayloCollectionChannelKey("brazzers", 97) == brand {
		t.Error("different collections share a key")
	}
	if ayloBrandChannelKey("brazzers") == brand {
		t.Error("the brand-wide channel collides with a collection")
	}
}

func TestChannelSeedsStayClearOfStudioIDs(t *testing.T) {
	// Seeds are shared with library channels, whose ids are small positive ints.
	seen := map[int]string{}
	for _, key := range []string{
		ayloBrandChannelKey("brazzers"),
		ayloCollectionChannelKey("brazzers", 96),
		ayloCollectionChannelKey("bangbros", 115131),
	} {
		seed := iptvNetChannelSeed(key)
		if seed < 1_000_000 {
			t.Errorf("%s: seed %d could collide with a studio id", key, seed)
		}
		if other, dup := seen[seed]; dup {
			t.Errorf("%s and %s share seed %d", key, other, seed)
		}
		seen[seed] = key
	}
}

func TestNetworkChannelsGroupByBrand(t *testing.T) {
	// A single "Networks" folder would bury 21 library channels under 100+
	// network ones; clients render each group as a top-level folder.
	s := iptvSettings{GroupTitle: "Vexxx TV"}

	lib := iptvChannel{Source: iptvSourceLibrary}
	if got := iptvGroupTitle(lib, s); got != "Vexxx TV" {
		t.Errorf("library channel got group %q", got)
	}

	bz := iptvChannel{Source: iptvSourceAylo, BrandLabel: "Brazzers"}
	bb := iptvChannel{Source: iptvSourceAylo, BrandLabel: "BangBros"}
	if got := iptvGroupTitle(bz, s); got != "Vexxx TV Brazzers" {
		t.Errorf("got group %q", got)
	}
	if iptvGroupTitle(bz, s) == iptvGroupTitle(bb, s) {
		t.Error("two brands share a group")
	}
}

func indexOf(args []string, want string) int {
	for i, a := range args {
		if a == want {
			return i
		}
	}
	return -1
}
