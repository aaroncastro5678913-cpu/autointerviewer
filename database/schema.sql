-- Schema for the unified Auto-Interview project (libSQL / SQLite).
-- This documents the tables; at runtime they are created automatically by
-- backend/src/db.js (initSchema). The local dev DB file is created here too:
--   database/interview.db   (DATABASE_URL=file:./database/interview.db)

-- 1) Telegram users
CREATE TABLE IF NOT EXISTS telegram_users (
  telegram_user_id  TEXT PRIMARY KEY,
  telegram_chat_id  TEXT,
  username          TEXT,
  created_at        TEXT NOT NULL
);

-- 2) Interview links / sessions
CREATE TABLE IF NOT EXISTS sessions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_token     TEXT NOT NULL UNIQUE,
  telegram_user_id  TEXT,
  telegram_chat_id  TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',   -- pending|in_progress|completed|failed|expired
  interview_url     TEXT,
  score             INTEGER,
  result_json       TEXT,
  created_at        TEXT NOT NULL,
  started_at        TEXT,
  completed_at      TEXT,
  expires_at        TEXT,
  question_count    INTEGER NOT NULL DEFAULT 0,
  webhook_delivered INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);

-- 3) Interview answers (one row per Q&A turn)
CREATE TABLE IF NOT EXISTS answers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_token     TEXT NOT NULL,
  turn_index        INTEGER NOT NULL,
  question          TEXT NOT NULL,
  answer_transcript TEXT NOT NULL DEFAULT '',
  timestamp         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_token, turn_index);

-- 4) Interview results (evaluation outcome)
CREATE TABLE IF NOT EXISTS results (
  session_token TEXT PRIMARY KEY,
  score         INTEGER,
  decision      TEXT,
  level         TEXT,
  result_json   TEXT,
  created_at    TEXT NOT NULL
);

-- Runtime settings (manual OpenAI key / mock toggle)
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL
);
