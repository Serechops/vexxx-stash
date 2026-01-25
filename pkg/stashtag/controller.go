package stashtag

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/stashapp/stash/pkg/logger"
)

type Controller struct {
	pythonPath string
	scriptPath string
	tempDir    string
}

func NewController(pythonPath string, tempDir string) *Controller {
	// Find the python script - check environment variable first (for Docker)
	var scriptPath string

	if envPath := os.Getenv("STASH_STASHTAG_SCRIPT"); envPath != "" {
		if _, err := os.Stat(envPath); err == nil {
			scriptPath = envPath
			logger.Debugf("StashTag: Using script from env var: %s", scriptPath)
		}
	}

	if scriptPath == "" {
		wd, _ := os.Getwd()
		// Get executable directory for native builds
		exePath, _ := os.Executable()
		exeDir := filepath.Dir(exePath)

		searchPaths := []string{
			// Native build: python-services folder next to executable
			filepath.Join(exeDir, "python-services", "stashtag", "client.py"),
			// Development paths
			filepath.Join(wd, "pkg", "stashtag", "client.py"),
			filepath.Join(wd, "..", "pkg", "stashtag", "client.py"),
			filepath.Join(wd, "..", "..", "pkg", "stashtag", "client.py"),
			// Docker path
			"/usr/lib/stash/stashtag/client.py",
		}

		for _, p := range searchPaths {
			if _, err := os.Stat(p); err == nil {
				scriptPath = p
				break
			}
		}

		if scriptPath == "" {
			scriptPath = filepath.Join(wd, "pkg", "stashtag", "client.py")
			logger.Warnf("StashTag: client.py not found in search paths, defaulting to %s", scriptPath)
		} else {
			logger.Debugf("StashTag: Found client.py at %s", scriptPath)
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

// PredictTagsRequest is the request for predicting tags
type PredictTagsRequest struct {
	ImagePath  string  `json:"image_path"`
	VTTPath    string  `json:"vtt_path,omitempty"`
	VTTContent string  `json:"vtt_content,omitempty"`
	Threshold  float64 `json:"threshold"`
}

// PredictTagsResponse is the response from predict_tags
type PredictTagsResponse struct {
	Success bool            `json:"success"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   string          `json:"error,omitempty"`
}

// PredictMarkersRequest is the request for predicting markers
type PredictMarkersRequest struct {
	ImagePath  string  `json:"image_path"`
	VTTPath    string  `json:"vtt_path,omitempty"`
	VTTContent string  `json:"vtt_content,omitempty"`
	Threshold  float64 `json:"threshold"`
}

// PredictMarkersResponse is the response from predict_markers
type PredictMarkersResponse struct {
	Success bool            `json:"success"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   string          `json:"error,omitempty"`
}

// PredictTags calls the StashTag predict_tags API
func (c *Controller) PredictTags(ctx context.Context, req PredictTagsRequest) (*PredictTagsResponse, error) {
	reqJSON, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	resultJSON, err := c.runPythonScript(ctx, "predict_tags", string(reqJSON))
	if err != nil {
		return &PredictTagsResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	var resp PredictTagsResponse
	if err := json.Unmarshal(resultJSON, &resp); err != nil {
		// If we can't unmarshal into our structure, wrap as raw result
		resp.Success = true
		resp.Result = json.RawMessage(resultJSON)
	}

	return &resp, nil
}

// PredictMarkers calls the StashTag predict_markers API
func (c *Controller) PredictMarkers(ctx context.Context, req PredictMarkersRequest) (*PredictMarkersResponse, error) {
	reqJSON, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	resultJSON, err := c.runPythonScript(ctx, "predict_markers", string(reqJSON))
	if err != nil {
		return &PredictMarkersResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	var resp PredictMarkersResponse
	if err := json.Unmarshal(resultJSON, &resp); err != nil {
		resp.Success = true
		resp.Result = json.RawMessage(resultJSON)
	}

	return &resp, nil
}

// Status checks the availability of the StashTag service
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

func (c *Controller) runPythonScript(ctx context.Context, command string, inputJSON string) ([]byte, error) {
	_ = os.MkdirAll(c.tempDir, 0755)

	args := []string{c.scriptPath, command}
	cmd := exec.CommandContext(ctx, c.pythonPath, args...)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	cmd.Stderr = os.Stderr

	go func() {
		defer stdin.Close()
		_, _ = io.WriteString(stdin, inputJSON)
	}()

	output, err := cmd.Output()
	if err != nil {
		logger.Errorf("StashTag python script error: %v", err)
		return nil, fmt.Errorf("execution failed: %w", err)
	}

	logger.Infof("StashTag: Python script completed. Output len: %d", len(output))
	if len(output) > 0 {
		logger.Debugf("StashTag: Python output: %s", string(output))
	} else {
		logger.Warn("StashTag: Python script returned EMPTY output")
	}

	return output, nil
}
