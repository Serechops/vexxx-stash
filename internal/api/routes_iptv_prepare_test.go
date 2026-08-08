package api

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stashapp/stash/pkg/iptv"
)

// Preparation: the states between "no schedule" and "a finished schedule".
//
// These exist because the original code had only those two states, and a
// provider whose channels take a while to become schedulable therefore looked
// exactly like a provider whose channels were broken — retried on a backoff that
// doubled to half an hour, reported to the player as a 500, and shown in the
// panel as "No playable content".

var errFakeWarming = errors.New("fake channel is not ready")

// fakePrepNetwork is a provider whose answer is whatever the test says it is.
type fakePrepNetwork struct {
	programs []iptv.SceneEntry
	err      error
	live     bool
	note     string
	// calls counts schedule builds and prepared counts bulk-preparation kicks.
	// Atomic because refreshCatalogs builds four channels at a time.
	calls    atomic.Int64
	prepared atomic.Int64
}

func (f *fakePrepNetwork) Source() string             { return "fake" }
func (f *fakePrepNetwork) Label() string              { return "Fake" }
func (f *fakePrepNetwork) SessionLive() bool          { return f.live }
func (f *fakePrepNetwork) IsNoSession(err error) bool { return false }

func (f *fakePrepNetwork) ListChannels(context.Context, int) ([]iptvNetChannelSpec, error) {
	return nil, nil
}

func (f *fakePrepNetwork) Programs(context.Context, iptvNetChannelSpec, int, uint64) ([]iptv.SceneEntry, error) {
	f.calls.Add(1)
	return f.programs, f.err
}

func (f *fakePrepNetwork) ProgramSource(context.Context, int) (programSource, error) {
	return programSource{}, nil
}

func (f *fakePrepNetwork) IsWarming(err error) bool { return errors.Is(err, errFakeWarming) }
func (f *fakePrepNetwork) PrepNote() string         { return f.note }
func (f *fakePrepNetwork) Prepare(context.Context)  { f.prepared.Add(1) }

// plainNetwork implements only the required half of the contract, so it can
// never be asked how its preparation is going. Deliberately not embedding
// fakePrepNetwork: embedding would promote IsWarming and PrepNote and make this
// a preparer after all, which is precisely what it is here to not be.
type plainNetwork struct{ live bool }

func (p *plainNetwork) Source() string             { return "plain" }
func (p *plainNetwork) Label() string              { return "Plain" }
func (p *plainNetwork) SessionLive() bool          { return p.live }
func (p *plainNetwork) IsNoSession(err error) bool { return false }

func (p *plainNetwork) ListChannels(context.Context, int) ([]iptvNetChannelSpec, error) {
	return nil, nil
}

func (p *plainNetwork) Programs(context.Context, iptvNetChannelSpec, int, uint64) ([]iptv.SceneEntry, error) {
	return nil, nil
}

func (p *plainNetwork) ProgramSource(context.Context, int) (programSource, error) {
	return programSource{}, nil
}

func programs(n int) []iptv.SceneEntry {
	out := make([]iptv.SceneEntry, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, iptv.SceneEntry{SceneID: i + 1, Duration: 600})
	}
	return out
}

func prepSettings() iptvSettings {
	return iptvSettings{NetworkMinScenes: iptvNetMinReleases, NetworkPrograms: 50}
}

// ─── what each outcome is cached as ───────────────────────────────────────────

func TestAnIncompleteScheduleAirsInsteadOfFailing(t *testing.T) {
	// Programmes *and* an error, wrapped the way a provider returns it.
	ns := newIPTVNetworkState(&fakePrepNetwork{
		programs: programs(15),
		err:      fmt.Errorf("%w — 15 of 50 measured so far", errIPTVNetIncomplete),
	})
	entry := ns.fetchCatalog(context.Background(), iptvNetChannelSpec{Key: "fake-a"}, 50)

	if entry.err != nil {
		t.Fatalf("an airable schedule must not be cached as a failure: %v", entry.err)
	}
	if len(entry.programs) != 15 {
		t.Errorf("kept %d programmes, want the 15 that were built", len(entry.programs))
	}
	if !entry.partial {
		t.Error("the schedule is unfinished and must be marked so, or it is cached for a day")
	}
	if entry.attempts != 0 {
		t.Errorf("attempts = %d; making progress is not failing, so it must not feed the backoff", entry.attempts)
	}
	if entry.dead() {
		t.Error("a partial schedule has programmes — dropping it from the lineup would be wrong")
	}
}

