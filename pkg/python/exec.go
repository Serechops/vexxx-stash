// Package python provides utilities for working with the python executable.
package python

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	stashExec "github.com/stashapp/stash/pkg/exec"
	"github.com/stashapp/stash/pkg/fsutil"
	"github.com/stashapp/stash/pkg/logger"
)

type Python string

func (p *Python) Command(ctx context.Context, args []string) *exec.Cmd {
	return stashExec.CommandContext(ctx, string(*p), args...)
}

// New returns a new Python instance at the given path.
func New(path string) *Python {
	ret := Python(path)
	return &ret
}

// Resolve tries to find the python executable in the system.
// It first checks for python3, then python.
// Returns nil and an exec.ErrNotFound error if not found.
func Resolve(configuredPythonPath string) (*Python, error) {
	if configuredPythonPath != "" {
		isFile, err := fsutil.FileExists(configuredPythonPath)
		switch {
		case err == nil && isFile:
			logger.Tracef("using configured python path: %s", configuredPythonPath)
			return New(configuredPythonPath), nil
		case err == nil && !isFile:
			logger.Warnf("configured python path is not a file: %s", configuredPythonPath)
		case err != nil:
			logger.Warnf("unable to use configured python path: %v", err)
		}
	}

	python3, err := exec.LookPath("python3")

	if err != nil {
		python, err := exec.LookPath("python")
		if err != nil {
			return nil, fmt.Errorf("python executable not in PATH: %w", err)
		}
		ret := Python(python)
		return &ret, nil
	}

	ret := Python(python3)
	return &ret, nil
}

// IsPythonCommand returns true if arg is "python" or "python3"
func IsPythonCommand(arg string) bool {
	return arg == "python" || arg == "python3"
}

// PipInstall installs a Python module using pip.
func (p *Python) PipInstall(ctx context.Context, module string) error {
	cmd := p.Command(ctx, []string{"-m", "pip", "install", module})
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("pip install %s failed: %w\nOutput: %s", module, err, string(output))
	}
	logger.Debugf("pip install %s: %s", module, string(output))
	return nil
}

// PipRequirements installs Python dependencies from a requirements.txt file.
// Logs the installed packages for transparency.
func (p *Python) PipRequirements(ctx context.Context, requirementsPath string) error {
	cmd := p.Command(ctx, []string{"-m", "pip", "install", "-r", requirementsPath})
	output, err := cmd.CombinedOutput()
	outputStr := string(output)
	if err != nil {
		return fmt.Errorf("pip install -r %s failed: %w\nOutput: %s", requirementsPath, err, outputStr)
	}

	// Log which packages were installed
	for _, line := range splitLines(outputStr) {
		if len(line) > 0 {
			// Log lines that indicate successful installation
			if contains(line, "Successfully installed") ||
				contains(line, "Requirement already satisfied") {
				logger.Infof("[pip] %s", line)
			}
		}
	}

	return nil
}

// splitLines splits a string into lines
func splitLines(s string) []string {
	var lines []string
	var current string
	for _, r := range s {
		if r == '\n' {
			lines = append(lines, current)
			current = ""
		} else if r != '\r' {
			current += string(r)
		}
	}
	if current != "" {
		lines = append(lines, current)
	}
	return lines
}

// contains checks if substr is in s
func contains(s, substr string) bool {
	return len(s) >= len(substr) && findSubstr(s, substr)
}

func findSubstr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// CheckAndInstallRequirements checks for collisions before installing from requirements.txt.
// Use this for plugins to verify we aren't overwriting existing major dependencies.
func (p *Python) CheckAndInstallRequirements(ctx context.Context, requirementsPath string) error {
	// 1. Script to parse requirements and check against installed packages
	// We use a simple python script to do the parsing to handle case insensitivity and basic versioning
	script := `
import sys
import os
import re

try:
    from importlib.metadata import distributions
    installed = {d.metadata['Name'].lower(): d.version for d in distributions()}
except ImportError:
    # Fallback for older python < 3.8
    import pkg_resources
    installed = {d.project_name.lower(): d.version for d in pkg_resources.working_set}

req_file = sys.argv[1]
to_install = []
skipped = []

# Regex to capture package name from a requirement string
# Handles: requests, requests==1.0, requests>=1.0, etc.
# Does NOT handle git urls or local paths well, but good enough for standard plugins
name_re = re.compile(r'^([a-zA-Z0-9_\-]+)')

with open(req_file, 'r') as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#') or line.startswith('-'):
            continue
        
        match = name_re.match(line)
        if match:
            pkg_name = match.group(1).lower()
            if pkg_name in installed:
                print(f"SKIP:{pkg_name}:{installed[pkg_name]}:{line}")
            else:
                print(f"INSTALL:{line}")
        else:
            print(f"INSTALL:{line}")
`
	args := []string{"-c", script, requirementsPath}
	cmd := p.Command(ctx, args)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("analyzing requirements failed: %w\nOutput: %s", err, string(output))
	}

	var installList []string

	lines := splitLines(string(output))
	for _, l := range lines {
		if contains(l, "SKIP:") {
			parts := strings.Split(l, ":")
			if len(parts) >= 4 {
				// SKIP:pkg_name:installed_ver:req_line
				logger.Warnf("[Collision] Check skipped package '%s' (v%s) requested as '%s'", parts[1], parts[2], parts[3])
			}
		} else if contains(l, "INSTALL:") {
			// INSTALL:line
			req := l[8:] // trim INSTALL:
			installList = append(installList, req)
		}
	}

	if len(installList) == 0 {
		logger.Debug("All requirements already satisfied or skipped due to collision.")
		return nil
	}

	// 2. Install the safe subset
	logger.Infof("Installing %d missing dependencies...", len(installList))
	// pip install pkg1 pkg2 ...
	// Note: We are passing the requirement strings directly to pip install
	pipArgs := append([]string{"-m", "pip", "install"}, installList...)
	installCmd := p.Command(ctx, pipArgs)
	if out, err := installCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("safe install failed: %w\nOutput: %s", err, string(out))
	} else {
		logger.Debugf("Safe install output: %s", string(out))
	}

	return nil
}

// CheckModules checks which of the provided modules are missing from the environment.
// It returns a list of missing module names.
func (p *Python) CheckModules(ctx context.Context, modules []string) ([]string, error) {
	if len(modules) == 0 {
		return nil, nil
	}

	// Python script to check for module existence using importlib
	// We pass modules as arguments
	script := `
import importlib.util
import sys

mods = sys.argv[1:]
missing = []
for m in mods:
	try:
		if importlib.util.find_spec(m) is None:
			missing.append(m)
	except ImportError:
		missing.append(m)
	except Exception:
		# If unknown error (e.g. module name syntax), assume missing or problem
		missing.append(m)

print('\n'.join(missing))
`
	args := append([]string{"-c", script}, modules...)
	cmd := p.Command(ctx, args)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("checking modules failed: %w\nOutput: %s", err, string(output))
	}

	missing := splitLines(string(output))
	// clean up empty lines
	var cleanMissing []string
	for _, m := range missing {
		m = sanitizeModuleName(m)
		if m != "" {
			cleanMissing = append(cleanMissing, m)
		}
	}
	return cleanMissing, nil
}

func sanitizeModuleName(m string) string {
	// Simple cleanup of whitespace/newlines
	var ret []rune
	for _, r := range m {
		if r > 32 { // non-whitespace
			ret = append(ret, r)
		}
	}
	return string(ret)
}
