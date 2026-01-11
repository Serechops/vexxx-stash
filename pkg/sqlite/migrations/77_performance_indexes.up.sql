-- Index for looking up scenes by date (Timeline view, filter by date)
CREATE INDEX `index_scenes_on_date` ON `scenes` (`date`);

-- Index for looking up scenes by rating
CREATE INDEX `index_scenes_on_rating` ON `scenes` (`rating`);

-- Index for sorting scenes by creation time
CREATE INDEX `index_scenes_on_created_at` ON `scenes` (`created_at`);

-- Index for sorting scenes by update time
CREATE INDEX `index_scenes_on_updated_at` ON `scenes` (`updated_at`);

-- Indexes for StashID lookups (Prevent full table scans during Auto-Identify)
CREATE INDEX `index_scene_stash_ids_on_stash_id` ON `scene_stash_ids` (`stash_id`);
CREATE INDEX `index_performer_stash_ids_on_stash_id` ON `performer_stash_ids` (`stash_id`);
CREATE INDEX `index_studio_stash_ids_on_stash_id` ON `studio_stash_ids` (`stash_id`);
CREATE INDEX `index_tag_stash_ids_on_stash_id` ON `tag_stash_ids` (`stash_id`);

-- Indexes for File operations (Sorting by mod time, recently created)
CREATE INDEX `index_files_on_mod_time` ON `files` (`mod_time`);
CREATE INDEX `index_files_on_created_at` ON `files` (`created_at`);
