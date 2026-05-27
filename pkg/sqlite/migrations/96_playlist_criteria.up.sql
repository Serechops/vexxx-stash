-- Add JSON criteria support for dynamic (smart) playlists
ALTER TABLE playlists ADD COLUMN criteria TEXT;
