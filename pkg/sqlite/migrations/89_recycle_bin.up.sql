-- Recycle bin: captures full entity snapshots (scalars + join-table data)
-- before destructive DELETE mutations, enabling restore.
--
-- Only DELETE operations are tracked — UPDATE tracking is intentionally
-- omitted to prevent unbounded log growth from scraping sessions.

CREATE TABLE IF NOT EXISTS `recycle_bin` (
  `id`           INTEGER  PRIMARY KEY AUTOINCREMENT,
  `entity_type`  TEXT     NOT NULL,
  `entity_id`    INTEGER  NOT NULL,
  `entity_name`  TEXT     NOT NULL DEFAULT '',
  `deleted_data` TEXT     NOT NULL, -- full JSON snapshot (scalars + join tables)
  `deleted_at`   DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  `group_id`     TEXT     -- groups bulk-delete entries for atomic restore
);

CREATE INDEX IF NOT EXISTS `index_recycle_bin_entity`     ON `recycle_bin`(`entity_type`, `entity_id`);
CREATE INDEX IF NOT EXISTS `index_recycle_bin_deleted_at` ON `recycle_bin`(`deleted_at` DESC);
CREATE INDEX IF NOT EXISTS `index_recycle_bin_group_id`   ON `recycle_bin`(`group_id`) WHERE `group_id` IS NOT NULL;
