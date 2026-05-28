package sqlite

import (
	"context"

	"github.com/stashapp/stash/pkg/models"
)

// AnalyticsStore runs aggregation queries for the analytics dashboard.
type AnalyticsStore struct{}

// ScenesByCodec returns scene counts and total file size grouped by video codec.
func (s *AnalyticsStore) ScenesByCodec(ctx context.Context) ([]models.AnalyticsBreakdown, error) {
	const q = `
SELECT
  COALESCE(NULLIF(vf.video_codec, ''), 'Unknown') AS label,
  COUNT(DISTINCT s.id)                             AS count,
  CAST(COALESCE(SUM(f.size), 0) AS REAL)          AS size
FROM scenes s
INNER JOIN scenes_files sf ON sf.scene_id = s.id
INNER JOIN files f          ON f.id = sf.file_id
INNER JOIN video_files vf   ON vf.file_id = sf.file_id
GROUP BY vf.video_codec
ORDER BY count DESC`

	var rows []models.AnalyticsBreakdown
	if err := querySelect(ctx, q, nil, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// ScenesByResolution returns scene counts and total file size grouped by height bucket.
func (s *AnalyticsStore) ScenesByResolution(ctx context.Context) ([]models.AnalyticsBreakdown, error) {
	const q = `
SELECT
  CASE
    WHEN vf.height >= 2160 THEN '4K+'
    WHEN vf.height >= 1440 THEN '1440p'
    WHEN vf.height >= 1080 THEN '1080p'
    WHEN vf.height >= 720  THEN '720p'
    WHEN vf.height >= 480  THEN '480p'
    ELSE                        'SD'
  END                                              AS label,
  COUNT(DISTINCT s.id)                             AS count,
  CAST(COALESCE(SUM(f.size), 0) AS REAL)          AS size
FROM scenes s
INNER JOIN scenes_files sf ON sf.scene_id = s.id
INNER JOIN files f          ON f.id = sf.file_id
INNER JOIN video_files vf   ON vf.file_id = sf.file_id
GROUP BY label
ORDER BY count DESC`

	var rows []models.AnalyticsBreakdown
	if err := querySelect(ctx, q, nil, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// ScenesByStudio returns the top 20 studios by scene count with total file size.
func (s *AnalyticsStore) ScenesByStudio(ctx context.Context) ([]models.AnalyticsBreakdown, error) {
	const q = `
SELECT
  COALESCE(st.name, 'No Studio')                  AS label,
  COUNT(s.id)                                      AS count,
  CAST(COALESCE(SUM(f.size), 0) AS REAL)          AS size
FROM scenes s
LEFT JOIN studios st        ON st.id = s.studio_id
INNER JOIN scenes_files sf  ON sf.scene_id = s.id
INNER JOIN files f           ON f.id = sf.file_id
GROUP BY s.studio_id
ORDER BY count DESC
LIMIT 20`

	var rows []models.AnalyticsBreakdown
	if err := querySelect(ctx, q, nil, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// ScenesByRating returns scene counts grouped by star-rating bucket.
func (s *AnalyticsStore) ScenesByRating(ctx context.Context) ([]models.AnalyticsBreakdown, error) {
	const q = `
SELECT
  CASE
    WHEN s.rating IS NULL  THEN 'Unrated'
    WHEN s.rating >= 90   THEN '5★'
    WHEN s.rating >= 70   THEN '4★'
    WHEN s.rating >= 50   THEN '3★'
    WHEN s.rating >= 30   THEN '2★'
    ELSE                       '1★'
  END                              AS label,
  COUNT(s.id)                      AS count,
  0.0                              AS size
FROM scenes s
GROUP BY label
ORDER BY
  CASE label
    WHEN '5★'     THEN 1
    WHEN '4★'     THEN 2
    WHEN '3★'     THEN 3
    WHEN '2★'     THEN 4
    WHEN '1★'     THEN 5
    ELSE               6
  END`

	var rows []models.AnalyticsBreakdown
	if err := querySelect(ctx, q, nil, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// ScenesByMonth returns scene counts per calendar month (YYYY-MM) based on
// file creation date, up to the last 60 months.
func (s *AnalyticsStore) ScenesByMonth(ctx context.Context) ([]models.AnalyticsBreakdown, error) {
	const q = `
SELECT
  strftime('%Y-%m', f.created_at)  AS label,
  COUNT(DISTINCT s.id)             AS count,
  0.0                              AS size
FROM scenes s
INNER JOIN scenes_files sf ON sf.scene_id = s.id
INNER JOIN files f          ON f.id = sf.file_id
WHERE f.created_at IS NOT NULL
GROUP BY label
ORDER BY label
LIMIT 60`

	var rows []models.AnalyticsBreakdown
	if err := querySelect(ctx, q, nil, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// TopStudiosByWatchTime returns the top 15 studios ranked by total accumulated
// play_duration across all their scenes. Size holds total seconds watched.
func (s *AnalyticsStore) TopStudiosByWatchTime(ctx context.Context) ([]models.AnalyticsBreakdown, error) {
	const q = `
SELECT
  COALESCE(st.name, 'No Studio')                  AS label,
  COUNT(DISTINCT s.id)                             AS count,
  CAST(COALESCE(SUM(s.play_duration), 0) AS REAL)  AS size
FROM scenes s
LEFT JOIN studios st ON st.id = s.studio_id
WHERE s.play_duration > 0
GROUP BY s.studio_id
ORDER BY size DESC
LIMIT 15`

	var rows []models.AnalyticsBreakdown
	if err := querySelect(ctx, q, nil, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// TopPerformersByWatchTime returns the top 15 performers ranked by total
// accumulated play_duration across all their scenes. Size holds total seconds.
func (s *AnalyticsStore) TopPerformersByWatchTime(ctx context.Context) ([]models.AnalyticsBreakdown, error) {
	const q = `
SELECT
  p.name                                           AS label,
  COUNT(DISTINCT s.id)                             AS count,
  CAST(COALESCE(SUM(s.play_duration), 0) AS REAL)  AS size
FROM performers p
INNER JOIN performers_scenes ps ON ps.performer_id = p.id
INNER JOIN scenes s             ON s.id = ps.scene_id
WHERE s.play_duration > 0
GROUP BY p.id
ORDER BY size DESC
LIMIT 15`

	var rows []models.AnalyticsBreakdown
	if err := querySelect(ctx, q, nil, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// MonthlyWatchActivity returns the number of play events per calendar month
// from the scenes_view_dates table, up to the last 60 months.
func (s *AnalyticsStore) MonthlyWatchActivity(ctx context.Context) ([]models.AnalyticsBreakdown, error) {
	const q = `
SELECT
  strftime('%Y-%m', svd.view_date)  AS label,
  COUNT(*)                           AS count,
  0.0                                AS size
FROM scenes_view_dates svd
WHERE svd.view_date IS NOT NULL
GROUP BY label
ORDER BY label
LIMIT 60`

	var rows []models.AnalyticsBreakdown
	if err := querySelect(ctx, q, nil, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}
