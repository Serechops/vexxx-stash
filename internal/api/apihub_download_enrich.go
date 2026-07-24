package api

import (
	"context"

	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/stashbox"
)

// enrichUnmatchedEntities fleshes out the studio and performers on a scraped
// scene that don't already exist in the library. The provider (Aylo/EvilAngel)
// only carries a name (and, for performers, gender + maybe a portrait) — so
// entities the Identify pass has to *create* would otherwise land metadata-less.
//
// For each entity that MatchRelationships did NOT link to an existing library
// row (StoredID == nil), it queries the user's configured stash-box by name and
// merges the canonical data (bio, birthdate, measurements, aliases, URLs, image,
// and the stash-box RemoteSiteID) into the scraped stub. Provider-supplied
// fields win; the stash-box only fills the gaps.
//
// Returns the stash-box endpoint the enrichment used, which the caller sets as
// the Identify source's RemoteSite so that any merged RemoteSiteID becomes a
// linked StashID on the newly-created studio/performer. Returns "" when no
// stash-box is configured (provider-only — unchanged behaviour). Everything here
// is best-effort: a lookup failure logs and leaves the stub as-is, so a flaky
// stash-box never blocks an import.
func enrichUnmatchedEntities(ctx context.Context, scraped *models.ScrapedScene) string {
	boxes := config.GetInstance().GetStashBoxes()
	if len(boxes) == 0 {
		return ""
	}
	box := boxes[0]
	client := stashbox.NewClient(*box, stashbox.ExcludeTagPatterns(manager.GetInstance().Config.GetScraperExcludeTagPatterns()))

	if s := scraped.Studio; s != nil && s.StoredID == nil && s.Name != "" {
		found, err := client.FindStudio(ctx, s.Name)
		if err != nil {
			logger.Warnf("[apihub-download] stash-box studio lookup for %q failed: %v", s.Name, err)
		} else if found != nil {
			mergeScrapedStudio(s, found)
		}
	}

	for _, p := range scraped.Performers {
		if p == nil || p.StoredID != nil || p.Name == nil || *p.Name == "" {
			continue
		}
		found, err := client.FindPerformerByName(ctx, *p.Name)
		if err != nil {
			logger.Warnf("[apihub-download] stash-box performer lookup for %q failed: %v", *p.Name, err)
			continue
		}
		if found != nil {
			mergeScrapedPerformer(p, found)
		}
	}

	return box.Endpoint
}

// coalesceStr returns a if it holds a non-empty value, otherwise b — used to
// prefer the provider's value and fall back to the stash-box's.
func coalesceStr(a, b *string) *string {
	if a != nil && *a != "" {
		return a
	}
	return b
}

// mergeScrapedStudio fills empty fields on the provider stub dst from the
// stash-box result src, always taking src's RemoteSiteID (and image/URLs when
// the provider supplied none) so the created studio links back to the box.
func mergeScrapedStudio(dst, src *models.ScrapedStudio) {
	dst.Details = coalesceStr(dst.Details, src.Details)
	dst.Aliases = coalesceStr(dst.Aliases, src.Aliases)
	if dst.Parent == nil {
		dst.Parent = src.Parent
	}
	if len(dst.URLs) == 0 {
		dst.URLs = src.URLs
	}
	if len(dst.Images) == 0 {
		dst.Images = src.Images
		// ScrapedStudio.GetImage gates on len(Images) but reads *Image, so both
		// must be set for the created studio to pick up the logo.
		dst.Image = coalesceStr(dst.Image, src.Image)
	}
	dst.RemoteSiteID = src.RemoteSiteID
}

// mergeScrapedPerformer fills empty fields on the provider stub dst from the
// stash-box result src. The provider's name and gender win; everything else is
// filled from the box, along with its RemoteSiteID for StashID linking.
func mergeScrapedPerformer(dst, src *models.ScrapedPerformer) {
	dst.Gender = coalesceStr(dst.Gender, src.Gender)
	dst.Disambiguation = coalesceStr(dst.Disambiguation, src.Disambiguation)
	dst.Birthdate = coalesceStr(dst.Birthdate, src.Birthdate)
	dst.DeathDate = coalesceStr(dst.DeathDate, src.DeathDate)
	dst.Ethnicity = coalesceStr(dst.Ethnicity, src.Ethnicity)
	dst.Country = coalesceStr(dst.Country, src.Country)
	dst.EyeColor = coalesceStr(dst.EyeColor, src.EyeColor)
	dst.HairColor = coalesceStr(dst.HairColor, src.HairColor)
	dst.Height = coalesceStr(dst.Height, src.Height)
	dst.Weight = coalesceStr(dst.Weight, src.Weight)
	dst.Measurements = coalesceStr(dst.Measurements, src.Measurements)
	dst.FakeTits = coalesceStr(dst.FakeTits, src.FakeTits)
	dst.CareerLength = coalesceStr(dst.CareerLength, src.CareerLength)
	dst.Tattoos = coalesceStr(dst.Tattoos, src.Tattoos)
	dst.Piercings = coalesceStr(dst.Piercings, src.Piercings)
	dst.Aliases = coalesceStr(dst.Aliases, src.Aliases)
	dst.Details = coalesceStr(dst.Details, src.Details)
	if len(dst.URLs) == 0 {
		dst.URLs = src.URLs
	}
	if len(dst.Images) == 0 {
		dst.Images = src.Images
		dst.Image = coalesceStr(dst.Image, src.Image)
	}
	dst.RemoteSiteID = src.RemoteSiteID
}
