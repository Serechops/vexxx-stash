package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	distDir := "dist"
	outputFile := filepath.Join(distDir, "PATREON_RELEASE.md")

	version := os.Getenv("STASH_VERSION")
	gitHash := os.Getenv("GITHASH")
	releaseRepo := os.Getenv("STASH_RELEASE_REPO")

	if version == "" {
		version = "dev"
	}
	if gitHash == "" {
		// try to get it from git directly
		if h, err := getGitHash(); err == nil {
			gitHash = h
		} else {
			gitHash = "unknown"
		}
	}
	if releaseRepo == "" {
		releaseRepo = "Serechops/vexxx-stash"
	}

	artifacts := []struct {
		Name        string
		Filename    string
		Description string
	}{
		{"Windows", "stash-win.exe", "Windows 10/11 (64-bit)"},
		{"macOS", "stash-macos", "macOS (Universal - Intel & Apple Silicon)"},
		{"Linux", "stash-linux", "Linux (64-bit)"},
		{"Raspberry Pi 4", "stash-linux-arm64v8", "Linux ARM64 (Raspberry Pi 4, etc.)"},
		{"FreeBSD", "stash-freebsd", "FreeBSD (64-bit)"},
		{"Docker Image", "stash-docker.tar.gz", "Docker Image (Offline Load)"},
	}

	// Generate Markdown
	if err := writeMarkdown(outputFile, version, gitHash, releaseRepo, artifacts, distDir); err != nil {
		fmt.Printf("Error writing Markdown file: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Successfully generated release notes at %s\n", outputFile)

	// Generate HTML
	htmlOutputFile := filepath.Join(distDir, "PATREON_RELEASE.html")
	if err := writeHTML(htmlOutputFile, version, gitHash, releaseRepo, artifacts, distDir); err != nil {
		fmt.Printf("Error writing HTML file: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Successfully generated release notes at %s\n", htmlOutputFile)
}

func writeMarkdown(path, version, gitHash, releaseRepo string, artifacts []struct{ Name, Filename, Description string }, distDir string) error {
	var sb strings.Builder

	// Header
	sb.WriteString(fmt.Sprintf("# **Vexxx %s**\n\n", version))
	sb.WriteString(fmt.Sprintf("**Build Hash:** [%s](https://github.com/%s/commit/%s)\n", gitHash, releaseRepo, gitHash))
	sb.WriteString(fmt.Sprintf("**Build Date:** %s\n\n", time.Now().Format("2006-01-02")))

	sb.WriteString("This build includes all the latest changes and improvements from the official repository, plus our exclusive custom presets.\n\n")
	sb.WriteString("---\n\n")

	// Downloads Table
	sb.WriteString("## **Downloads**\n\n")
	sb.WriteString("| Platform | Description | Filename |\n")
	sb.WriteString("| :--- | :--- | :--- |\n")

	for _, art := range artifacts {
		p := filepath.Join(distDir, art.Filename)
		if _, err := os.Stat(p); err == nil {
			sb.WriteString(fmt.Sprintf("| **%s** | %s | `%s` |\n", art.Name, art.Description, art.Filename))
		}
	}
	sb.WriteString("\n---\n\n")

	// Latest Changes
	if msg, err := getGitCommitMessage(); err == nil && msg != "" {
		sb.WriteString("## **Latest Changes**\n\n")
		sb.WriteString("```text\n")
		sb.WriteString(msg)
		sb.WriteString("\n```\n\n---\n\n")
	}

	// Checksums
	sb.WriteString("## **Verification (SHA-256)**\n\n")
	sb.WriteString("Verify parity with the repository build by checking the hashes below.\n\n")
	sb.WriteString("```text\n")

	for _, art := range artifacts {
		p := filepath.Join(distDir, art.Filename)
		if _, err := os.Stat(p); err == nil {
			hash, err := calculateSHA256(p)
			if err != nil {
				fmt.Printf("Error hashing %s: %v\n", art.Filename, err)
				continue
			}
			sb.WriteString(fmt.Sprintf("%s  %s\n", hash, art.Filename))
		}
	}
	sb.WriteString("```\n")

	return os.WriteFile(path, []byte(sb.String()), 0644)
}

func writeHTML(path, version, gitHash, releaseRepo string, artifacts []struct{ Name, Filename, Description string }, distDir string) error {
	var sb strings.Builder

	// Basic styling wrapper for copy-paste friendliness
	sb.WriteString("<html><body style=\"font-family: sans-serif;\">\n")

	// Header
	sb.WriteString(fmt.Sprintf("<h3><strong>Vexxx %s</strong></h3>\n", version))
	sb.WriteString(fmt.Sprintf("<p><strong>Build Hash:</strong> <a href=\"https://github.com/%s/commit/%s\">%s</a></p>\n", releaseRepo, gitHash, gitHash))
	sb.WriteString(fmt.Sprintf("<p><strong>Build Date:</strong> %s</p>\n", time.Now().Format("2006-01-02")))

	sb.WriteString("<p>This build includes all the latest changes and improvements from the official repository, plus our exclusive custom presets.</p>\n")

	// Downloads List
	sb.WriteString("<h3><strong>Downloads</strong></h3>\n")
	sb.WriteString("<ul>\n")

	for _, art := range artifacts {
		p := filepath.Join(distDir, art.Filename)
		if _, err := os.Stat(p); err == nil {
			sb.WriteString(fmt.Sprintf("<li><p><strong>%s</strong>: %s - <code>%s</code></p></li>\n", art.Name, art.Description, art.Filename))
		}
	}
	sb.WriteString("</ul>\n")

	// Latest Changes
	if msg, err := getGitCommitMessage(); err == nil && msg != "" {
		sb.WriteString("<h3><strong>Latest Changes</strong></h3>\n")
		sb.WriteString("<blockquote>")
		sb.WriteString(strings.ReplaceAll(msg, "\n", "<br>"))
		sb.WriteString("</blockquote>\n")
	}

	// Checksums
	sb.WriteString("<h3><strong>Verification (SHA-256)</strong></h3>\n")
	sb.WriteString("<p>Verify parity with the repository build by checking the hashes below.</p>\n")
	sb.WriteString("<blockquote>")

	for _, art := range artifacts {
		p := filepath.Join(distDir, art.Filename)
		if _, err := os.Stat(p); err == nil {
			hash, err := calculateSHA256(p)
			if err != nil {
				fmt.Printf("Error hashing %s: %v\n", art.Filename, err)
				continue
			}
			sb.WriteString(fmt.Sprintf("%s | %s<br>\n", hash, art.Filename))
		}
	}
	sb.WriteString("</blockquote>\n")
	sb.WriteString("</body></html>")

	return os.WriteFile(path, []byte(sb.String()), 0644)
}

func calculateSHA256(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}

	return hex.EncodeToString(hash.Sum(nil)), nil
}

func getGitHash() (string, error) {
	cmd := exec.Command("git", "rev-parse", "--short", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func getGitCommitMessage() (string, error) {
	cmd := exec.Command("git", "log", "-1", "--pretty=format:%B")
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
