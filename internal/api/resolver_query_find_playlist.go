package api

import (
	"context"
	"strconv"

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
		return err
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
		return err
	}); err != nil {
		return nil, err
	}

	return &FindPlaylistsResultType{
		Count:     total,
		Playlists: playlists,
	}, nil
}
