//go:build linux

package main

import (
	"fmt"
	"os/exec"
	"strings"
)

// checkFirewall checks whether the port is visible in Linux firewall/socket tools.
// Priority: ufw → iptables/nftables → ss (socket stats, no firewall info but confirms binding).
func checkFirewall(port int) []CheckResult {
	const sec = "NETWORK"
	portStr := fmt.Sprintf("%d", port)

	// --- ufw ---
	if out, err := exec.Command("ufw", "status", "verbose").Output(); err == nil {
		text := string(out)
		if strings.Contains(text, "Status: inactive") {
			return []CheckResult{ok(sec, "firewall", "ufw is inactive — no packet filtering")}
		}
		// Look for the port in the ufw rule table
		if strings.Contains(text, portStr) {
			return []CheckResult{ok(sec, "firewall",
				fmt.Sprintf("ufw active: port %d appears in rule set", port))}
		}
		return []CheckResult{warn(sec, "firewall",
			fmt.Sprintf("ufw active but port %d not found in rules — traffic may be blocked", port))}
	}

	// --- nftables ---
	if out, err := exec.Command("nft", "list", "ruleset").Output(); err == nil {
		if strings.Contains(string(out), portStr) {
			return []CheckResult{ok(sec, "firewall",
				fmt.Sprintf("nftables: port %d referenced in ruleset", port))}
		}
		return []CheckResult{warn(sec, "firewall",
			fmt.Sprintf("nftables active but port %d not found in ruleset — may be blocked", port))}
	}

	// --- iptables ---
	if out, err := exec.Command("iptables", "-L", "INPUT", "-n", "--line-numbers").Output(); err == nil {
		text := string(out)
		if strings.Contains(text, "dpt:"+portStr) || strings.Contains(text, ":"+portStr+" ") {
			return []CheckResult{ok(sec, "firewall",
				fmt.Sprintf("iptables: INPUT rule found for port %d", port))}
		}
		// Check policy — if ACCEPT we're fine without an explicit rule
		if strings.Contains(text, "Chain INPUT (policy ACCEPT)") {
			return []CheckResult{ok(sec, "firewall",
				fmt.Sprintf("iptables INPUT policy is ACCEPT — port %d not filtered", port))}
		}
		return []CheckResult{warn(sec, "firewall",
			fmt.Sprintf("iptables: no explicit rule for port %d and INPUT policy is not ACCEPT", port))}
	}

	// --- ss fallback: just confirms kernel-level binding visibility ---
	if out, err := exec.Command("ss", "-tlnp").Output(); err == nil {
		if strings.Contains(string(out), ":"+portStr) {
			return []CheckResult{ok(sec, "firewall",
				fmt.Sprintf("ss: port %d is bound (firewall state unknown — no ufw/iptables/nft available)", port))}
		}
		return []CheckResult{warn(sec, "firewall",
			fmt.Sprintf("ss: port %d not bound; firewall state unknown", port))}
	}

	return []CheckResult{warn(sec, "firewall",
		"unable to inspect firewall — ufw, nft, iptables, and ss all unavailable")}
}
