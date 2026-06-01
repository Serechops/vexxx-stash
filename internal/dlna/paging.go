package dlna

import (
	"context"
	"fmt"
	"math"
	"strconv"

	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/scene"
)

type scenePager struct {
	sceneFilter *models.SceneFilterType
	parentID    string
}

func (p *scenePager) getPageID(page int) string {
	return p.parentID + "/page/" + strconv.Itoa(page)
}

func (p *scenePager) getPages(ctx context.Context, r models.SceneQueryer, total int) ([]interface{}, error) {
	var objs []interface{}

	pages := int(math.Ceil(float64(total) / float64(pageSize)))

	// Determine which pages need title-prefix labels (up to 10 sample pages).
	// For small libraries (≤10 pages) every page gets a label; for larger ones
	// we label every (pages/10)th page.
	type labelledPage struct {
		page     int
		sceneIdx int // 0-based position in the sorted scene list
	}
	var labelled []labelledPage
	for page := 1; page <= pages; page++ {
		if pages <= 10 || (page-1)%(pages/10) == 0 {
			labelled = append(labelled, labelledPage{page: page, sceneIdx: (page - 1) * pageSize})
		}
	}

	// Fetch all needed sample scenes in one query.
	// We request up to (last needed position + 1) scenes sorted by title,
	// then index into the slice by each sample's position.
	titlePrefixes := make(map[int]string) // page -> prefix
	if len(labelled) > 0 {
		lastIdx := labelled[len(labelled)-1].sceneIdx
		fetchCount := lastIdx + 1
		sort := "title"
		page := 1
		findFilter := &models.FindFilterType{
			PerPage: &fetchCount,
			Sort:    &sort,
			Page:    &page,
		}
		scenes, err := scene.Query(ctx, r, p.sceneFilter, findFilter)
		if err != nil {
			return nil, err
		}
		for _, lp := range labelled {
			if lp.sceneIdx < len(scenes) {
				title := scenes[lp.sceneIdx].GetTitle()
				if len(title) > 3 {
					title = title[0:3]
				}
				titlePrefixes[lp.page] = title
			}
		}
	}

	for page := 1; page <= pages; page++ {
		title := fmt.Sprintf("Page %d", page)
		if prefix, ok := titlePrefixes[page]; ok {
			title += fmt.Sprintf(" (%s...)", prefix)
		}
		objs = append(objs, makeStorageFolder(p.getPageID(page), title, p.parentID))
	}

	return objs, nil
}

func (p *scenePager) getPageVideos(ctx context.Context, r SceneFinder, f models.FileGetter, page int, host string, sort string, direction models.SortDirectionEnum) ([]interface{}, error) {
	var objs []interface{}

	findFilter := &models.FindFilterType{
		PerPage:   &pageSize,
		Page:      &page,
		Sort:      &sort,
		Direction: &direction,
	}

	scenes, err := scene.Query(ctx, r, p.sceneFilter, findFilter)
	if err != nil {
		return nil, err
	}

	for _, s := range scenes {
		if err := s.LoadPrimaryFile(ctx, f); err != nil {
			return nil, err
		}

		objs = append(objs, sceneToContainer(s, p.parentID, host))
	}

	return objs, nil
}
