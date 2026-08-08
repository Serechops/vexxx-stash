package api

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/internal/static"
	"github.com/stashapp/stash/pkg/ffmpeg"
	"github.com/stashapp/stash/pkg/iptv"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
)

// iptvRoutes exposes the library as a set of 24/7 linear TV channels that
// ordinary IPTV clients (TiviMate, VLC, Kodi's PVR IPTV Simple, OTT Navigator)
// can consume over the LAN.
//
// The channel stream is *not* a redirect to a scene's own VOD playlist. It is a
// rolling live playlist stitched by this file: a sliding window of segments with
// a monotonically increasing media sequence and no EXT-X-ENDLIST, so a channel
// crosses from one scene into the next without the player ever seeing the stream
// terminate. Scene changes are announced with EXT-X-DISCONTINUITY, which is
// precisely what that tag is for.
//
// Segments themselves are not re-encoded here. Each one is mapped back onto the
// owning scene's own segment index and handed to Stash's existing StreamManager,
// which already owns ffmpeg process lifecycle, look-ahead buffering and idle
// reaping. That keeps this file to playlist arithmetic and access control.
type iptvRoutes struct {
	routes
	repository *models.Repository
	config     *config.Config

	cycles   *iptvCycleCache
	channels *iptvChannelCache
	logos    *iptvLogoCache
	networks iptvNetworks
}

const (
	// iptvPluginID is the plugin whose settings configure these routes. Reading
	// them through the plugin config (rather than new top-level keys) means the
	// UI plugin owns its own settings surface, matching how faptap/pmvhaven do it.
	iptvPluginID = "vexxx-iptv"

	// iptvMinUsefulBytes is the output below which a programme is treated as
	// having failed rather than simply being short. One MPEG-TS packet is 188
	// bytes, so anything under a few hundred KB means ffmpeg died early.
	iptvMinUsefulBytes = 256 * 1024

	// After this many consecutive failed programmes the channel closes the
	// connection instead of grinding through a broken stretch of the library.
	iptvMaxConsecutiveFailures = 3
	iptvFailureBackoff         = 2 * time.Second

	// iptvSlotGraceSeconds pads ffmpeg's -t so it never becomes the thing that
	// ends a programme — the wall-clock deadline in pipeProgram does that. The
	// padding has to exceed the largest plausible keyframe interval, since an
	// -ss with -c copy lands up to one GOP early and -t counts from there.
	iptvSlotGraceSeconds = 60.0

	// Slots shorter than this are waited out rather than aired: spawning ffmpeg
	// only to kill it a moment later costs more than the frames are worth.
	iptvMinSlotSeconds = 2.0

	iptvCycleTTL   = 30 * time.Minute
	iptvChannelTTL = 30 * time.Minute

	// Rasterising an SVG costs real work, and every client refetches all of them
	// on each guide refresh, so converted logos are held far longer than the
	// schedule caches — a studio logo changing is a once-in-a-library event.
	iptvLogoTTL = 24 * time.Hour

	iptvDefaultMinScenes   = 3
	iptvDefaultMaxPrograms = 300
	iptvDefaultGroupTitle  = "Vexxx TV"
	iptvDefaultEPGHours    = 12

	// iptvMaxEPGEntries caps per-channel programme entries so a channel of very
	// short scenes cannot blow up the guide.
	iptvMaxEPGEntries = 400

	iptvXMLTVTimeFormat = "20060102150405 -0700"

	// Sent by ffmpeg when a programme's source is a URL. The CDNs fronting the
	// API Hub catalogs reject the default Lavf/… agent, so this is required for
	// a network channel to play at all.
	iptvRemoteUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
		"AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

func newIPTVRoutes(repo *models.Repository, cfg *config.Config) iptvRoutes {
	return iptvRoutes{
		routes:     routes{txnManager: repo.TxnManager},
		repository: repo,
		config:     cfg,
		cycles:     &iptvCycleCache{entries: make(map[string]*iptvCycleEntry)},
		channels:   &iptvChannelCache{},
		logos:      &iptvLogoCache{entries: make(map[string]iptvLogoEntry)},
		networks:   newIPTVNetworks(),
	}
}

func (rs iptvRoutes) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/playlist.m3u", rs.Playlist)
	r.Get("/playlist.m3u8", rs.Playlist)
	r.Get("/xmltv.xml", rs.XMLTV)
	r.Get("/channels.json", rs.ChannelsJSON)

	// A channel is a single continuous MPEG-TS body. The .ts alias exists
	// because some clients decide how to demux from the URL suffix rather than
	// from the Content-Type header.
	r.Get("/ch/{channelId}", rs.ChannelStream)
	r.Get("/ch/{channelId}.ts", rs.ChannelStream)

	// Logos go out through here rather than straight from /studio/{id}/image so
	// that SVGs get rasterised first — see ChannelLogo.
	r.Get("/logo/{channelId}.png", rs.ChannelLogo)
	r.Get("/logo/{channelId}", rs.ChannelLogo)

	return r
}

// ─── settings ─────────────────────────────────────────────────────────────────

type iptvSettings struct {
	MinScenes   int
	MaxPrograms int
	Resolution  string
	GroupTitle  string
	EPGHours    int

	// NetworkMinScenes is the smallest catalog worth its own network channel,
	// and NetworkPrograms how many programmes such a channel's rotation holds.
	// They are separate from the library equivalents above because the costs are
	// not comparable: a library programme is a row already in the database,
	// while a network one is ~53KB fetched over the internet.
	NetworkMinScenes int
	NetworkPrograms  int
}

