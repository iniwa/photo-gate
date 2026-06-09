PRAGMA foreign_keys = ON;

CREATE TABLE albums (
  id TEXT PRIMARY KEY CHECK (
    length(id) >= 1 AND length(id) <= 128
    AND substr(id, 1, 1) GLOB '[A-Za-z0-9]'
    AND id NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  title TEXT NOT NULL,
  photoprism_album_uid TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  expires_at TEXT,
  thumb_long_edge INTEGER NOT NULL DEFAULT 640,
  thumb_format TEXT NOT NULL DEFAULT 'webp',
  thumb_quality INTEGER NOT NULL DEFAULT 80,
  preview_long_edge INTEGER NOT NULL DEFAULT 3840,
  preview_format TEXT NOT NULL DEFAULT 'jpg',
  preview_quality INTEGER NOT NULL DEFAULT 88,
  strip_exif INTEGER NOT NULL DEFAULT 1 CHECK (strip_exif IN (0, 1)),
  download_enabled INTEGER NOT NULL DEFAULT 0 CHECK (download_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE album_permissions (
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (album_id, user_id)
);

CREATE INDEX idx_album_permissions_user_id ON album_permissions(user_id);
CREATE INDEX idx_album_permissions_album_id ON album_permissions(album_id);
