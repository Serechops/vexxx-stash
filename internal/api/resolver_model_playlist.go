package api

import (
	"context"
	"fmt"
	"strconv"

	"github.com/stashapp/stash/internal/api/urlbuilders"
	"github.com/stashapp/stash/pkg/models"
)

type playlistResolver struct{ *Resolver }
type playlistItemResolver struct{ *Resolver }

// Playlist field resolvers

func (r *playlistResolver) ID(ctx context.Context, obj *models.Playlist) (string, error) {
	return strconv.Itoa(obj.ID), nil
}

func (r *playlistResolver) Items(ctx context.Context, obj *models.Playlist) ([]*models.PlaylistItem, error) {
	var items []*models.PlaylistItem
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		items, err = r.repository.Playlist.FindItems(ctx, obj.ID)
		return err
	}); err != nil {
		return nil, err
	}

	return items, nil
}

func (r *playlistResolver) CoverImagePath(ctx context.Context, obj *models.Playlist) (*string, error) {
	baseURL, _ := ctx.Value(BaseURLCtxKey).(string)

	// If a specific cover is set, use that
	if obj.CoverType != nil && obj.CoverID != nil {
		coverType := *obj.CoverType
		coverID := *obj.CoverID

		var path *string
		if err := r.withReadTxn(ctx, func(ctx context.Context) error {
			switch models.PlaylistMediaType(coverType) {
			case models.PlaylistMediaTypeScene:
				scene, err := r.repository.Scene.Find(ctx, coverID)
				if err != nil {
					return err
				}
				if scene != nil {
					p := urlbuilders.NewSceneURLBuilder(baseURL, scene).GetScreenshotURL()
					path = &p
				}
			case models.PlaylistMediaTypeImage:
				image, err := r.repository.Image.Find(ctx, coverID)
				if err != nil {
					return err
				}
				if image != nil {
					p := urlbuilders.NewImageURLBuilder(baseURL, image).GetThumbnailURL()
					path = &p
				}
			case models.PlaylistMediaTypeGallery:
				gallery, err := r.repository.Gallery.Find(ctx, coverID)
				if err != nil {
					return err
				}
				if gallery != nil {
					p := urlbuilders.NewGalleryURLBuilder(baseURL, gallery).GetCoverURL()
					path = &p
				}
			case models.PlaylistMediaTypeGroup:
				group, err := r.repository.Group.Find(ctx, coverID)
				if err != nil {
					return err
				}
				if group != nil {
					hasImage, err := r.repository.Group.HasFrontImage(ctx, coverID)
					if err != nil {
						return err
					}
					p := urlbuilders.NewGroupURLBuilder(baseURL, group).GetGroupFrontImageURL(hasImage)
					path = &p
				}
			}
			return nil
		}); err != nil {
			return nil, err
		}
		return path, nil
	}

	// Otherwise, use first item's thumbnail
	var items []*models.PlaylistItem
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		items, err = r.repository.Playlist.FindItems(ctx, obj.ID)
		return err
	}); err != nil {
		return nil, err
	}

	if len(items) > 0 {
		return r.playlistItemResolver().ThumbnailPath(ctx, items[0])
	}

	return nil, nil
}

func (r *playlistResolver) User(ctx context.Context, obj *models.Playlist) (*models.User, error) {
	if obj.UserID == nil {
		return nil, nil
	}

	var user *models.User
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		user, err = r.repository.User.Find(ctx, *obj.UserID)
		return err
	}); err != nil {
		return nil, err
	}

	return user, nil
}

func (r *playlistResolver) playlistItemResolver() *playlistItemResolver {
	return &playlistItemResolver{r.Resolver}
}

// PlaylistItem field resolvers

func (r *playlistItemResolver) ID(ctx context.Context, obj *models.PlaylistItem) (string, error) {
	return strconv.Itoa(obj.ID), nil
}

func (r *playlistItemResolver) Scene(ctx context.Context, obj *models.PlaylistItem) (*models.Scene, error) {
	if obj.SceneID == nil {
		return nil, nil
	}

	var scene *models.Scene
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		scene, err = r.repository.Scene.Find(ctx, *obj.SceneID)
		return err
	}); err != nil {
		return nil, err
	}

	return scene, nil
}

func (r *playlistItemResolver) Image(ctx context.Context, obj *models.PlaylistItem) (*models.Image, error) {
	if obj.ImageID == nil {
		return nil, nil
	}

	var image *models.Image
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		image, err = r.repository.Image.Find(ctx, *obj.ImageID)
		return err
	}); err != nil {
		return nil, err
	}

	return image, nil
}

func (r *playlistItemResolver) Gallery(ctx context.Context, obj *models.PlaylistItem) (*models.Gallery, error) {
	if obj.GalleryID == nil {
		return nil, nil
	}

	var gallery *models.Gallery
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		gallery, err = r.repository.Gallery.Find(ctx, *obj.GalleryID)
		return err
	}); err != nil {
		return nil, err
	}

	return gallery, nil
}

func (r *playlistItemResolver) Group(ctx context.Context, obj *models.PlaylistItem) (*models.Group, error) {
	if obj.GroupID == nil {
		return nil, nil
	}

	var group *models.Group
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		group, err = r.repository.Group.Find(ctx, *obj.GroupID)
		return err
	}); err != nil {
		return nil, err
	}

	return group, nil
}

