package trailer

import (
	"context"
	"net/url"
	"regexp"
	"strings"
	"sync"
)

// Scraper provides trailer URL scraping for supported sites
type Scraper struct {
	algolia *AlgoliaScraper
	aylo    *AyloScraper
}

// TrailerResult holds the result of a trailer scrape attempt
type TrailerResult struct {
	URL        string
	TrailerURL string
	Error      string
}

// NewScraper creates a new trailer scraper
func NewScraper(cacheDir string) *Scraper {
	cache := NewTokenCache(cacheDir)
	return &Scraper{
		algolia: NewAlgoliaScraper(cache),
		aylo:    NewAyloScraper(cache),
	}
}

// ScrapeTrailerURL scrapes a single URL for its trailer
func (s *Scraper) ScrapeTrailerURL(ctx context.Context, sceneURL string) (string, error) {
	domain := extractDomain(sceneURL)
	siteType := GetSiteType(domain)

	switch siteType {
	case "algolia":
		return s.algolia.ScrapeTrailer(ctx, sceneURL)
	case "aylo":
		return s.aylo.ScrapeTrailer(ctx, sceneURL)
	default:
		return "", nil // Unsupported site, return empty (not an error)
	}
}

// ScrapeTrailerURLs scrapes multiple URLs concurrently
func (s *Scraper) ScrapeTrailerURLs(ctx context.Context, urls []string) []TrailerResult {
	results := make([]TrailerResult, len(urls))
	var wg sync.WaitGroup

	// Limit concurrency to avoid overwhelming external APIs
	semaphore := make(chan struct{}, 5)

	for i, u := range urls {
		wg.Add(1)
		go func(idx int, sceneURL string) {
			defer wg.Done()

			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			result := TrailerResult{URL: sceneURL}

			trailerURL, err := s.ScrapeTrailerURL(ctx, sceneURL)
			if err != nil {
				result.Error = err.Error()
			} else {
				result.TrailerURL = trailerURL
			}

			results[idx] = result
		}(i, u)
	}

	wg.Wait()
	return results
}

// extractDomain extracts the base domain from a URL
func extractDomain(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}

	host := parsed.Hostname()
	// Remove www. prefix if present
	host = strings.TrimPrefix(host, "www.")
	return host
}

// extractClipID extracts the numeric clip/scene ID from a URL
func extractClipID(rawURL string) string {
	// Pattern: /12345/ or /12345 at end of URL
	re := regexp.MustCompile(`/(\d+)(?:/|$)`)
	matches := re.FindStringSubmatch(rawURL)
	if len(matches) < 2 {
		return ""
	}
	return matches[1]
}
