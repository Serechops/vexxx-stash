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
	"www.evilangel.com":                 true,
	"members.evilangel.com":             true,
	"www.adulttime.com":                 true,
	"members.adulttime.com":             true,
	"freetour.adulttime.com":            true,
	// DFXtra — third site on the same Gamma platform (see
	// apihub_dfxtra_catalog.go). Public homepage like EvilAngel's, so both
	// hosts are needed: www for the window.env key scrape, members for
	// streaming/photoset/download.
	"www.dfxtra.com":     true,
	"members.dfxtra.com": true,
	"api2.reptyle.com":                  true,
	"ma-store.reptyle.com":              true,
	// TeamSkeet/Reptyle's dedicated OAuth host. Unlike members.reptyle.com
	// (Cloudflare JS-challenged), this one answers a plain POST, so the plugin
	// refreshes the 30-min access token here without driving a browser — the
	// refresh token travels in the request body, no Bearer/cookie needed.
	"auth.reptyle.com": true,
	// NewSensations — a legacy server-rendered PHP site (category.php/
	// gallery.php/sets.php/advancedsearch.php), unlike every other network's
	// JSON API. The plugin scrapes these pages' HTML through this relay with
	// the member cookie attached (see cookieForwardHosts below). Its video/
	// image CDN (nsnetwork{members,tour,thumbs}.newsensations.com) serves
	// pre-signed URLs (validfrom/validto/hash query params) consumed directly
	// by <video>/<img> in the browser — no proxying needed for those, so they
	// are deliberately NOT listed here.
	"newsensations.com":          true,
	"site-api.project1service.com": true,
}

// allowedProxySuffixes is a whitelist of domain suffixes that can be proxied,
// for CDN families that shard content across numbered/lettered subdomains
// (e.g. images03-fame.gammacdn.com, streaming-hls.gammacdn.com), or that
// front a single logical API behind an app-id-prefixed hostname (Algolia).
var allowedProxySuffixes = []string{
	".gammacdn.com",
	".algolia.net",
	".algolianet.com",
}

// refererSpoofExact maps an exact proxied host to the Origin/Referer the
// upstream expects instead of Stash's own origin. Kept per-exact-host rather
// than a blanket "evilangel.com" substring match: members.evilangel.com's
// session-validated member API checks the Referer subdomain specifically (a
// real browser trace showed it expects the `members` referer, not `www`), so
// spoofing the wrong one can silently fail auth even with valid cookies.
var refererSpoofExact = map[string]string{
	"www.evilangel.com":            "https://www.evilangel.com",
	"members.evilangel.com":        "https://members.evilangel.com",
	"www.adulttime.com":            "https://members.adulttime.com",
	"members.adulttime.com":        "https://members.adulttime.com",
	"freetour.adulttime.com":       "https://members.adulttime.com",
	"www.dfxtra.com":               "https://www.dfxtra.com",
	"members.dfxtra.com":           "https://members.dfxtra.com",
	"api2.reptyle.com":             "https://app.reptyle.com",
	"ma-store.reptyle.com":         "https://app.reptyle.com",
	"auth.reptyle.com":             "https://app.reptyle.com",
	"site-api.project1service.com": "https://www.brazzers.com",
}

// algoliaOriginByAppID maps an Algolia application id (sent verbatim by the
// plugin as X-Algolia-Application-Id, forwarded below) to the Referer/Origin
// its secured/search key is restricted to. Keyed by app id rather than a
// blanket Algolia-suffix rule because more than one network now shares this
// relay: EvilAngel's key is restricted to its own domain, Adult Time's to
// members.adulttime.com — spoofing the wrong one fails the upstream's
// referrer check even with an otherwise-valid key.
var algoliaOriginByAppID = map[string]string{
	"TSMKFA364Q": "https://members.adulttime.com",
}

// refererSpoofSuffixes is the fallback for Algolia hosts whose app id isn't
// (yet) in algoliaOriginByAppID above — kept defaulting to EvilAngel since it
// was the sole Algolia consumer before Adult Time.
var refererSpoofSuffixes = []struct{ suffix, origin string }{
	{".algolia.net", "https://www.evilangel.com"},
	{".algolianet.com", "https://www.evilangel.com"},
}

func refererOriginFor(host string, algoliaAppID string) (string, bool) {
	if origin, ok := refererSpoofExact[host]; ok {
		return origin, true
	}
	if algoliaAppID != "" {
		if origin, ok := algoliaOriginByAppID[strings.ToUpper(algoliaAppID)]; ok {
			return origin, true
		}
	}
	for _, e := range refererSpoofSuffixes {
		if strings.HasSuffix(host, e.suffix) {
			return e.origin, true
		}
	}
	return "", false
}

