# Mixed-Media Playlist Feature Design

## Overview

This document outlines the design and implementation plan for a Mixed-Media Playlist system that supports all of Stash's content types: Scenes, Groups (Movies), Images, and Galleries.

## Feature Requirements

### Core Functionality
1. Create, read, update, delete playlists
2. Add/remove items from playlists with support for:
   - Scenes (video playback)
   - Groups/Movies (collection of scenes)
   - Images (single image display)
   - Galleries (image collection slideshow)
3. Reorder items within a playlist
4. Playlist metadata (name, description, cover image)
5. Shuffle and repeat modes
6. Remember playback position

### User Experience
1. Playlist dashboard for management
2. Continuous playback across different media types
3. Drag-and-drop reordering
4. Quick add from any content page
5. Playlist sharing (optional/future)

---

## Database Schema

### Migration: 85_playlists.up.sql

```sql
-- Playlists table
CREATE TABLE playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    -- cover can reference any media type
    cover_type TEXT CHECK (cover_type IN ('scene', 'image', 'gallery', 'group')),
    cover_id INTEGER,
    duration INTEGER DEFAULT 0,  -- cached total duration in seconds
    item_count INTEGER DEFAULT 0,  -- cached item count
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL  -- optional owner
);

-- Playlist items - polymorphic relationship
CREATE TABLE playlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,  -- order within playlist
    -- Media type discriminator
    media_type TEXT NOT NULL CHECK (media_type IN ('scene', 'image', 'gallery', 'group')),
    -- Only one of these will be set based on media_type
    scene_id INTEGER REFERENCES scenes(id) ON DELETE CASCADE,
    image_id INTEGER REFERENCES images(id) ON DELETE CASCADE,
    gallery_id INTEGER REFERENCES galleries(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    -- Item-specific settings
    duration_override INTEGER,  -- custom duration for images (slideshow timing)
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

-- Indexes
CREATE INDEX idx_playlists_name ON playlists(name);
CREATE INDEX idx_playlists_user_id ON playlists(user_id);
CREATE INDEX idx_playlist_items_playlist_id ON playlist_items(playlist_id);
CREATE INDEX idx_playlist_items_position ON playlist_items(playlist_id, position);
CREATE INDEX idx_playlist_items_scene ON playlist_items(scene_id) WHERE scene_id IS NOT NULL;
CREATE INDEX idx_playlist_items_image ON playlist_items(image_id) WHERE image_id IS NOT NULL;
CREATE INDEX idx_playlist_items_gallery ON playlist_items(gallery_id) WHERE gallery_id IS NOT NULL;
CREATE INDEX idx_playlist_items_group ON playlist_items(group_id) WHERE group_id IS NOT NULL;
```

---

## Backend Models

### pkg/models/model_playlist.go

```go
package models

type PlaylistMediaType string

const (
    PlaylistMediaTypeScene   PlaylistMediaType = "scene"
    PlaylistMediaTypeImage   PlaylistMediaType = "image"
    PlaylistMediaTypeGallery PlaylistMediaType = "gallery"
    PlaylistMediaTypeGroup   PlaylistMediaType = "group"
)

type Playlist struct {
    ID          int       `json:"id"`
    Name        string    `json:"name"`
    Description string    `json:"description"`
    CoverType   *string   `json:"cover_type"`
    CoverID     *int      `json:"cover_id"`
    Duration    int       `json:"duration"`     // cached
    ItemCount   int       `json:"item_count"`   // cached
    UserID      *int      `json:"user_id"`
    CreatedAt   time.Time `json:"created_at"`
    UpdatedAt   time.Time `json:"updated_at"`
}

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

// Input types for GraphQL
type PlaylistCreateInput struct {
    Name        string  `json:"name"`
    Description *string `json:"description"`
    UserID      *int    `json:"user_id"`
}

type PlaylistUpdateInput struct {
    ID          string  `json:"id"`
    Name        *string `json:"name"`
    Description *string `json:"description"`
    CoverType   *string `json:"cover_type"`
    CoverID     *string `json:"cover_id"`
}

type PlaylistItemInput struct {
    MediaType        PlaylistMediaType `json:"media_type"`
    MediaID          string            `json:"media_id"`
    DurationOverride *int              `json:"duration_override"`
    Notes            *string           `json:"notes"`
}

type PlaylistAddItemsInput struct {
    PlaylistID string              `json:"playlist_id"`
    Items      []PlaylistItemInput `json:"items"`
    Position   *int                `json:"position"` // insert at position, nil = append
}

type PlaylistRemoveItemsInput struct {
    PlaylistID string   `json:"playlist_id"`
    ItemIDs    []string `json:"item_ids"`
}

type PlaylistReorderInput struct {
    PlaylistID string   `json:"playlist_id"`
    ItemIDs    []string `json:"item_ids"` // new order
}
```

