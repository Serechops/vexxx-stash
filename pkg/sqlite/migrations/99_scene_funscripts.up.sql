CREATE TABLE `scene_funscripts` (
  `scene_id` integer NOT NULL,
  `path` text NOT NULL,
  `label` varchar(255) NOT NULL,
  primary key (`scene_id`, `path`),
  foreign key(`scene_id`) references `scenes`(`id`) on delete CASCADE
);
