-- Make title column nullable in galleries_chapters
CREATE TABLE galleries_chapters_new (
  `id` integer not null primary key autoincrement,
  `title` varchar(255),
  `image_index` integer not null,
  `gallery_id` integer not null,
  `created_at` datetime not null,
  `updated_at` datetime not null,
  foreign key(`gallery_id`) references `galleries`(`id`) on delete CASCADE
);
INSERT INTO galleries_chapters_new SELECT id, title, image_index, gallery_id, created_at, updated_at FROM galleries_chapters;
DROP TABLE galleries_chapters;
ALTER TABLE galleries_chapters_new RENAME TO galleries_chapters;
CREATE INDEX `index_galleries_chapters_on_gallery_id` ON galleries_chapters (`gallery_id`);