// forwardedRequestHeaders is the whitelist of caller-supplied headers passed
// through verbatim to the upstream request (e.g. Algolia's auth headers).
// Keep this narrow — anything else the plugin needs the relay to send should
// be added explicitly, not opened up wholesale.
var forwardedRequestHeaders = []string{
	"Content-Type",
	"X-Algolia-Application-Id",
	"X-Algolia-API-Key",
	// TeamSkeet/Reptyle authenticates purely off a Bearer JWT (never a Cookie
	// header) — the client already holds this token itself, so forwarding it
	// verbatim carries the same trust level as the Algolia key headers above.
	"Authorization",
	// Adult Time's member area answers 403 to a plain GET of its JSON
	// endpoints and 200 to the identical request carrying this header; the
	// members page additionally serves a promotional interstitial redirect to
	// anything that does not look like an in-page fetch. Measured across both:
	// this header alone is what makes them behave, which is why it has to
	// survive the relay rather than being set here for one host.
	"X-Requested-With",
	// Aylo authentication headers
	"instance",
	"x-instance",
}

func isAllowedProxyHost(host string) bool {
	if allowedProxyDomains[host] {
		return true
	}
	for _, suffix := range allowedProxySuffixes {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}

// cookieForwardHosts is a whitelist of hosts the proxy will attach a caller-
// supplied Cookie header to (via the X-Apihub-Cookie request header). Kept
// separate and narrower than allowedProxyDomains so a session cookie pasted
// for one member site can never be replayed against a CDN host.
var cookieForwardHosts = map[string]bool{
	"members.evilangel.com": true,
	"members.adulttime.com": true,
	"newsensations.com":     true,
	"members.dfxtra.com":    true,
}

func (rs proxyRoutes) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/media", rs.ProxyMedia)
	r.Post("/media", rs.ProxyMedia)

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
	if !isAllowedProxyHost(host) {
		logger.Warnf("Proxy request blocked for domain: %s (not in whitelist)", host)
		http.Error(w, "Domain not allowed", http.StatusForbidden)
		return
	}

	// Create the proxy request
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	method := r.Method
	if method != http.MethodGet && method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body io.Reader
	if method == http.MethodPost {
		body = r.Body
	}
	proxyReq, err := http.NewRequestWithContext(r.Context(), method, targetURLStr, body)
	if err != nil {
		logger.Warnf("Failed to create proxy request: %v", err)
		http.Error(w, "Failed to create proxy request", http.StatusInternalServerError)
		return
	}

	// Set headers for the upstream request (mimic browser)
	proxyReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	proxyReq.Header.Set("Accept", "*/*")
	proxyReq.Header.Set("Accept-Language", "en-US,en;q=0.9")
	// Deliberately not setting Accept-Encoding: some upstreams (e.g. Algolia,
	// behind Cloudflare) compress regardless of what's requested. Leaving this
	// unset lets Go's http.Transport negotiate gzip itself and transparently
	// decompress the response — setting it ourselves would disable that and
	// leave us blindly copying compressed bytes into a response that Stash's
	// own middleware might then compress a second time.
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

	if origin, ok := refererOriginFor(host, r.Header.Get("X-Algolia-Application-Id")); ok {
		proxyReq.Header.Set("Origin", origin)
		proxyReq.Header.Set("Referer", origin+"/")
		proxyReq.Header.Set("X-Requested-With", "XMLHttpRequest")
	}

	// Forward a narrow, explicit whitelist of caller-supplied headers (e.g.
	// Algolia's auth headers) — never the full header set, so the plugin
	// can't smuggle arbitrary headers through this relay.
	for _, name := range forwardedRequestHeaders {
		if v := r.Header.Get(name); v != "" {
			proxyReq.Header.Set(name, v)
		}
	}

	// Forward a caller-supplied session cookie for member-gated endpoints only.
	// The plugin sends it as a custom header (never as the actual outgoing
	// Cookie header, which browsers forbid scripts from setting) so this
	// server-side hop is the only place the real Cookie header gets attached.
	if cookieForwardHosts[host] {
		if cookie := r.Header.Get("X-Apihub-Cookie"); cookie != "" {
			proxyReq.Header.Set("Cookie", cookie)
		}
	}

	resp, err := client.Do(proxyReq)
	if err != nil {
		logger.Warnf("Proxy request failed: %v", err)
		http.Error(w, "Proxy request failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Expose the final URL after any redirects — the plugin needs this to
	// discover the resolved series id for NewSensations banner-track redirects
	// (bannerload.php?track=XXXX → category.php?id=YYYY). The Go http.Client
	// follows redirects automatically, so the caller's fetch API sees only the
	// proxy URL; this header bridges that gap.
	if resp.Request.URL != nil {
		w.Header().Set("X-Final-URL", resp.Request.URL.String())
	}

	if resp.StatusCode != http.StatusOK {
		logger.Warnf("Upstream server returned status: %d for URL: %s", resp.StatusCode, targetURLStr)
		http.Error(w, fmt.Sprintf("Upstream server error: %d", resp.StatusCode), resp.StatusCode)
		return
	}

	// Add CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "*")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Security-Policy, Location, X-Final-URL")

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