func (rs iptvRoutes) settings() iptvSettings {
	s := iptvSettings{
		MinScenes:        iptvDefaultMinScenes,
		MaxPrograms:      iptvDefaultMaxPrograms,
		Resolution:       string(models.StreamingResolutionEnumStandardHd),
		GroupTitle:       iptvDefaultGroupTitle,
		EPGHours:         iptvDefaultEPGHours,
		NetworkMinScenes: iptvNetMinReleases,
		NetworkPrograms:  iptvNetDefaultPrograms,
	}

	pc := rs.config.GetPluginConfiguration(iptvPluginID)
	if pc == nil {
		return s
	}

	if v, ok := iptvSettingInt(pc["minScenes"]); ok && v > 0 {
		s.MinScenes = v
	}
	if v, ok := iptvSettingInt(pc["maxPrograms"]); ok && v > 0 {
		s.MaxPrograms = v
	}
	if v, ok := iptvSettingInt(pc["epgHours"]); ok && v > 0 {
		s.EPGHours = v
	}
	if v, ok := iptvSettingInt(pc["networkMinScenes"]); ok && v > 0 {
		s.NetworkMinScenes = v
	}
	if v, ok := iptvSettingInt(pc["networkPrograms"]); ok && v > 0 {
		s.NetworkPrograms = v
	}
	if v, ok := pc["groupTitle"].(string); ok && v != "" {
		s.GroupTitle = v
	}
	if v, ok := pc["resolution"].(string); ok && v != "" {
		// An unrecognised value would silently fall through to "no scaling",
		// which for a 4K library means a channel nobody can play.
		if models.StreamingResolutionEnum(v).IsValid() {
			s.Resolution = v
		} else {
			logger.Warnf("[iptv] ignoring invalid resolution setting %q", v)
		}
	}

	return s
}

// iptvSettingInt coerces a plugin setting to an int. Values arrive from JSON so
// a NUMBER setting is a float64, but a hand-edited config may hold a string.
func iptvSettingInt(v interface{}) (int, bool) {
	switch t := v.(type) {
	case float64:
		return int(t), true
	case int:
		return t, true
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(t))
		return n, err == nil
	}
	return 0, false
}

// ─── channel list ─────────────────────────────────────────────────────────────

// iptvChannel is one entry in the lineup. A channel is either a library studio
// or an API Hub network, distinguished by Source; Key is what appears in URLs
// and is the only identifier the rest of the pipeline needs.
type iptvChannel struct {
	Number int `json:"number"`
	// Source is iptvSourceLibrary or iptvSourceAylo.
	Source string `json:"source"`
	// Key identifies the channel in a URL. Library channels keep their bare
	// studio id so playlists configured before networks existed keep working.
	Key string `json:"key"`
	// StudioID is set for library channels only.
	StudioID int `json:"studio_id"`
	// BrandSlug, BrandLabel and CollectionID are set for API Hub channels only.
	// CollectionID names the child studio this channel airs; zero means the
	// brand-wide channel.
	BrandSlug    string `json:"brand_slug,omitempty"`
	BrandLabel   string `json:"brand_label,omitempty"`
	CollectionID int    `json:"collection_id,omitempty"`
	// LogoStudioID is the studio whose image represents this channel, which for
	// a network is the matching library studio when one exists. Zero means fall
	// back to the placeholder.
	LogoStudioID int    `json:"-"`
	TvgID        string `json:"tvg_id"`
	Name         string `json:"name"`
	SceneCount   int    `json:"scene_count"`
}

// isNetwork reports a channel whose content is a provider's catalog rather than
// a file on disk. Asked in several places — programme caps, guide icons, how a
// programme is resolved — and always for the same underlying reason, so it is
// one predicate rather than a comparison against each provider in turn.
func (ch iptvChannel) isNetwork() bool {
	return ch.Source != "" && ch.Source != iptvSourceLibrary
}

type iptvChannelCache struct {
	mu    sync.Mutex
	list  []iptvChannel
	byKey map[string]iptvChannel
	built time.Time
	minSc int
	// networks records whether the cached lineup was built while API Hub had a
	// live session. A lineup built without one is missing every network channel,
	// and there is nothing about connecting an account that invalidates this
	// cache — so without this flag a reconnect appears to do nothing for up to a
	// full TTL, which reads as a broken feature rather than a stale cache.
	networks bool
	// netGen is the combined API Hub directory generation this lineup was built from.
	// Network discovery runs in the background, so the lineup a request is
	// served may be missing channels that have since been found; comparing
	// generations is how a background refresh becomes visible without the
	// warmer having to reach into this cache.
	netGen uint64
	loaded bool
}

