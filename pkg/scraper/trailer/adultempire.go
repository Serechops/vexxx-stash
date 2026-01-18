package trailer

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const (
	adultEmpireTrailerBase = "https://trailer.adultempire.com/hls/trailer"
)

// AdultEmpireScraper handles trailer URL extraction for AdultEmpire groups
type AdultEmpireScraper struct {
	client *http.Client
}

// NewAdultEmpireScraper creates a new AdultEmpire trailer scraper
func NewAdultEmpireScraper() *AdultEmpireScraper {
	return &AdultEmpireScraper{
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// ScrapeTrailerFromGroupURL extracts trailer URL from an AdultEmpire group/movie URL
// Example input: https://www.adultempire.com/2755037/dp-masters-10-porn-movies.html
// Example output: https://trailer.adultempire.com/hls/trailer/2755037/master.m3u8
func (s *AdultEmpireScraper) ScrapeTrailerFromGroupURL(ctx context.Context, groupURL string) (string, error) {
	// Extract movie ID from URL
	movieID := extractAdultEmpireMovieID(groupURL)
	if movieID == "" {
		return "", fmt.Errorf("could not extract movie ID from URL: %s", groupURL)
	}

	// Construct trailer URL
	trailerURL := fmt.Sprintf("%s/%s/master.m3u8", adultEmpireTrailerBase, movieID)

	// Optionally verify the trailer exists
	if err := s.verifyTrailerExists(ctx, trailerURL); err != nil {
		return "", err
	}

	return trailerURL, nil
}

// IsAdultEmpireURL checks if the URL is from AdultEmpire
func IsAdultEmpireURL(rawURL string) bool {
	lower := strings.ToLower(rawURL)
	return strings.Contains(lower, "adultempire.com") || strings.Contains(lower, "adultdvdempire.com")
}

// extractAdultEmpireMovieID extracts the movie ID from an AdultEmpire URL
// URL patterns:
//   - https://www.adultempire.com/2755037/dp-masters-10-porn-movies.html
//   - https://www.adultdvdempire.com/2755037/dp-masters-10-porn-movies.html
func extractAdultEmpireMovieID(rawURL string) string {
	// Pattern: domain.com/{movie_id}/...
	re := regexp.MustCompile(`(?:adultempire\.com|adultdvdempire\.com)/(\d+)/`)
	matches := re.FindStringSubmatch(rawURL)
	if len(matches) < 2 {
		return ""
	}
	return matches[1]
}

// verifyTrailerExists checks if the trailer URL is accessible
func (s *AdultEmpireScraper) verifyTrailerExists(ctx context.Context, trailerURL string) error {
	req, err := http.NewRequestWithContext(ctx, "HEAD", trailerURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Origin", "https://www.adultempire.com")
	req.Header.Set("Referer", "https://www.adultempire.com/")

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to verify trailer: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("trailer not available (status: %d)", resp.StatusCode)
	}

	return nil
}

// ScrapeTrailerFromGroupURLs scrapes trailer URLs for multiple group URLs
func (s *AdultEmpireScraper) ScrapeTrailerFromGroupURLs(ctx context.Context, groupURLs []string) map[string]string {
	results := make(map[string]string)

	for _, groupURL := range groupURLs {
		if !IsAdultEmpireURL(groupURL) {
			continue
		}

		trailerURL, err := s.ScrapeTrailerFromGroupURL(ctx, groupURL)
		if err == nil && trailerURL != "" {
			results[groupURL] = trailerURL
		}
	}

	return results
}

// GetTrailerURLForMovieID directly constructs a trailer URL from a movie ID
// Useful when you already know the movie ID
func GetTrailerURLForMovieID(movieID string) string {
	return fmt.Sprintf("%s/%s/master.m3u8", adultEmpireTrailerBase, movieID)
}