func TestAWarmingChannelIsNeitherFailedNorDead(t *testing.T) {
	ns := newIPTVNetworkState(&fakePrepNetwork{err: errFakeWarming})
	entry := ns.fetchCatalog(context.Background(), iptvNetChannelSpec{Key: "fake-a"}, 50)

	if !entry.warming {
		t.Fatal("the provider said this is not ready yet, not that it is broken")
	}
	if entry.err == nil {
		t.Error("the error is kept so a tuning viewer can be told to come back, rather than shown an empty channel")
	}
	if entry.dead() {
		t.Error("a warming channel must stay in the lineup — dropping it hides a channel that is about to work")
	}
	if ns.dir.isDead("fake-a", 50) {
		t.Error("the directory agrees: not dead")
	}
}

func TestPreparationRetriesFlatWhileFailureBacksOff(t *testing.T) {
	net := &fakePrepNetwork{err: errFakeWarming}
	ns := newIPTVNetworkState(net)
	spec := iptvNetChannelSpec{Key: "fake-a"}

	// Ten passes of a channel that is simply still working.
	for i := 0; i < 10; i++ {
		entry := ns.fetchCatalog(context.Background(), spec, 50)
		if entry.attempts != 0 {
			t.Fatalf("pass %d: attempts = %d, want 0 — preparation repeating is evidence it is working", i, entry.attempts)
		}
		wait := time.Until(entry.retryAt)
		if wait > iptvNetPrepRetry+time.Second || wait < iptvNetPrepRetry-time.Second {
			t.Fatalf("pass %d: next attempt in %s, want the flat %s", i, wait.Round(time.Second), iptvNetPrepRetry)
		}
	}

	// The same channel genuinely breaking must still back off, and must start
	// counting from zero rather than inheriting anything from the warm.
	net.err = errors.New("boom")
	entry := ns.fetchCatalog(context.Background(), spec, 50)
	if entry.attempts != 1 {
		t.Errorf("first real failure counted as attempt %d, want 1", entry.attempts)
	}
	if entry.warming || entry.partial {
		t.Error("a real failure must not be reported as preparation")
	}
}

func TestAnUnfinishedScheduleExpiresOnItsOwnDeadlineNotTheCatalogTTL(t *testing.T) {
	// Freshly built by the catalog's standards, which is exactly why the TTL is
	// the wrong clock: it will be a longer rotation in three minutes.
	partial := iptvNetCatalogEntry{
		built:    time.Now(),
		programs: programs(15),
		partial:  true,
		retryAt:  time.Now().Add(-time.Second),
	}
	if partial.current(iptvNetCatalogTTL) {
		t.Error("a partial schedule past its deadline must be rebuilt, or it stays short for a day")
	}

	partial.retryAt = time.Now().Add(iptvNetPrepRetry)
	if !partial.current(iptvNetCatalogTTL) {
		t.Error("a partial schedule inside its deadline should keep serving rather than being rebuilt every request")
	}

	warming := iptvNetCatalogEntry{built: time.Now(), warming: true, retryAt: time.Now().Add(-time.Second)}
	if warming.current(iptvNetCatalogTTL) {
		t.Error("a warming channel past its deadline must be reattempted")
	}
}

func TestBulkPreparationIsKickedOncePerWarmNotOncePerChannel(t *testing.T) {
	// Doing it per channel means each one rediscovers the same work separately,
	// and a channel nobody has asked for never starts its share at all.
	s := prepSettings()
	net := &fakePrepNetwork{live: true, programs: programs(50)}
	ns := newIPTVNetworkState(net)

	specs := make([]iptvNetChannelSpec, 0, 20)
	for i := 0; i < 20; i++ {
		specs = append(specs, iptvNetChannelSpec{Key: fmt.Sprintf("fake-%d", i)})
	}
	ns.dir.mu.Lock()
	ns.dir.specs, ns.dir.specsAt, ns.dir.minScenes = specs, time.Now(), s.NetworkMinScenes
	ns.dir.mu.Unlock()

	ns.prepare(context.Background())
	ns.refreshCatalogs(context.Background(), s)

	if got := net.prepared.Load(); got != 1 {
		t.Errorf("Prepare called %d times for a pass over %d channels, want 1", got, len(specs))
	}
	if got := net.calls.Load(); int(got) != len(specs) {
		t.Errorf("built %d of %d channels", got, len(specs))
	}
}

