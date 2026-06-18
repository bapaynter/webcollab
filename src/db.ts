import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export type Database = ReturnType<typeof Database>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pages (
  id            INTEGER PRIMARY KEY,
  path          TEXT UNIQUE NOT NULL,
  current_html  TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edits (
  id            INTEGER PRIMARY KEY,
  page_id       INTEGER NOT NULL REFERENCES pages(id),
  version       INTEGER NOT NULL,
  user_suggestion TEXT NOT NULL,
  validator_reasoning TEXT,
  validator_change_summary TEXT,
  previous_html TEXT NOT NULL,
  new_html      TEXT NOT NULL,
  ip_hash       TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE(page_id, version)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip_hash       TEXT PRIMARY KEY,
  last_suggestion_at TEXT,
  cooldown_until TEXT,
  total_attempts INTEGER DEFAULT 0,
  total_rejected INTEGER DEFAULT 0,
  flagged       INTEGER DEFAULT 0
);
`;

export function initDb(path: string): Database {
  if (path !== ":memory:") {
    const absPath = isAbsolute(path) ? path : resolve(process.cwd(), path);
    mkdirSync(dirname(absPath), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
