CREATE INDEX IF NOT EXISTS `index_images_on_date` ON `images` (`date`);
CREATE INDEX IF NOT EXISTS `index_images_on_created_at` ON `images` (`created_at`);
CREATE INDEX IF NOT EXISTS `index_images_on_rating` ON `images` (`rating`);
CREATE INDEX IF NOT EXISTS `index_images_on_organized` ON `images` (`organized`);
CREATE INDEX IF NOT EXISTS `index_images_on_o_counter` ON `images` (`o_counter`);
