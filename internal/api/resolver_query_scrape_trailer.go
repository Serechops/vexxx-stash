package api

import (
	"context"
	"path/filepath"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/scraper/trailer"
)

func (r *queryResolver) ScrapeTrailerUrls(ctx context.Context, urls []string) ([]*TrailerResult, error) {
	// Get cache directory from config
	cacheDir := filepath.Join(config.GetInstance().GetConfigPath(), "trailer_cache")

	// Create scraper and run batch scrape
	scraper := trailer.NewScraper(cacheDir)
	results := scraper.ScrapeTrailerURLs(ctx, urls)

	// Convert to GraphQL type
	ret := make([]*TrailerResult, len(results))
	for i, r := range results {
		ret[i] = &TrailerResult{
			URL:        r.URL,
			TrailerURL: nilIfEmpty(r.TrailerURL),
			Error:      nilIfEmpty(r.Error),
		}
	}

	return ret, nil
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
