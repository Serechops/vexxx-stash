//go:build !windows && !linux && !darwin

package main

// checkFirewall is a no-op stub for platforms where firewall inspection
// is not implemented (FreeBSD, OpenBSD, etc.).
func checkFirewall(_ int) []CheckResult {
	return []CheckResult{warn("NETWORK", "firewall",
		"firewall inspection not supported on this platform")}
}
