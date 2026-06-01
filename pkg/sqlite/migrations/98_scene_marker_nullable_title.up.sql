PRAGMA foreign_keys=OFF;

-- Make scene_markers.title nullable.
-- Previously stored as NOT NULL VARCHAR; empty string was the sentinel for "no title".
-- Now uses NULL to represent "no title", consistent with gallery_chapters.title.
-- Existing rows with empty-string titles are converted to NULL via NULLIF.

DROP INDEX IF EXISTS `index_scene_markers_on_primary_tag_id`;
DROP INDEX IF EXISTS `index_scene_markers_on_scene_id`;

CREATE TABLE `scene_markers_new` (
  `id`             INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
  `title`          VARCHAR(255),
  `seconds`        FLOAT    NOT NULL,
  `end_seconds`    FLOAT,
  `primary_tag_id` INTEGER  REFERENCES `tags`(`id`) ON DELETE SET NULL,
  `scene_id`       INTEGER  NOT NULL REFERENCES `scenes`(`id`),
  `created_at`     DATETIME NOT NULL,
  `updated_at`     DATETIME NOT NULL
);

-- Copy existing rows; convert empty-string titles to NULL
INSERT INTO `scene_markers_new`
  SELECT `id`, NULLIF(`title`, ''), `seconds`, `end_seconds`, `primary_tag_id`, `scene_id`, `created_at`, `updated_at`
  FROM `scene_markers`;

DROP TABLE `scene_markers`;
ALTER TABLE `scene_markers_new` RENAME TO `scene_markers`;

CREATE INDEX `index_scene_markers_on_primary_tag_id` ON `scene_markers`(`primary_tag_id`);
CREATE INDEX `index_scene_markers_on_scene_id`       ON `scene_markers`(`scene_id`);

PRAGMA foreign_keys=ON;
