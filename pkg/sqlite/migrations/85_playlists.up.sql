-- Mixed-Media Playlists
-- Supports Scenes, Groups (Movies), Images, and Galleries

-- Playlists table
CREATE TABLE playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    -- cover can reference any media type
    cover_type TEXT CHECK (cover_type IS NULL OR cover_type IN ('scene', 'image', 'gallery', 'group')),
    cover_id INTEGER,
    duration INTEGER NOT NULL DEFAULT 0,  -- cached total duration in seconds
    item_count INTEGER NOT NULL DEFAULT 0,  -- cached item count
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL  -- optional owner
);

-- Playlist items - polymorphic relationship
CREATE TABLE playlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,  -- order within playlist (0-based)
    -- Media type discriminator
    media_type TEXT NOT NULL CHECK (media_type IN ('scene', 'image', 'gallery', 'group')),
    -- Only one of these will be set based on media_type
    scene_id INTEGER REFERENCES scenes(id) ON DELETE CASCADE,
    image_id INTEGER REFERENCES images(id) ON DELETE CASCADE,
    gallery_id INTEGER REFERENCES galleries(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    -- Item-specific settings
    duration_override INTEGER,  -- custom duration for images (slideshow timing in seconds)
    notes TEXT,  -- optional notes for this item
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Ensure only one media reference is set
    CHECK (
        (media_type = 'scene' AND scene_id IS NOT NULL AND image_id IS NULL AND gallery_id IS NULL AND group_id IS NULL) OR
        (media_type = 'image' AND image_id IS NOT NULL AND scene_id IS NULL AND gallery_id IS NULL AND group_id IS NULL) OR
        (media_type = 'gallery' AND gallery_id IS NOT NULL AND scene_id IS NULL AND image_id IS NULL AND group_id IS NULL) OR
        (media_type = 'group' AND group_id IS NOT NULL AND scene_id IS NULL AND image_id IS NULL AND gallery_id IS NULL)
    ),
    UNIQUE(playlist_id, position)
);

-- Indexes for playlists
CREATE INDEX idx_playlists_name ON playlists(name);
CREATE INDEX idx_playlists_user_id ON playlists(user_id);
CREATE INDEX idx_playlists_updated_at ON playlists(updated_at);

-- Indexes for playlist items
CREATE INDEX idx_playlist_items_playlist_id ON playlist_items(playlist_id);
CREATE INDEX idx_playlist_items_position ON playlist_items(playlist_id, position);
CREATE INDEX idx_playlist_items_scene ON playlist_items(scene_id) WHERE scene_id IS NOT NULL;
CREATE INDEX idx_playlist_items_image ON playlist_items(image_id) WHERE image_id IS NOT NULL;
CREATE INDEX idx_playlist_items_gallery ON playlist_items(gallery_id) WHERE gallery_id IS NOT NULL;
CREATE INDEX idx_playlist_items_group ON playlist_items(group_id) WHERE group_id IS NOT NULL;
