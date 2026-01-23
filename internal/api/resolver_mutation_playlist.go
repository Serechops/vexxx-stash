package api

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/stashapp/stash/pkg/models"
)

// PlaylistCreate creates a new playlist
func (r *mutationResolver) PlaylistCreate(ctx context.Context, input models.PlaylistCreateInput) (*models.Playlist, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return nil, errors.New("playlist name cannot be empty")
	}

	now := time.Now()
	playlist := &models.Playlist{
		Name:      name,
		CreatedAt: now,
		UpdatedAt: now,
		ItemCount: 0,
		Duration:  0,
	}

	// Handle description if provided
	if input.Description != nil {
		playlist.Description = *input.Description
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		return r.repository.Playlist.Create(ctx, playlist)
	}); err != nil {
		return nil, err
	}

	return playlist, nil
}

// PlaylistUpdate updates an existing playlist
func (r *mutationResolver) PlaylistUpdate(ctx context.Context, input models.PlaylistUpdateInput) (*models.Playlist, error) {
	id, err := strconv.Atoi(input.ID)
	if err != nil {
		return nil, fmt.Errorf("invalid playlist id: %w", err)
	}

	var playlist *models.Playlist
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		// Find existing playlist
		existing, err := r.repository.Playlist.Find(ctx, id)
		if err != nil {
			return err
		}
		if existing == nil {
			return fmt.Errorf("playlist not found: %d", id)
		}

		// Build partial update
		partial := models.NewPlaylistPartial()

		if input.Name != nil {
			name := strings.TrimSpace(*input.Name)
			if name == "" {
				return errors.New("playlist name cannot be empty")
			}
			partial.Name = models.NewOptionalString(name)
		}

		if input.Description != nil {
			partial.Description = models.NewOptionalString(*input.Description)
		}

		if input.CoverType != nil {
			partial.CoverType = models.NewOptionalString(string(*input.CoverType))
		}

		if input.CoverID != nil {
			coverID, err := strconv.Atoi(*input.CoverID)
			if err != nil {
				return fmt.Errorf("invalid cover_id: %w", err)
			}
			partial.CoverID = models.NewOptionalInt(coverID)
		}

		playlist, err = r.repository.Playlist.Update(ctx, id, partial)
		return err
	}); err != nil {
		return nil, err
	}

	return playlist, nil
}

// PlaylistDestroy deletes a playlist
func (r *mutationResolver) PlaylistDestroy(ctx context.Context, id string) (bool, error) {
	idInt, err := strconv.Atoi(id)
	if err != nil {
		return false, fmt.Errorf("invalid playlist id: %w", err)
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		return r.repository.Playlist.Destroy(ctx, idInt)
	}); err != nil {
		return false, err
	}

	return true, nil
}

// PlaylistAddItems adds items to a playlist
func (r *mutationResolver) PlaylistAddItems(ctx context.Context, input models.PlaylistAddItemsInput) (*models.Playlist, error) {
	playlistID, err := strconv.Atoi(input.PlaylistID)
	if err != nil {
		return nil, fmt.Errorf("invalid playlist_id: %w", err)
	}

	if len(input.Items) == 0 {
		return nil, errors.New("no items provided")
	}

	var playlist *models.Playlist
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		// Verify playlist exists
		existing, err := r.repository.Playlist.Find(ctx, playlistID)
		if err != nil {
			return err
		}
		if existing == nil {
			return fmt.Errorf("playlist not found: %d", playlistID)
		}

		// Convert input items to PlaylistItem
		items := make([]*models.PlaylistItem, len(input.Items))
		for i, item := range input.Items {
			playlistItem, err := playlistItemFromInput(playlistID, item)
			if err != nil {
				return err
			}
			items[i] = playlistItem
		}

		// Add items
		if err := r.repository.Playlist.AddItems(ctx, playlistID, items, input.Position); err != nil {
			return err
		}

		// Update cached stats
		if err := r.repository.Playlist.UpdateCachedStats(ctx, playlistID); err != nil {
			return err
		}

		// Fetch updated playlist
		playlist, err = r.repository.Playlist.Find(ctx, playlistID)
		return err
	}); err != nil {
		return nil, err
	}

	return playlist, nil
}

// PlaylistRemoveItems removes items from a playlist
func (r *mutationResolver) PlaylistRemoveItems(ctx context.Context, input models.PlaylistRemoveItemsInput) (*models.Playlist, error) {
	playlistID, err := strconv.Atoi(input.PlaylistID)
	if err != nil {
		return nil, fmt.Errorf("invalid playlist_id: %w", err)
	}

	if len(input.ItemIDs) == 0 {
		return nil, errors.New("no item IDs provided")
	}

	// Convert string IDs to ints
	itemIDs := make([]int, len(input.ItemIDs))
	for i, idStr := range input.ItemIDs {
		itemID, err := strconv.Atoi(idStr)
		if err != nil {
			return nil, fmt.Errorf("invalid item_id: %w", err)
		}
		itemIDs[i] = itemID
	}

	var playlist *models.Playlist
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		// Verify playlist exists
		existing, err := r.repository.Playlist.Find(ctx, playlistID)
		if err != nil {
			return err
		}
		if existing == nil {
			return fmt.Errorf("playlist not found: %d", playlistID)
		}

		// Remove items
		if err := r.repository.Playlist.RemoveItems(ctx, playlistID, itemIDs); err != nil {
			return err
		}

		// Update cached stats
		if err := r.repository.Playlist.UpdateCachedStats(ctx, playlistID); err != nil {
			return err
		}

		// Fetch updated playlist
		playlist, err = r.repository.Playlist.Find(ctx, playlistID)
		return err
	}); err != nil {
		return nil, err
	}

	return playlist, nil
}

