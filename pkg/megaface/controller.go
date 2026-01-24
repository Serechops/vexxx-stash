package megaface

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

// Controller manages MegaFace Python client interactions.
type Controller struct {
	pythonPath string
	scriptPath string
	tempDir    string
}

// NewController creates a new MegaFace controller.
func NewController(pythonPath string, tempDir string) *Controller {
	// Find the python script - check environment variable first (for Docker)
	var scriptPath string

	if envPath := os.Getenv("STASH_MEGAFACE_SCRIPT"); envPath != "" {
		if _, err := os.Stat(envPath); err == nil {
			scriptPath = envPath
			logger.Debugf("MegaFace: Using script from env var: %s", scriptPath)
		}
	}

	if scriptPath == "" {
		wd, _ := os.Getwd()
		// Get executable directory for native builds
		exePath, _ := os.Executable()
		exeDir := filepath.Dir(exePath)

		searchPaths := []string{
			// Native build: python-services folder next to executable
			filepath.Join(exeDir, "python-services", "megaface", "client.py"),
			// Development paths
			filepath.Join(wd, "pkg", "megaface", "client.py"),
			filepath.Join(wd, "..", "pkg", "megaface", "client.py"),
			filepath.Join(wd, "..", "..", "pkg", "megaface", "client.py"),
			// Docker path
			"/usr/lib/stash/megaface/client.py",
		}

		for _, p := range searchPaths {
			if _, err := os.Stat(p); err == nil {
				scriptPath = p
				break
			}
		}

		if scriptPath == "" {
			scriptPath = filepath.Join(wd, "pkg", "megaface", "client.py")
			logger.Warnf("MegaFace: client.py not found in search paths, defaulting to %s", scriptPath)
		} else {
			logger.Debugf("MegaFace: Found client.py at %s", scriptPath)
		}
	}

	return &Controller{
		pythonPath: pythonPath,
		scriptPath: scriptPath,
		tempDir:    tempDir,
	}
}

// GetTempDir returns the temporary directory for MegaFace operations.
func (c *Controller) GetTempDir() string {
	return c.tempDir
}

// StatusResponse represents the MegaFace status response.
type StatusResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

// IdentifyRequest is the request for identifying performers.
type IdentifyRequest struct {
	ImagePath string `json:"image_path"`
}

// IdentifyResponse is the response from MegaFace identify.
type IdentifyResponse struct {
	Success bool   `json:"success"`
	Result  string `json:"result,omitempty"` // HTML output from MegaFace
	Error   string `json:"error,omitempty"`
}

// Status checks if the MegaFace client is available.
func (c *Controller) Status(ctx context.Context) (*StatusResponse, error) {
	resultJSON, err := c.runPythonScript(ctx, "status", "")
	if err != nil {
		return &StatusResponse{
			Status:  "error",
			Message: err.Error(),
		}, nil
	}

	var resp StatusResponse
	if err := json.Unmarshal([]byte(resultJSON), &resp); err != nil {
		return nil, fmt.Errorf("failed to parse status response: %w", err)
	}

	return &resp, nil
}

// Identify identifies performers in an image using MegaFace.
func (c *Controller) Identify(ctx context.Context, req IdentifyRequest) (*IdentifyResponse, error) {
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
	if err := json.Unmarshal([]byte(resultJSON), &resp); err != nil {
		return nil, fmt.Errorf("failed to parse identify response: %w", err)
	}

	return &resp, nil
}

// runPythonScript executes the Python client script with the given command and input.
func (c *Controller) runPythonScript(ctx context.Context, command string, inputJSON string) (string, error) {
	cmd := exec.CommandContext(ctx, c.pythonPath, c.scriptPath, command)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return "", fmt.Errorf("failed to create stdin pipe: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("failed to start python script: %w", err)
	}

	// Write input to stdin
	if inputJSON != "" {
		_, _ = stdin.Write([]byte(inputJSON))
	}
	stdin.Close()

	// Read stdout
	outputBytes, err := io.ReadAll(stdout)
	if err != nil {
		return "", fmt.Errorf("failed to read stdout: %w", err)
	}

	// Read stderr for logging
	stderrBytes, _ := io.ReadAll(stderr)
	if len(stderrBytes) > 0 {
		logger.Debugf("MegaFace Python stderr: %s", string(stderrBytes))
	}

	if err := cmd.Wait(); err != nil {
		return "", fmt.Errorf("python script failed: %w, stderr: %s", err, string(stderrBytes))
	}

	return string(outputBytes), nil
}
