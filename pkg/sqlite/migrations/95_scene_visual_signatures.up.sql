CREATE TABLE IF NOT EXISTS scene_visual_signatures (
    scene_id   INTEGER   NOT NULL PRIMARY KEY,
    signature  BLOB      NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS index_scene_visual_signatures_updated_at
    ON scene_visual_signatures (updated_at);
