// Uses Node's built-in SQLite (node:sqlite, Node >= 22.5). No native build step,
// so this deploys cleanly anywhere modern Node runs. API mirrors better-sqlite3:
// db.exec(sql), db.prepare(sql).run/get/all(...).
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '..', 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(path.join(dataDir, 'interview.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    session_token        TEXT PRIMARY KEY,
    status               TEXT NOT NULL DEFAULT 'pending', -- pending | started | completed | expired
    candidate_ref        TEXT,            -- opaque id from Telegram bot (e.g. chat id). Never used for scoring.
    created_at           TEXT NOT NULL,
    started_at           TEXT,
    completed_at         TEXT,
    expires_at           TEXT,
    question_count       INTEGER NOT NULL DEFAULT 0,
    result_json          TEXT,            -- final evaluation JSON
    webhook_delivered    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS transcripts (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    session_token      TEXT NOT NULL,
    turn_index         INTEGER NOT NULL,
    question           TEXT NOT NULL,
    answer_transcript  TEXT NOT NULL DEFAULT '',
    timestamp          TEXT NOT NULL,
    FOREIGN KEY (session_token) REFERENCES sessions(session_token) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_transcripts_session
    ON transcripts(session_token, turn_index);

  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT NOT NULL
  );
`);

export default db;
