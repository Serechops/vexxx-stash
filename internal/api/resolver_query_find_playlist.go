package api

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/stashapp/stash/pkg/models"
)

func (r *queryResolver) FindPlaylist(ctx context.Context, id string) (*models.Playlist, error) {
	idInt, err := strconv.Atoi(id)
	if err != nil {
		return nil, err
	}

	var playlist *models.Playlist
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		playlist, err = r.repository.Playlist.Find(ctx, idInt)
		if err != nil || playlist == nil {
			return err
		}

		return r.hydrateDynamicPlaylistStats(ctx, playlist)
	}); err != nil {
		return nil, err
	}

	return playlist, nil
}

func (r *queryResolver) FindPlaylists(
	ctx context.Context,
	playlistFilter *models.PlaylistFilterType,
	filter *models.FindFilterType,
) (*FindPlaylistsResultType, error) {
	var playlists []*models.Playlist
	var total int

	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error

		if playlistFilter == nil {
			playlistFilter = &models.PlaylistFilterType{}
		}

		playlists, total, err = r.repository.Playlist.Query(ctx, playlistFilter, filter)
		if err != nil {
			return err
		}

		for _, playlist := range playlists {
			if err := r.hydrateDynamicPlaylistStats(ctx, playlist); err != nil {
				return err
			}
		}

		return nil
	}); err != nil {
		return nil, err
	}

	return &FindPlaylistsResultType{
		Count:     total,
		Playlists: playlists,
	}, nil
}

func (r *queryResolver) hydrateDynamicPlaylistStats(ctx context.Context, playlist *models.Playlist) error {
	if playlist == nil || playlist.Criteria == nil || strings.TrimSpace(*playlist.Criteria) == "" {
		return nil
	}

	var criteria models.PlaylistCriteria
	if err := json.Unmarshal([]byte(*playlist.Criteria), &criteria); err != nil {
		return nil
	}

	findFilter := criteria.FindFilter
	if findFilter == nil {
		findFilter = &models.FindFilterType{PerPage: intPtrPlaylist(-1)}
	}

	result, err := r.repository.Scene.Query(ctx, models.SceneQueryOptions{
		QueryOptions: models.QueryOptions{
			FindFilter: findFilter,
			Count:      true,
		},
		SceneFilter:   criteria.SceneFilter,
		TotalDuration: true,
	})
	if err != nil {
		return err
	}

	// result.IDs is the paginated set (respects per_page and filters).
	// result.Count is the total matching rows ignoring pagination.
	// result.TotalDuration is the duration of all matching rows ignoring pagination.
	playlist.ItemCount = len(result.IDs)
	if result.Count > 0 {
		playlist.Duration = int(result.TotalDuration * float64(len(result.IDs)) / float64(result.Count))
	}
	return nil
}

func intPtrPlaylist(i int) *int {
	return &i
}
