-- Migration 83: Content Profile System
-- Stores computed user preference profiles for intelligent recommendations

-- Main content profile table
CREATE TABLE content_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_type TEXT NOT NULL DEFAULT 'user', -- 'user' (global), 'performer', 'studio'
    profile_key TEXT,                           -- For sub-profiles, stores the entity ID
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    profile_data TEXT                           -- JSON blob for flexible storage of computed weights
);

-- Index for quick profile lookups
CREATE UNIQUE INDEX idx_content_profiles_type_key ON content_profiles(profile_type, profile_key);

-- Tag weights cache for quick lookups during recommendation scoring
CREATE TABLE tag_weights (
    profile_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    weight REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, tag_id),
    FOREIGN KEY (profile_id) REFERENCES content_profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Performer weights for scoring
CREATE TABLE performer_weights (
    profile_id INTEGER NOT NULL,
    performer_id INTEGER NOT NULL,
    weight REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, performer_id),
    FOREIGN KEY (profile_id) REFERENCES content_profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (performer_id) REFERENCES performers(id) ON DELETE CASCADE
);

-- Studio weights for scoring
CREATE TABLE studio_weights (
    profile_id INTEGER NOT NULL,
    studio_id INTEGER NOT NULL,
    weight REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, studio_id),
    FOREIGN KEY (profile_id) REFERENCES content_profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE CASCADE
);

-- Performer attribute weights (ethnicity, hair color, etc.)
CREATE TABLE attribute_weights (
    profile_id INTEGER NOT NULL,
    attribute_name TEXT NOT NULL,  -- 'gender', 'ethnicity', 'hair_color', 'eye_color', etc.
    attribute_value TEXT NOT NULL, -- The actual value ('female', 'brunette', 'blue', etc.)
    weight REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, attribute_name, attribute_value),
    FOREIGN KEY (profile_id) REFERENCES content_profiles(id) ON DELETE CASCADE
);

-- Indexes for efficient weight lookups during recommendation scoring
CREATE INDEX idx_tag_weights_profile ON tag_weights(profile_id);
CREATE INDEX idx_performer_weights_profile ON performer_weights(profile_id);
CREATE INDEX idx_studio_weights_profile ON studio_weights(profile_id);
CREATE INDEX idx_attribute_weights_profile ON attribute_weights(profile_id);
