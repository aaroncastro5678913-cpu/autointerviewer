// Data access for sessions, answers, results and Telegram users (async, libSQL).
import { db } from './db.js';
import { nanoid } from 'nanoid';

const nowIso = () => new Date().toISOString();
const one = (rs) => (rs.rows && rs.rows.length ? rs.rows[0] : null);

// ---- Telegram users ----

export async function upsertTelegramUser({ telegramUserId, telegramChatId, username = null }) {
  await db.execute({
    sql: `INSERT INTO telegram_users (telegram_user_id, telegram_chat_id, username, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(telegram_user_id) DO UPDATE SET telegram_chat_id = excluded.telegram_chat_id,
                                                      username = excluded.username`,
    args: [String(telegramUserId), String(telegramChatId), username, nowIso()],
  });
}

// ---- Sessions ----

export async function createSession({ telegramUserId = null, telegramChatId = null, ttlHours = 72, interviewUrl = null } = {}) {
  const token = nanoid(32);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  await db.execute({
    sql: `INSERT INTO sessions (session_token, telegram_user_id, telegram_chat_id, status, interview_url, created_at, expires_at)
          VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
    args: [token, telegramUserId ? String(telegramUserId) : null, telegramChatId ? String(telegramChatId) : null, interviewUrl, createdAt, expiresAt],
  });
  return getSession(token);
}

export async function getSession(token) {
  return one(await db.execute({ sql: 'SELECT * FROM sessions WHERE session_token = ?', args: [token] }));
}

export function isExpired(session) {
  if (!session?.expires_at) return false;
  return new Date(session.expires_at).getTime() < Date.now();
}

export async function setInterviewUrl(token, url) {
  await db.execute({ sql: 'UPDATE sessions SET interview_url = ? WHERE session_token = ?', args: [url, token] });
}

export async function markStarted(token) {
  await db.execute({
    sql: `UPDATE sessions SET status = 'in_progress', started_at = ?
          WHERE session_token = ? AND status = 'pending'`,
    args: [nowIso(), token],
  });
  return getSession(token);
}

export async function markCompleted(token, result) {
  const now = nowIso();
  const score = typeof result?.overall_score === 'number' ? result.overall_score : null;
  await db.execute({
    sql: `UPDATE sessions SET status = 'completed', completed_at = ?, score = ?, result_json = ?
          WHERE session_token = ?`,
    args: [now, score, JSON.stringify(result), token],
  });
  await db.execute({
    sql: `INSERT INTO results (session_token, score, decision, level, result_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_token) DO UPDATE SET score = excluded.score, decision = excluded.decision,
                                                   level = excluded.level, result_json = excluded.result_json`,
    args: [token, score, result?.decision || null, result?.level || null, JSON.stringify(result), now],
  });
  return getSession(token);
}

export async function markWebhookDelivered(token) {
  await db.execute({ sql: 'UPDATE sessions SET webhook_delivered = 1 WHERE session_token = ?', args: [token] });
}

// ---- Answers (transcript) ----

export async function addTranscriptTurn(token, { question, answer_transcript = '', timestamp }) {
  const next = one(await db.execute({
    sql: 'SELECT COALESCE(MAX(turn_index), -1) + 1 AS next FROM answers WHERE session_token = ?',
    args: [token],
  }));
  const turnIndex = Number(next.next);
  await db.execute({
    sql: `INSERT INTO answers (session_token, turn_index, question, answer_transcript, timestamp)
          VALUES (?, ?, ?, ?, ?)`,
    args: [token, turnIndex, question, answer_transcript, timestamp || nowIso()],
  });
  const count = await getQuestionCount(token);
  await db.execute({ sql: 'UPDATE sessions SET question_count = ? WHERE session_token = ?', args: [count, token] });
  return { turnIndex, question_count: count };
}

export async function getTranscript(token) {
  const rs = await db.execute({
    sql: 'SELECT turn_index, question, answer_transcript, timestamp FROM answers WHERE session_token = ? ORDER BY turn_index ASC',
    args: [token],
  });
  return rs.rows;
}

export async function getQuestionCount(token) {
  const r = one(await db.execute({ sql: 'SELECT COUNT(*) AS c FROM answers WHERE session_token = ?', args: [token] }));
  return Number(r.c);
}

// ---- Local dev demo session (matches the frontend's default redirect) ----
export const SAMPLE_TOKEN = 'sample-dev-token-0000000000000000';

export async function ensureSampleSession() {
  const existing = await getSession(SAMPLE_TOKEN);
  const now = nowIso();
  if (!existing) {
    const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    await db.execute({
      sql: `INSERT INTO sessions (session_token, status, created_at, expires_at) VALUES (?, 'pending', ?, ?)`,
      args: [SAMPLE_TOKEN, now, expires],
    });
  } else if (existing.status === 'completed') {
    await db.execute({ sql: 'DELETE FROM answers WHERE session_token = ?', args: [SAMPLE_TOKEN] });
    await db.execute({
      sql: `UPDATE sessions SET status='pending', started_at=NULL, completed_at=NULL,
            result_json=NULL, score=NULL, webhook_delivered=0, question_count=0 WHERE session_token = ?`,
      args: [SAMPLE_TOKEN],
    });
  }
  return SAMPLE_TOKEN;
}
