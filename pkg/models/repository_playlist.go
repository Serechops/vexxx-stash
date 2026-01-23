package models

import "context"

// PlaylistFinder provides methods to find playlists
type PlaylistFinder interface {
	Find(ctx context.Context, id int) (*Playlist, error)
	FindMany(ctx context.Context, ids []int) ([]*Playlist, error)
	FindByName(ctx context.Context, name string) (*Playlist, error)
}

// PlaylistQueryer provides methods to query playlists
type PlaylistQueryer interface {
	Query(ctx context.Context, playlistFilter *PlaylistFilterType, findFilter *FindFilterType) ([]*Playlist, int, error)
	QueryCount(ctx context.Context, playlistFilter *PlaylistFilterType, findFilter *FindFilterType) (int, error)
}

// PlaylistCreator provides methods to create playlists
type PlaylistCreator interface {
	Create(ctx context.Context, newPlaylist *Playlist) error
}

// PlaylistUpdater provides methods to update playlists
type PlaylistUpdater interface {
	Update(ctx context.Context, id int, partial PlaylistPartial) (*Playlist, error)
	UpdateFull(ctx context.Context, updatedPlaylist *Playlist) error
}

// PlaylistDestroyer provides methods to delete playlists
type PlaylistDestroyer interface {
	Destroy(ctx context.Context, id int) error
}

// PlaylistItemFinder provides methods to find playlist items
type PlaylistItemFinder interface {
	FindItems(ctx context.Context, playlistID int) ([]*PlaylistItem, error)
	FindItem(ctx context.Context, id int) (*PlaylistItem, error)
	FindItemsByScene(ctx context.Context, sceneID int) ([]*PlaylistItem, error)
	FindItemsByImage(ctx context.Context, imageID int) ([]*PlaylistItem, error)
	FindItemsByGallery(ctx context.Context, galleryID int) ([]*PlaylistItem, error)
	FindItemsByGroup(ctx context.Context, groupID int) ([]*PlaylistItem, error)
	CountByMediaType(ctx context.Context, playlistID int, mediaType PlaylistMediaType) (int, error)
}

// PlaylistItemWriter provides methods to modify playlist items
type PlaylistItemWriter interface {
	AddItems(ctx context.Context, playlistID int, items []*PlaylistItem, position *int) error
	RemoveItems(ctx context.Context, playlistID int, itemIDs []int) error
	ReorderItems(ctx context.Context, playlistID int, itemIDs []int) error
	UpdateItemPosition(ctx context.Context, itemID int, newPosition int) error
}

// PlaylistCacheUpdater provides methods to update cached playlist statistics
type PlaylistCacheUpdater interface {
	UpdateCachedStats(ctx context.Context, playlistID int) error
}

// PlaylistReader combines all read interfaces
type PlaylistReader interface {
	PlaylistFinder
	PlaylistQueryer
	PlaylistItemFinder
}

// PlaylistWriter combines all write interfaces
type PlaylistWriter interface {
	PlaylistCreator
	PlaylistUpdater
	PlaylistDestroyer
	PlaylistItemWriter
	PlaylistCacheUpdater
}

// PlaylistReaderWriter combines reader and writer interfaces
type PlaylistReaderWriter interface {
	PlaylistReader
	PlaylistWriter
}
