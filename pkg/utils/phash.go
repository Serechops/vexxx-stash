package utils

import (
	"math"
	"sort"
	"strconv"

	"github.com/corona10/goimagehash"
)

type Phash struct {
	SceneID   int     `db:"id"`
	Hash      int64   `db:"phash"`
	Duration  float64 `db:"duration"`
	Neighbors []int
	Bucket    int
}

func FindDuplicates(hashes []*Phash, distance int, durationDiff float64) [][]int {
	if len(hashes) < 2 {
		return nil
	}

	byScene := make(map[int][]*Phash)
	for _, h := range hashes {
		byScene[h.SceneID] = append(byScene[h.SceneID], h)
	}

	if len(byScene) < 2 {
		return nil
	}

	sceneIDs := make([]int, 0, len(byScene))
	for sceneID := range byScene {
		sceneIDs = append(sceneIDs, sceneID)
	}
	sort.Ints(sceneIDs)

	idxByScene := make(map[int]int, len(sceneIDs))
	for i, sceneID := range sceneIDs {
		idxByScene[sceneID] = i
	}

	parents := make([]int, len(sceneIDs))
	for i := range parents {
		parents[i] = i
	}

	find := func(x int) int {
		for parents[x] != x {
			parents[x] = parents[parents[x]]
			x = parents[x]
		}
		return x
	}

	union := func(a, b int) {
		ra := find(a)
		rb := find(b)
		if ra != rb {
			parents[rb] = ra
		}
	}

	for i := 0; i < len(sceneIDs)-1; i++ {
		sceneA := sceneIDs[i]
		hashesA := byScene[sceneA]

		for j := i + 1; j < len(sceneIDs); j++ {
			sceneB := sceneIDs[j]
			hashesB := byScene[sceneB]

			matched := false
			for _, hashA := range hashesA {
				hashAImg := goimagehash.NewImageHash(uint64(hashA.Hash), goimagehash.PHash)
				for _, hashB := range hashesB {
					if !durationsWithinThreshold(hashA.Duration, hashB.Duration, durationDiff) {
						continue
					}

					hashBImg := goimagehash.NewImageHash(uint64(hashB.Hash), goimagehash.PHash)
					d, _ := hashAImg.Distance(hashBImg)
					if d <= distance {
						matched = true
						break
					}
				}

				if matched {
					break
				}
			}

			if matched {
				union(idxByScene[sceneA], idxByScene[sceneB])
			}
		}
	}

	grouped := make(map[int][]int)
	for _, sceneID := range sceneIDs {
		root := find(idxByScene[sceneID])
		grouped[root] = append(grouped[root], sceneID)
	}

	ret := make([][]int, 0, len(grouped))
	for _, group := range grouped {
		if len(group) > 1 {
			sort.Ints(group)
			ret = append(ret, group)
		}
	}

	sort.Slice(ret, func(i, j int) bool {
		return ret[i][0] < ret[j][0]
	})

	return ret
}

func durationsWithinThreshold(durationA, durationB, durationDiff float64) bool {
	if durationDiff < 0 {
		return true
	}

	if durationA > 0 && durationB > 0 {
		return math.Abs(durationA-durationB) <= durationDiff
	}

	// Preserve existing behavior: if either duration is missing, duration filter
	// does not block matching.
	return true
}

func PhashToString(phash int64) string {
	return strconv.FormatUint(uint64(phash), 16)
}

func StringToPhash(s string) (int64, error) {
	ret, err := strconv.ParseUint(s, 16, 64)
	if err != nil {
		return 0, err
	}

	return int64(ret), nil
}
