// stash-diag is a standalone diagnostic tool for the Vexxx/Stash installation.
// It checks configuration, paths, FFmpeg, database schema, plugins, scrapers,
// and (optionally) a running Stash instance via its GraphQL API.
//
// Usage:
//
//	stash-diag [--config PATH] [--url URL] [--api-key KEY] [--json] [--verbose]
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	flag "github.com/spf13/pflag"
	"github.com/stashapp/stash/internal/build"
	"github.com/stashapp/stash/internal/manager/config"
)

// Status represents the result severity of a single check.
type Status int

const (
	StatusOK    Status = iota // 0 — all good
	StatusWarn                // 1 — non-fatal issue
	StatusError               // 2 — critical problem
)

func (s Status) String() string {
	switch s {
	case StatusOK:
		return "OK"
	case StatusWarn:
		return "WARN"
	default:
		return "ERROR"
	}
}

func (s Status) MarshalJSON() ([]byte, error) {
	return json.Marshal(s.String())
}

func (s Status) symbol() string {
	switch s {
	case StatusOK:
		return "✓"
	case StatusWarn:
		return "⚠"
	default:
		return "✗"
	}
}

// CheckResult holds the outcome of a single diagnostic check.
type CheckResult struct {
	Section string `json:"section"`
	Name    string `json:"name"`
	Status  Status `json:"status"`
	Message string `json:"message"`
	Detail  string `json:"detail,omitempty"`
}

func ok(section, name, message string) CheckResult {
	return CheckResult{Section: section, Name: name, Status: StatusOK, Message: message}
}

func warn(section, name, message string) CheckResult {
	return CheckResult{Section: section, Name: name, Status: StatusWarn, Message: message}
}

func errResult(section, name, message string) CheckResult {
	return CheckResult{Section: section, Name: name, Status: StatusError, Message: message}
}

func withDetail(r CheckResult, detail string) CheckResult {
	r.Detail = detail
	return r
}

// DiagReport is the top-level JSON structure.
type DiagReport struct {
	GeneratedAt string        `json:"generated_at"`
	Version     string        `json:"version"`
	Results     []CheckResult `json:"results"`
	Summary     diagSummary   `json:"summary"`
}

type diagSummary struct {
	OK     int `json:"ok"`
	Warns  int `json:"warnings"`
	Errors int `json:"errors"`
}

var (
	flagURL     string
	flagJSON    bool
	flagVerbose bool
	flagAPIKey  string
	flagNoTUI   bool
)

func init() {
	// --config / -c is already registered by the config package's own init().
	flag.StringVar(&flagURL, "url", "", "URL of a running Stash instance for online checks (e.g. http://localhost:9999)")
	flag.BoolVar(&flagJSON, "json", false, "Output results as JSON instead of text")
	flag.BoolVar(&flagVerbose, "verbose", false, "Show additional detail in text output")
	flag.StringVar(&flagAPIKey, "api-key", "", "API key for authenticating with Stash (online mode)")
	flag.BoolVar(&flagNoTUI, "no-tui", false, "Disable the interactive TUI and print plain text output")
}

func main() {
	// logger.Logger is intentionally left nil so that internal package log
	// messages don't pollute our clean diagnostic output.

	flag.Parse()

	var report DiagReport

	switch {
	case flagJSON || flagNoTUI:
		// Non-interactive: run checks inline and emit text or JSON.
		results := runAllChecks("", flagURL, flagAPIKey)
		report = buildReport(results)
		if flagJSON {
			enc := json.NewEncoder(os.Stdout)
			enc.SetIndent("", "  ")
			_ = enc.Encode(report)
		} else {
			printReport(report)
		}
	default:
		// Interactive TUI (default).
		report = runTUI("", flagURL, flagAPIKey)
	}

	// Exit code reflects the worst-case status across all checks.
	for _, r := range report.Results {
		if r.Status == StatusError {
			os.Exit(2)
		}
	}
	for _, r := range report.Results {
		if r.Status == StatusWarn {
			os.Exit(1)
		}
	}
}

// runAllChecks executes every offline (and optionally online) check and returns
// the flat slice of results. configArg is ignored here — the config package
// already picked up the --config flag via its own pflag registration in init().
func runAllChecks(configArg, urlArg, apiKeyArg string) []CheckResult {
	_ = configArg // consumed by config.Initialize() via pflag

	var results []CheckResult

	cfg, err := config.Initialize()
	if err != nil {
		results = append(results, errResult("CONFIG", "initialization", err.Error()))
		if urlArg != "" {
			results = append(results, checkOnline(urlArg, apiKeyArg)...)
		}
		return results
	}

	if cfg.IsNewSystem() {
		results = append(results, withDetail(
			warn("CONFIG", "configuration", "no config file found — running as a new system"),
			"Use --config to specify the path, or set STASH_CONFIG_FILE environment variable",
		))
	} else {
		results = append(results, ok("CONFIG", "configuration", cfg.GetConfigFile()))
	}

	results = append(results, checkPaths(cfg)...)
	results = append(results, checkFFmpeg(cfg)...)
	results = append(results, checkDatabase(cfg)...)
	results = append(results, checkPlugins(cfg)...)
	results = append(results, checkScrapers(cfg)...)
	results = append(results, checkNetwork(cfg)...)
	results = append(results, checkPermissions(cfg)...)
	results = append(results, checkPython(cfg)...)
	results = append(results, checkLogFile(cfg)...)
	results = append(results, checkConfigPermissions(cfg)...)
	results = append(results, checkConnectivity(cfg)...)
	results = append(results, checkProcess(cfg)...)

	if urlArg != "" {
		results = append(results, checkOnline(urlArg, apiKeyArg)...)
	}

	return results
}

func buildReport(results []CheckResult) DiagReport {
	s := diagSummary{}
	for _, r := range results {
		switch r.Status {
		case StatusOK:
			s.OK++
		case StatusWarn:
			s.Warns++
		case StatusError:
			s.Errors++
		}
	}
	return DiagReport{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Version:     build.VersionString(),
		Results:     results,
		Summary:     s,
	}
}

func printReport(report DiagReport) {
	header := fmt.Sprintf("Stash Diagnostic Report — %s — %s", report.Version, report.GeneratedAt)
	fmt.Println(header)
	fmt.Println(strings.Repeat("=", len(header)))

	currentSection := ""
	for _, r := range report.Results {
		if r.Section != currentSection {
			currentSection = r.Section
			fmt.Printf("\n[%s]\n", currentSection)
		}
		if r.Detail != "" && flagVerbose {
			fmt.Printf("  %s  %-24s %s\n     %s%s\n",
				r.Status.symbol(), r.Name, r.Message,
				dim, r.Detail+reset)
		} else {
			fmt.Printf("  %s  %-24s %s\n", r.Status.symbol(), r.Name, r.Message)
		}
	}

	fmt.Printf("\nSummary: %d OK  %d warning(s)  %d error(s)\n",
		report.Summary.OK, report.Summary.Warns, report.Summary.Errors)
}

// ANSI escape codes for muted detail text (gracefully ignored on terminals that
// don't support them — the string is still readable).
const (
	dim   = "\033[2m"
	reset = "\033[0m"
)
