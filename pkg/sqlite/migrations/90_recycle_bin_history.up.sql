-- Persistent audit log for recycle bin events (deleted, restored, purged).
-- Unlike the recycle_bin table (which only holds pending items), this table
-- is never truncated by normal operations; entries accumulate over time.

CREATE TABLE IF NOT EXISTS `recycle_bin_history` (
  `id`           INTEGER  PRIMARY KEY AUTOINCREMENT,
  `entity_type`  TEXT     NOT NULL,
  `entity_id`    INTEGER  NOT NULL,
  `entity_name`  TEXT     NOT NULL DEFAULT '',
  `action`       TEXT     NOT NULL, -- 'deleted', 'restored', 'purged'
  `actioned_at`  DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  `group_id`     TEXT,
  `notes`        TEXT     NOT NULL DEFAULT ''  -- summary of affected associations
);

CREATE INDEX IF NOT EXISTS `index_recycle_bin_history_actioned_at` ON `recycle_bin_history`(`actioned_at` DESC);
CREATE INDEX IF NOT EXISTS `index_recycle_bin_history_entity`      ON `recycle_bin_history`(`entity_type`, `entity_id`);
