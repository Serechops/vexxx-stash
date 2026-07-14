package pmvhaven

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

// Generator produces beat-synced funscripts on demand from a PMVHaven video's
// audio. PMVHaven ships no scripts, so the first time a video is played its CDN
// mp4 is pulled through ffmpeg (audio only, downsampled to the analyzer's
// sample rate), handed to the bundled analyzer.py (librosa beat tracking), and
// the resulting .funscript JSON is cached under <dir>/funscripts/. Subsequent
// requests serve the cached file directly.
//
// Generation is serialized per-video (a colliding second request waits for the
// in-flight one rather than launching a duplicate ffmpeg+python pipeline).
type Generator struct {
	db *DB
	// All lazily resolved so plugin-setting changes take effect without restart.
	dir      func() string // data dir; funscripts/ cache lives under it
	ffmpeg   func() string // ffmpeg executable (Stash's configured path)
	python   func() string // python executable
	analyzer func() string // path to analyzer.py
	smooth   func() string // optional --smooth strength ("" = none)

	mu       sync.Mutex
	inflight map[string]*sync.Mutex
}

// NewGenerator wires a funscript generator. The provider funcs are resolved on
// each call so configuration changes apply live.
func NewGenerator(db *DB, dir, ffmpeg, python, analyzer, smooth func() string) *Generator {
	return &Generator{
		db:       db,
		dir:      dir,
		ffmpeg:   ffmpeg,
		python:   python,
		analyzer: analyzer,
		smooth:   smooth,
		inflight: make(map[string]*sync.Mutex),
	}
}

// cachePath is the on-disk funscript path for a video id.
func (g *Generator) cachePath(id string) string {
	return filepath.Join(g.dir(), "funscripts", id+".funscript")
}

// lockFor returns the per-id mutex used to serialize generation.
func (g *Generator) lockFor(id string) *sync.Mutex {
	g.mu.Lock()
	defer g.mu.Unlock()
	l, ok := g.inflight[id]
	if !ok {
		l = &sync.Mutex{}
		g.inflight[id] = l
	}
	return l
}

// Cached reports whether a funscript for the video already exists on disk.
func (g *Generator) Cached(id string) bool {
	if _, err := os.Stat(g.cachePath(id)); err == nil {
		return true
	}
	return false
}

// Ensure returns the path to the video's funscript, generating and caching it
// first if it does not yet exist. ctx bounds the (potentially multi-second)
// ffmpeg + analyzer pipeline.
func (g *Generator) Ensure(ctx context.Context, id string) (string, error) {
	out := g.cachePath(id)
	if _, err := os.Stat(out); err == nil {
		return out, nil
	}

	lock := g.lockFor(id)
	lock.Lock()
	defer lock.Unlock()

	// Another waiter may have produced it while we blocked on the lock.
	if _, err := os.Stat(out); err == nil {
		return out, nil
	}

	url, err := g.db.VideoURL(id)
	if err != nil {
		return "", err
	}
	if url == "" {
		return "", fmt.Errorf("pmvhaven: unknown video %q", id)
	}

	data, err := g.generate(ctx, id, url)
	if err != nil {
		return "", err
	}

	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		return "", err
	}
	// Write atomically so a serve never sees a half-written file.
	tmp := out + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, out); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return out, nil
}

// generate runs the ffmpeg → analyzer pipeline and returns the funscript JSON.
func (g *Generator) generate(ctx context.Context, id, videoURL string) ([]byte, error) {
	wav := filepath.Join(os.TempDir(), "pmv-"+sanitize(id)+".wav")
	defer os.Remove(wav)

	// 1. Pull audio only, mono @ 22050 Hz (the analyzer's SR) straight to wav.
	//    ffmpeg streams the remote mp4 and discards the video track (-vn).
	ff := g.resolve(g.ffmpeg, "ffmpeg")
	ffArgs := []string{
		"-y", "-nostdin",
		"-i", videoURL,
		"-vn", "-ac", "1", "-ar", "22050",
		"-f", "wav", wav,
	}
	if err := runCmd(ctx, ff, ffArgs, nil); err != nil {
		return nil, fmt.Errorf("pmvhaven: ffmpeg audio extract failed: %w", err)
	}

	// 2. Beat-analyze the wav → funscript JSON on stdout.
	py := g.resolve(g.python, "python")
	analyzer := g.resolve(g.analyzer, filepath.Join(g.dir(), "analyzer.py"))
	pyArgs := []string{analyzer, wav}
	if s := g.smooth(); s != "" {
		pyArgs = append(pyArgs, "--smooth", s)
	}
	var stdout bytes.Buffer
	if err := runCmd(ctx, py, pyArgs, &stdout); err != nil {
		return nil, fmt.Errorf("pmvhaven: analyzer failed: %w", err)
	}

	// 3. Validate it is a funscript with at least an actions array.
	out := bytes.TrimSpace(stdout.Bytes())
	var probe struct {
		Actions []json.RawMessage `json:"actions"`
	}
	if err := json.Unmarshal(out, &probe); err != nil {
		return nil, fmt.Errorf("pmvhaven: analyzer produced invalid funscript: %w", err)
	}
	return out, nil
}

// resolve calls a provider and falls back to def when it yields "".
func (g *Generator) resolve(p func() string, def string) string {
	if p != nil {
		if v := p(); v != "" {
			return v
		}
	}
	return def
}

// lookExe resolves an executable name to a path exec will accept.
//
// Go refuses to run a name that PATH resolved relative to the working directory
// (exec.ErrDot, a security measure against a hijacked cwd). On Windows the
// working directory is always searched, and stash's own directory typically
// holds ffmpeg.exe — so a bare "ffmpeg" would resolve there and then be
// rejected, which is not what the user means by "the ffmpeg next to stash".
// Absolutise that case; leave every other lookup failure to exec, whose error
// ("executable file not found in %PATH%") is the clearer one to report.
func lookExe(name string) string {
	path, err := exec.LookPath(name)
	if errors.Is(err, exec.ErrDot) {
		if abs, absErr := filepath.Abs(path); absErr == nil {
			return abs
		}
	}
	if err != nil {
		return name
	}
	return path
}

// runCmd runs an external command with the given context. stdout, when non-nil,
// captures the command's standard output; stderr is folded into the error.
func runCmd(ctx context.Context, name string, args []string, stdout *bytes.Buffer) error {
	// A generous ceiling so a wedged ffmpeg/python can't pin a request forever.
	cctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(cctx, lookExe(name), args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if stdout != nil {
		cmd.Stdout = stdout
	}
	if err := cmd.Run(); err != nil {
		msg := bytes.TrimSpace(stderr.Bytes())
		if len(msg) > 600 {
			msg = msg[len(msg)-600:]
		}
		return fmt.Errorf("%v: %s", err, msg)
	}
	return nil
}

// sanitize strips path separators from an id so it is safe in a temp filename.
func sanitize(id string) string {
	repl := func(r rune) rune {
		switch r {
		case '/', '\\', ':', '.', ' ':
			return '_'
		}
		return r
	}
	return mapString(repl, id)
}

func mapString(f func(rune) rune, s string) string {
	b := make([]rune, 0, len(s))
	for _, r := range s {
		b = append(b, f(r))
	}
	return string(b)
}
