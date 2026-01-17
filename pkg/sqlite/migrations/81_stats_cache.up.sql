-- Stats cache table for fast aggregate counts
CREATE TABLE IF NOT EXISTS `stats` (
    `key` TEXT PRIMARY KEY NOT NULL,
    `value` INTEGER NOT NULL DEFAULT 0
);

-- Populate initial image count (this may take a while for large databases)
INSERT OR REPLACE INTO `stats` (`key`, `value`)
SELECT 'image_count', COUNT(*) FROM `images`;

-- Populate initial scene count
INSERT OR REPLACE INTO `stats` (`key`, `value`)
SELECT 'scene_count', COUNT(*) FROM `scenes`;

-- Populate initial gallery count
INSERT OR REPLACE INTO `stats` (`key`, `value`)
SELECT 'gallery_count', COUNT(*) FROM `galleries`;

-- Populate initial performer count
INSERT OR REPLACE INTO `stats` (`key`, `value`)
SELECT 'performer_count', COUNT(*) FROM `performers`;
