package models

import (
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

// PlaylistMediaType represents the type of media in a playlist item
type PlaylistMediaType string

const (
	PlaylistMediaTypeScene   PlaylistMediaType = "scene"
	PlaylistMediaTypeImage   PlaylistMediaType = "image"
	PlaylistMediaTypeGallery PlaylistMediaType = "gallery"
	PlaylistMediaTypeGroup   PlaylistMediaType = "group"
)

func (p PlaylistMediaType) IsValid() bool {
	switch p {
	case PlaylistMediaTypeScene, PlaylistMediaTypeImage, PlaylistMediaTypeGallery, PlaylistMediaTypeGroup:
		return true
	}
	return false
}

func (p PlaylistMediaType) String() string {
	return string(p)
}

func (p *PlaylistMediaType) UnmarshalGQL(v interface{}) error {
	str, ok := v.(string)
	if !ok {
		return fmt.Errorf("enums must be strings")
	}

	// Convert from GraphQL uppercase to database lowercase
	*p = PlaylistMediaType(strings.ToLower(str))
	if !p.IsValid() {
		return fmt.Errorf("%s is not a valid PlaylistMediaType", str)
	}
	return nil
}

func (p PlaylistMediaType) MarshalGQL(w io.Writer) {
	// Convert from database lowercase to GraphQL uppercase
	fmt.Fprint(w, strconv.Quote(strings.ToUpper(p.String())))
}

// Playlist represents a collection of mixed media items
type Playlist struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CoverType   *string   `json:"cover_type"`
	CoverID     *int      `json:"cover_id"`
	Duration    int       `json:"duration"`   // cached total duration in seconds
	ItemCount   int       `json:"item_count"` // cached item count
	UserID      *int      `json:"user_id"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// NewPlaylist creates a new Playlist with default values
func NewPlaylist() Playlist {
	currentTime := time.Now()
	return Playlist{
		CreatedAt: currentTime,
		UpdatedAt: currentTime,
	}
}

// PlaylistPartial represents part of a Playlist for partial updates
type PlaylistPartial struct {
	Name        OptionalString
	Description OptionalString
	CoverType   OptionalString
	CoverID     OptionalInt
	Duration    OptionalInt
	ItemCount   OptionalInt
	UserID      OptionalInt
	UpdatedAt   OptionalTime
}

// NewPlaylistPartial creates a new PlaylistPartial with UpdatedAt set
func NewPlaylistPartial() PlaylistPartial {
	return PlaylistPartial{
		UpdatedAt: NewOptionalTime(time.Now()),
	}
}

// PlaylistItem represents a single item in a playlist
type PlaylistItem struct {
	ID               int               `json:"id"`
	PlaylistID       int               `json:"playlist_id"`
	Position         int               `json:"position"`
	MediaType        PlaylistMediaType `json:"media_type"`
	SceneID          *int              `json:"scene_id"`
	ImageID          *int              `json:"image_id"`
	GalleryID        *int              `json:"gallery_id"`
	GroupID          *int              `json:"group_id"`
	DurationOverride *int              `json:"duration_override"`
	Notes            string            `json:"notes"`
	CreatedAt        time.Time         `json:"created_at"`
}

// NewPlaylistItem creates a new PlaylistItem with default values
func NewPlaylistItem() PlaylistItem {
	return PlaylistItem{
		CreatedAt: time.Now(),
	}
}

// GetMediaID returns the media ID based on the media type
func (pi *PlaylistItem) GetMediaID() *int {
	switch pi.MediaType {
	case PlaylistMediaTypeScene:
		return pi.SceneID
	case PlaylistMediaTypeImage:
		return pi.ImageID
	case PlaylistMediaTypeGallery:
		return pi.GalleryID
	case PlaylistMediaTypeGroup:
		return pi.GroupID
	}
	return nil
}

// PlaylistCreateInput contains data for creating a new playlist
type PlaylistCreateInput struct {
	Name        string  `json:"name"`
	Description *string `json:"description"`
}

// PlaylistUpdateInput contains data for updating an existing playlist
type PlaylistUpdateInput struct {
	ID          string             `json:"id"`
	Name        *string            `json:"name"`
	Description *string            `json:"description"`
	CoverType   *PlaylistMediaType `json:"cover_type"`
	CoverID     *string            `json:"cover_id"`
}

// PlaylistItemInput represents input for adding an item to a playlist
type PlaylistItemInput struct {
	MediaType        PlaylistMediaType `json:"media_type"`
	MediaID          string            `json:"media_id"`
	DurationOverride *int              `json:"duration_override"`
	Notes            *string           `json:"notes"`
}

// PlaylistAddItemsInput contains data for adding items to a playlist
type PlaylistAddItemsInput struct {
	PlaylistID string              `json:"playlist_id"`
	Items      []PlaylistItemInput `json:"items"`
	Position   *int                `json:"position"` // insert at position, nil = append
}

// PlaylistRemoveItemsInput contains data for removing items from a playlist
type PlaylistRemoveItemsInput struct {
	PlaylistID string   `json:"playlist_id"`
	ItemIDs    []string `json:"item_ids"`
}

// PlaylistReorderInput contains data for reordering playlist items
type PlaylistReorderInput struct {
	PlaylistID string   `json:"playlist_id"`
	ItemIDs    []string `json:"item_ids"` // new order of item IDs
}

// PlaylistFilterType contains filter criteria for finding playlists
type PlaylistFilterType struct {
	Name      *StringCriterionInput    `json:"name"`
	UserID    *IntCriterionInput       `json:"user_id"`
	ItemCount *IntCriterionInput       `json:"item_count"`
	Duration  *IntCriterionInput       `json:"duration"`
	CreatedAt *TimestampCriterionInput `json:"created_at"`
	UpdatedAt *TimestampCriterionInput `json:"updated_at"`
}