func (r *playlistItemResolver) Title(ctx context.Context, obj *models.PlaylistItem) (string, error) {
	switch obj.MediaType {
	case models.PlaylistMediaTypeScene:
		if obj.SceneID != nil {
			var scene *models.Scene
			if err := r.withReadTxn(ctx, func(ctx context.Context) error {
				var err error
				scene, err = r.repository.Scene.Find(ctx, *obj.SceneID)
				return err
			}); err != nil {
				return "", err
			}
			if scene != nil {
				return scene.GetTitle(), nil
			}
		}
	case models.PlaylistMediaTypeImage:
		if obj.ImageID != nil {
			var image *models.Image
			if err := r.withReadTxn(ctx, func(ctx context.Context) error {
				var err error
				image, err = r.repository.Image.Find(ctx, *obj.ImageID)
				return err
			}); err != nil {
				return "", err
			}
			if image != nil {
				return image.GetTitle(), nil
			}
		}
	case models.PlaylistMediaTypeGallery:
		if obj.GalleryID != nil {
			var gallery *models.Gallery
			if err := r.withReadTxn(ctx, func(ctx context.Context) error {
				var err error
				gallery, err = r.repository.Gallery.Find(ctx, *obj.GalleryID)
				return err
			}); err != nil {
				return "", err
			}
			if gallery != nil {
				return gallery.GetTitle(), nil
			}
		}
	case models.PlaylistMediaTypeGroup:
		if obj.GroupID != nil {
			var group *models.Group
			if err := r.withReadTxn(ctx, func(ctx context.Context) error {
				var err error
				group, err = r.repository.Group.Find(ctx, *obj.GroupID)
				return err
			}); err != nil {
				return "", err
			}
			if group != nil {
				return group.Name, nil
			}
		}
	}
	return fmt.Sprintf("Item %d", obj.ID), nil
}

func (r *playlistItemResolver) ThumbnailPath(ctx context.Context, obj *models.PlaylistItem) (*string, error) {
	baseURL, _ := ctx.Value(BaseURLCtxKey).(string)

	switch obj.MediaType {
	case models.PlaylistMediaTypeScene:
		if obj.SceneID != nil {
			var scene *models.Scene
			if err := r.withReadTxn(ctx, func(ctx context.Context) error {
				var err error
				scene, err = r.repository.Scene.Find(ctx, *obj.SceneID)
				return err
			}); err != nil {
				return nil, err
			}
			if scene != nil {
				path := urlbuilders.NewSceneURLBuilder(baseURL, scene).GetScreenshotURL()
				return &path, nil
			}
		}
	case models.PlaylistMediaTypeImage:
		if obj.ImageID != nil {
			var image *models.Image
			if err := r.withReadTxn(ctx, func(ctx context.Context) error {
				var err error
				image, err = r.repository.Image.Find(ctx, *obj.ImageID)
				return err
			}); err != nil {
				return nil, err
			}
			if image != nil {
				path := urlbuilders.NewImageURLBuilder(baseURL, image).GetThumbnailURL()
				return &path, nil
			}
		}
	case models.PlaylistMediaTypeGallery:
		if obj.GalleryID != nil {
			var gallery *models.Gallery
			if err := r.withReadTxn(ctx, func(ctx context.Context) error {
				var err error
				gallery, err = r.repository.Gallery.Find(ctx, *obj.GalleryID)
				return err
			}); err != nil {
				return nil, err
			}
			if gallery != nil {
				path := urlbuilders.NewGalleryURLBuilder(baseURL, gallery).GetCoverURL()
				return &path, nil
			}
		}
	case models.PlaylistMediaTypeGroup:
		if obj.GroupID != nil {
			var group *models.Group
			var hasImage bool
			if err := r.withReadTxn(ctx, func(ctx context.Context) error {
				var err error
				group, err = r.repository.Group.Find(ctx, *obj.GroupID)
				if err != nil {
					return err
				}
				if group != nil {
					hasImage, err = r.repository.Group.HasFrontImage(ctx, *obj.GroupID)
				}
				return err
			}); err != nil {
				return nil, err
			}
			if group != nil {
				path := urlbuilders.NewGroupURLBuilder(baseURL, group).GetGroupFrontImageURL(hasImage)
				return &path, nil
			}
		}
	}
	return nil, nil
}

func (r *playlistItemResolver) EffectiveDuration(ctx context.Context, obj *models.PlaylistItem) (*int, error) {
	// If duration override is set, use it
	if obj.DurationOverride != nil {
		return obj.DurationOverride, nil
	}

	// Otherwise, get duration from media
	switch obj.MediaType {
	case models.PlaylistMediaTypeScene:
		if obj.SceneID != nil {
			var scene *models.Scene
			if err := r.withReadTxn(ctx, func(ctx context.Context) error {
				var err error
				scene, err = r.repository.Scene.Find(ctx, *obj.SceneID)
				if err != nil {
					return err
				}
				if scene != nil {
					return scene.LoadPrimaryFile(ctx, r.repository.File)
				}
				return nil
			}); err != nil {
				return nil, err
			}
			if scene != nil {
				if pf := scene.Files.Primary(); pf != nil {
					duration := int(pf.Duration)
					return &duration, nil
				}
			}
		}
	case models.PlaylistMediaTypeGroup:
		if obj.GroupID != nil {
			var group *models.Group
			if err := r.withReadTxn(ctx, func(ctx context.Context) error {
				var err error
				group, err = r.repository.Group.Find(ctx, *obj.GroupID)
				return err
			}); err != nil {
				return nil, err
			}
			if group != nil && group.Duration != nil {
				duration := *group.Duration
				return &duration, nil
			}
		}
	}

	// Images and galleries don't have inherent duration
	return nil, nil
}
