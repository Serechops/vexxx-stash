package api

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/stashapp/stash/pkg/iptv"
	"github.com/stashapp/stash/pkg/logger"
)

// Network channels: a provider's own catalog aired as live TV.
//
// A library channel airs files on disk; a network channel airs a provider's
// catalog straight from its CDN, so it can cover releases that were never
// downloaded. Everything downstream — the virtual timeline, the guide, the
// MPEG-TS pipe — is shared with library channels. Only two things differ, and
// both come from the source being remote:
//
//  1. The schedule and the stream URL have different lifetimes. Durations are
//     stable and cache for a day; a playable URL is signed and short-lived, so
//     it is resolved per programme, moments before ffmpeg starts. A schedule
//     never holds a playable URL.
//
//  2. A programme can fail for reasons a local file cannot — the session
//     lapsed, the provider 500s, the release turned out to be AV1.
//     ChannelStream's existing consecutive-failure backoff absorbs that: the
//     slot is lost and the channel moves on, which is right for live TV.
//
// This file owns everything that is true of *any* provider: what is cached, for
// how long, when it is refreshed, and when a channel leaves the lineup. Each
// provider supplies only the four things that are actually its own, via
// iptvNetwork — see routes_iptv_apihub.go (Aylo) and routes_iptv_adulttime.go.
//
// Authentication is entirely API Hub's. Nothing here mints, refreshes or stores
// a credential; each provider reads the session API Hub already holds and
// disappears from the lineup when there isn't one.

const (
	// How long a built schedule is good for. Durations and release dates do not
	// change, so the only thing this bounds is how long a channel keeps airing
	// the same rotation.
	iptvNetCatalogTTL = 24 * time.Hour

	// Below this a child studio is not worth its own channel — the rotation
	// would be too short to feel like a channel rather than a loop. Measured
	// against the live Aylo catalog, 10 keeps 116 of 132 collections; against
	// Adult Time, 193 of 206.
	iptvNetMinReleases = 10

	// How many programmes a network channel's rotation holds. At roughly half
	// an hour a scene this is about a day's worth, and it is also the main cost
	// dial: listings cannot be trimmed, so this multiplied by the channel count
	// is the daily metadata bill.
	iptvNetDefaultPrograms = 50

	// Catalogs are refreshed in the background this long before they expire, so
	// a schedule is replaced while the old one is still serving rather than
	// after it has already gone stale.
	iptvNetRefreshLead = 2 * time.Hour

	// A schedule that failed to build is retried on this cadence, doubling to
	// the cap. It is deliberately nothing like the catalog TTL, because the two
	// describe different things: a successful schedule is good for a day, while
	// a failure is usually a session being momentarily between renewals.
	// Treating that as a fact about the channel is what once took 53 of 122
	// channels off air for 24 hours over a gap that closed in about a minute.
	iptvNetRetryBase = 2 * time.Minute
	iptvNetRetryMax  = 30 * time.Minute

	// How many channel schedules are built at once. Distinct from a provider's
	// own HTTP concurrency limit: this bounds memory, since every channel in
	// flight holds several decoded catalog pages.
	iptvNetChannelConcurrency = 4

	// How long a background warm may run before it is abandoned. Generous
	// because a cold start walks a provider's entire lineup.
	iptvNetWarmTimeout = 15 * time.Minute
)

// ─── the provider contract ────────────────────────────────────────────────────

