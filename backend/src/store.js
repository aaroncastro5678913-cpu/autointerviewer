import db from './db.js';
import { nanoid } from 'nanoid';

const nowIso = () => new Date().toISOString();

// ---- Sessions ----

export function createSession({ candidateRef = null, ttlHours = 72 } = {}) {
  const token = nanoid(32);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  db.prepare(
    `INSERT INTO sessions (session_token, status, candidate_ref, created_at, expires_at)
     VALUES (?, 'pending', ?, ?, ?)`
  ).run(token, candidateRef, createdAt, expiresAt);
  return getSession(token);
}

export function getSession(token) {
  return db.prepare('SELECT * FROM sessions WHERE session_token = ?').get(token) || null;
}

export function isExpired(session) {
  if (!session?.expires_at) return false;
  return new Date(session.expires_at).getTime() < Date.now();
}

export function markStarted(token) {
  db.prepare(
    `UPDATE sessions SET status = 'started', started_at = ?
     WHERE session_token = ? AND status = 'pending'`
  ).run(nowIso(), token);
  return getSession(token);
}

export function markCompleted(token, resultJson) {
  db.prepare(
    `UPDATE sessions
     SET status = 'completed', completed_at = ?, result_json = ?
     WHERE session_token = ?`
  ).run(nowIso(), JSON.stringify(resultJson), token);
  return getSession(token);
}

export function markWebhookDelivered(token) {
  db.prepare('UPDATE sessions SET webhook_delivered = 1 WHERE session_token = ?').run(token);
}

// ---- Transcripts ----

export function addTranscriptTurn(token, { question, answer_transcript = '', timestamp }) {
  const row = db
    .prepare('SELECT COALESCE(MAX(turn_index), -1) + 1 AS next FROM transcripts WHERE session_token = ?')
    .get(token);
  const turnIndex = row.next;
  db.prepare(
    `INSERT INTO transcripts (session_token, turn_index, question, answer_transcript, timestamp)
     VALUES (?, ?, ?, ?, ?)`
  ).run(token, turnIndex, question, answer_transcript, timestamp || nowIso());

  const count = db
    .prepare('SELECT COUNT(*) AS c FROM transcripts WHERE session_token = ?')
    .get(token).c;
  db.prepare('UPDATE sessions SET question_count = ? WHERE session_token = ?').run(count, token);

  return { turnIndex, question_count: count };
}

export function getTranscript(token) {
  return db
    .prepare(
      'SELECT turn_index, question, answer_transcript, timestamp FROM transcripts WHERE session_token = ? ORDER BY turn_index ASC'
    )
    .all(token);
}

export function getQuestionCount(token) {
  return db.prepare('SELECT COUNT(*) AS c FROM transcripts WHERE session_token = ?').get(token).c;
}
