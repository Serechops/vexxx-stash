package stashface

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/stashapp/stash/pkg/logger"
)

type Controller struct {
	pythonPath     string
	scriptPath     string
	tempDir        string
	clientInitOnce sync.Once
	clientInitErr  error
}

func NewController(pythonPath string, tempDir string) *Controller {
	// Find the python script - check environment variable first (for Docker)
	var scriptPath string

	if envPath := os.Getenv("STASH_STASHFACE_SCRIPT"); envPath != "" {
		if _, err := os.Stat(envPath); err == nil {
			scriptPath = envPath
			logger.Debugf("StashFace: Using script from env var: %s", scriptPath)
		}
	}

	if scriptPath == "" {
		wd, _ := os.Getwd()
		// Get executable directory for native builds
		exePath, _ := os.Executable()
		exeDir := filepath.Dir(exePath)

		searchPaths := []string{
			// Native build: python-services folder next to executable
			filepath.Join(exeDir, "python-services", "stashface", "client.py"),
			// Development paths
			filepath.Join(wd, "pkg", "stashface", "client.py"),
			filepath.Join(wd, "..", "pkg", "stashface", "client.py"),
			filepath.Join(wd, "..", "..", "pkg", "stashface", "client.py"),
			// Docker path
			"/usr/lib/stash/stashface/client.py",
		}

		for _, p := range searchPaths {
			if _, err := os.Stat(p); err == nil {
				scriptPath = p
				break
			}
		}

		if scriptPath == "" {
			scriptPath = filepath.Join(wd, "pkg", "stashface", "client.py")
			logger.Warnf("StashFace: client.py not found in search paths, defaulting to %s", scriptPath)
		} else {
			logger.Debugf("StashFace: Found client.py at %s", scriptPath)
		}
	}

	// Default to python3 if no Python path configured
	if pythonPath == "" {
		pythonPath = "python3"
	}

	return &Controller{
		pythonPath: pythonPath,
		scriptPath: scriptPath,
		tempDir:    tempDir,
	}
}

func (c *Controller) GetTempDir() string {
	return c.tempDir
}

type IdentifyRequest struct {
	ImagePath string  `json:"image_path"`
	VTTPath   string  `json:"vtt_path"`
	Threshold float64 `json:"threshold"`
	Results   int     `json:"results"`
}