// channelList returns the lineup, rebuilding it at most once per TTL. Channel
// numbers are assigned by studio name so that adding a studio shifts numbers
// predictably instead of reshuffling the whole lineup.
func (rs iptvRoutes) channelList(r *http.Request, s iptvSettings) ([]iptvChannel, map[string]iptvChannel, error) {
	// Before the cache check, not after, and this is the drive loop for every
	// provider's background work.
	//
	// Putting it below would mean it only ran when this lineup was rebuilt —
	// which is once per half hour at best, and in practice not at all: a lineup
	// is only rebuilt when a provider's cache generation moves, and the
	// generation only moves when a warm does something. A settled lineup would
	// therefore never warm again, and a provider with work left would sit at
	// whatever it had reached. That is exactly how a half-built TeamSkeet lineup
	// came to stall at 34 of 138 channels with its whole ration unspent.
	//
	// Every warm is single-flight and skips whatever is current, so calling this
	// on every playlist, guide and panel request costs a goroutine per provider.
	rs.networks.warmAll(s)

	c := rs.channels
	c.mu.Lock()
	defer c.mu.Unlock()

	// A lineup that predates a reconnect, or one built before the background
	// warmer found more network channels, is rebuilt immediately rather than
	// waiting out its TTL. Both checks are local — a config read and an integer
	// compare — so they cost nothing on the hot path.
	fresh := time.Since(c.built) < iptvChannelTTL
	if c.loaded && fresh {
		if !c.networks && rs.networks.anySessionLive() {
			fresh = false
		}
		if c.netGen != rs.networks.generation() {
			fresh = false
		}
	}
	if c.loaded && c.minSc == s.MinScenes && fresh {
		return c.list, c.byKey, nil
	}

	// Read before building, not after: a background warm that finishes mid-build
	// must leave this lineup looking stale, or its new channels wait for the TTL.
	netGen := rs.networks.generation()

	var studios []*models.Studio
	if err := rs.withReadTxn(r, func(ctx context.Context) error {
		sortBy := "name"
		perPage := -1
		findFilter := &models.FindFilterType{
			Sort:    &sortBy,
			PerPage: &perPage,
		}

		var err error
		studios, _, err = rs.repository.Studio.Query(ctx, nil, findFilter)
		return err
	}); err != nil {
		return nil, nil, err
	}

	list := make([]iptvChannel, 0, len(studios))
	studioByName := make(map[string]int, len(studios))
	if err := rs.withReadTxn(r, func(ctx context.Context) error {
		for _, st := range studios {
			studioByName[strings.ToLower(st.Name)] = st.ID

			count, err := rs.studioSceneCount(ctx, st.ID)
			if err != nil {
				return err
			}
			if count < s.MinScenes {
				continue
			}
			list = append(list, iptvChannel{
				Source:       iptvSourceLibrary,
				Key:          strconv.Itoa(st.ID),
				StudioID:     st.ID,
				LogoStudioID: st.ID,
				TvgID:        fmt.Sprintf("vexxx-studio-%d", st.ID),
				Name:         st.Name,
				SceneCount:   count,
			})
		}
		return nil
	}); err != nil {
		return nil, nil, err
	}

	sort.SliceStable(list, func(i, j int) bool {
		return strings.ToLower(list[i].Name) < strings.ToLower(list[j].Name)
	})

	// Network channels are appended after the library rather than sorted in
	// among it, so they occupy a stable block at the end of the lineup: adding
	// or losing one cannot renumber every studio channel on the TV.
	list = append(list, rs.networks.channels(s, studioByName)...)

	byKey := make(map[string]iptvChannel, len(list))
	for i := range list {
		list[i].Number = i + 1
		byKey[list[i].Key] = list[i]
	}

	c.list, c.byKey, c.built, c.minSc, c.loaded = list, byKey, time.Now(), s.MinScenes, true
	c.networks = ayloSessionLive()
	c.netGen = netGen
	return list, byKey, nil
}

// channelByKey resolves a URL channel id to its lineup entry. A nil channel
// with a nil error means the id is simply not in the lineup.
func (rs iptvRoutes) channelByKey(r *http.Request, key string, s iptvSettings) (*iptvChannel, error) {
	_, byKey, err := rs.channelList(r, s)
	if err != nil {
		return nil, err
	}
	ch, ok := byKey[key]
	if !ok {
		return nil, nil
	}
	return &ch, nil
}

// iptvGroupTitle keeps network channels in their own category. Clients render
// groups as top-level folders, so mixing a handful of streamed network channels
// in among hundreds of library ones would bury them — and the two behave
// differently enough (one plays offline, one needs a live session) that telling
// them apart at a glance is worth a folder.
func iptvGroupTitle(ch iptvChannel, s iptvSettings) string {
	if !ch.isNetwork() {
		return s.GroupTitle
	}
	// One group per brand, not a single "Networks" folder. A brand contributes
	// dozens of child-studio channels, and clients render a group as a top-level
	// folder — so lumping them together buries the library's own channels under
	// a hundred-entry list, while per-brand folders stay navigable with a remote.
	if ch.BrandLabel != "" {
		return s.GroupTitle + " " + ch.BrandLabel
	}
	return s.GroupTitle + " Networks"
}

func (rs iptvRoutes) studioSceneCount(ctx context.Context, studioID int) (int, error) {
	result, err := rs.repository.Scene.Query(ctx, models.SceneQueryOptions{
		QueryOptions: models.QueryOptions{
			FindFilter: models.BatchFindFilter(0),
			Count:      true,
		},
		SceneFilter: iptvStudioFilter(studioID),
	})
	if err != nil {
		return 0, err
	}
	return result.Count, nil
}

func iptvStudioFilter(studioID int) *models.SceneFilterType {
	depth := -1 // include descendant studios, so a network channel covers its sub-sites
	return &models.SceneFilterType{
		Studios: &models.HierarchicalMultiCriterionInput{
			Value:    []string{strconv.Itoa(studioID)},
			Modifier: models.CriterionModifierIncludes,
			Depth:    &depth,
		},
	}
}

// ─── cycle cache ──────────────────────────────────────────────────────────────

type iptvCycleEntry struct {
	cycle *iptv.Cycle
	built time.Time
	max   int
}

type iptvCycleCache struct {
	mu      sync.Mutex
	entries map[string]*iptvCycleEntry
}

