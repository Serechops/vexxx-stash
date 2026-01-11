package trailer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// TokenCache stores API tokens with daily expiry
type TokenCache struct {
	mu       sync.RWMutex
	tokens   map[string]cachedToken
	cacheDir string
}

type cachedToken struct {
	Token string `json:"token"`
	Date  string `json:"date"`
}

// NewTokenCache creates a new token cache
func NewTokenCache(cacheDir string) *TokenCache {
	tc := &TokenCache{
		tokens:   make(map[string]cachedToken),
		cacheDir: cacheDir,
	}
	tc.loadFromDisk()
	return tc
}

// Get retrieves a token if it exists and is from today
func (c *TokenCache) Get(key string) (string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	today := time.Now().UTC().Format("2006-01-02")
	if t, ok := c.tokens[key]; ok && t.Date == today {
		return t.Token, true
	}
	return "", false
}

// Set stores a token with today's date
func (c *TokenCache) Set(key, token string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	today := time.Now().UTC().Format("2006-01-02")
	c.tokens[key] = cachedToken{
		Token: token,
		Date:  today,
	}
	c.saveToDisk()
}

func (c *TokenCache) loadFromDisk() {
	if c.cacheDir == "" {
		return
	}

	path := filepath.Join(c.cacheDir, "trailer_tokens.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}

	var tokens map[string]cachedToken
	if err := json.Unmarshal(data, &tokens); err != nil {
		return
	}

	c.tokens = tokens
}

func (c *TokenCache) saveToDisk() {
	if c.cacheDir == "" {
		return
	}

	if err := os.MkdirAll(c.cacheDir, 0755); err != nil {
		return
	}

	path := filepath.Join(c.cacheDir, "trailer_tokens.json")
	data, err := json.MarshalIndent(c.tokens, "", "  ")
	if err != nil {
		return
	}

	os.WriteFile(path, data, 0644)
}
