package trailer

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	algoliaAppID = "TSMKFA364Q"
	algoliaAgent = "Algolia for JavaScript (4.22.1); Browser"
)

// AlgoliaScraper handles trailer scraping for Algolia-powered sites
type AlgoliaScraper struct {
	cache  *TokenCache
	client *http.Client
}

// NewAlgoliaScraper creates a new Algolia scraper
func NewAlgoliaScraper(cache *TokenCache) *AlgoliaScraper {
	return &AlgoliaScraper{
		cache: cache,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

// ScrapeTrailer gets the trailer URL for an Algolia-powered site
func (s *AlgoliaScraper) ScrapeTrailer(ctx context.Context, url string) (string, error) {
	domain := extractDomain(url)
	if domain == "" {
		return "", fmt.Errorf("could not extract domain from URL: %s", url)
	}

	// Get or fetch API key
	apiKey, err := s.getAPIKey(ctx, domain)
	if err != nil {
		return "", fmt.Errorf("failed to get API key for %s: %w", domain, err)
	}

	// Extract clip ID from URL
	clipID := extractClipID(url)
	if clipID == "" {
		return "", fmt.Errorf("could not extract clip ID from URL: %s", url)
	}

	// Query Algolia for trailer
	return s.queryAlgolia(ctx, domain, apiKey, clipID)
}

func (s *AlgoliaScraper) getAPIKey(ctx context.Context, domain string) (string, error) {
	cacheKey := "algolia_" + domain

	// Check cache
	if key, ok := s.cache.Get(cacheKey); ok {
		return key, nil
	}

	// Fetch from site
	siteURL := fmt.Sprintf("https://www.%s/en", domain)
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

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	// Extract window.env JSON
	re := regexp.MustCompile(`window\.env\s*=\s*({.+?});`)
	matches := re.FindSubmatch(body)
	if len(matches) < 2 {
		return "", fmt.Errorf("could not find window.env in page")
	}

	var env struct {
		API struct {
			Algolia struct {
				APIKey string `json:"apiKey"`
			} `json:"algolia"`
		} `json:"api"`
	}
	if err := json.Unmarshal(matches[1], &env); err != nil {
		return "", fmt.Errorf("failed to parse window.env: %w", err)
	}

	if env.API.Algolia.APIKey == "" {
		return "", fmt.Errorf("no API key found in window.env")
	}

	s.cache.Set(cacheKey, env.API.Algolia.APIKey)
	return env.API.Algolia.APIKey, nil
}

func (s *AlgoliaScraper) queryAlgolia(ctx context.Context, domain, apiKey, clipID string) (string, error) {
	endpoint := fmt.Sprintf("https://%s-dsn.algolia.net/1/indexes/all_scenes/query", algoliaAppID)

	params := fmt.Sprintf(`clickAnalytics=true&facetFilters=%%5B%%5B%%22clip_id%%3A%s%%22%%5D%%5D&facets=%%5B%%5D&hitsPerPage=1&tagFilters=`, clipID)
	body := fmt.Sprintf(`{"params":"%s"}`, params)

	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, strings.NewReader(body))
	if err != nil {
		return "", err
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
	req.Header.Set("Origin", fmt.Sprintf("https://www.%s", domain))
	req.Header.Set("Referer", fmt.Sprintf("https://www.%s", domain))
	req.Header.Set("x-algolia-api-key", apiKey)
	req.Header.Set("x-algolia-application-id", algoliaAppID)
	req.Header.Set("x-algolia-agent", algoliaAgent)
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		Hits []struct {
			VideoFormats []struct {
				Format     string `json:"format"`
				TrailerURL string `json:"trailer_url"`
			} `json:"video_formats"`
		} `json:"hits"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode Algolia response: %w", err)
	}

	if len(result.Hits) == 0 || len(result.Hits[0].VideoFormats) == 0 {
		return "", fmt.Errorf("no video formats found in Algolia response")
	}

	// Find highest resolution trailer
	var bestURL string
	var bestRes int
	for _, vf := range result.Hits[0].VideoFormats {
		if vf.TrailerURL == "" {
			continue
		}
		res := parseResolution(vf.Format)
		if res > bestRes {
			bestRes = res
			bestURL = vf.TrailerURL
		}
	}

	if bestURL == "" {
		return "", fmt.Errorf("no trailer URL found in video formats")
	}

	return bestURL, nil
}

func parseResolution(format string) int {
	re := regexp.MustCompile(`(\d+)`)
	matches := re.FindStringSubmatch(format)
	if len(matches) < 2 {
		return 0
	}
	res, _ := strconv.Atoi(matches[1])
	return res
}