// iptvNetwork is everything a provider must supply to become channels.
// Deliberately small: discovery, sampling, playback and a session check. All
// caching, retrying and lineup policy is handled generically below, so a new
// provider cannot accidentally reintroduce a caching bug that has already been
// fixed once.
type iptvNetwork interface {
	// Source is the iptvSource* constant identifying this provider's channels.
	Source() string

	// Label names the provider in log lines.
	Label() string

	// SessionLive reports whether API Hub currently holds usable credentials.
	// Called on cache-hit paths, so it must stay cheap — a config read, not a
	// network round trip.
	SessionLive() bool

	// IsNoSession reports an error that means the session lapsed rather than
	// the channel being broken. This is the one failure that must never be
	// cached; see iptvNetworkState.fetchCatalog.
	IsNoSession(err error) bool

	// ListChannels discovers the lineup, already ordered — channel numbers come
	// from this order, so it must be stable across refreshes or a TV's stored
	// playlist renumbers itself.
	ListChannels(ctx context.Context, minScenes int) ([]iptvNetChannelSpec, error)

	// Programs samples one channel's schedulable programmes. Returning an empty
	// slice with a nil error is a real answer — "this channel has nothing that
	// can fill a slot" — and takes the channel out of the lineup.
	Programs(ctx context.Context, spec iptvNetChannelSpec, want int, seed uint64) ([]iptv.SceneEntry, error)

	// ProgramSource resolves a programme to something ffmpeg can open right
	// now. A live call on every programme boundary: the URL in the cached
	// schedule, if there ever was one, expired long ago.
	ProgramSource(ctx context.Context, programID int) (programSource, error)
}

// ─── channel specs ────────────────────────────────────────────────────────────

// iptvNetChannelSpec is everything the lineup needs about one network channel,
// without any of its programmes. Building the list of specs is cheap; building
// their schedules is not, which is why the two are cached separately and warmed
// independently.
type iptvNetChannelSpec struct {
	// Source ties a spec back to the provider that produced it, so a spec
	// recovered from the lineup can be routed without a second lookup.
	Source string
	Key    string

	// BrandSlug and BrandLabel group channels into folders on the TV. For a
	// provider with one catalog (Adult Time) they name the provider itself; for
	// one with several (Aylo) they name the brand.
	BrandSlug  string
	BrandLabel string

	Name string

	// TvgID is the guide id clients store to bind a channel to its listings.
	// The provider supplies it rather than deriving it from Key here, because
	// changing one silently unbinds the EPG on a TV that already has the
	// playlist — so its historical shape has to be preserved exactly.
	TvgID string

	// CollectionID and Collection identify the child studio this channel airs,
	// whichever way the provider names them — Aylo uses a numeric collection
	// id, Adult Time a channel name. Both zero/empty means the brand-wide
	// channel. Only the provider interprets these.
	CollectionID int
	Collection   string

	SceneCount int
}

// iptvNetChannelSeed derives a stable numeric channel id from a channel key, so
// network channels can reuse ShuffleSeed. Studio ids are small positive ints;
// these are offset well clear of them so the two never collide on a seed.
func iptvNetChannelSeed(key string) int {
	var h int
	for _, c := range key {
		h = h*31 + int(c)
	}
	if h < 0 {
		h = -h
	}
	return 1_000_000 + h%1_000_000
}

// ─── cached schedules ─────────────────────────────────────────────────────────

type iptvNetCatalogEntry struct {
	programs []iptv.SceneEntry
	built    time.Time
	want     int
	err      error

	// attempts counts consecutive failures, which sets how long to wait before
	// trying again; retryAt is when that wait is up. Both are zero on success,
	// where built and the catalog TTL decide freshness instead.
	attempts int
	retryAt  time.Time
}

// dead reports a channel with nothing to air: its catalog was read successfully
// and held no scene that can fill a slot. Aylo lists plenty of archive
// collections whose scenes carry a placeholder duration of 0 or 1 second —
// measured, 14 of 122 channels — and they are real pages on the site but cannot
// be scheduled, so the lineup is better off without them.
//
// This is distinct from a failure precisely because it is an answer: a dead
// channel is dropped, a failed one is retried.
func (e iptvNetCatalogEntry) dead() bool {
	return e.err == nil && len(e.programs) == 0
}

// current reports whether an entry can keep serving, i.e. no refetch is due.
func (e iptvNetCatalogEntry) current(ttl time.Duration) bool {
	if e.err != nil {
		return time.Now().Before(e.retryAt)
	}
	return time.Since(e.built) < ttl
}

