CREATE TABLE potential_scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stash_id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(stash_id)
);
