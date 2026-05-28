package api

import (
	"context"

	"github.com/stashapp/stash/pkg/models"
)

func (r *queryResolver) AnalyticsData(ctx context.Context) (*AnalyticsData, error) {
	var ret AnalyticsData

	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		analytics := r.repository.Analytics

		codecs, err := analytics.ScenesByCodec(ctx)
		if err != nil {
			return err
		}

		resolutions, err := analytics.ScenesByResolution(ctx)
		if err != nil {
			return err
		}

		studios, err := analytics.ScenesByStudio(ctx)
		if err != nil {
			return err
		}

		ratings, err := analytics.ScenesByRating(ctx)
		if err != nil {
			return err
		}

		monthly, err := analytics.ScenesByMonth(ctx)
		if err != nil {
			return err
		}

		ret = AnalyticsData{
			ScenesByCodec:      toAnalyticsBreakdownList(codecs),
			ScenesByResolution: toAnalyticsBreakdownList(resolutions),
			ScenesByStudio:     toAnalyticsBreakdownList(studios),
			ScenesByRating:     toAnalyticsBreakdownList(ratings),
			ScenesByMonth:      toAnalyticsBreakdownList(monthly),
		}

		return nil
	}); err != nil {
		return nil, err
	}

	return &ret, nil
}

// toAnalyticsBreakdownList converts model structs to pointer slice for the GraphQL result.
func toAnalyticsBreakdownList(rows []models.AnalyticsBreakdown) []*models.AnalyticsBreakdown {
	out := make([]*models.AnalyticsBreakdown, len(rows))
	for i := range rows {
		r := rows[i]
		out[i] = &r
	}
	return out
}
