import Database from 'better-sqlite3';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export const db = new Database(path.join(DATA_DIR, 'torrent-feed.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'rss',            -- rss | knaben
  category_default TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  interval_min INTEGER NOT NULL DEFAULT 15,
  headers_json TEXT,                           -- sent with feed requests
  detail_headers_json TEXT,                    -- sent with per-item detail page requests (cookies etc.)
  include_regex TEXT,
  exclude_regex TEXT,
  last_fetched_at INTEGER,
  last_attempt_at INTEGER,
  last_status TEXT,                            -- ok | error
  last_error TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  info_hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  tags_json TEXT NOT NULL DEFAULT '[]',
  resolution INTEGER,                          -- 720 / 1080 / 2160 for filtering
  size_bytes INTEGER,
  seeders INTEGER NOT NULL DEFAULT 0,
  leechers INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER NOT NULL,               -- epoch ms
  magnet TEXT,
  torrent_url TEXT,
  origin TEXT,                                 -- upstream tracker (e.g. "The Pirate Bay")
  details_url TEXT,
  description_html TEXT,
  details_status TEXT NOT NULL DEFAULT 'none', -- none | pending | ok | failed
  details_error TEXT,
  details_fetched_at INTEGER,
  state TEXT NOT NULL DEFAULT 'new',           -- new | sent | hidden
  sent_at INTEGER,
  client_torrent_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_feed ON items(published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_items_state ON items(state, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category, published_at DESC);

CREATE TABLE IF NOT EXISTS item_files (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  size_bytes INTEGER
);
CREATE INDEX IF NOT EXISTS idx_item_files_item ON item_files(item_id);

CREATE TABLE IF NOT EXISTS item_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  local_path TEXT,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | ok | failed
  UNIQUE(item_id, source_url)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  title, description, content='items', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, title, description) VALUES (new.id, new.title, COALESCE(new.description_html, ''));
END;
CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, description) VALUES ('delete', old.id, old.title, COALESCE(old.description_html, ''));
END;
CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE OF title, description_html ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, description) VALUES ('delete', old.id, old.title, COALESCE(old.description_html, ''));
  INSERT INTO items_fts(rowid, title, description) VALUES (new.id, new.title, COALESCE(new.description_html, ''));
END;
`);

// A crash mid-fetch must not leave details stuck as pending forever.
db.prepare(`UPDATE items SET details_status = 'none' WHERE details_status = 'pending'`).run();

// ---- settings helpers -------------------------------------------------------

export const SETTING_DEFAULTS: Record<string, string> = {
  transmission_url: '',
  transmission_user: '',
  transmission_password: '',
  download_dir: '',
  start_paused: '0',
  prune_days: '30',
  prefetch_details: '0',
};

export function getSetting(key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? SETTING_DEFAULTS[key] ?? '';
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
