PRAGMA foreign_keys=OFF;

-- Make scene_markers.primary_tag_id nullable with ON DELETE SET NULL.
-- This allows tags used as primary markers to be deleted without cascading
-- the deletion to the marker itself. The marker will simply have no primary tag.
-- See: pkg/sqlite/scene_marker.go TODO comment.

DROP INDEX IF EXISTS `index_scene_markers_on_primary_tag_id`;
DROP INDEX IF EXISTS `index_scene_markers_on_scene_id`;

CREATE TABLE `scene_markers_new` (
  `id`             INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
  `title`          VARCHAR(255) NOT NULL,
  `seconds`        FLOAT    NOT NULL,
  `end_seconds`    FLOAT,
  `primary_tag_id` INTEGER  REFERENCES `tags`(`id`) ON DELETE SET NULL,
  `scene_id`       INTEGER  NOT NULL REFERENCES `scenes`(`id`),
  `created_at`     DATETIME NOT NULL,
  `updated_at`     DATETIME NOT NULL
);

-- Copy existing rows; end_seconds may not exist in older schemas so use COALESCE
INSERT INTO `scene_markers_new`
  SELECT `id`, `title`, `seconds`, `end_seconds`, `primary_tag_id`, `scene_id`, `created_at`, `updated_at`
  FROM `scene_markers`;

DROP TABLE `scene_markers`;
ALTER TABLE `scene_markers_new` RENAME TO `scene_markers`;

CREATE INDEX `index_scene_markers_on_primary_tag_id` ON `scene_markers`(`primary_tag_id`);
CREATE INDEX `index_scene_markers_on_scene_id`       ON `scene_markers`(`scene_id`);

PRAGMA foreign_keys=ON;
