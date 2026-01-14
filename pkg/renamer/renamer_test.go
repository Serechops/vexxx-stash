package renamer

import (
	"strings"
	"testing"

	"github.com/stashapp/stash/pkg/models"
)

func TestComposePath_StrictValidation(t *testing.T) {
	r := NewRenamer()
	scene := &models.Scene{
		ID:    1,
		Title: "Test Scene",
	}
	studio := &models.Studio{
		Name: "Test Studio",
	}
	// Missing ParentStudio
	var parentStudio *models.Studio = nil

	tests := []struct {
		name      string
		template  string
		expectErr bool
	}{
		{
			name:      "Valid Title",
			template:  "{title}",
			expectErr: false,
		},
		{
			name:      "Missing Parent Studio",
			template:  "{parent_studio}/{studio}",
			expectErr: true,
		},
		{
			name:      "Valid Studio",
			template:  "{studio}",
			expectErr: false,
		},
		{
			name:      "Missing Date",
			template:  "{date} - {title}",
			expectErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := r.ComposePath(tt.template, scene, studio, parentStudio, nil, nil, 0)
			if tt.expectErr {
				if err == nil {
					t.Errorf("expected error for template %q, got none. Result: %q", tt.template, result)
				} else if !strings.Contains(err.Error(), "missing data for token") {
					t.Errorf("expected 'missing data' error, got: %v", err)
				}
			} else {
				if err != nil {
					t.Errorf("unexpected error for template %q: %v", tt.template, err)
				}
			}
		})
	}
}
