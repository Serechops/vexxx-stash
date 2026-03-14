package main

import (
	"bufio"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/stashapp/stash/internal/manager/config"
)

// ---------------------------------------------------------------------------
// PYTHON
// ---------------------------------------------------------------------------

func checkPython(cfg *config.Config) []CheckResult {
	const sec = "PYTHON"

	candidates := []string{"python3", "python"}
	configured := cfg.GetPythonPath()
	if configured != "" {
		candidates = append([]string{configured}, candidates...)
	}

	for _, candidate := range candidates {
		out, err := exec.Command(candidate, "--version").Output()
		if err == nil {
			ver := strings.TrimSpace(string(out))
			label := candidate
			if candidate == configured {
				label = "configured"
			}
			return []CheckResult{ok(sec, label, ver)}
		}
	}

	if configured != "" {
		return []CheckResult{errResult(sec, "python", fmt.Sprintf("not found at configured path %q or in PATH — plugins requiring Python will fail", configured))}
	}
	return []CheckResult{warn(sec, "python", "python3/python not found in PATH — plugins requiring Python will fail")}
}

// ---------------------------------------------------------------------------
// LOG FILE
// ---------------------------------------------------------------------------

const logTailLines = 50 // lines to scan from end of log
const logMaxErrors = 10 // max error/warn entries to surface

func checkLogFile(cfg *config.Config) []CheckResult {
	const sec = "LOG"

	logFile := cfg.GetLogFile()
	if logFile == "" {
		return []CheckResult{ok(sec, "log_file", "not configured (logging to stdout only)")}
	}

	info, err := os.Stat(logFile)
	if err != nil {
		if os.IsNotExist(err) {
			return []CheckResult{warn(sec, "log_file", fmt.Sprintf("file not found: %s", logFile))}
		}
		return []CheckResult{errResult(sec, "log_file", fmt.Sprintf("cannot stat: %v", err))}
	}

	results := []CheckResult{ok(sec, "log_file", fmt.Sprintf("%s (%s)", logFile, formatBytes(uint64(info.Size()))))}

	f, err := os.Open(logFile)
	if err != nil {
		return append(results, warn(sec, "log_tail", fmt.Sprintf("cannot read: %v", err)))
	}
	defer f.Close()

	// Collect last logTailLines lines via a ring buffer
	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
		if len(lines) > logTailLines {
			lines = lines[1:]
		}
	}

	var issues []string
	for _, l := range lines {
		upper := strings.ToUpper(l)
		if strings.Contains(upper, "ERROR") || strings.Contains(upper, "FATAL") {
			issues = append(issues, l)
		}
	}

	if len(issues) == 0 {
		results = append(results, ok(sec, "log_tail", fmt.Sprintf("no errors in last %d lines", len(lines))))
	} else {
		shown := issues
		extra := 0
		if len(shown) > logMaxErrors {
			extra = len(shown) - logMaxErrors
			shown = shown[:logMaxErrors]
		}
		detail := strings.Join(shown, "\n")
		if extra > 0 {
			detail += fmt.Sprintf("\n  … and %d more", extra)
		}
		results = append(results, withDetail(
			warn(sec, "log_tail", fmt.Sprintf("%d error/fatal line(s) in last %d log lines", len(issues), len(lines))),
			detail,
		))
	}

	return results
}

// ---------------------------------------------------------------------------
// CONFIG FILE PERMISSIONS
// ---------------------------------------------------------------------------

func checkConfigPermissions(cfg *config.Config) []CheckResult {
	const sec = "CONFIG"

	cf := cfg.GetConfigFile()
	if cf == "" {
		return nil
	}

	info, err := os.Stat(cf)
	if err != nil {
		return []CheckResult{errResult(sec, "file_perms", fmt.Sprintf("cannot stat %s: %v", cf, err))}
	}

	// On Windows, os.FileMode permission bits are not reliable — skip the check.
	if runtime.GOOS == "windows" {
		return []CheckResult{ok(sec, "file_perms", fmt.Sprintf("(Windows — ACL not checked) %s", cf))}
	}

	mode := info.Mode().Perm()
	// Warn if group-readable (040) or world-readable (004) since config contains API keys/password hash.
	if mode&0o004 != 0 || mode&0o040 != 0 {
		return []CheckResult{withDetail(
			warn(sec, "file_perms", fmt.Sprintf("%s is readable by group/others (mode %04o) — contains API keys", cf, mode)),
			"Fix: chmod 600 "+cf,
		)}
	}

	return []CheckResult{ok(sec, "file_perms", fmt.Sprintf("mode %04o — not world/group readable", mode))}
}

