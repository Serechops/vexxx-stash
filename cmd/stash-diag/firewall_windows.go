//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"strings"
)

// checkFirewall queries the Windows Firewall for inbound TCP rules covering
// the given port using PowerShell's Get-NetFirewallRule / Get-NetFirewallPortFilter.
// Falls back to netsh if PowerShell is unavailable.
func checkFirewall(port int) []CheckResult {
	const sec = "NETWORK"

	// --- PowerShell approach (Windows 8+ / Server 2012+) ---
	psScript := fmt.Sprintf(`
$port = %d
$rules = Get-NetFirewallRule -Direction Inbound -Enabled True -Action Allow -ErrorAction SilentlyContinue |
    ForEach-Object {
        $r = $_
        $pf = $r | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
        if ($pf -and ($pf.LocalPort -eq 'Any' -or $pf.LocalPort -eq $port) -and
            ($pf.Protocol -eq 'Any' -or $pf.Protocol -eq 'TCP')) {
            $r.DisplayName
        }
    }
if ($rules) { $rules -join '|' } else { '' }
`, port)

	out, err := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", psScript).Output()
	if err == nil {
		names := strings.TrimSpace(string(out))
		if names == "" {
			return []CheckResult{warn(sec, "firewall",
				fmt.Sprintf("no Windows Firewall Allow rule found for TCP port %d — inbound traffic may be blocked", port))}
		}
		rules := strings.Split(names, "|")
		return []CheckResult{ok(sec, "firewall",
			fmt.Sprintf("TCP %d covered by %d rule(s): %s", port, len(rules), strings.Join(rules, ", ")))}
	}

	// --- NetSH fallback ---
	out, err = exec.Command("netsh", "advfirewall", "firewall", "show", "rule",
		"name=all", "dir=in", "protocol=TCP").Output()
	if err != nil {
		return []CheckResult{warn(sec, "firewall",
			fmt.Sprintf("cannot query Windows Firewall (neither PowerShell nor netsh succeeded): %v", err))}
	}

	// Parse netsh block output — each rule is a paragraph separated by blank lines.
	portStr := fmt.Sprintf("%d", port)
	var matchedRules []string

	type ruleState struct {
		name    string
		enabled bool
		action  string
		ports   string // LocalPort value
	}
	cur := ruleState{}

	flush := func() {
		if cur.name == "" {
			return
		}
		if cur.enabled && strings.EqualFold(cur.action, "Allow") &&
			(cur.ports == "Any" || cur.ports == portStr) {
			matchedRules = append(matchedRules, cur.name)
		}
		cur = ruleState{}
	}

	for _, raw := range strings.Split(string(out), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			flush()
			continue
		}
		if after, ok := strings.CutPrefix(line, "Rule Name:"); ok {
			flush()
			cur.name = strings.TrimSpace(after)
		} else if after, ok := strings.CutPrefix(line, "Enabled:"); ok {
			cur.enabled = strings.Contains(strings.ToLower(after), "yes")
		} else if after, ok := strings.CutPrefix(line, "Action:"); ok {
			cur.action = strings.TrimSpace(after)
		} else if after, ok := strings.CutPrefix(line, "LocalPort:"); ok {
			cur.ports = strings.TrimSpace(after)
		}
	}
	flush()

	if len(matchedRules) == 0 {
		return []CheckResult{warn(sec, "firewall",
			fmt.Sprintf("no active Allow rule for TCP port %d in Windows Firewall", port))}
	}
	return []CheckResult{ok(sec, "firewall",
		fmt.Sprintf("TCP %d allowed by %d rule(s): %s", port, len(matchedRules), strings.Join(matchedRules, ", ")))}
}
