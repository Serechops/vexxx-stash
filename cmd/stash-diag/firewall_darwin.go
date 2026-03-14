//go:build darwin

package main

import (
	"fmt"
	"os/exec"
	"strings"
)

// checkFirewall checks macOS firewall and socket state for the given port.
func checkFirewall(port int) []CheckResult {
	const sec = "NETWORK"
	portStr := fmt.Sprintf("%d", port)
	var results []CheckResult

	// --- macOS Application Firewall (socketfilterfw) ---
	sfwPath := "/usr/libexec/ApplicationFirewall/socketfilterfw"
	if out, err := exec.Command(sfwPath, "--getglobalstate").Output(); err == nil {
		text := strings.TrimSpace(string(out))
		if strings.Contains(strings.ToLower(text), "disabled") {
			results = append(results, ok(sec, "firewall_appfw", "Application Firewall disabled — no app-level filtering"))
		} else {
			// Check if stash binary has an explicit rule
			if bOut, bErr := exec.Command(sfwPath, "--listapps").Output(); bErr == nil {
				if strings.Contains(string(bOut), "stash") {
					results = append(results, ok(sec, "firewall_appfw", "Application Firewall enabled; stash has a rule"))
				} else {
					results = append(results, warn(sec, "firewall_appfw",
						"Application Firewall enabled; no explicit rule for stash — may prompt on first run"))
				}
			} else {
				results = append(results, warn(sec, "firewall_appfw",
					fmt.Sprintf("Application Firewall enabled (state: %s)", text)))
			}
		}
	}

	// --- Packet Filter (pfctl) ---
	if out, err := exec.Command("pfctl", "-sr").Output(); err == nil {
		if strings.Contains(string(out), portStr) {
			results = append(results, ok(sec, "firewall_pf",
				fmt.Sprintf("pf: rule referencing port %d found", port)))
		} else {
			// pf loaded with no rule for port likely means pass-all or only specific blocks
			results = append(results, ok(sec, "firewall_pf",
				fmt.Sprintf("pf: no explicit rule for port %d (pass-all or allowlist model)", port)))
		}
	}

	// --- lsof: is anything actually listening on this port? ---
	if out, err := exec.Command("lsof", "-iTCP:"+portStr, "-sTCP:LISTEN", "-n", "-P").Output(); err == nil {
		lines := strings.TrimSpace(string(out))
		if lines != "" {
			// First line is header, subsequent lines are processes
			procs := strings.Split(lines, "\n")
			if len(procs) > 1 {
				results = append(results, ok(sec, "port_listen",
					fmt.Sprintf("port %d is held by: %s", port, strings.TrimSpace(procs[1]))))
			}
		}
	}

	if len(results) == 0 {
		results = append(results, warn(sec, "firewall",
			"could not determine macOS firewall state (socketfilterfw/pfctl unavailable)"))
	}
	return results
}
