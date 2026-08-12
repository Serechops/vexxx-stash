package api

import (
	"testing"
)

func TestNewSensationsNetwork(t *testing.T) {
	if (nsNetwork{}).Label() != "New Sensations" {
		t.Errorf("expected 'New Sensations'")
	}
}
