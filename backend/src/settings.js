// Runtime-overridable settings. Values entered via the admin settings page are
// stored in the `settings` table and take precedence over the .env defaults in
// config.js. This lets an operator paste the OpenAI API key manually without
// editing files or restarting the server. The key is stored server-side only
// and is NEVER returned to any browser (only a masked preview is exposed).
import db from './db.js';
import { config } from './config.js';

const nowIso = () => new Date().toISOString();

const KEY_OPENAI = 'openai_api_key';
const KEY_MOCK = 'mock_mode';

function getRaw(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setRaw(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, nowIso());
}

function delRaw(key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

// ---- Effective values (DB override > env) ----

export function getApiKey() {
  const override = getRaw(KEY_OPENAI);
  return override && override.trim() ? override.trim() : config.openai.apiKey;
}

export function isMockMode() {
  const override = getRaw(KEY_MOCK);
  if (override === null) return config.mockMode;
  return override === 'true';
}

// ---- Mutators ----

// Pass an empty string / null to clear the stored key (falls back to env).
export function setApiKey(value) {
  if (value === undefined) return;
  if (value === null || value === '') delRaw(KEY_OPENAI);
  else setRaw(KEY_OPENAI, String(value).trim());
}

export function setMockMode(value) {
  if (value === undefined) return;
  if (value === null) delRaw(KEY_MOCK);
  else setRaw(KEY_MOCK, value ? 'true' : 'false');
}

// ---- Safe view for the admin UI (never leaks the full key) ----

export function maskKey(key) {
  if (!key) return null;
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export function settingsView() {
  const key = getApiKey();
  return {
    mock_mode: isMockMode(),
    openai_key_set: !!key,
    openai_key_masked: maskKey(key),
    openai_key_source: getRaw(KEY_OPENAI) ? 'manual' : config.openai.apiKey ? 'env' : 'none',
    chat_model: config.openai.chatModel,
    transcribe_model: config.openai.transcribeModel,
    tts_model: config.openai.ttsModel,
    tts_voice: config.openai.ttsVoice,
  };
}