// cycle returns a channel's schedule, rebuilding it at most once per TTL.
//
// The TTL matters more than it looks: a rebuild can change what is on air, so
// keeping it long makes the schedule feel stable, while still letting newly
// scanned scenes join the rotation without a restart.
// allowFetch is passed through to network channels, where building a schedule
// may mean going to the internet. Only a caller serving one channel should set
// it — see ayloCycleEntries.
func (rs iptvRoutes) cycle(r *http.Request, ch iptvChannel, s iptvSettings, allowFetch bool) (*iptv.Cycle, error) {
	c := rs.cycles
	c.mu.Lock()
	defer c.mu.Unlock()

	// Network channels are sized by their own setting; the library's programme
	// cap is about query cost, theirs about bandwidth.
	max := s.MaxPrograms
	if ch.isNetwork() {
		max = s.NetworkPrograms
	}

	if e, ok := c.entries[ch.Key]; ok && e.max == max && time.Since(e.built) < iptvCycleTTL {
		return e.cycle, nil
	}

	var (
		scenes []iptv.SceneEntry
		// A schedule that is still filling in is built and served but never
		// cached: it will be a longer rotation in a few minutes, and pinning the
		// short one for a cycle TTL would waste the work of finishing it.
		volatile bool
	)

	if ns := rs.networks.bySource(ch.Source); ns != nil {
		entries, partial, err := ns.cycleEntries(r.Context(), ch.Key, s, allowFetch)
		if err != nil {
			return nil, err
		}
		volatile = partial
		if len(entries) == 0 {
			// The schedule has not been fetched yet. Returning an empty cycle is
			// right — the guide simply has nothing for this channel yet — but
			// caching it is not, or the channel would stay blank for a full cycle
			// TTL after the background warm has already filled it in.
			return &iptv.Cycle{}, nil
		}
		scenes = entries
	} else if err := rs.withReadTxn(r, func(ctx context.Context) error {
		studioID := ch.StudioID
		// Stash's `random_<seed>` sort is a deterministic function of the row id,
		// so a fixed per-channel seed gives a stable shuffle that also survives
		// the LIMIT — letting us cap the rotation without reading the whole
		// studio into memory just to shuffle it here.
		sortBy := fmt.Sprintf("random_%d", iptv.ShuffleSeed(studioID))
		page := 1
		perPage := s.MaxPrograms

		result, err := rs.repository.Scene.Query(ctx, models.SceneQueryOptions{
			QueryOptions: models.QueryOptions{
				FindFilter: &models.FindFilterType{
					Sort:    &sortBy,
					Page:    &page,
					PerPage: &perPage,
				},
			},
			SceneFilter: iptvStudioFilter(studioID),
		})
		if err != nil {
			return err
		}

		found, err := result.Resolve(ctx)
		if err != nil {
			return err
		}

		scenes = make([]iptv.SceneEntry, 0, len(found))
		for _, scene := range found {
			if err := scene.LoadFiles(ctx, rs.repository.Scene); err != nil {
				return err
			}

			f := scene.Files.Primary()
			if f == nil || f.Duration <= 0 {
				continue
			}

			scenes = append(scenes, iptv.SceneEntry{
				SceneID:  scene.ID,
				Title:    scene.GetTitle(),
				Details:  scene.Details,
				Date:     iptvSceneDate(scene),
				Duration: f.Duration,
			})
		}
		return nil
	}); err != nil {
		return nil, err
	}

	channelID := ch.StudioID
	if ch.isNetwork() {
		channelID = iptvNetChannelSeed(ch.Key)
	}
	cycle := iptv.BuildCycle(channelID, scenes)
	if !volatile {
		c.entries[ch.Key] = &iptvCycleEntry{cycle: cycle, built: time.Now(), max: max}
	}

	logger.Debugf("[iptv] built schedule for channel %s (%s): %d programmes, %d segments (%s)",
		ch.Key, ch.Name, len(cycle.Programs), cycle.TotalSegs,
		(time.Duration(cycle.TotalSegs) * iptv.SegmentSeconds * time.Second).Round(time.Minute))

	return cycle, nil
}

func iptvSceneDate(scene *models.Scene) string {
	if scene.Date == nil {
		return ""
	}
	return scene.Date.String()
}

// ─── M3U playlist ─────────────────────────────────────────────────────────────

