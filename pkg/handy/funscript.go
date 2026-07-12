package handy

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
)

// funscript mirrors the on-disk format (see pkg/scene/funscript.go and the
// launchcontrol reference). Only the fields relevant to point conversion.
type funscript struct {
	Inverted bool `json:"inverted,omitempty"`
	Range    int  `json:"range,omitempty"`
	Actions  []struct {
		At  float64 `json:"at"`
		Pos int     `json:"pos"`
	} `json:"actions"`
}

// LoadFunscriptPoints reads a .funscript file and converts its actions to
// HSP points (t ms, x 0–100), applying the script's inverted/range flags the
// same way the cloud CSV conversion does.
func LoadFunscriptPoints(path string) ([]Point, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var fs funscript
	if err := json.Unmarshal(data, &fs); err != nil {
		return nil, fmt.Errorf("parsing funscript: %w", err)
	}
	if len(fs.Actions) == 0 {
		return nil, fmt.Errorf("funscript has no actions")
	}

	points := make([]Point, 0, len(fs.Actions))
	for _, a := range fs.Actions {
		if a.At < 0 {
			continue
		}
		pos := a.Pos
		if fs.Inverted {
			pos = 100 - pos
		}
		if fs.Range > 0 && fs.Range < 100 {
			pos = pos * 100 / fs.Range
		}
		if pos < 0 {
			pos = 0
		}
		if pos > 100 {
			pos = 100
		}
		points = append(points, Point{T: uint32(a.At), X: uint32(pos)})
	}
	sort.Slice(points, func(i, j int) bool { return points[i].T < points[j].T })
	return points, nil
}