func TestAProviderWithNoBulkWorkIsNeverAskedToPrepare(t *testing.T) {
	// plainNetwork has no Prepare method at all, so this must not panic.
	ns := newIPTVNetworkState(&plainNetwork{live: true})
	ns.prepare(context.Background())
}

// ─── how it is reported ───────────────────────────────────────────────────────

func TestChannelStatusNamesEachStateDistinctly(t *testing.T) {
	s := prepSettings()
	ns := newIPTVNetworkState(&fakePrepNetwork{live: true})

	if state, _ := ns.channelStatus("never-seen", s); state != iptvChanPending {
		t.Errorf("a channel with no entry yet = %q, want %q", state, iptvChanPending)
	}

	cases := []struct {
		name  string
		entry iptvNetCatalogEntry
		want  string
	}{
		{"ready", iptvNetCatalogEntry{programs: programs(50), want: 50}, iptvChanReady},
		{"partial", iptvNetCatalogEntry{programs: programs(15), want: 50, partial: true, note: "15 of 50"}, iptvChanPartial},
		{"warming", iptvNetCatalogEntry{want: 50, warming: true, err: errFakeWarming, note: "measuring"}, iptvChanWarming},
		{"failed", iptvNetCatalogEntry{want: 50, err: errors.New("boom")}, iptvChanFailed},
	}
	for _, c := range cases {
		ns.dir.putCatalog(c.name, c.entry)
		state, detail := ns.channelStatus(c.name, s)
		if state != c.want {
			t.Errorf("%s = %q, want %q", c.name, state, c.want)
		}
		if c.want != iptvChanReady && detail == "" {
			t.Errorf("%s: a channel that is not showing anything must say why", c.name)
		}
	}
}

func TestStatusCountsMatchTheLineupTheUserCanSee(t *testing.T) {
	s := prepSettings()
	ns := newIPTVNetworkState(&fakePrepNetwork{live: true, note: "measuring runtimes"})

	specs := []iptvNetChannelSpec{
		{Key: "a"}, {Key: "b"}, {Key: "c"}, {Key: "d"}, {Key: "e"}, {Key: "dead"},
	}
	ns.dir.mu.Lock()
	ns.dir.specs, ns.dir.specsAt, ns.dir.minScenes = specs, time.Now(), s.NetworkMinScenes
	ns.dir.mu.Unlock()

	ns.dir.putCatalog("a", iptvNetCatalogEntry{want: 50, programs: programs(50)})
	ns.dir.putCatalog("b", iptvNetCatalogEntry{want: 50, programs: programs(12), partial: true})
	ns.dir.putCatalog("c", iptvNetCatalogEntry{want: 50, warming: true, err: errFakeWarming})
	ns.dir.putCatalog("e", iptvNetCatalogEntry{want: 50, err: errors.New("boom")})
	// "d" is deliberately left unfetched, and "dead" read fine but had nothing.
	ns.dir.putCatalog("dead", iptvNetCatalogEntry{want: 50})

	st := ns.status(s)

	// Five, not six: a dead channel is not offered to the TV, so counting it
	// here would make the banner disagree with the list underneath it.
	if st.Channels != 5 {
		t.Errorf("Channels = %d, want 5 — dead channels are not in the lineup", st.Channels)
	}
	if st.Ready != 1 || st.Partial != 1 || st.Warming != 1 || st.Pending != 1 || st.Failed != 1 {
		t.Errorf("counts = ready %d, partial %d, warming %d, pending %d, failed %d; want one of each",
			st.Ready, st.Partial, st.Warming, st.Pending, st.Failed)
	}
	if st.Ready+st.Partial+st.Warming+st.Pending+st.Failed != st.Channels {
		t.Error("every channel in the lineup must land in exactly one bucket")
	}
	if !st.Preparing() {
		t.Error("channels are still being built, so the panel should say so")
	}
	if st.Note != "measuring runtimes" {
		t.Errorf("Note = %q, want the provider's explanation", st.Note)
	}
}

func TestAFinishedProviderIsNotAskedToExplainItself(t *testing.T) {
	s := prepSettings()
	ns := newIPTVNetworkState(&fakePrepNetwork{live: true, note: "should not be shown"})

	ns.dir.mu.Lock()
	ns.dir.specs, ns.dir.specsAt, ns.dir.minScenes =
		[]iptvNetChannelSpec{{Key: "a"}}, time.Now(), s.NetworkMinScenes
	ns.dir.mu.Unlock()
	ns.dir.putCatalog("a", iptvNetCatalogEntry{want: 50, programs: programs(50)})

	st := ns.status(s)
	if st.Preparing() {
		t.Error("nothing is outstanding")
	}
	if st.Note != "" {
		t.Errorf("Note = %q; a finished lineup needs no progress note, and building one costs a database read", st.Note)
	}
}