func (rs iptvRoutes) Playlist(w http.ResponseWriter, r *http.Request) {
	s := rs.settings()

	channels, _, err := rs.channelList(r, s)
	if err != nil {
		logger.Errorf("[iptv] building channel list: %v", err)
		http.Error(w, "error building channel list", http.StatusInternalServerError)
		return
	}

	base := iptvBaseURL(r)
	apiKey := r.URL.Query().Get("apikey")

	var b strings.Builder
	fmt.Fprintf(&b, "#EXTM3U x-tvg-url=%q\n", iptvURL(base, "/iptv/xmltv.xml", apiKey))

	for _, ch := range channels {
		streamURL := iptvURL(base, fmt.Sprintf("/iptv/ch/%s.ts", ch.Key), apiKey)
		logoURL := iptvURL(base, fmt.Sprintf("/iptv/logo/%s.png", ch.Key), apiKey)

		// A raw MPEG-TS body needs no adaptive-manifest hints — every one of
		// these clients demuxes TS natively. All it wants is a little buffer,
		// since the stream is paced in real time and has no segments to prefetch.
		b.WriteString("#EXTVLCOPT:network-caching=1500\n")

		fmt.Fprintf(&b,
			"#EXTINF:-1 tvg-id=%q tvg-chno=%q tvg-name=%q tvg-logo=%q group-title=%q,%s\n",
			ch.TvgID,
			strconv.Itoa(ch.Number),
			iptvEscapeAttr(ch.Name),
			logoURL,
			iptvEscapeAttr(iptvGroupTitle(ch, s)),
			iptvEscapeAttr(ch.Name),
		)
		b.WriteString(streamURL)
		b.WriteString("\n")
	}

	w.Header().Set("Content-Type", "audio/x-mpegurl; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="vexxx-tv.m3u"`)
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write([]byte(b.String()))
}

// ─── channel stream ───────────────────────────────────────────────────────────

// ChannelStream serves a channel as one never-ending MPEG-TS response.
//
// The handler loops: it asks the schedule what is on air right now, runs ffmpeg
// over that scene from the matching offset, copies its output into the response
// body, and when that programme's slot ends it immediately starts the next one
// into the *same* body. The client sees a single connection that never
// terminates, which is what makes a channel feel like a channel.
//
// Almost always this is a remux, not a transcode: local libraries are H.264 or
// HEVC with AAC/AC-3, all of which MPEG-TS carries natively, so ffmpeg is only
// repackaging existing frames at a few percent of a core (see iptv.ChooseMode).
//
// Two properties fall out for free rather than needing enforcement. The stream
// is unseekable because it is a pipe — there is no timeline to scrub and no
// earlier bytes to request. And it is paced by `-re`, so the server hands over
// frames at playback speed instead of letting a client drain a whole scene in
// seconds and run ahead of the schedule.
func (rs iptvRoutes) ChannelStream(w http.ResponseWriter, r *http.Request) {
	s := rs.settings()

	ch, err := rs.channelByKey(r, chi.URLParam(r, "channelId"), s)
	if err != nil {
		logger.Errorf("[iptv] resolving channel: %v", err)
		http.Error(w, "error resolving channel", http.StatusInternalServerError)
		return
	}
	if ch == nil {
		http.Error(w, "unknown channel", http.StatusNotFound)
		return
	}

	// The one caller that may go to the network: a viewer tuning in can wait a
	// moment, and refusing to play because a schedule had not been warmed yet
	// would just be a broken channel.
	cycle, err := rs.cycle(r, *ch, s, true)
	if err != nil {
		// A channel that is still being prepared has not failed, and saying so
		// with a 500 is actively misleading — both to whoever reads the log and
		// to the player, which reasonably treats a server error as a reason to
		// give up on the channel. 503 with a Retry-After is the honest answer:
		// come back shortly, this is going to work.
		if rs.networks.isWarming(ch.Source, err) {
			logger.Debugf("[iptv] channel %s is not ready yet: %v", ch.Key, err)
			w.Header().Set("Retry-After", strconv.Itoa(int(iptvNetPrepRetry.Seconds())))
			http.Error(w, "channel is still being prepared", http.StatusServiceUnavailable)
			return
		}

		logger.Errorf("[iptv] building schedule for channel %s: %v", ch.Key, err)
		http.Error(w, "error building schedule", http.StatusInternalServerError)
		return
	}
	if cycle.Empty() {
		http.Error(w, "channel has no playable content", http.StatusNotFound)
		return
	}

	ff := manager.GetInstance().FFMpeg
	if ff == nil {
		http.Error(w, "ffmpeg is not configured", http.StatusServiceUnavailable)
		return
	}

	w.Header().Set("Content-Type", "video/mp2t")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.WriteHeader(http.StatusOK)

	out := &iptvFlushWriter{w: w}
	if f, ok := w.(http.Flusher); ok {
		out.flusher = f
		f.Flush()
	}

	ctx := r.Context()
	failures := 0

	for ctx.Err() == nil {
		program, offset, ok := iptvOnAir(cycle, time.Now())
		if !ok {
			return
		}

		remaining := float64(program.Segments*iptv.SegmentSeconds) - offset

		// Barely any airtime left in this slot: waiting it out lands cleanly on
		// the next programme instead of spawning an ffmpeg only to kill it.
		if remaining < iptvMinSlotSeconds {
			wait := time.Duration(remaining * float64(time.Second))
			if wait < 100*time.Millisecond {
				wait = 100 * time.Millisecond
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(wait):
			}
			continue
		}

		written, err := rs.pipeProgram(ctx, ff, out, r, *ch, program, offset, remaining, s)
		if ctx.Err() != nil {
			return // client hung up; not an error
		}

		if written >= iptvMinUsefulBytes {
			failures = 0
			continue
		}

		// A programme that produced almost nothing means a missing or unreadable
		// file — or, on a network channel, a lapsed session or a release that
		// stopped resolving. Retrying immediately would spin on it, so back off —
		// and give up after a few so a broken run cannot pin a core forever. The
		// client re-tunes, and by then the schedule has moved on.
		failures++
		logger.Warnf("[iptv] channel %s: programme %d produced %d bytes (attempt %d): %v",
			ch.Key, program.SceneID, written, failures, err)

		if failures >= iptvMaxConsecutiveFailures {
			logger.Errorf("[iptv] channel %s: giving up after %d failed programmes", ch.Key, failures)
			return
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(iptvFailureBackoff):
		}
	}
}

// iptvOnAir resolves what a channel is playing at an instant, together with how
// far into that programme the stream should start.
//
// The offset is derived from the wall clock every time rather than being carried
// forward across programmes, so a stream that drifts — a slow read, a scene
// truncated to whole segments — is pulled back into line at each boundary
// instead of accumulating error over an evening.
func iptvOnAir(cycle *iptv.Cycle, now time.Time) (iptv.Program, float64, bool) {
	abs := iptv.AbsSegment(now)

	slot, ok := cycle.Locate(abs)
	if !ok {
		return iptv.Program{}, 0, false
	}

	programStart := iptv.SegmentTime(abs - int64(slot.LocalSeg))
	offset := now.Sub(programStart).Seconds()
	if offset < 0 {
		offset = 0
	}

	return slot.Program, offset, true
}

// programSource is everything the streamer needs about a scene's file. Codecs
// come from what ffprobe recorded at scan time, so choosing copy-vs-transcode
// costs nothing at stream time.
type programSource struct {
	Path       string
	VideoCodec string
	AudioCodec string
	Height     int
	// Remote marks Path as a URL rather than a file, which changes the input
	// flags ffmpeg needs — see iptvStreamArgs.
	Remote bool
}

// channelProgramSource resolves a programme to something ffmpeg can open,
// dispatching on where the channel's content lives.
func (rs iptvRoutes) channelProgramSource(r *http.Request, ch iptvChannel, programID int) (programSource, error) {
	if ns := rs.networks.bySource(ch.Source); ns != nil {
		return ns.net.ProgramSource(r.Context(), programID)
	}
	return rs.programSource(r, programID)
}

func (rs iptvRoutes) programSource(r *http.Request, sceneID int) (programSource, error) {
	var src programSource

	err := rs.withReadTxn(r, func(ctx context.Context) error {
		scene, err := rs.repository.Scene.Find(ctx, sceneID)
		if err != nil {
			return err
		}
		if scene == nil {
			return fmt.Errorf("scene %d not found", sceneID)
		}

		if err := scene.LoadFiles(ctx, rs.repository.Scene); err != nil {
			return err
		}

		f := scene.Files.Primary()
		if f == nil {
			return fmt.Errorf("scene %d has no primary file", sceneID)
		}

		src = programSource{
			Path:       f.Path,
			VideoCodec: f.VideoCodec,
			AudioCodec: f.AudioCodec,
			Height:     f.Height,
		}
		return nil
	})

	return src, err
}

// pipeProgram runs one programme into the response body for the length of its
// remaining airtime, returning how many bytes reached the client.
func (rs iptvRoutes) pipeProgram(
	ctx context.Context,
	ff *ffmpeg.FFMpeg,
	out io.Writer,
	r *http.Request,
	ch iptvChannel,
	program iptv.Program,
	offset float64,
	remaining float64,
	s iptvSettings,
) (int64, error) {
	src, err := rs.channelProgramSource(r, ch, program.SceneID)
	if err != nil {
		return 0, err
	}

	mode := iptv.ChooseMode(src.VideoCodec, src.AudioCodec)
	if mode != iptv.ModeCopy {
		logger.Debugf("[iptv] programme %d needs %s (%s/%s)",
			program.SceneID, mode, src.VideoCodec, src.AudioCodec)
	}

	// The slot is bounded by the wall clock, not by ffmpeg's own -t.
	//
	// With -c copy an -ss into the middle of a scene snaps back to the previous
	// keyframe, and ffmpeg then measures -t from where it actually landed rather
	// than from the offset we asked for. On a file with a 10s GOP a 4s slot
	// emits 6.5s of video — verified, not theoretical. Since -re paces output in
	// real time, killing the process when its airtime is up is both exact and
	// independent of how far the seek slipped. -t stays as a generous backstop
	// so a missed deadline can't leave ffmpeg running forever.
	slotCtx, cancel := context.WithTimeout(ctx, time.Duration(remaining*float64(time.Second)))
	defer cancel()

	cmd := ff.Command(slotCtx, iptvStreamArgs(src, offset, remaining+iptvSlotGraceSeconds, mode, s))

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return 0, err
	}
	var stderr strings.Builder
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return 0, err
	}

	written, copyErr := io.Copy(out, stdout)
	waitErr := cmd.Wait()

	// Our own slot deadline firing is the ordinary way a programme ends, so the
	// kill it causes must not be reported as a failure.
	if errors.Is(slotCtx.Err(), context.DeadlineExceeded) && ctx.Err() == nil {
		return written, nil
	}

	if written < iptvMinUsefulBytes {
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			return written, fmt.Errorf("ffmpeg: %s", msg)
		}
		if copyErr != nil {
			return written, copyErr
		}
		return written, waitErr
	}

	return written, nil
}

