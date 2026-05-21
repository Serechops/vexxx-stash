CREATE TABLE IF NOT EXISTS dismissed_recommendations (
    entity_type TEXT NOT NULL,
    entity_key  TEXT NOT NULL,
    dismissed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (entity_type, entity_key)
);