// PlaylistReorderItems reorders items in a playlist
func (r *mutationResolver) PlaylistReorderItems(ctx context.Context, input models.PlaylistReorderInput) (*models.Playlist, error) {
	playlistID, err := strconv.Atoi(input.PlaylistID)
	if err != nil {
		return nil, fmt.Errorf("invalid playlist_id: %w", err)
	}

	if len(input.ItemIDs) == 0 {
		return nil, errors.New("no item IDs provided")
	}

	// Convert string IDs to ints
	itemIDs := make([]int, len(input.ItemIDs))
	for i, idStr := range input.ItemIDs {
		itemID, err := strconv.Atoi(idStr)
		if err != nil {
			return nil, fmt.Errorf("invalid item_id: %w", err)
		}
		itemIDs[i] = itemID
	}

	var playlist *models.Playlist
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		// Verify playlist exists
		existing, err := r.repository.Playlist.Find(ctx, playlistID)
		if err != nil {
			return err
		}
		if existing == nil {
			return fmt.Errorf("playlist not found: %d", playlistID)
		}

		// Reorder items - positions are implied by the order of itemIDs
		if err := r.repository.Playlist.ReorderItems(ctx, playlistID, itemIDs); err != nil {
			return err
		}

		// Fetch updated playlist
		playlist, err = r.repository.Playlist.Find(ctx, playlistID)
		return err
	}); err != nil {
		return nil, err
	}

	return playlist, nil
}

// PlaylistAddScene is a quick-add helper for adding a scene to a playlist
func (r *mutationResolver) PlaylistAddScene(ctx context.Context, playlistID string, sceneID string) (*models.Playlist, error) {
	return r.PlaylistAddItems(ctx, models.PlaylistAddItemsInput{
		PlaylistID: playlistID,
		Items: []models.PlaylistItemInput{
			{
				MediaType: models.PlaylistMediaTypeScene,
				MediaID:   sceneID,
			},
		},
	})
}

// PlaylistAddImage is a quick-add helper for adding an image to a playlist
func (r *mutationResolver) PlaylistAddImage(ctx context.Context, playlistID string, imageID string) (*models.Playlist, error) {
	return r.PlaylistAddItems(ctx, models.PlaylistAddItemsInput{
		PlaylistID: playlistID,
		Items: []models.PlaylistItemInput{
			{
				MediaType: models.PlaylistMediaTypeImage,
				MediaID:   imageID,
			},
		},
	})
}

// PlaylistAddGallery is a quick-add helper for adding a gallery to a playlist
func (r *mutationResolver) PlaylistAddGallery(ctx context.Context, playlistID string, galleryID string) (*models.Playlist, error) {
	return r.PlaylistAddItems(ctx, models.PlaylistAddItemsInput{
		PlaylistID: playlistID,
		Items: []models.PlaylistItemInput{
			{
				MediaType: models.PlaylistMediaTypeGallery,
				MediaID:   galleryID,
			},
		},
	})
}

// PlaylistAddGroup is a quick-add helper for adding a group to a playlist
func (r *mutationResolver) PlaylistAddGroup(ctx context.Context, playlistID string, groupID string) (*models.Playlist, error) {
	return r.PlaylistAddItems(ctx, models.PlaylistAddItemsInput{
		PlaylistID: playlistID,
		Items: []models.PlaylistItemInput{
			{
				MediaType: models.PlaylistMediaTypeGroup,
				MediaID:   groupID,
			},
		},
	})
}

// playlistItemFromInput converts a PlaylistItemInput to a PlaylistItem
func playlistItemFromInput(playlistID int, input models.PlaylistItemInput) (*models.PlaylistItem, error) {
	mediaID, err := strconv.Atoi(input.MediaID)
	if err != nil {
		return nil, fmt.Errorf("invalid media_id: %w", err)
	}

	item := &models.PlaylistItem{
		PlaylistID: playlistID,
		MediaType:  input.MediaType,
	}

	switch input.MediaType {
	case models.PlaylistMediaTypeScene:
		item.SceneID = &mediaID
	case models.PlaylistMediaTypeImage:
		item.ImageID = &mediaID
	case models.PlaylistMediaTypeGallery:
		item.GalleryID = &mediaID
	case models.PlaylistMediaTypeGroup:
		item.GroupID = &mediaID
	default:
		return nil, fmt.Errorf("unknown media type: %s", input.MediaType)
	}

	return item, nil
}