---

## GraphQL Schema

### graphql/schema/types/playlist.graphql

```graphql
enum PlaylistMediaType {
  SCENE
  IMAGE
  GALLERY
  GROUP
}

type Playlist {
  id: ID!
  name: String!
  description: String
  duration: Int!
  item_count: Int!
  user: User
  created_at: Time!
  updated_at: Time!
  
  # Resolved fields
  cover_image_path: String
  items: [PlaylistItem!]!
  
  # Playback tracking
  current_position: Int  # last played item position
}

type PlaylistItem {
  id: ID!
  position: Int!
  media_type: PlaylistMediaType!
  duration_override: Int
  notes: String
  created_at: Time!
  
  # Union-like resolved content
  scene: Scene
  image: Image
  gallery: Gallery
  group: Group
  
  # Computed
  title: String!          # resolved from media
  thumbnail_path: String  # resolved from media
  duration: Int           # from media or override
}

input PlaylistCreateInput {
  name: String!
  description: String
}

input PlaylistUpdateInput {
  id: ID!
  name: String
  description: String
  cover_type: PlaylistMediaType
  cover_id: ID
}

input PlaylistItemInput {
  media_type: PlaylistMediaType!
  media_id: ID!
  duration_override: Int
  notes: String
}

input PlaylistAddItemsInput {
  playlist_id: ID!
  items: [PlaylistItemInput!]!
  position: Int  # null = append
}

input PlaylistRemoveItemsInput {
  playlist_id: ID!
  item_ids: [ID!]!
}

input PlaylistReorderInput {
  playlist_id: ID!
  item_ids: [ID!]!  # complete new order
}

input PlaylistFilterType {
  name: StringCriterionInput
  user_id: IntCriterionInput
  item_count: IntCriterionInput
  duration: IntCriterionInput
  created_at: TimestampCriterionInput
  updated_at: TimestampCriterionInput
}

type FindPlaylistsResultType {
  count: Int!
  playlists: [Playlist!]!
}

# Add to Query type
extend type Query {
  findPlaylist(id: ID!): Playlist
  findPlaylists(filter: FindFilterType, playlist_filter: PlaylistFilterType): FindPlaylistsResultType!
}

# Add to Mutation type
extend type Mutation {
  playlistCreate(input: PlaylistCreateInput!): Playlist!
  playlistUpdate(input: PlaylistUpdateInput!): Playlist!
  playlistDestroy(id: ID!): Boolean!
  
  playlistAddItems(input: PlaylistAddItemsInput!): Playlist!
  playlistRemoveItems(input: PlaylistRemoveItemsInput!): Playlist!
  playlistReorderItems(input: PlaylistReorderInput!): Playlist!
  
  # Convenience mutations
  playlistAddScene(playlist_id: ID!, scene_id: ID!): Playlist!
  playlistAddImage(playlist_id: ID!, image_id: ID!): Playlist!
  playlistAddGallery(playlist_id: ID!, gallery_id: ID!): Playlist!
  playlistAddGroup(playlist_id: ID!, group_id: ID!): Playlist!
}
```

---

## Implementation Plan

### Phase 1: Database & Models (Backend Foundation)
1. Create migration `85_playlists.up.sql`
2. Create `pkg/models/model_playlist.go` with types
3. Create `pkg/models/repository_playlist.go` with interface
4. Create `pkg/sqlite/playlist.go` with SQLite implementation

