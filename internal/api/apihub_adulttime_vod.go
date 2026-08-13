package api

import (
	"context"
	"sync"
	"time"
)

// Adult Time as on-demand VOD movies, for the Xtream Codes API
// (routes_iptv_xtream.go) — separate from, and independent of, Adult Time as
// 24/7 linear channels (routes_iptv_adulttime.go). Both read the same
// underlying catalog helpers in apihub_gamma_catalog.go, but nothing here is
// shared state with the linear-channel system: a bug in one cannot affect the
// other.
//
// Caching here is deliberately simpler than routes_iptv_network.go's
// warm/backoff machinery. That complexity exists because the linear guide
// walks every channel's schedule on every EPG refresh and must never block a
// request on a live fetch. A VOD catalog is browsed once when a client opens
// the Movies tab, so a client can wait a couple of seconds for a cold cache —
// there is no request path this could stall that isn't already expecting a
// network round trip.

// adultTimeVODCatalogTTL matches the linear-channel catalog TTL
// (iptvNetCatalogTTL) — movie collections and their scene lists change on the
// same cadence a schedule would.
const adultTimeVODCatalogTTL = 24 * time.Hour

// adultTimeVODRetryTTL is how long a failed build is cached for — deliberately
// short, since the ordinary cause (a lapsed session) is usually fixed within
// minutes and the alternative is pinning the Movies tab empty for a day.
const adultTimeVODRetryTTL = 2 * time.Minute

type adultTimeVODCache struct {
	mu      sync.Mutex
	entries []gammaMovieVODEntry
	builtAt time.Time
	err     error
}

var adultTimeVOD = &adultTimeVODCache{}

// entries returns the cached VOD catalog, rebuilding synchronously when
// stale. The mutex is held across the rebuild rather than released and
// re-acquired, so concurrent callers on a cold cache queue behind the one
// fetch instead of each starting their own — a client's first Movies-tab
// visit is exactly when several requests (categories, then streams per
// category) can land at once.
func (c *adultTimeVODCache) get(ctx context.Context) ([]gammaMovieVODEntry, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	ttl := adultTimeVODCatalogTTL
	if c.err != nil {
		ttl = adultTimeVODRetryTTL
	}
	if !c.builtAt.IsZero() && time.Since(c.builtAt) < ttl {
		return c.entries, c.err
	}

	entries, err := gammaListMovieScenes(ctx, adultTimeSite)
	c.builtAt = time.Now()
	if err != nil {
		c.entries, c.err = nil, err
		return nil, err
	}
	c.entries, c.err = entries, nil
	return c.entries, nil
}

// adultTimeVODEntries returns every playable VOD entry (one per scene,
// labelled with its parent movie).
func adultTimeVODEntries(ctx context.Context) ([]gammaMovieVODEntry, error) {
	return adultTimeVOD.get(ctx)
}

// adultTimeVODEntryByClipID looks up a single VOD entry, for get_vod_info and
// the stream handler. Both need the full entry (movie title, thumbnail) that
// a bare clip id alone does not carry.
func adultTimeVODEntryByClipID(ctx context.Context, clipID int) (gammaMovieVODEntry, bool, error) {
	entries, err := adultTimeVODEntries(ctx)
	if err != nil {
		return gammaMovieVODEntry{}, false, err
	}
	for _, e := range entries {
		if e.ClipID == clipID {
			return e, true, nil
		}
	}
	return gammaMovieVODEntry{}, false, nil
}

// adultTimeVODForceStale drops the cache so the next request rebuilds it —
// mirrors the linear lineup's Rewarm endpoint, for the same reason: a session
// reconnect should not wait out a full TTL before the Movies tab notices.
func adultTimeVODForceStale() {
	adultTimeVOD.mu.Lock()
	defer adultTimeVOD.mu.Unlock()
	adultTimeVOD.builtAt = time.Time{}
}
