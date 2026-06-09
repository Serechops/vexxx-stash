// Package localtunnel implements a localtunnel.me / loca.lt client
// that exposes a local port through a public HTTPS URL without
// requiring Node.js or npx.
package localtunnel

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const defaultBaseURL = "https://localtunnel.me"

// Tunnel represents an active localtunnel session.
type Tunnel struct {
	url       string
	remote    string
	cancel    context.CancelFunc
	closed    chan struct{}
	closeOnce sync.Once
	wg        sync.WaitGroup
	mu        sync.Mutex
	abortErr  error
}

// Options for creating a tunnel.
type Options struct {
	// Subdomain to request (optional). Leave empty for random.
	Subdomain string
	// LocalPort is the local port to expose.
	LocalPort int
	// LocalHost is the local hostname to proxy to (default "localhost").
	LocalHost string
}

type serverReply struct {
	ID           string `json:"id"`
	Port         int    `json:"port"`
	MaxConnCount int    `json:"max_conn_count"`
	URL          string `json:"url"`
}

// Start creates and starts a new localtunnel. Blocks until the tunnel
// is registered and ready. Returns the public URL or an error.
func Start(ctx context.Context, opts Options) (*Tunnel, error) {
	localHost := opts.LocalHost
	if localHost == "" {
		localHost = "localhost"
	}

	ctx, cancel := context.WithCancel(ctx)
	t := &Tunnel{
		cancel: cancel,
		closed: make(chan struct{}),
	}

	// 1. Register tunnel with server
	setupURL := defaultBaseURL + "/"
	if opts.Subdomain != "" {
		setupURL += opts.Subdomain
	} else {
		setupURL += "?new"
	}

	client := &http.Client{Timeout: 30 * time.Second}
	res, err := client.Get(setupURL)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("localtunnel: failed to register tunnel: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		cancel()
		return nil, fmt.Errorf("localtunnel: server returned %d: %s", res.StatusCode, strings.TrimSpace(string(body)))
	}

	var reply serverReply
	if err := json.NewDecoder(res.Body).Decode(&reply); err != nil {
		cancel()
		return nil, fmt.Errorf("localtunnel: failed to parse server reply: %w", err)
	}

	t.url = reply.URL

	// Extract remote hostname from base URL
	u, err := url.Parse(defaultBaseURL)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("localtunnel: invalid base URL: %w", err)
	}
	t.remote = fmt.Sprintf("%s:%d", u.Hostname(), reply.Port)

	if reply.MaxConnCount < 10 {
		reply.MaxConnCount = 10
	}
	if reply.MaxConnCount > 20 {
		reply.MaxConnCount = 20
	}

	// 2. Start proxy goroutines
	t.wg.Add(reply.MaxConnCount)
	for i := 0; i < reply.MaxConnCount; i++ {
		go t.proxyLoop(ctx, localHost, opts.LocalPort)
	}

	return t, nil
}

// URL returns the public HTTPS URL for this tunnel.
func (t *Tunnel) URL() string {
	return t.url
}

// Close shuts down the tunnel, closing all active connections.
func (t *Tunnel) Close() error {
	t.mu.Lock()
	if t.abortErr != nil {
		t.mu.Unlock()
		return nil
	}
	t.abortErr = fmt.Errorf("localtunnel: closed")
	t.mu.Unlock()

	// Cancel the context to break DialContext and RoundTrip calls,
	// then fire Done() immediately so the caller can proceed.
	// Proxy goroutines will exit once their in-flight HTTP request
	// completes or is cancelled.
	t.cancel()
	t.closeOnce.Do(func() {
		close(t.closed)
	})

	// Wait for goroutines with a generous timeout in background.
	// We never block Close() on this — the process will clean up
	// naturally when connections are eventually dropped.
	go func() {
		done := make(chan struct{})
		go func() {
			t.wg.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
		}
	}()

	return nil
}

// Done returns a channel that is closed when the tunnel has fully shut down.
func (t *Tunnel) Done() <-chan struct{} {
	return t.closed
}

func (t *Tunnel) proxyLoop(ctx context.Context, localHost string, localPort int) {
	defer t.wg.Done()

	// HTTP transport for forwarding requests to the local server.
	// DisableCompression prevents the proxy from requesting gzip
	// from the local server — this is critical because gzip would
	// re-encode Range response bodies, making Content-Range byte
	// offsets meaningless to the client (DeoVR).
	// DisableKeepAlives is set because each tunnel TCP connection
	// serves exactly one HTTP request-response cycle.
	transport := &http.Transport{
		DisableCompression: true,
		DisableKeepAlives:  true,
	}

	var d net.Dialer
	for ctx.Err() == nil {
		// Connect to localtunnel server's control port.
		// Each TCP connection will carry exactly one HTTP request.
		remoteConn, err := d.DialContext(ctx, "tcp", t.remote)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			time.Sleep(3 * time.Second)
			continue
		}

		// Set a generous idle timeout — if no request arrives within
		// 90 seconds the tunnel server probably dropped us.
		_ = remoteConn.SetReadDeadline(time.Now().Add(90 * time.Second))

		// Read the first byte — the server sends it when a new
		// request arrives.  This byte is actually the first byte
		// of the raw HTTP request (e.g. 'G' from "GET /...").
		var b [1]byte
		if _, err := io.ReadFull(remoteConn, b[:]); err != nil {
			remoteConn.Close()
			if ctx.Err() != nil {
				return
			}
			time.Sleep(1 * time.Second)
			continue
		}

		// Request arrived — clear the idle deadline so large
		// video responses can stream for as long as needed.
		_ = remoteConn.SetReadDeadline(time.Time{})

		// ── HTTP-aware proxying ─────────────────────────────────
		//
		// Instead of raw TCP bidirectional copy (which doesn't
		// understand HTTP semantics), we parse the request, forward
		// it through Go's http.Transport, and write the response
		// back through the tunnel connection.  This preserves:
		//
		//   • Range request headers  (Range: bytes=X-Y)
		//   • 206 Partial Content status codes
		//   • Accept-Ranges / Content-Range / Content-Length headers
		//
		// All of which are required for DeoVR video seeking.

		// Reconstruct the full byte stream: prepend the signal
		// byte so the HTTP parser sees the complete request line.
		bufReader := bufio.NewReaderSize(
			io.MultiReader(bytes.NewReader(b[:]), remoteConn),
			32*1024,
		)

		req, err := http.ReadRequest(bufReader)
		if err != nil {
			remoteConn.Close()
			continue
		}

		// Rewrite the URL to target the local server while keeping
		// the original Host header intact.  URL-generating handlers
		// (like /deovr) use r.Host to build public URLs pointing
		// back through the tunnel — preserving Host ensures those
		// URLs are correct (e.g. https://vexxx-vr.loca.lt/...).
		req.URL.Scheme = "http"
		req.URL.Host = fmt.Sprintf("%s:%d", localHost, localPort)
		req.RequestURI = "" // must be empty for http.Transport

		// Propagate tunnel shutdown so in-flight requests are
		// cancelled when Close() is called.
		req = req.WithContext(ctx)

		resp, err := transport.RoundTrip(req)
		if err != nil {
			remoteConn.Close()
			continue
		}

		// Write the full HTTP response (status line, headers, body)
		// back through the tunnel.  For Range responses this
		// preserves the 206 status, Content-Range, Content-Length,
		// and Accept-Ranges headers exactly as the local server
		// sent them — enabling DeoVR to seek properly.
		resp.Close = true // emit Connection: close for the tunnel peer
		_ = resp.Write(remoteConn)
		resp.Body.Close()
		remoteConn.Close()
	}
}
