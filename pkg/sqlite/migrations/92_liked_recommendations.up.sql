-- Migration 92: Liked Recommendations
-- Stores explicit positive signals from the user so they persist across
-- sessions and can feed back into profile weight nudges.

CREATE TABLE IF NOT EXISTS liked_recommendations (
    entity_type TEXT NOT NULL,
    entity_key  TEXT NOT NULL,
    liked_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (entity_type, entity_key)
);