// ---------------------------------------------------------------------------
// STASH-BOX + PACKAGE SOURCE CONNECTIVITY
// ---------------------------------------------------------------------------

func checkConnectivity(cfg *config.Config) []CheckResult {
	const sec = "CONNECTIVITY"
	var results []CheckResult

	client := &http.Client{Timeout: 8 * time.Second}

	headCheck := func(label, rawURL string) CheckResult {
		if rawURL == "" {
			return warn(sec, label, "URL not configured")
		}
		resp, err := client.Head(rawURL)
		if err != nil {
			return errResult(sec, label, fmt.Sprintf("%s: %v", rawURL, err))
		}
		resp.Body.Close()
		if resp.StatusCode >= 500 {
			return warn(sec, label, fmt.Sprintf("%s  HTTP %d", rawURL, resp.StatusCode))
		}
		return ok(sec, label, fmt.Sprintf("%s  HTTP %d", rawURL, resp.StatusCode))
	}

	// Stash-box endpoints
	for _, sb := range cfg.GetStashBoxes() {
		label := sb.Name
		if label == "" {
			label = "stash-box"
		}
		results = append(results, headCheck(label, sb.Endpoint))
	}

	// Plugin package sources
	for _, src := range cfg.GetPluginPackageSources() {
		label := "plugins/community"
		if src.Name != nil && *src.Name != "" {
			label = "plugins/" + *src.Name
		}
		results = append(results, headCheck(label, src.URL))
	}

	// Scraper package sources
	for _, src := range cfg.GetScraperPackageSources() {
		label := "scrapers/community"
		if src.Name != nil && *src.Name != "" {
			label = "scrapers/" + *src.Name
		}
		results = append(results, headCheck(label, src.URL))
	}

	if len(results) == 0 {
		results = append(results, ok(sec, "endpoints", "no stash-box or package sources configured"))
	}

	return results
}

// ---------------------------------------------------------------------------
// PROCESS CHECK
// ---------------------------------------------------------------------------

func checkProcess(cfg *config.Config) []CheckResult {
	const sec = "PROCESS"

	port := cfg.GetPort()
	names := []string{"stash", "stash.exe"}

	switch runtime.GOOS {
	case "windows":
		return checkProcessWindows(sec, port, names)
	default:
		return checkProcessUnix(sec, port, names)
	}
}

func checkProcessWindows(sec string, port int, names []string) []CheckResult {
	out, err := exec.Command("tasklist", "/FO", "CSV", "/NH").Output()
	if err != nil {
		return []CheckResult{warn(sec, "process", fmt.Sprintf("tasklist failed: %v", err))}
	}

	text := strings.ToLower(string(out))
	for _, name := range names {
		if strings.Contains(text, strings.ToLower(name)) {
			// Also try to grab the PID via netstat
			if pid, laddr := netstatPID(port); pid != "" {
				return []CheckResult{ok(sec, "process", fmt.Sprintf("%s is running (PID %s, listening on %s)", name, pid, laddr))}
			}
			return []CheckResult{ok(sec, "process", fmt.Sprintf("%s is running (found in tasklist)", name))}
		}
	}

	return []CheckResult{warn(sec, "process", "stash process not found in tasklist")}
}

// netstatPID tries netstat -ano to find the PID listening on port.
func netstatPID(port int) (pid, laddr string) {
	out, err := exec.Command("netstat", "-ano").Output()
	if err != nil {
		return "", ""
	}
	portStr := fmt.Sprintf(":%d ", port)
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "LISTENING") && strings.Contains(line, portStr) {
			fields := strings.Fields(line)
			if len(fields) >= 5 {
				return fields[4], fields[1]
			}
		}
	}
	return "", ""
}

func checkProcessUnix(sec string, port int, names []string) []CheckResult {
	// Try pgrep first
	for _, name := range names {
		out, err := exec.Command("pgrep", "-x", name).Output()
		if err == nil {
			pids := strings.TrimSpace(string(out))
			if pids != "" {
				return []CheckResult{ok(sec, "process", fmt.Sprintf("%s running (PID %s)", name, strings.ReplaceAll(pids, "\n", ",")))}
			}
		}
	}

	// Fall back to ss/lsof port-based detection
	portStr := fmt.Sprintf(":%d", port)
	if out, err := exec.Command("ss", "-tlnp").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			if strings.Contains(line, portStr) {
				return []CheckResult{ok(sec, "process", fmt.Sprintf("process listening on port %d (ss): %s", port, strings.TrimSpace(line)))}
			}
		}
	}

	return []CheckResult{warn(sec, "process", "stash process not detected (pgrep/ss found nothing)")}
}