func TestOnlyConnectedProvidersAppearInTheProgressReport(t *testing.T) {
	s := prepSettings()
	nets := iptvNetworks{
		newIPTVNetworkState(&fakePrepNetwork{live: false}),
		newIPTVNetworkState(&plainNetwork{live: true}),
	}

	got := nets.statuses(s)
	if len(got) != 1 || got[0].Source != "plain" {
		t.Fatalf("statuses = %+v; a provider with no session has no lineup to report on", got)
	}
}

// ─── the optional half of the contract ────────────────────────────────────────

func TestAProviderWithNoPreparationIsNeverWarming(t *testing.T) {
	ns := newIPTVNetworkState(&plainNetwork{})
	if ns.isWarming(errFakeWarming) {
		t.Error("a provider that does not implement iptvNetPreparer cannot claim a channel is warming")
	}
	if ns.isWarming(nil) {
		t.Error("no error is not a warming error")
	}
}

func TestLibraryChannelsAreNeverWarming(t *testing.T) {
	// bySource returns nil for a library channel, and the 503 path must not
	// panic or misreport on the way past.
	nets := iptvNetworks{newIPTVNetworkState(&fakePrepNetwork{})}
	if nets.isWarming(iptvSourceLibrary, errFakeWarming) {
		t.Error("a studio on disk has no preparation to be waiting on")
	}
}

func TestTeamSkeetTellsPreparationApartFromAnUnfinishedSchedule(t *testing.T) {
	net := teamSkeetNetwork{}

	if !net.IsWarming(errTeamSkeetWarming) {
		t.Error("a channel with nothing measured yet is warming")
	}
	// An incomplete schedule is handled before the warming branch and its error
	// is cleared, so it must never reach the 503 path — a channel that is
	// already airing is not a channel to tell the player to come back to.
	if net.IsWarming(errIPTVNetIncomplete) {
		t.Error("an airable-but-growing schedule is not a warming channel")
	}
	if net.IsWarming(errTeamSkeetNoSession) {
		t.Error("a lapsed session is not preparation — it must keep its own handling")
	}
	if net.IsWarming(nil) {
		t.Error("no error is not warming")
	}
}

func TestATeamSkeetChannelAirsOnceItHasEnoughToBeAChannel(t *testing.T) {
	// The floor for going on air with a partial rotation is the same one that
	// decides whether a collection deserves a channel at all. If these ever
	// diverge, a channel could be created that can never reach its own airing
	// threshold.
	if iptvNetMinReleases <= 0 {
		t.Fatal("the airing floor must be positive")
	}
	if iptvNetMinReleases > iptvNetDefaultPrograms {
		t.Errorf("the airing floor (%d) exceeds a full rotation (%d), so no partial schedule could ever air",
			iptvNetMinReleases, iptvNetDefaultPrograms)
	}
}

func TestPrepNoteReportsProgressThroughTheRunItIsOn(t *testing.T) {
	// Restored, because the sweep state is process-wide and a test that leaves it
	// running would change what every later one sees.
	defer func() { teamSkeetSweep = &teamSkeetSweepState{} }()

	teamSkeetSweep = &teamSkeetSweepState{}
	teamSkeetSweep.begin()
	teamSkeetSweep.setTotal(8772)
	for i := 0; i < 1204; i++ {
		teamSkeetSweep.record(true)
	}

	note := teamSkeetNetwork{}.PrepNote()

	// Both halves of "1204 of 8772" have to be there. The ratio is the only
	// thing that moves visibly — the size of the store barely changes between
	// two panel refreshes, so reporting that instead reads as a stall.
	if !strings.Contains(note, "1204") || !strings.Contains(note, "8772") {
		t.Errorf("note does not report progress through this run: %q", note)
	}
	if !strings.Contains(note, "runtime") {
		t.Errorf("note does not say what is being counted: %q", note)
	}

	// Before the scene list comes back there is no ratio to show, and the note
	// must still say something rather than reading as finished.
	teamSkeetSweep = &teamSkeetSweepState{}
	teamSkeetSweep.begin()
	note = teamSkeetNetwork{}.PrepNote()
	if note == "" {
		t.Error("a sweep that has not yet counted its work still owes the panel an explanation")
	}
}
