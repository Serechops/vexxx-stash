package renamer

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/stashapp/stash/pkg/models"
)

var invalidFileNameChars = regexp.MustCompile(`[<>:"/\\|?*]`)

func SanitizeFileName(name string) string {
	return invalidFileNameChars.ReplaceAllString(name, "")
}

type Renamer struct{}

func NewRenamer() *Renamer {
	return &Renamer{}
}

// ComposePath generates a new file path based on the template and scene metadata.
// It assumes the template produces a relative path from the stash root.
func (r *Renamer) ComposePath(template string, scene *models.Scene, studio *models.Studio, parentStudio *models.Studio, performers []*models.Performer, file *models.VideoFile, performerLimit int) (string, error) {
	res := template

	// Helper to safe replace
	replace := func(token, value string) {
		res = strings.ReplaceAll(res, token, SanitizeFileName(value))
	}

	// Helper to check if token exists in template
	hasToken := func(token string) bool {
		return strings.Contains(res, token)
	}

	replace("{title}", scene.GetTitle())

	if hasToken("{date}") || hasToken("{year}") {
		if scene.Date != nil {
			replace("{date}", scene.Date.String())
			parts := strings.Split(scene.Date.String(), "-")
			if len(parts) > 0 {
				replace("{year}", parts[0])
			}
		} else {
			return "", fmt.Errorf("missing data for token {date}/{year}")
		}
	}

	if hasToken("{studio}") {
		if studio != nil {
			replace("{studio}", studio.Name)
		} else {
			return "", fmt.Errorf("missing data for token {studio}")
		}
	}

	if hasToken("{parent_studio}") {
		if parentStudio != nil {
			replace("{parent_studio}", parentStudio.Name)
		} else {
			return "", fmt.Errorf("missing data for token {parent_studio}")
		}
	}

	// Performers
	if hasToken("{performers}") {
		if len(performers) > 0 {
			// Sort performers alphabetically by name
			sortedPerformers := make([]*models.Performer, len(performers))
			copy(sortedPerformers, performers)

			for i := 0; i < len(sortedPerformers)-1; i++ {
				for j := 0; j < len(sortedPerformers)-i-1; j++ {
					if strings.ToLower(sortedPerformers[j].Name) > strings.ToLower(sortedPerformers[j+1].Name) {
						sortedPerformers[j], sortedPerformers[j+1] = sortedPerformers[j+1], sortedPerformers[j]
					}
				}
			}

			// Apply Limit
			if performerLimit > 0 && len(sortedPerformers) > performerLimit {
				sortedPerformers = sortedPerformers[:performerLimit]
			}

			names := make([]string, len(sortedPerformers))
			for i, p := range sortedPerformers {
				names[i] = p.Name
			}
			replace("{performers}", strings.Join(names, ", "))
		} else {
			return "", fmt.Errorf("missing data for token {performers}")
		}
	}

	if hasToken("{rating}") {
		if scene.Rating != nil {
			replace("{rating}", fmt.Sprintf("%d", *scene.Rating))
		} else {
			return "", fmt.Errorf("missing data for token {rating}")
		}
	}

	if file != nil {
		ext := filepath.Ext(file.Path)
		// ext includes dot
		if len(ext) > 0 {
			replace("{ext}", strings.TrimPrefix(ext, "."))
		}
	}

	// Handle ID
	res = strings.ReplaceAll(res, "{id}", fmt.Sprintf("%d", scene.ID))

	// Clean double separators or empty tokens leaving trailing separators
	// Basic implementation - users might want robust path cleaning
	res = filepath.Clean(res)

	// Determine extension logic: if template does not have extension, append original?
	// User requested "renaming ... according to template".
	// Usually template includes extension or we force it?
	// If user writes "{title}", we should append ".mp4".
	// If user writes "{title}.{ext}", we use it.

	// Ensure the result has the correct extension
	if file != nil {
		origExt := filepath.Ext(file.Path)
		if !strings.HasSuffix(strings.ToLower(res), strings.ToLower(origExt)) {
			res += origExt
		}
	}

	return res, nil
}