// iptvNetRetryDelay backs a repeatedly failing channel off, so one that is
// broken for a real reason stops costing a request every couple of minutes
// forever.
func iptvNetRetryDelay(attempts int) time.Duration {
	d := iptvNetRetryBase
	for i := 1; i < attempts; i++ {
		if d >= iptvNetRetryMax {
			break
		}
		d *= 2
	}
	if d > iptvNetRetryMax {
		d = iptvNetRetryMax
	}
	return d
}

// ─── directory (which channels exist) ─────────────────────────────────────────

// iptvNetDirectory caches one provider's channel list and every channel's
// programmes.
//
// Both are refreshed off the request path, and this is the whole reason the type
// exists. Discovering the lineup costs a handful of round trips; filling in
// every channel's schedule costs a few hundred MB. Neither belongs inside a
// playlist request that a TV app will abandon, so requests are served from
// whatever is cached and a background warm is kicked off to fill the rest in.
// Callers see the lineup grow over a minute or two after a cold start rather
// than waiting for all of it.
//
// gen increments whenever the cached content changes. The channel-list cache
// records the generation it was built at and rebuilds when it moves, which is
// what makes a background refresh visible without any invalidation plumbing.
type iptvNetDirectory struct {
	mu sync.Mutex

	specs     []iptvNetChannelSpec
	specsAt   time.Time
	minScenes int

	catalogs map[string]*iptvNetCatalogEntry

	gen     uint64
	warming bool
}

func newIPTVNetDirectory() *iptvNetDirectory {
	return &iptvNetDirectory{catalogs: make(map[string]*iptvNetCatalogEntry)}
}

func (d *iptvNetDirectory) generation() uint64 {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.gen
}

// snapshot returns the cached specs and whether they are still fresh.
// Stale specs are still returned: serving a lineup that is a day out of date
// beats serving none while a refresh runs.
func (d *iptvNetDirectory) snapshot(minScenes int) (specs []iptvNetChannelSpec, fresh bool) {
	d.mu.Lock()
	defer d.mu.Unlock()

	fresh = !d.specsAt.IsZero() &&
		d.minScenes == minScenes &&
		time.Since(d.specsAt) < iptvNetCatalogTTL
	return d.specs, fresh
}

// catalog returns a channel's cached programmes. ok is false when nothing has
// been fetched for it yet, which callers treat as "not ready" rather than
// "empty" — the difference between a channel whose guide fills in shortly and
// one that is genuinely broken.
func (d *iptvNetDirectory) catalog(key string, want int) (entry iptvNetCatalogEntry, ok bool) {
	d.mu.Lock()
	defer d.mu.Unlock()

	e, ok := d.catalogs[key]
	if !ok || e.want != want {
		return iptvNetCatalogEntry{}, false
	}
	return *e, true
}

// isDead reports a channel known to have nothing schedulable in it. Unknown
// channels are not dead — a schedule that has not been built yet is a channel
// whose guide fills in shortly, not one to hide.
func (d *iptvNetDirectory) isDead(key string, want int) bool {
	entry, ok := d.catalog(key, want)
	return ok && entry.dead()
}

func (d *iptvNetDirectory) putCatalog(key string, entry iptvNetCatalogEntry) {
	d.mu.Lock()
	defer d.mu.Unlock()

	d.catalogs[key] = &entry
	d.gen++
}

// beginWarm claims the right to run a background refresh. Only one runs at a
// time: a second would duplicate every request for no benefit, and a cold start
// can otherwise trigger one per in-flight client.
func (d *iptvNetDirectory) beginWarm() bool {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.warming {
		return false
	}
	d.warming = true
	return true
}

func (d *iptvNetDirectory) endWarm() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.warming = false
}

// ─── one provider, wired up ───────────────────────────────────────────────────

