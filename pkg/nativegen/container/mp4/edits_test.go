package mp4

import (
	"errors"
	"testing"

	"github.com/stashapp/stash/pkg/nativegen/container"
)

func u64b(v uint64) []byte {
	return append(u32b(uint32(v>>32)), u32b(uint32(v))...)
}

// elstV0 builds a version 0 edit list. Each entry is a duration in movie
// timescale units and a media time in media timescale units, at rate 1.0.
func elstV0(entries ...[2]int64) []byte {
	payload := [][]byte{fullBoxHeader(), u32b(uint32(len(entries)))}
	for _, e := range entries {
		payload = append(payload,
			u32b(uint32(e[0])), u32b(uint32(e[1])), u16b(1), u16b(0))
	}
	return mkbox("elst", payload...)
}

// trakWithEdits builds the payload of a trak carrying an edit list, which is
// what parseEditList is given.
func trakWithEdits(elst []byte) []byte {
	return mkbox("edts", elst)
}

func TestParseEditListShift(t *testing.T) {
	const mediaTimescale, movieTimescale = 12800, 1000

	tests := []struct {
		name string
		trak []byte
		want int64
	}{
		{
			// The common case, and the one this whole file exists for: a
			// composition offset of two frames at 25 fps declared as the point
			// the presentation starts.
			name: "one segment starting two frames in",
			trak: trakWithEdits(elstV0([2]int64{898560, 1024})),
			want: 1024,
		},
		{
			name: "no edit list at all",
			trak: mkbox("mdia"),
			want: 0,
		},
		{
			name: "an edts with no elst inside it",
			trak: mkbox("edts"),
			want: 0,
		},
		{
			name: "an elst with no entries",
			trak: trakWithEdits(elstV0()),
			want: 0,
		},
		{
			name: "media_time 0, which shifts nothing",
			trak: trakWithEdits(elstV0([2]int64{898560, 0})),
			want: 0,
		},
		{
			// An empty edit delays the media, so it pulls the shift the other
			// way; 500 movie units at these timescales is 6400 media units.
			name: "an empty edit before the media",
			trak: trakWithEdits(elstV0([2]int64{500, -1}, [2]int64{898560, 1024})),
			want: 1024 - 6400,
		},
		{
			name: "an empty edit and nothing else",
			trak: trakWithEdits(elstV0([2]int64{500, -1})),
			want: -6400,
		},
		{
			name: "version 1, whose durations and media times are 64-bit",
			trak: trakWithEdits(mkbox("elst",
				[]byte{1, 0, 0, 0}, u32b(1),
				u64b(898560), u64b(1<<33), u16b(1), u16b(0))),
			want: 1 << 33,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseEditList(tt.trak, mediaTimescale, movieTimescale)
			if err != nil {
				t.Fatalf("parseEditList: %v", err)
			}
			if got.shift != tt.want {
				t.Errorf("shift = %d, want %d", got.shift, tt.want)
			}
		})
	}
}

// An edit list that genuinely edits cannot be expressed by a sample index, and
// guessing at one would move the frame a time resolves to and so the hashes
// computed from it. Those files have to be declined instead.
func TestParseEditListDeclinesRealEdits(t *testing.T) {
	const mediaTimescale, movieTimescale = 12800, 1000

	tests := []struct {
		name string
		trak []byte
		// noMovieTimescale drops the movie timescale, which only matters to the
		// one case below that needs it to convert an empty edit.
		noMovieTimescale bool
	}{
		{
			name: "two segments of media joined together",
			trak: trakWithEdits(elstV0([2]int64{1000, 0}, [2]int64{1000, 500000})),
		},
		{
			name: "media played at a rate other than 1.0",
			trak: trakWithEdits(mkbox("elst", fullBoxHeader(), u32b(1),
				u32b(898560), u32b(1024), u16b(2), u16b(0))),
		},
		{
			name: "media played backwards",
			trak: trakWithEdits(mkbox("elst", fullBoxHeader(), u32b(1),
				u32b(898560), u32b(1024), u16b(0xffff), u16b(0))),
		},
		{
			name: "an entry count larger than the box",
			trak: trakWithEdits(mkbox("elst", fullBoxHeader(), u32b(4),
				u32b(898560), u32b(1024), u16b(1), u16b(0))),
		},
		{
			// Without the movie timescale the empty edit cannot be converted
			// into media units, so its delay is unknown rather than zero.
			name:             "an empty edit in a file with no movie timescale",
			trak:             trakWithEdits(elstV0([2]int64{500, -1}, [2]int64{898560, 1024})),
			noMovieTimescale: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			movie := uint32(movieTimescale)
			if tt.noMovieTimescale {
				movie = 0
			}
			_, err := parseEditList(tt.trak, mediaTimescale, movie)
			if !errors.Is(err, container.ErrUnsupported) {
				t.Errorf("parseEditList error = %v, want ErrUnsupported", err)
			}
		})
	}
}

// The shift moves both timestamps by the same amount, so the reorder delay
// between them survives, and it is allowed to take the earliest samples
// negative rather than dropping them: they are still needed to decode the
// frames that follow.
func TestEditListApplyMovesBothTimestamps(t *testing.T) {
	samples := []container.Sample{
		{DTS: 0, PTS: 1024},
		{DTS: 512, PTS: 2048},
		{DTS: 1024, PTS: 1536},
	}
	editList{shift: 1024}.apply(samples)

	want := []container.Sample{
		{DTS: -1024, PTS: 0},
		{DTS: -512, PTS: 1024},
		{DTS: 0, PTS: 512},
	}
	for i := range want {
		if samples[i] != want[i] {
			t.Errorf("sample %d = {DTS %d, PTS %d}, want {DTS %d, PTS %d}",
				i, samples[i].DTS, samples[i].PTS, want[i].DTS, want[i].PTS)
		}
	}

	// A zero shift must leave the index exactly as it was, since that is the
	// path every file without an edit list takes.
	before := append([]container.Sample(nil), samples...)
	editList{}.apply(samples)
	for i := range before {
		if samples[i] != before[i] {
			t.Errorf("a zero shift changed sample %d", i)
		}
	}
}

func TestMovieTimescaleOf(t *testing.T) {
	v0 := mkbox("mvhd", fullBoxHeader(), u32b(0), u32b(0), u32b(1000), u32b(898589))
	if got := movieTimescaleOf(v0); got != 1000 {
		t.Errorf("version 0 mvhd timescale = %d, want 1000", got)
	}

	v1 := mkbox("mvhd", []byte{1, 0, 0, 0}, u64b(0), u64b(0), u32b(600), u64b(1000))
	if got := movieTimescaleOf(v1); got != 600 {
		t.Errorf("version 1 mvhd timescale = %d, want 600", got)
	}

	// No mvhd, and a truncated one, both mean "unknown" rather than zero units
	// per second; the caller declines files that need the value.
	if got := movieTimescaleOf(mkbox("moov")); got != 0 {
		t.Errorf("timescale with no mvhd = %d, want 0", got)
	}
	if got := movieTimescaleOf(mkbox("mvhd", fullBoxHeader(), u32b(0))); got != 0 {
		t.Errorf("timescale from a truncated mvhd = %d, want 0", got)
	}
}