// iptvStreamArgs builds the ffmpeg invocation for one programme. Kept pure so
// the copy-vs-transcode decision and the live pacing flags are testable without
// running anything.
func iptvStreamArgs(src programSource, offset, duration float64, mode iptv.StreamMode, s iptvSettings) []string {
	args := []string{
		"-hide_banner",
		"-nostdin",
		"-loglevel", "error",
		// Deliver at playback speed. Without this ffmpeg races through the file
		// as fast as the socket drains, so the client would burn through a scene
		// in seconds and the channel would sprint ahead of its own schedule.
		"-re",
	}

	if src.Remote {
		// Input options for a URL, all of which must precede -i.
		//
		// A remote source can stall or drop in ways a local file cannot, and a
		// dropped read mid-programme would otherwise end the slot early and count
		// as a channel failure — so let ffmpeg re-establish the connection and
		// carry on. The browser user-agent is not cosmetic: CDNs in front of these
		// catalogs reject the default Lavf/… agent outright.
		args = append(args,
			"-reconnect", "1",
			"-reconnect_streamed", "1",
			"-reconnect_on_network_error", "1",
			"-reconnect_delay_max", "5",
			"-multiple_requests", "1",
			"-user_agent", iptvRemoteUserAgent,
		)
	}

	if offset > 0 {
		// Placed before -i so ffmpeg seeks by index instead of decoding and
		// discarding everything up to the offset — the difference between
		// tuning in instantly and grinding through half an hour of video. For a
		// remote input this becomes a range request (progressive) or a jump to
		// the right segment (HLS) rather than a file seek, so it stays cheap.
		args = append(args, "-ss", strconv.FormatFloat(offset, 'f', 3, 64))
	}

	args = append(args, "-i", src.Path, "-t", strconv.FormatFloat(duration, 'f', 3, 64))

	switch mode {
	case iptv.ModeCopy:
		args = append(args, "-c", "copy")
	case iptv.ModeTranscodeAudio:
		args = append(args, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2")
	default:
		args = append(args, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23")
		if h := iptvMaxHeight(s.Resolution); h > 0 && (src.Height == 0 || src.Height > h) {
			// The comma is escaped for ffmpeg's filter parser, not a shell —
			// args go straight to exec, so no quoting is involved.
			args = append(args, "-vf", fmt.Sprintf("scale=-2:min(ih\\,%d)", h))
		}
		args = append(args, "-c:a", "aac", "-b:a", "192k", "-ac", "2")
	}

	args = append(args,
		// Subtitle and data streams have no place in this muxer and will abort
		// the run if ffmpeg tries to carry them.
		"-sn", "-dn",
		"-map", "0:v:0",
		// Optional: plenty of scenes have no audio track at all.
		"-map", "0:a:0?",
		"-f", "mpegts",
		"-muxdelay", "0",
		"-muxpreload", "0",
		"pipe:1",
	)

	return args
}

func iptvMaxHeight(resolution string) int {
	e := models.StreamingResolutionEnum(resolution)
	if !e.IsValid() {
		return 0
	}
	return e.GetMaxResolution()
}

// iptvFlushWriter pushes each chunk to the client as it arrives. Without the
// flush, chunks sit in Go's response buffer and the picture stutters.
type iptvFlushWriter struct {
	w       io.Writer
	flusher http.Flusher
}

func (f *iptvFlushWriter) Write(p []byte) (int, error) {
	n, err := f.w.Write(p)
	if f.flusher != nil {
		f.flusher.Flush()
	}
	return n, err
}

// ─── channel logo ─────────────────────────────────────────────────────────────

type iptvLogoEntry struct {
	data        []byte
	contentType string
	built       time.Time
}

type iptvLogoCache struct {
	mu      sync.Mutex
	entries map[string]iptvLogoEntry
}

// ChannelLogo serves a channel's logo in a format a TV client can actually
// decode.
//
// This exists rather than pointing tvg-logo straight at /studio/{id}/image
// because that route serves whatever is stored, and in a real library over half
// the studio logos are SVG. No Android IPTV client can display one — TiviMate,
// Smarters and OTT Navigator all load images through Glide or Coil, neither of
// which has an SVG decoder — so those channels simply show a blank tile with
// nothing logged anywhere. iptv.LogoImage rasterises them first.
//
// Network channels have no studio of their own, so they borrow the image of the
// like-named library studio when one exists (LogoStudioID) and fall back to the
// same placeholder a logo-less studio gets.
func (rs iptvRoutes) ChannelLogo(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "channelId")

	if entry, ok := rs.cachedLogo(key); ok {
		iptvWriteLogo(w, entry)
		return
	}

	ch, err := rs.channelByKey(r, key, rs.settings())
	if err != nil {
		logger.Warnf("[iptv] resolving channel %s for logo: %v", key, err)
	}

	var stored []byte
	if ch != nil && ch.LogoStudioID > 0 {
		studioID := ch.LogoStudioID
		if err := rs.withReadTxn(r, func(ctx context.Context) error {
			var err error
			stored, err = rs.repository.Studio.GetImage(ctx, studioID)
			return err
		}); err != nil {
			logger.Warnf("[iptv] reading logo for studio %d: %v", studioID, err)
		}
	}

	data, contentType, err := iptv.LogoImage(stored, iptv.LogoMaxDim)
	if err != nil {
		// A logo that won't convert is not worth failing the request over: the
		// client would draw a broken tile either way, and the stock placeholder
		// at least looks deliberate. It is itself an SVG, so it goes through the
		// same conversion.
		if len(stored) > 0 {
			logger.Debugf("[iptv] channel %s logo unusable (%v), falling back to the default", key, err)
		}
		data, contentType, err = iptv.LogoImage(static.ReadAll(static.DefaultStudioImage), iptv.LogoMaxDim)
		if err != nil {
			http.Error(w, "no logo available", http.StatusNotFound)
			return
		}
	}

	entry := iptvLogoEntry{data: data, contentType: contentType, built: time.Now()}

	rs.logos.mu.Lock()
	rs.logos.entries[key] = entry
	rs.logos.mu.Unlock()

	iptvWriteLogo(w, entry)
}

func (rs iptvRoutes) cachedLogo(key string) (iptvLogoEntry, bool) {
	rs.logos.mu.Lock()
	defer rs.logos.mu.Unlock()

	entry, ok := rs.logos.entries[key]
	if !ok || time.Since(entry.built) >= iptvLogoTTL {
		return iptvLogoEntry{}, false
	}
	return entry, true
}

func iptvWriteLogo(w http.ResponseWriter, entry iptvLogoEntry) {
	w.Header().Set("Content-Type", entry.contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(entry.data)))
	// Clients refetch every logo each time they refresh the guide, so let them
	// keep it. A studio logo changing is rare enough to wait a day for.
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write(entry.data)
}

