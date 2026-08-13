package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/logger"
)

// apihubDiscordWebhookSettingKey is the plugin config key the frontend writes
// the user's Discord webhook URL under (see tokenStorage.ts's
// persistDiscordWebhookToServer) — same configurePlugin-backed store as
// downloadDir and the provider tokens.
const apihubDiscordWebhookSettingKey = "discordWebhookUrl"

type discordEmbedImage struct {
	URL string `json:"url"`
}

type discordEmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

type discordEmbed struct {
	Title       string              `json:"title,omitempty"`
	Description string              `json:"description,omitempty"`
	Color       int                 `json:"color,omitempty"`
	Thumbnail   *discordEmbedImage  `json:"thumbnail,omitempty"`
	Fields      []discordEmbedField `json:"fields,omitempty"`
	Timestamp   string              `json:"timestamp,omitempty"`
}

type discordWebhookPayload struct {
	Username string         `json:"username,omitempty"`
	Embeds   []discordEmbed `json:"embeds,omitempty"`
}

// apihubDiscordWebhookURL reads the user-configured Discord webhook URL from
// the plugin's server-side config, or "" when unset.
func apihubDiscordWebhookURL() string {
	pc := config.GetInstance().GetPluginConfiguration("apihub")
	if pc == nil {
		return ""
	}
	v, _ := pc[apihubDiscordWebhookSettingKey].(string)
	return strings.TrimSpace(v)
}

// sendDiscordWebhook posts payload to a Discord webhook URL. Discord returns a
// bare 204 on success.
func sendDiscordWebhook(url string, payload discordWebhookPayload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("discord returned %s", resp.Status)
	}
	return nil
}

// apihubDownloadResult is one item's outcome, collected during
// apihubDownloadJob.Execute purely to build the end-of-batch Discord summary —
// mirrors what's already passed to recordHistory for each item.
type apihubDownloadResult struct {
	Title  string
	Status apihubHistoryStatus
	Error  string
}

// notifyDiscordJobComplete posts a summary embed for a finished download batch
// to the user's configured Discord webhook, when one is set. Best-effort and
// entirely non-fatal: a missing/invalid webhook, or Discord being unreachable,
// must never affect the download job itself, so failures are only logged.
func notifyDiscordJobComplete(results []apihubDownloadResult) {
	if len(results) == 0 {
		return
	}
	webhookURL := apihubDiscordWebhookURL()
	if webhookURL == "" {
		return
	}

	var succeeded, partial, failed int
	lines := make([]string, 0, len(results))
	for _, r := range results {
		icon := "✅" // ✅
		switch r.Status {
		case apihubHistoryPartial:
			icon = "⚠️" // ⚠️
			partial++
		case apihubHistoryFailed:
			icon = "❌" // ❌
			failed++
		default:
			succeeded++
		}
		lines = append(lines, fmt.Sprintf("%s %s", icon, r.Title))
	}

	color := 0x2ecc71 // green
	if failed > 0 {
		color = 0xe74c3c // red
	} else if partial > 0 {
		color = 0xe67e22 // orange
	}

	desc := strings.Join(lines, "\n")
	// Discord embed description caps at 4096 chars.
	if len(desc) > 3900 {
		desc = desc[:3900] + "\n…"
	}

	embed := discordEmbed{
		Title:       fmt.Sprintf("APIHub: %d/%d downloads complete", succeeded, len(results)),
		Description: desc,
		Color:       color,
		Fields: []discordEmbedField{
			{Name: "Succeeded", Value: fmt.Sprintf("%d", succeeded), Inline: true},
			{Name: "Partial", Value: fmt.Sprintf("%d", partial), Inline: true},
			{Name: "Failed", Value: fmt.Sprintf("%d", failed), Inline: true},
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	if err := sendDiscordWebhook(webhookURL, discordWebhookPayload{
		Username: "Stash — API Hub",
		Embeds:   []discordEmbed{embed},
	}); err != nil {
		logger.Warnf("[apihub-download] discord notification failed: %v", err)
	}
}
