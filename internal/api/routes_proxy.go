package api

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/stashapp/stash/pkg/logger"
)

type proxyRoutes struct {
	routes
}

// allowedProxyDomains is a whitelist of domains that can be proxied
var allowedProxyDomains = map[string]bool{
	"trailer.adultempire.com":           true,
	"internal-video.adultempire.com":    true,
	"video.adultempire.com":             true,
	"imgs1cdn.adultempire.com":          true,
	"trailer.adultdvdempire.com":        true,
	"internal-video.adultdvdempire.com": true,
	"video.adultdvdempire.com":          true,
}

func (rs proxyRoutes) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/media", rs.ProxyMedia)

	return r
}

// ProxyMedia proxies media content from external sources to bypass CORS restrictions
// URL format: /proxy/media?url=<encoded_url>
// For HLS streams, it rewrites the M3U8 playlist to route segment requests through the proxy
func (rs proxyRoutes) ProxyMedia(w http.ResponseWriter, r *http.Request) {
	// Debug: log the raw query string
	logger.Debugf("Proxy raw query: %s", r.URL.RawQuery)
	logger.Debugf("Proxy full URL: %s", r.URL.String())

	targetURLStr := r.URL.Query().Get("url")
	logger.Debugf("Proxy URL param value: '%s'", targetURLStr)

	if targetURLStr == "" {
		logger.Warnf("Proxy request missing URL parameter. Raw query: %s", r.URL.RawQuery)
		http.Error(w, "Missing 'url' parameter", http.StatusBadRequest)
		return
	}

	logger.Infof("Proxy request for: %s", targetURLStr)

	// Parse and validate the URL
	parsedURL, err := url.Parse(targetURLStr)
	if err != nil {
		logger.Warnf("Proxy request invalid URL: %s - error: %v", targetURLStr, err)
		http.Error(w, "Invalid URL", http.StatusBadRequest)
		return
	}

	// Security: Only allow whitelisted domains
	host := strings.ToLower(parsedURL.Hostname())
	if !allowedProxyDomains[host] {
		logger.Warnf("Proxy request blocked for domain: %s (not in whitelist)", host)
		http.Error(w, "Domain not allowed", http.StatusForbidden)
		return
	}

	// Create the proxy request
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	proxyReq, err := http.NewRequestWithContext(r.Context(), "GET", targetURLStr, nil)
	if err != nil {
		logger.Warnf("Failed to create proxy request: %v", err)
		http.Error(w, "Failed to create proxy request", http.StatusInternalServerError)
		return
	}

	// Set headers for the upstream request (mimic browser)
	proxyReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	proxyReq.Header.Set("Accept", "*/*")
	proxyReq.Header.Set("Accept-Language", "en-US,en;q=0.9")
	proxyReq.Header.Set("Accept-Encoding", "identity") // Don't request compressed data
	proxyReq.Header.Set("Connection", "keep-alive")
	proxyReq.Header.Set("sec-ch-ua", `"Google Chrome";v="120", "Chromium";v="120", "Not_A Brand";v="24"`)
	proxyReq.Header.Set("sec-ch-ua-mobile", "?0")
	proxyReq.Header.Set("sec-ch-ua-platform", `"Windows"`)
	proxyReq.Header.Set("sec-fetch-dest", "empty")
	proxyReq.Header.Set("sec-fetch-mode", "cors")
	proxyReq.Header.Set("sec-fetch-site", "same-site")

	// For AdultEmpire content, set proper origin/referer
	if strings.Contains(host, "adultempire") {
		proxyReq.Header.Set("Origin", "https://www.adultempire.com")
		proxyReq.Header.Set("Referer", "https://www.adultempire.com/")
	}

	resp, err := client.Do(proxyReq)
	if err != nil {
		logger.Warnf("Proxy request failed: %v", err)
		http.Error(w, "Proxy request failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		logger.Warnf("Upstream server returned status: %d for URL: %s", resp.StatusCode, targetURLStr)
		http.Error(w, fmt.Sprintf("Upstream server error: %d", resp.StatusCode), resp.StatusCode)
		return
	}

	// Add CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "*")

	// Check if this is an HLS playlist and needs rewriting
	isHLS := strings.Contains(targetURLStr, ".m3u8")

	if isHLS {
		logger.Debugf("Processing HLS playlist: %s", targetURLStr)
		rs.handleHLSPlaylist(w, resp, targetURLStr)
	} else {
		// For non-HLS content, just copy the response
		contentType := resp.Header.Get("Content-Type")
		if contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	}
}

// handleHLSPlaylist reads an M3U8 playlist and rewrites segment URLs to go through the proxy
func (rs proxyRoutes) handleHLSPlaylist(w http.ResponseWriter, resp *http.Response, originalURL string) {
	// Get the base URL for resolving relative paths
	baseURL := originalURL[:strings.LastIndex(originalURL, "/")+1]

	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()

		// Check if this line is a segment URL (not a comment/tag)
		if !strings.HasPrefix(line, "#") && line != "" {
			var fullURL string

			if strings.HasPrefix(line, "http://") || strings.HasPrefix(line, "https://") {
				// Absolute URL
				fullURL = line
			} else {
				// Relative URL - resolve against base URL
				fullURL = baseURL + strings.TrimPrefix(line, "/")
			}

			// Rewrite to go through our proxy
			encodedURL := url.QueryEscape(fullURL)
			proxiedLine := fmt.Sprintf("/proxy/media?url=%s", encodedURL)
			fmt.Fprintln(w, proxiedLine)
		} else {
			// Keep comments/tags as-is
			fmt.Fprintln(w, line)
		}
	}

	if err := scanner.Err(); err != nil {
		logger.Warnf("Error reading HLS playlist: %v", err)
	}
}
