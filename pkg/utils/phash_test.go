package utils

import (
	"reflect"
	"testing"
)

func TestFindDuplicates_GroupsBySceneIDAcrossMultiHashRows(t *testing.T) {
	hashes := []*Phash{
		{SceneID: 1, Hash: 0, Duration: 100},
		{SceneID: 2, Hash: 0, Duration: 100},
		{SceneID: 2, Hash: 3, Duration: 100},
		{SceneID: 3, Hash: 3, Duration: 100},
	}

	dupes := FindDuplicates(hashes, 0, -1)
	want := [][]int{{1, 2, 3}}
	if !reflect.DeepEqual(dupes, want) {
		t.Fatalf("FindDuplicates() = %v, want %v", dupes, want)
	}
}

func TestFindDuplicates_RespectsDurationThresholdWhenPresent(t *testing.T) {
	hashes := []*Phash{
		{SceneID: 1, Hash: 0, Duration: 100},
		{SceneID: 2, Hash: 0, Duration: 103},
		{SceneID: 3, Hash: 0, Duration: 120},
	}

	dupes := FindDuplicates(hashes, 0, 5)
	want := [][]int{{1, 2}}
	if !reflect.DeepEqual(dupes, want) {
		t.Fatalf("FindDuplicates() = %v, want %v", dupes, want)
	}
}

func TestFindDuplicates_AllowsMissingDuration(t *testing.T) {
	hashes := []*Phash{
		{SceneID: 1, Hash: 0, Duration: 0},
		{SceneID: 2, Hash: 0, Duration: 10},
	}

	dupes := FindDuplicates(hashes, 0, 1)
	want := [][]int{{1, 2}}
	if !reflect.DeepEqual(dupes, want) {
		t.Fatalf("FindDuplicates() = %v, want %v", dupes, want)
	}
}
