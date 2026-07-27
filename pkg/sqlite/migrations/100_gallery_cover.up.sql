ALTER TABLE `galleries` ADD COLUMN `cover_blob` varchar(255) REFERENCES `blobs`(`checksum`);
