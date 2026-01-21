package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/stashapp/stash/internal/build"
	"github.com/stashapp/stash/pkg/logger"
)

func getReleaseRepo() string {
	repo := build.ReleaseRepo()
	if repo == "" {
		repo = os.Getenv("STASH_RELEASE_REPO")
	}
	if repo == "" {
		repo = "Serechops/vexxx-stash"
	}
	return repo
}

const apiAcceptHeader string = "application/vnd.github.v3+json"

const defaultSHLength int = 8 // default length of SHA short hash returned by <git rev-parse --short HEAD>

type githubTagResponse struct {
	Name        string
	Zipball_url string
	Tarball_url string
	Commit      struct {
		Sha string
		Url string
	}
	Node_id string
}

type LatestRelease struct {
	Version   string
	Hash      string
	ShortHash string
	Date      string
	Url       string
	Repo      string
}

func makeGithubRequest(ctx context.Context, url string, output interface{}) error {
	transport := &http.Transport{Proxy: http.ProxyFromEnvironment}

	client := &http.Client{
		Timeout:   3 * time.Second,
		Transport: transport,
	}

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)

	req.Header.Add("Accept", apiAcceptHeader) // gh api recommendation , send header with api version
	logger.Debugf("Github API request: %s", url)
	response, err := client.Do(req)

	if err != nil {
		//lint:ignore ST1005 Github is a proper capitalized noun
		return fmt.Errorf("Github API request failed for %s: %w", url, err)
	}

	if response.StatusCode != http.StatusOK {
		//lint:ignore ST1005 Github is a proper capitalized noun
		return fmt.Errorf("Github API request failed for %s: %s", url, response.Status)
	}

	defer response.Body.Close()

	data, err := io.ReadAll(response.Body)
	if err != nil {
		//lint:ignore ST1005 Github is a proper capitalized noun
		return fmt.Errorf("Github API read response failed: %w", err)
	}

	err = json.Unmarshal(data, output)
	if err != nil {
		return fmt.Errorf("unmarshalling Github API response failed: %w", err)
	}

	return nil
}

// GetLatestRelease gets latest release information from github API
// If running a build from the "master" branch, then the latest full release
// is used, otherwise it uses the release that is tagged with "latest_develop"
// which is the latest pre-release build.
// GetLatestRelease gets latest release information from github API
// Uses git tags to determine the latest version since releases are not published.
func GetLatestRelease(ctx context.Context) (*LatestRelease, error) {
	repo := getReleaseRepo()

	// Query tags endpoint
	url := fmt.Sprintf("https://api.github.com/repos/%s/tags?per_page=1", repo)

	var tags []githubTagResponse
	err := makeGithubRequest(ctx, url, &tags)
	if err != nil {
		return nil, err
	}

	if len(tags) == 0 {
		return nil, fmt.Errorf("no tags found in repository %s", repo)
	}

	latestTag := tags[0]
	version := latestTag.Name
	latestHash := latestTag.Commit.Sha

	// Retrieve commit details to get the date (optional, but nice to have)
	// For now, we'll leave Date empty to save an API call, or we could fetch it.
	// Users primarily care about the Version string.
	releaseDate := ""

	// URL to the tag view on GitHub
	releaseUrl := fmt.Sprintf("https://github.com/%s/releases/tag/%s", repo, version)

	// bounds check for slicing
	_, githash, _ := build.Version()
	shLength := len(githash)
	if shLength == 0 {
		shLength = defaultSHLength
	}

	if shLength > len(latestHash) {
		shLength = defaultSHLength
		if shLength > len(latestHash) {
			shLength = len(latestHash)
		}
	}

	return &LatestRelease{
		Version:   version,
		Hash:      latestHash,
		ShortHash: latestHash[:shLength],
		Date:      releaseDate,
		Url:       releaseUrl,
		Repo:      repo,
	}, nil
}

func printLatestVersion(ctx context.Context) {
	latestRelease, err := GetLatestRelease(ctx)
	if err != nil {
		logger.Errorf("Couldn't retrieve latest version: %v", err)
	} else {
		version, githash, _ := build.Version()
		switch {
		case githash == "":
			logger.Infof("Latest version: %s (%s)", latestRelease.Version, latestRelease.ShortHash)
		case githash == latestRelease.ShortHash:
			logger.Infof("Version %s (%s) is already the latest released", latestRelease.Version, latestRelease.ShortHash)
		case strings.Contains(version, latestRelease.Version) && !build.IsOfficial():
			logger.Infof("Running development build %s based on latest version %s (%s)", version, latestRelease.Version, latestRelease.ShortHash)
		default:
			logger.Infof("New version available: %s (%s)", latestRelease.Version, latestRelease.ShortHash)
		}
	}
}