// ─── XMLTV guide ──────────────────────────────────────────────────────────────

func (rs iptvRoutes) XMLTV(w http.ResponseWriter, r *http.Request) {
	s := rs.settings()

	channels, _, err := rs.channelList(r, s)
	if err != nil {
		logger.Errorf("[iptv] building channel list: %v", err)
		http.Error(w, "error building channel list", http.StatusInternalServerError)
		return
	}

	base := iptvBaseURL(r)
	apiKey := r.URL.Query().Get("apikey")

	from := time.Now().Add(-1 * time.Hour) // include what is already in progress
	to := time.Now().Add(time.Duration(s.EPGHours) * time.Hour)

	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<tv generator-info-name="Vexxx TV">` + "\n")

	for _, ch := range channels {
		fmt.Fprintf(&b, "  <channel id=%q>\n", ch.TvgID)
		fmt.Fprintf(&b, "    <display-name>%s</display-name>\n", iptvEscapeXML(ch.Name))
		fmt.Fprintf(&b, "    <display-name>%d</display-name>\n", ch.Number)
		fmt.Fprintf(&b, "    <icon src=%q />\n",
			iptvURL(base, fmt.Sprintf("/iptv/logo/%s.png", ch.Key), apiKey))
		b.WriteString("  </channel>\n")
	}

	for _, ch := range channels {
		// Guide generation walks the whole lineup, so it never fetches: a
		// hundred-odd network catalogs read synchronously is minutes of stall.
		// Channels whose schedule is still warming are simply left out of this
		// guide and appear in the next one.
		cycle, err := rs.cycle(r, ch, s, false)
		if err != nil || cycle.Empty() {
			continue
		}

		for _, a := range cycle.Airings(from, to, iptvMaxEPGEntries) {
			fmt.Fprintf(&b, "  <programme start=%q stop=%q channel=%q>\n",
				a.Start.Format(iptvXMLTVTimeFormat),
				a.End.Format(iptvXMLTVTimeFormat),
				ch.TvgID)

			title := a.Program.Title
			if title == "" {
				title = ch.Name
			}
			fmt.Fprintf(&b, "    <title>%s</title>\n", iptvEscapeXML(title))

			if a.Program.Details != "" {
				fmt.Fprintf(&b, "    <desc>%s</desc>\n", iptvEscapeXML(a.Program.Details))
			}
			// Only library programmes have a local screenshot. A network
			// programme's id belongs to the provider's catalog, so pointing at
			// /scene/{id}/screenshot would either 404 or — worse — resolve to an
			// unrelated scene that happens to share the number.
			if !ch.isNetwork() {
				fmt.Fprintf(&b, "    <icon src=%q />\n",
					iptvURL(base, fmt.Sprintf("/scene/%d/screenshot", a.Program.SceneID), apiKey))
			}
			if a.Program.Date != "" {
				fmt.Fprintf(&b, "    <date>%s</date>\n",
					iptvEscapeXML(strings.ReplaceAll(a.Program.Date, "-", "")))
			}
			fmt.Fprintf(&b, "    <category>%s</category>\n", iptvEscapeXML(ch.Name))

			b.WriteString("  </programme>\n")
		}
	}

	b.WriteString("</tv>\n")

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write([]byte(b.String()))
}

// ─── channels.json (plugin UI) ────────────────────────────────────────────────

type iptvNowPlaying struct {
	iptvChannel
	LogoURL   string `json:"logo_url"`
	Programs  int    `json:"programs"`
	CycleSecs int    `json:"cycle_seconds"`
	SceneID   int    `json:"scene_id,omitempty"`
	Title     string `json:"title,omitempty"`
	StartedAt string `json:"started_at,omitempty"`
	EndsAt    string `json:"ends_at,omitempty"`
	Progress  int    `json:"progress_percent"`

	// Status and StatusDetail explain a channel that is not showing anything.
	// Without them the panel has one blank state for four quite different
	// situations — building, still preparing, broken, and genuinely empty — and
	// the user cannot tell whether to wait or to go and fix something.
	Status       string `json:"status,omitempty"`
	StatusDetail string `json:"status_detail,omitempty"`
}

func (rs iptvRoutes) ChannelsJSON(w http.ResponseWriter, r *http.Request) {
	s := rs.settings()

	channels, _, err := rs.channelList(r, s)
	if err != nil {
		http.Error(w, "error building channel list", http.StatusInternalServerError)
		return
	}

	base := iptvBaseURL(r)
	apiKey := r.URL.Query().Get("apikey")

	out := make([]iptvNowPlaying, 0, len(channels))
	now := time.Now()

	for _, ch := range channels {
		entry := iptvNowPlaying{
			iptvChannel: ch,
			// Same converted logo the TVs get, so the panel is a preview of the
			// real lineup rather than a second rendering path.
			LogoURL: iptvURL(base, fmt.Sprintf("/iptv/logo/%s.png", ch.Key), apiKey),
		}

		if ns := rs.networks.bySource(ch.Source); ns != nil {
			entry.Status, entry.StatusDetail = ns.channelStatus(ch.Key, s)
		}

		// Same reasoning as the guide: the panel lists every channel, so a
		// channel still warming shows without now-playing rather than blocking
		// the whole page on its catalog.
		cycle, err := rs.cycle(r, ch, s, false)
		if err == nil && !cycle.Empty() {
			entry.Programs = len(cycle.Programs)
			entry.CycleSecs = cycle.TotalSegs * iptv.SegmentSeconds

			if slot, ok := cycle.Locate(iptv.AbsSegment(now)); ok {
				started := iptv.SegmentTime(iptv.AbsSegment(now) - int64(slot.LocalSeg))
				entry.SceneID = slot.Program.SceneID
				entry.Title = slot.Program.Title
				entry.StartedAt = started.Format(time.RFC3339)
				entry.EndsAt = started.
					Add(time.Duration(slot.Program.Segments) * iptv.SegmentSeconds * time.Second).
					Format(time.RFC3339)
				if slot.Program.Segments > 0 {
					entry.Progress = slot.LocalSeg * 100 / slot.Program.Segments
				}
			}
		}

		out = append(out, entry)
	}

	writeJSON(w, map[string]interface{}{
		"playlist_url": iptvURL(base, "/iptv/playlist.m3u", apiKey),
		"epg_url":      iptvURL(base, "/iptv/xmltv.xml", apiKey),
		"lan_urls":     iptvLANPlaylistURLs(r, apiKey),
		"resolution":   s.Resolution,
		"networks":     rs.networks.statuses(s),
		"channels":     out,
	})
}

// iptvLANPlaylistURLs offers the playlist at each of this machine's LAN
// addresses. The browser reaches Stash at whatever host the user typed —
// often "localhost", which is useless to type into a TV — so the UI needs a
// concrete address to show instead.
func iptvLANPlaylistURLs(r *http.Request, apiKey string) []string {
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}

	// Reuse the port the browser reached us on: it is by definition a port this
	// server is listening on, which a guessed default would not be.
	port := ""
	if _, p, err := net.SplitHostPort(r.Host); err == nil {
		port = ":" + p
	}

	prefix := getProxyPrefix(r)

	var urls []string
	for _, host := range lanHosts() {
		urls = append(urls, iptvURL(scheme+"://"+host+port+prefix, "/iptv/playlist.m3u", apiKey))
	}
	return urls
}

// ─── helpers ──────────────────────────────────────────────────────────────────

func iptvBaseURL(r *http.Request) string {
	if base, ok := r.Context().Value(BaseURLCtxKey).(string); ok && base != "" {
		return strings.TrimSuffix(base, "/")
	}

	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" || r.URL.Scheme == "https" {
		scheme = "https"
	}
	return scheme + "://" + r.Host + getProxyPrefix(r)
}

// iptvURL appends the caller's api key so that every URL handed to a TV app is
// self-contained — IPTV clients cannot set headers or hold a session cookie.
func iptvURL(base, path, apiKey string) string {
	u := base + path
	if apiKey == "" {
		return u
	}
	sep := "?"
	if strings.Contains(path, "?") {
		sep = "&"
	}
	return u + sep + "apikey=" + apiKey
}

// iptvEscapeAttr makes a value safe inside a double-quoted M3U attribute. The
// format has no escape mechanism, so an embedded quote or newline would corrupt
// the rest of the entry.
func iptvEscapeAttr(s string) string {
	s = strings.ReplaceAll(s, `"`, "'")
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, ",", " ")
	return strings.TrimSpace(s)
}

func iptvEscapeXML(s string) string {
	var b strings.Builder
	if err := xml.EscapeText(&b, []byte(s)); err != nil {
		return ""
	}
	return b.String()
}
