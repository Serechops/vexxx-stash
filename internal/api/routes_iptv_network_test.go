package api

import (
	"errors"
	"testing"
	"time"

	"github.com/stashapp/stash/pkg/iptv"
)

// ─── catalog cache lifetimes ──────────────────────────────────────────────────
//
// These cover the distinction that caused a real outage: a schedule that failed
// to build is not the same as a channel with nothing to air, and treating a
// momentary session gap as the latter took most of the lineup off air for a day.

func TestFailedEntryIsRetriedLongBeforeTheCatalogTTL(t *testing.T) {
	entry := iptvNetCatalogEntry{
		built:    time.Now(),
		err:      errors.New("boom"),
		attempts: 1,
		retryAt:  time.Now().Add(iptvNetRetryBase),
	}

	if !entry.current(iptvNetCatalogTTL) {
		t.Error("a just-failed entry should not be retried immediately")
	}

	// The failure is fresh by the catalog's standards but past its own deadline,
	// which is exactly the case the old code got wrong.
	entry.retryAt = time.Now().Add(-time.Second)
	if entry.current(iptvNetCatalogTTL) {
		t.Error("a failed entry past its retry deadline should be refetched")
	}
}

func TestSuccessfulEntryLivesOutTheCatalogTTL(t *testing.T) {
	entry := iptvNetCatalogEntry{
		built:    time.Now().Add(-time.Hour),
		programs: []iptv.SceneEntry{{SceneID: 1}},
	}
	if !entry.current(iptvNetCatalogTTL) {
		t.Error("an hour-old schedule should still serve")
	}

	entry.built = time.Now().Add(-2 * iptvNetCatalogTTL)
	if entry.current(iptvNetCatalogTTL) {
		t.Error("a schedule past the TTL should be rebuilt")
	}
}

func TestDeadIsAnAnswerAndAFailureIsNot(t *testing.T) {
	dead := iptvNetCatalogEntry{built: time.Now()}
	if !dead.dead() {
		t.Error("an empty catalog read without error is a dead channel")
	}

	failed := iptvNetCatalogEntry{built: time.Now(), err: errors.New("boom")}
	if failed.dead() {
		t.Error("a failed read must not be mistaken for a dead channel — it would be dropped instead of retried")
	}

	ok := iptvNetCatalogEntry{built: time.Now(), programs: []iptv.SceneEntry{{SceneID: 1}}}
	if ok.dead() {
		t.Error("a channel with programmes is not dead")
	}
}

func TestDeadChannelsAreRetriedOnlyOnTheSlowSchedule(t *testing.T) {
	// A dead channel costs a request every time it is reconsidered, and its
	// durations are not going to appear in the next two minutes.
	dead := iptvNetCatalogEntry{built: time.Now()}
	if !dead.current(iptvNetCatalogTTL) {
		t.Error("a dead channel should not be refetched on the failure cadence")
	}
}

func TestRetryDelayBacksOffAndIsCapped(t *testing.T) {
	if got := iptvNetRetryDelay(1); got != iptvNetRetryBase {
		t.Errorf("first retry = %s, want %s", got, iptvNetRetryBase)
	}
	if got := iptvNetRetryDelay(2); got != 2*iptvNetRetryBase {
		t.Errorf("second retry = %s, want %s", got, 2*iptvNetRetryBase)
	}

	prev := time.Duration(0)
	for n := 1; n <= 20; n++ {
		got := iptvNetRetryDelay(n)
		if got < prev {
			t.Errorf("retry delay went backwards at attempt %d: %s after %s", n, got, prev)
		}
		if got > iptvNetRetryMax {
			t.Errorf("attempt %d exceeded the cap: %s > %s", n, got, iptvNetRetryMax)
		}
		prev = got
	}
	if prev != iptvNetRetryMax {
		t.Errorf("delay never reached the cap: %s", prev)
	}
}

func TestDirectoryReportsDeadChannelsButNotUnknownOnes(t *testing.T) {
	d := newIPTVNetDirectory()

	if d.isDead("aylo-brazzers-1", 50) {
		t.Error("a channel with no schedule yet is still warming, not dead")
	}

	d.putCatalog("aylo-brazzers-1", iptvNetCatalogEntry{built: time.Now(), want: 50})
	if !d.isDead("aylo-brazzers-1", 50) {
		t.Error("an empty successful read should mark the channel dead")
	}

	d.putCatalog("aylo-brazzers-2", iptvNetCatalogEntry{
		built: time.Now(), want: 50, err: errors.New("boom"),
	})
	if d.isDead("aylo-brazzers-2", 50) {
		t.Error("a failed read must not drop the channel from the lineup")
	}
}
