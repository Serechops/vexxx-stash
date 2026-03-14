package main

import (
	"fmt"
	"net"
	"os"
	"time"

	"github.com/stashapp/stash/internal/manager/config"
)

// ---------------------------------------------------------------------------
// NETWORK
// ---------------------------------------------------------------------------

// checkNetwork probes the configured listen address and platform firewall rules.
func checkNetwork(cfg *config.Config) []CheckResult {
	const sec = "NETWORK"
	var results []CheckResult

	port := cfg.GetPort()
	host := cfg.GetHost()
	listenAddr := fmt.Sprintf("%s:%d", host, port)

	results = append(results, ok(sec, "listen_addr", listenAddr))

	if ext := cfg.GetExternalHost(); ext != "" {
		results = append(results, ok(sec, "external_host", ext))
	}

	// TLS
	if cfg.HasTLSConfig() {
		cert, key := cfg.GetTLSFiles()
		results = append(results, ok(sec, "tls", fmt.Sprintf("enabled  cert=%s  key=%s", cert, key)))
	} else {
		results = append(results, ok(sec, "tls", "disabled (plain HTTP)"))
	}

	// Port probe — is something currently listening on this port?
	dialAddr := fmt.Sprintf("127.0.0.1:%d", port)
	conn, err := net.DialTimeout("tcp", dialAddr, 2*time.Second)
	if err == nil {
		conn.Close()
		results = append(results, ok(sec, "port_probe",
			fmt.Sprintf("port %d is listening — Stash appears to be running", port)))
	} else {
		// Try binding — if we can, the port is free (Stash not started).
		l, lerr := net.Listen("tcp", dialAddr)
		if lerr == nil {
			l.Close()
			results = append(results, warn(sec, "port_probe",
				fmt.Sprintf("port %d is free — Stash does not appear to be running", port)))
		} else {
			results = append(results, warn(sec, "port_probe",
				fmt.Sprintf("port %d: %v", port, err)))
		}
	}

	// Platform-specific firewall inspection
	results = append(results, checkFirewall(port)...)

	return results
}

// ---------------------------------------------------------------------------
// PERMISSIONS
// ---------------------------------------------------------------------------

// checkPermissions tests read/write access on key Stash directories and files.
func checkPermissions(cfg *config.Config) []CheckResult {
	const sec = "PERMISSIONS"
	var results []CheckResult

	type dirEntry struct {
		name string
		path string
	}

	pluginsPath := cfg.GetPluginsPath()
	if pluginsPath == "" {
		pluginsPath = cfg.GetDefaultPluginsPath()
	}
	scrapersPath := cfg.GetScrapersPath()
	if scrapersPath == "" {
		scrapersPath = cfg.GetDefaultScrapersPath()
	}

	dirs := []dirEntry{
		{"generated", cfg.GetGeneratedPath()},
		{"cache", cfg.GetCachePath()},
		{"metadata", cfg.GetMetadataPath()},
		{"blobs", cfg.GetBlobsPath()},
		{"plugins", pluginsPath},
		{"scrapers", scrapersPath},
	}

	for _, d := range dirs {
		if d.path == "" {
			results = append(results, warn(sec, d.name, "not configured"))
			continue
		}
		results = append(results, probeWritable(sec, d.name, d.path))
	}

	// Library (stash) directories — should be readable
	for _, sp := range cfg.GetStashPaths() {
		if sp.Path == "" {
			continue
		}
		info, err := os.Stat(sp.Path)
		if err != nil {
			results = append(results, errResult(sec, "library", fmt.Sprintf("cannot stat %s: %v", sp.Path, err)))
		} else if !info.IsDir() {
			results = append(results, errResult(sec, "library", fmt.Sprintf("not a directory: %s", sp.Path)))
		} else {
			// Test read access by opening the directory
			f, err := os.Open(sp.Path)
			if err != nil {
				results = append(results, errResult(sec, "library", fmt.Sprintf("not readable: %s: %v", sp.Path, err)))
			} else {
				f.Close()
				results = append(results, ok(sec, "library", fmt.Sprintf("readable: %s", sp.Path)))
			}
		}
	}

	// Database file — should be readable and writable
	dbPath := cfg.GetDatabasePath()
	if dbPath == "" {
		dbPath = cfg.GetDefaultDatabaseFilePath()
	}
	if dbPath != "" {
		if _, err := os.Stat(dbPath); err == nil {
			f, err := os.OpenFile(dbPath, os.O_RDWR, 0)
			if err != nil {
				results = append(results, errResult(sec, "database", fmt.Sprintf("not writable: %v", err)))
			} else {
				f.Close()
				results = append(results, ok(sec, "database", fmt.Sprintf("readable and writable: %s", dbPath)))
			}
		} else if os.IsNotExist(err) {
			results = append(results, warn(sec, "database", fmt.Sprintf("file not found (new install?): %s", dbPath)))
		} else {
			results = append(results, errResult(sec, "database", fmt.Sprintf("cannot stat: %v", err)))
		}
	}

	// Config file — should be readable
	cf := cfg.GetConfigFile()
	if cf != "" {
		if _, err := os.Stat(cf); err == nil {
			results = append(results, ok(sec, "config_file", fmt.Sprintf("readable: %s", cf)))
		} else {
			results = append(results, errResult(sec, "config_file", fmt.Sprintf("cannot stat: %v", err)))
		}
	}

	return results
}

// probeWritable checks whether a directory exists and is writable by the
// current process by creating and immediately removing a temporary file.
func probeWritable(sec, name, dir string) CheckResult {
	info, err := os.Stat(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return warn(sec, name, fmt.Sprintf("not found (will be created on first use): %s", dir))
		}
		return errResult(sec, name, fmt.Sprintf("cannot stat %s: %v", dir, err))
	}
	if !info.IsDir() {
		return errResult(sec, name, fmt.Sprintf("not a directory: %s", dir))
	}

	tmp, err := os.CreateTemp(dir, ".stash-diag-probe-*")
	if err != nil {
		return errResult(sec, name, fmt.Sprintf("not writable (%s): %v", dir, err))
	}
	tmp.Close()
	_ = os.Remove(tmp.Name())
	return ok(sec, name, fmt.Sprintf("r/w  %s", dir))
}
