package stashbox

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/stashbox/graphql"
)

func (c Client) resolveStudio(ctx context.Context, s *graphql.StudioFragment) (*models.ScrapedStudio, error) {
	scraped := studioFragmentToScrapedStudio(*s)

	if s.Parent != nil {
		parentStudio, err := c.client.FindStudio(ctx, &s.Parent.ID, nil)
		if err != nil {
			return nil, err
		}

		if parentStudio.FindStudio == nil {
			return scraped, nil
		}

		scraped.Parent, err = c.resolveStudio(ctx, parentStudio.FindStudio)
		if err != nil {
			return nil, err
		}
	}

	return scraped, nil
}

func (c Client) FindStudio(ctx context.Context, query string) (*models.ScrapedStudio, error) {
	var studio *graphql.FindStudio

	_, err := uuid.Parse(query)
	if err == nil {
		// Confirmed the user passed in a Stash ID
		studio, err = c.client.FindStudio(ctx, &query, nil)
	} else {
		// Otherwise assume they're searching on a name
		studio, err = c.client.FindStudio(ctx, nil, &query)
	}

	if err != nil {
		return nil, err
	}

	var ret *models.ScrapedStudio
	if studio.FindStudio != nil {
		ret, err = c.resolveStudio(ctx, studio.FindStudio)
		if err != nil {
			return nil, err
		}
	}

	return ret, nil
}

func studioFragmentToScrapedStudio(s graphql.StudioFragment) *models.ScrapedStudio {
	images := []string{}
	for _, image := range s.Images {
		images = append(images, image.URL)
	}

	aliases := strings.Join(s.Aliases, ", ")

	st := &models.ScrapedStudio{
		Name:         s.Name,
		Aliases:      &aliases,
		Images:       images,
		RemoteSiteID: &s.ID,
	}

	for _, u := range s.Urls {
		st.URLs = append(st.URLs, u.URL)
	}

	if len(st.Images) > 0 {
		st.Image = &st.Images[0]
	}

	return st
}

func (c Client) FindStudioByID(ctx context.Context, id string) (*models.ScrapedStudio, error) {
	// First fetch the studio itself
	studioResult, err := c.client.FindStudio(ctx, &id, nil)
	if err != nil {
		return nil, err
	}
	if studioResult.FindStudio == nil {
		return nil, nil // Not found
	}

	ret := studioFragmentToScrapedStudio(*studioResult.FindStudio)

	// Now fetch scenes with pagination
	page := 1
	perPage := 40 // Consistent with Performer
	for {
		input := graphql.SceneQueryInput{
			Studios: &graphql.MultiIDCriterionInput{
				Value:    []string{id},
				Modifier: graphql.CriterionModifierIncludes,
			},
			Page:      page,
			PerPage:   perPage,
			Sort:      graphql.SceneSortEnumDate,
			Direction: graphql.SortDirectionEnumDesc,
		}

		res, err := c.client.QueryScenes(ctx, input)
		if err != nil {
			return nil, err
		}

		if res == nil {
			break
		}

		for _, s := range res.QueryScenes.Scenes {
			scrapedScene, err := c.sceneFragmentToScrapedScene(ctx, s, false)
			if err != nil {
				continue
			}

			// Ensure the scene has the studio attached if not present in fragment
			if scrapedScene.Studio == nil {
				scrapedScene.Studio = ret
			}
			ret.Scenes = append(ret.Scenes, scrapedScene)
		}

		if len(res.QueryScenes.Scenes) < perPage {
			break
		}
		page++
	}

	return ret, nil
}