### Phase 2: GraphQL Layer
1. Create `graphql/schema/types/playlist.graphql`
2. Update `graphql/schema/schema.graphql` with Query/Mutation extensions
3. Create `internal/api/resolver_model_playlist.go` for field resolvers
4. Create `internal/api/resolver_mutation_playlist.go` for mutations
5. Create `internal/api/resolver_query_playlist.go` for queries
6. Update `gqlgen.yml` with model mappings
7. Regenerate GraphQL code

### Phase 3: Frontend - Core Components
1. Create GraphQL queries/mutations in `ui/v2.5/graphql/`
2. Create `PlaylistCard` component
3. Create `PlaylistList` component
4. Create `PlaylistEditDialog` component
5. Create `AddToPlaylistDialog` component

### Phase 4: Frontend - Dashboard
1. Create `PlaylistDashboard` page component
2. Add route configuration
3. Implement playlist CRUD operations
4. Implement drag-and-drop reordering

### Phase 5: Frontend - Playback
1. Create `PlaylistPlayer` component
2. Handle transitions between media types
3. Implement shuffle/repeat modes
4. Save playback position

### Phase 6: Integration
1. Add "Add to Playlist" buttons on Scene, Image, Gallery, Group pages
2. Add playlist counts to content details
3. Add playlist section to sidebar navigation

---

## File Structure

```
pkg/
  models/
    model_playlist.go        # Playlist and PlaylistItem types
    repository_playlist.go   # Repository interface
  sqlite/
    playlist.go              # SQLite implementation
    playlist_filter.go       # Filter handling
    migrations/
      85_playlists.up.sql    # Database migration

graphql/
  schema/
    types/
      playlist.graphql       # GraphQL type definitions
    schema.graphql           # Query/Mutation extensions

internal/
  api/
    resolver_model_playlist.go      # Field resolvers
    resolver_mutation_playlist.go   # Mutation resolvers
    resolver_query_playlist.go      # Query resolvers

ui/v2.5/
  graphql/
    queries/
      playlist.graphql       # GraphQL queries
    mutations/
      playlist.graphql       # GraphQL mutations
    data/
      playlist.graphql       # Fragments
  src/
    components/
      Playlists/
        PlaylistCard.tsx
        PlaylistList.tsx
        PlaylistEditDialog.tsx
        PlaylistPlayer.tsx
        AddToPlaylistDialog.tsx
        PlaylistDashboard.tsx
        index.ts
```

---

## API Examples

### Create Playlist
```graphql
mutation {
  playlistCreate(input: {
    name: "My Mixed Playlist"
    description: "Scenes and images"
  }) {
    id
    name
  }
}
```

### Add Items
```graphql
mutation {
  playlistAddItems(input: {
    playlist_id: "1"
    items: [
      { media_type: SCENE, media_id: "42" }
      { media_type: IMAGE, media_id: "100", duration_override: 10 }
      { media_type: GALLERY, media_id: "5" }
    ]
  }) {
    id
    item_count
    items {
      position
      media_type
      title
    }
  }
}
```

### Query Playlist with Items
```graphql
query {
  findPlaylist(id: "1") {
    id
    name
    items {
      id
      position
      media_type
      title
      thumbnail_path
      duration
      scene { id title }
      image { id title }
      gallery { id title }
      group { id name }
    }
  }
}
```

---

## Implementation Priority

1. **Must Have (MVP)**
   - Basic CRUD for playlists
   - Add/remove items
   - Simple list view
   - Basic playback

2. **Should Have**
   - Drag-and-drop reordering
   - Cover image selection
   - Playback position memory

3. **Nice to Have**
   - Shuffle/repeat modes
   - Smart playlists (auto-generated)
   - Playlist sharing
   - Import/export

---

## Notes

- Groups can contain multiple scenes, so playing a Group should either:
  - Play all scenes in the group sequentially
  - Or just show group info as a "chapter marker"
- Images/Galleries need configurable display duration for slideshow mode
- Consider adding a "quick playlist" for ad-hoc playback without saving