// iptvNetworkState pairs a provider with its cache. One per provider, held for
// the process lifetime.
type iptvNetworkState struct {
	net iptvNetwork
	dir *iptvNetDirectory
}

func newIPTVNetworkState(net iptvNetwork) *iptvNetworkState {
	return &iptvNetworkState{net: net, dir: newIPTVNetDirectory()}
}

// warm refreshes anything stale, in the background.
//
// It runs on its own context rather than a request's: the request that noticed
// the staleness is long finished by the time this completes, and cancelling the
// refresh because one client disconnected would mean the work restarts from
// scratch on the next request.
func (ns *iptvNetworkState) warm(s iptvSettings) {
	// Warming without a session would walk the whole lineup writing the same
	// failure into every channel. Renewal closes these gaps within minutes, so
	// the useful thing to do is nothing at all and be asked again.
	if !ns.net.SessionLive() {
		return
	}
	if !ns.dir.beginWarm() {
		return
	}

	go func() {
		defer ns.dir.endWarm()

		ctx, cancel := context.WithTimeout(context.Background(), iptvNetWarmTimeout)
		defer cancel()

		if _, fresh := ns.dir.snapshot(s.NetworkMinScenes); !fresh {
			ns.refreshDirectory(ctx, s)
		}
		ns.refreshCatalogs(ctx, s)
	}()
}

// refreshDirectory rediscovers which channels exist.
func (ns *iptvNetworkState) refreshDirectory(ctx context.Context, s iptvSettings) {
	specs, err := ns.net.ListChannels(ctx, s.NetworkMinScenes)
	if err != nil {
		logger.Warnf("[iptv] API Hub: could not list %s channels: %v", ns.net.Label(), err)
		return
	}
	if len(specs) == 0 {
		return
	}

	d := ns.dir
	d.mu.Lock()
	d.specs, d.specsAt, d.minScenes = specs, time.Now(), s.NetworkMinScenes
	d.gen++
	d.mu.Unlock()

	logger.Infof("[iptv] API Hub: %d %s channels", len(specs), ns.net.Label())
}

// refreshCatalogs fills in the schedules of channels that have none, or whose
// schedules are approaching expiry.
func (ns *iptvNetworkState) refreshCatalogs(ctx context.Context, s iptvSettings) {
	specs, _ := ns.dir.snapshot(s.NetworkMinScenes)
	if len(specs) == 0 {
		return
	}

	var (
		wg sync.WaitGroup
		// A lapsed session is the one failure that is not about the channel that
		// hit it, so the moment one is seen the rest of the run is abandoned:
		// every remaining channel would fail identically, and a hundred proofs
		// of that is a hundred wasted requests.
		lapsed atomic.Bool
		sem    = make(chan struct{}, iptvNetChannelConcurrency)
		n      int
	)
	for _, spec := range specs {
		entry, ok := ns.dir.catalog(spec.Key, s.NetworkPrograms)
		if ok && entry.current(iptvNetCatalogTTL-iptvNetRefreshLead) {
			continue
		}
		n++

		wg.Add(1)
		go func(spec iptvNetChannelSpec) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			if ctx.Err() != nil || lapsed.Load() {
				return
			}
			if entry := ns.fetchCatalog(ctx, spec, s.NetworkPrograms); ns.net.IsNoSession(entry.err) {
				lapsed.Store(true)
			}
		}(spec)
	}
	wg.Wait()

	if lapsed.Load() {
		logger.Infof("[iptv] API Hub: %s session lapsed mid-refresh; the rest of the lineup will be retried shortly", ns.net.Label())
	}
	if n > 0 {
		logger.Debugf("[iptv] API Hub: refreshed %d %s channel schedules", n, ns.net.Label())
	}
}