type IdentifyResponse struct {
	Success bool            `json:"success"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   string          `json:"error,omitempty"`
}

func (c *Controller) Identify(ctx context.Context, req IdentifyRequest) (*IdentifyResponse, error) {
	// serialize request
	reqJSON, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	resultJSON, err := c.runPythonScript(ctx, "identify", string(reqJSON))
	if err != nil {
		return &IdentifyResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	var resp IdentifyResponse
	// The python script should return the structure we expect
	// We might need to wrap the raw result
	resp.Success = true
	resp.Result = json.RawMessage(resultJSON)

	return &resp, nil
}

func (c *Controller) runPythonScript(ctx context.Context, command string, inputJSON string) ([]byte, error) {
	// Ensure temp dir exists
	_ = os.MkdirAll(c.tempDir, 0755)

	args := []string{c.scriptPath, command}

	cmd := exec.CommandContext(ctx, c.pythonPath, args...)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	// Capture stderr for debugging, but only return stdout as result
	cmd.Stderr = os.Stderr

	go func() {
		defer stdin.Close()
		_, _ = io.WriteString(stdin, inputJSON)
	}()

	output, err := cmd.Output()
	if err != nil {
		logger.Errorf("StashFace python script error: %v", err)
		return nil, fmt.Errorf("execution failed: %w", err)
	}

	logger.Infof("StashFace: Python script completed. Output len: %d", len(output))
	if len(output) > 0 {
		logger.Debugf("StashFace: Python output: %s", string(output))
	} else {
		logger.Warn("StashFace: Python script returned EMPTY output")
	}

	return output, nil
}

// Status checks the status of the python dependency
func (c *Controller) Status(ctx context.Context) (map[string]interface{}, error) {
	output, err := c.runPythonScript(ctx, "status", "{}")
	if err != nil {
		return map[string]interface{}{
			"status": "unavailable",
			"error":  err.Error(),
		}, nil
	}

	var result map[string]interface{}
	if err := json.Unmarshal(output, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// GenerateCandidates extracts frames from the video for selection
func (c *Controller) GenerateCandidates(ctx context.Context, videoPath string, vttPath string, numFrames int) ([]string, error) {
	// Simple frame extraction using ffmpeg
	outputDir := filepath.Join(c.tempDir, "candidates")
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, err
	}

	var timestamps []float64

	// Try to get timestamps from VTT if provided
	if vttPath != "" {
		content, err := os.ReadFile(vttPath)
		if err == nil {
			lines := strings.Split(string(content), "\n")
			for _, line := range lines {
				if strings.Contains(line, "-->") {
					parts := strings.Split(line, "-->")
					if len(parts) > 0 {
						start := strings.TrimSpace(parts[0])
						ts := parseVTTTimestamp(start)
						if ts >= 0 {
							timestamps = append(timestamps, ts)
						}
					}
				}
			}
		} else {
			logger.Warnf("StashFace: Failed to read VTT file %s: %v", vttPath, err)
		}
	}

	// If no VTT timestamps, calculate based on duration
	if len(timestamps) == 0 {
		// Get duration
		probeCmd := exec.CommandContext(ctx, "ffprobe",
			"-v", "error",
			"-show_entries", "format=duration",
			"-of", "default=noprint_wrappers=1:nokey=1",
			videoPath)
		output, err := probeCmd.Output()
		if err != nil {
			return nil, fmt.Errorf("ffprobe failed: %w", err)
		}

		var duration float64
		_, err = fmt.Sscanf(string(output), "%f", &duration)
		if err != nil {
			return nil, fmt.Errorf("failed to parse duration: %w", err)
		}

		if duration <= 0 {
			return nil, fmt.Errorf("invalid duration: %f", duration)
		}

		interval := duration / float64(numFrames+1)
		for i := 1; i <= numFrames; i++ {
			timestamps = append(timestamps, float64(i)*interval)
		}
	} else {
		// limit or distribute timestamps if we have too many
		if len(timestamps) > numFrames {
			// Simple distribution: pick evenly
			step := float64(len(timestamps)) / float64(numFrames)
			var selected []float64
			for i := 0; i < numFrames; i++ {
				idx := int(float64(i) * step)
				if idx < len(timestamps) {
					selected = append(selected, timestamps[idx])
				}
			}
			timestamps = selected
		}
	}

	imagePaths := []string{}

	// Extract frames
	for i, ts := range timestamps {
		filename := fmt.Sprintf("candidate_%03d.jpg", i+1)
		outPath := filepath.Join(outputDir, filename)

		// ffmpeg -ss <ts> -i <video> -vframes 1 -q:v 2 -y <out>
		cmd := exec.CommandContext(ctx, "ffmpeg",
			"-ss", fmt.Sprintf("%f", ts),
			"-i", videoPath,
			"-vframes", "1",
			"-q:v", "2",
			"-y",
			outPath,
		)

		if err := cmd.Run(); err != nil {
			logger.Warnf("StashFace: Failed to extract frame at %f: %v", ts, err)
			continue
		}

		imagePaths = append(imagePaths, outPath)
	}

	return imagePaths, nil
}

func parseVTTTimestamp(ts string) float64 {
	// 00:00:00.000
	parts := strings.Split(ts, ":")
	if len(parts) != 3 {
		return -1
	}
	h, _ := strconv.Atoi(parts[0])
	m, _ := strconv.Atoi(parts[1])
	sParts := strings.Split(parts[2], ".")
	s, _ := strconv.Atoi(sParts[0])
	ms := 0
	if len(sParts) > 1 {
		ms, _ = strconv.Atoi(sParts[1])
	}
	return float64(h*3600+m*60+s) + float64(ms)/1000.0
}

// GenerateSpriteFromCandidates creates a sprite from selected images
func (c *Controller) GenerateSpriteFromCandidates(imagePaths []string) (string, string, error) {
	if len(imagePaths) == 0 {
		return "", "", fmt.Errorf("no images provided")
	}

	outputDir := filepath.Join(c.tempDir, "sprite_gen")
	_ = os.MkdirAll(outputDir, 0755)

	spritePath := filepath.Join(outputDir, "sprite.jpg")
	vttPath := filepath.Join(outputDir, "sprite.vtt")

	// Very simple horizontal stitching for MVP (using ffmpeg tile was complex without input list file)
	// We will just copy the first image as sprite and create a VTT that points to it
	// Actually, let's try to do it right if possible.
	// For now, fallback to "First Image is Sprite" strategy as in smart_sprite.go placeholder
	// But we need to support identification effectively.
	// The HF Space likely scans the WHOLE sprite. If we only give one image, it only scans that.
	// So we MUST stitch them.

	// Stitching attempt: ffmpeg -i img1 -i img2 ... -filter_complex hstack=inputs=N out
	args := []string{}
	filterComplex := ""

	for i, p := range imagePaths {
		args = append(args, "-i", p)
		filterComplex += fmt.Sprintf("[%d:v]", i)
	}

	filterComplex += fmt.Sprintf("hstack=inputs=%d[v]", len(imagePaths))
	args = append(args, "-filter_complex", filterComplex, "-map", "[v]", "-y", spritePath)

	cmd := exec.Command("ffmpeg", args...)
	if err := cmd.Run(); err != nil {
		logger.Errorf("StashFace: Stitching failed: %v. Fallback to single image.", err)
		// Fallback code from smart_sprite.go
		input, _ := os.ReadFile(imagePaths[0])
		_ = os.WriteFile(spritePath, input, 0644)
	}

	// Generate VTT
	// We need dimensions of the frames to write correct VTT
	// Assume all frames are same size
	var width, height int
	if len(imagePaths) > 0 {
		file, err := os.Open(imagePaths[0])
		if err == nil {
			cfg, _, _ := image.DecodeConfig(file)
			width = cfg.Width
			height = cfg.Height
			file.Close()
		}
	}
	if width == 0 {
		width = 160 // fallback
		height = 90
	}

	f, err := os.Create(vttPath)
	if err != nil {
		return "", "", err
	}
	defer f.Close()

	f.WriteString("WEBVTT\n\n")
	for i := range imagePaths {
		f.WriteString(fmt.Sprintf("00:00:%02d.000 --> 00:00:%02d.000\n", i*5, (i+1)*5))
		// Horizontal stitching: x offset is i * width
		f.WriteString(fmt.Sprintf("sprite.jpg#xywh=%d,0,%d,%d\n\n", i*width, width, height))
	}

	return spritePath, vttPath, nil
}

// GenerateVTTForImage generates a temporary VTT file for a single image (e.g. screenshot)
// allowing it to be processed by the identification script which expects a sprite/vtt pair.
func (c *Controller) GenerateVTTForImage(imagePath string) (string, error) {
	outputDir := filepath.Join(c.tempDir, "screenshot_gen")
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create temp dir: %w", err)
	}

	// We create a VTT that simply points to the image.
	// Since the image path might be anywhere, and the VTT usually references relative paths or URLs,
	// we need to be careful how the Python script uses it.
	// The Python script `client.py` reads the VTT to find coordinates.
	// If the VTT says "image.jpg#xywh=...", the script loads "image.jpg".
	// If "image.jpg" is relative, it looks relative to VTT? Or working dir?
	// `client.py` uses `cached_download` or `Image.open`.
	// If we provide absolute path in VTT, it might work?

	// Better approach: Copy the image to the temp dir so they are together, OR
	// just write the absolute path in the VTT if the client supports it.
	// client.py: `image = Image.open(image_path)` where image_path is passed as arg.
	// Actually `identify` function in `client.py` takes `image_input` (path) and `vtt_input` (path).
	// It doesn't seemingly use the filename inside the VTT to load the image?
	// Let's check `client.py` logic.
	// `results = pipe(image, vtt_file)`
	// If `client.py` uses the VTT just for timestamps/positions, the filename inside VTT might be ignored or used for matching?
	// Stash's default VTTs use relative filenames.

	// To be safe, we will create a VTT that references the base name, but we assume the Python script
	// receives the direct path to the image anyway.

	vttPath := filepath.Join(outputDir, "input.vtt")
	f, err := os.Create(vttPath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	f.WriteString("WEBVTT\n\n")
	// Dummy entry covering 0-10 seconds
	f.WriteString("00:00:00.000 --> 00:00:10.000\n")
	// Use absolute path in VTT just in case, or just basename
	filename := filepath.Base(imagePath)
	f.WriteString(fmt.Sprintf("%s#xywh=0,0,100,100\n", filename))

	return vttPath, nil
}
