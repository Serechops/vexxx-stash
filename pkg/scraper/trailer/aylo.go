package trailer

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// AyloScraper handles trailer scraping for Aylo/MindGeek sites
type AyloScraper struct {
	cache  *TokenCache
	client *http.Client
}

// NewAyloScraper creates a new Aylo scraper
func NewAyloScraper(cache *TokenCache) *AyloScraper {
	return &AyloScraper{
		cache: cache,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

// ScrapeTrailer gets the trailer URL for an Aylo-powered site
func (s *AyloScraper) ScrapeTrailer(ctx context.Context, url string) (string, error) {
	domain := extractDomain(url)
	if domain == "" {
		return "", fmt.Errorf("could not extract domain from URL: %s", url)
	}

	// Get or fetch instance token
	token, err := s.getInstanceToken(ctx, domain)
	if err != nil {
		return "", fmt.Errorf("failed to get instance token for %s: %w", domain, err)
	}

	// Extract scene ID from URL
	sceneID := extractClipID(url)
	if sceneID == "" {
		return "", fmt.Errorf("could not extract scene ID from URL: %s", url)
	}

	// Query Aylo API for trailer
	return s.queryAyloAPI(ctx, domain, token, sceneID)
}

func (s *AyloScraper) getInstanceToken(ctx context.Context, domain string) (string, error) {
	cacheKey := "aylo_" + domain

	// Check cache
	if token, ok := s.cache.Get(cacheKey); ok {
		return token, nil
	}

	// Fetch from site (token comes from cookie)
	siteURL := fmt.Sprintf("https://www.%s", domain)
	req, err := http.NewRequestWithContext(ctx, "GET", siteURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	// Look for instance_token cookie
	for _, cookie := range resp.Cookies() {
		if cookie.Name == "instance_token" {
			s.cache.Set(cacheKey, cookie.Value)
			return cookie.Value, nil
		}
	}

	return "", fmt.Errorf("no instance_token cookie found for %s", domain)
}

func (s *AyloScraper) queryAyloAPI(ctx context.Context, domain, token, sceneID string) (string, error) {
	apiURL := fmt.Sprintf("https://site-api.project1service.com/v2/releases/%s", sceneID)

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return "", err
	}

	req.Header.Set("Instance", token)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Origin", fmt.Sprintf("https://www.%s", domain))
	req.Header.Set("Referer", fmt.Sprintf("https://www.%s", domain))

	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		Result struct {
			TrailerURL   string `json:"trailerUrl"`
			DownloadURLs struct {
				Trailer string `json:"trailer"`
			} `json:"downloadUrls"`
			Videos map[string]struct {
				Files map[string]struct {
					Format string `json:"format"`
					URLs   struct {
						View string `json:"view"`
					} `json:"urls"`
				} `json:"files"`
			} `json:"videos"`
		} `json:"result"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode Aylo API response: %w", err)
	}

	// Try old-style keys first
	if result.Result.TrailerURL != "" {
		return result.Result.TrailerURL, nil
	}
	if result.Result.DownloadURLs.Trailer != "" {
		return result.Result.DownloadURLs.Trailer, nil
	}

	// Try new-style videos structure
	var bestURL string
	var bestRes int
	for _, section := range result.Result.Videos {
		for _, file := range section.Files {
			if file.URLs.View == "" {
				continue
			}
			res := parseResolution(file.Format)
			if res > bestRes {
				bestRes = res
				bestURL = file.URLs.View
			}
		}
	}

	if bestURL != "" {
		return bestURL, nil
	}

	return "", fmt.Errorf("no trailer URL found in Aylo API response")
}