// fetchCatalog reads one channel's programmes and caches the result.
//
// What gets cached, and for how long, is the whole point of this function. Four
// outcomes, four lifetimes:
//
//   - success — kept for the catalog TTL, a day
//   - nothing schedulable — also kept for the day, and the channel leaves the
//     lineup; the collection is genuinely unairable, not broken
//   - a lapsed session — not cached at all, because it is not a fact about this
//     channel; the next request rebuilds it against a renewed session
//   - any other failure — cached only until a short, backing-off retry deadline
//
// The session case is called out because getting it wrong was a real outage: a
// warm that happened to run between token renewals wrote "no live Aylo session"
// into 53 of 122 channels, each with a fresh timestamp, and the whole lineup
// stayed dark for a day after the session came back a minute later.
func (ns *iptvNetworkState) fetchCatalog(ctx context.Context, spec iptvNetChannelSpec, want int) iptvNetCatalogEntry {
	entry := iptvNetCatalogEntry{built: time.Now(), want: want}
	entry.programs, entry.err = ns.net.Programs(ctx, spec, want, uint64(iptvNetChannelSeed(spec.Key)))

	if ns.net.IsNoSession(entry.err) {
		return entry
	}

	switch {
	case entry.err != nil:
		prev, _ := ns.dir.catalog(spec.Key, want)
		entry.attempts = prev.attempts + 1
		entry.retryAt = time.Now().Add(iptvNetRetryDelay(entry.attempts))
		logger.Debugf("[iptv] API Hub: %s schedule failed (attempt %d, retrying in %s): %v",
			spec.Name, entry.attempts, iptvNetRetryDelay(entry.attempts), entry.err)
	case entry.dead():
		// Worth an Info line rather than a silent disappearance: a channel that
		// was in yesterday's lineup and is not in today's should be explainable.
		logger.Infof("[iptv] API Hub: %s (%s) has no schedulable scenes — the catalog reports no usable durations for it, so it is left out of the lineup",
			spec.Name, spec.BrandLabel)
	}

	ns.dir.putCatalog(spec.Key, entry)
	return entry
}

// spec looks up one channel's spec by key.
func (ns *iptvNetworkState) spec(key string, s iptvSettings) (iptvNetChannelSpec, bool) {
	specs, _ := ns.dir.snapshot(s.NetworkMinScenes)
	for _, spec := range specs {
		if spec.Key == key {
			return spec, true
		}
	}
	return iptvNetChannelSpec{}, false
}

// channels appends this provider's channels to the lineup. It returns nothing at
// all — with no error — when API Hub holds no live session, which is the
// ordinary state for anyone who has not connected the network.
//
// studioByName lets a network channel borrow the logo of the matching library
// studio when one exists. Child studios rarely match, so most fall back to the
// brand's logo and then to the same placeholder any logo-less studio gets.
func (ns *iptvNetworkState) channels(s iptvSettings, studioByName map[string]int) []iptvChannel {
	if !ns.net.SessionLive() {
		// Not connected is not a problem worth logging on every playlist fetch.
		logger.Debugf("[iptv] skipping %s channels: no live session", ns.net.Label())
		return nil
	}

	specs, fresh := ns.dir.snapshot(s.NetworkMinScenes)
	if !fresh {
		// Serve whatever is known now and refresh behind the request.
		ns.warm(s)
	}

	out := make([]iptvChannel, 0, len(specs))
	for _, spec := range specs {
		// Offering a channel that provably cannot fill a slot is worse than not
		// offering it: a TV shows it, tunes it, and gets an error.
		if ns.dir.isDead(spec.Key, s.NetworkPrograms) {
			continue
		}
		out = append(out, iptvChannel{
			Source:       ns.net.Source(),
			Key:          spec.Key,
			BrandSlug:    spec.BrandSlug,
			BrandLabel:   spec.BrandLabel,
			CollectionID: spec.CollectionID,
			TvgID:        spec.TvgID,
			Name:         spec.Name,
			SceneCount:   spec.SceneCount,
			LogoStudioID: iptvNetLogoStudio(spec, studioByName),
		})
	}
	return out
}

// iptvNetLogoStudio finds a library studio whose logo suits a network channel:
// the studio of the same name if one exists, otherwise the brand's.
func iptvNetLogoStudio(spec iptvNetChannelSpec, studioByName map[string]int) int {
	if id, ok := studioByName[strings.ToLower(spec.Name)]; ok {
		return id
	}
	return studioByName[strings.ToLower(spec.BrandLabel)]
}

// cycleEntries turns a channel's cached programmes into schedule input.
//
// allowFetch separates the two kinds of caller. Tuning in (ChannelStream) may
// fetch: a viewer can wait a moment, and a channel that refused to play because
// its schedule had not been built yet would simply be broken. The guide and the
// plugin panel may not — they walk every channel at once, and a hundred-odd
// synchronous catalog reads inside one request is exactly the stall this design
// exists to avoid. They get an empty schedule and a background warm instead, so
// the guide fills in over the following minute.
func (ns *iptvNetworkState) cycleEntries(ctx context.Context, key string, s iptvSettings, allowFetch bool) ([]iptv.SceneEntry, error) {
	entry, ok := ns.dir.catalog(key, s.NetworkPrograms)

	// A viewer tuning in is worth one retry of a cached failure: the usual cause
	// is a session gap that has since closed, and the alternative is handing back
	// a stale error for as long as it is cached. The guide does not get this —
	// it walks every channel, so it would retry every failure on every refresh.
	if ok && entry.err != nil && allowFetch {
		ok = false
	}

	if !ok {
		if !allowFetch {
			ns.warm(s)
			return nil, nil
		}

		spec, found := ns.spec(key, s)
		if !found {
			return nil, fmt.Errorf("unknown %s channel %q", ns.net.Label(), key)
		}
		entry = ns.fetchCatalog(ctx, spec, s.NetworkPrograms)
	}
	if entry.err != nil {
		return nil, entry.err
	}
	return entry.programs, nil
}

// ─── the set of providers ─────────────────────────────────────────────────────

// iptvNetworks holds every configured provider, in lineup order. Order matters:
// it decides which block of channel numbers each provider occupies, so adding a
// provider must append rather than insert or a TV's stored playlist renumbers.
type iptvNetworks []*iptvNetworkState

func newIPTVNetworks() iptvNetworks {
	return iptvNetworks{
		newIPTVNetworkState(ayloNetwork{}),
		newIPTVNetworkState(adultTimeNetwork{}),
		newIPTVNetworkState(evilAngelNetwork{}),
		newIPTVNetworkState(teamSkeetNetwork{}),
	}
}

// bySource finds the provider that owns a channel. A nil result means the
// channel is a library channel (or a stale key from a provider that has since
// been removed), which every caller treats the same way.
func (ns iptvNetworks) bySource(source string) *iptvNetworkState {
	for _, s := range ns {
		if s.net.Source() == source {
			return s
		}
	}
	return nil
}

// generation combines every provider's cache generation, so the lineup cache has
// one number to watch rather than one per provider.
func (ns iptvNetworks) generation() uint64 {
	var sum uint64
	for _, s := range ns {
		sum += s.dir.generation()
	}
	return sum
}

// anySessionLive reports whether any provider is connected. The lineup cache
// uses it to notice a reconnect: a lineup built with no sessions is missing
// every network channel, and nothing about connecting an account would otherwise
// invalidate it.
func (ns iptvNetworks) anySessionLive() bool {
	for _, s := range ns {
		if s.net.SessionLive() {
			return true
		}
	}
	return false
}

// channels collects every provider's channels, in provider order.
func (ns iptvNetworks) channels(s iptvSettings, studioByName map[string]int) []iptvChannel {
	var out []iptvChannel
	for _, st := range ns {
		out = append(out, st.channels(s, studioByName)...)
	}
	return out
}

// errNoIPTVNetwork is returned when a channel names a provider that is not
// registered — a stale playlist entry, in practice.
var errNoIPTVNetwork = errors.New("channel belongs to no configured network")
