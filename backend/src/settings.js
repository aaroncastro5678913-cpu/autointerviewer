// Runtime-overridable settings (manual OpenAI key + mock toggle) stored in the
// DB. Values are cached in memory so getApiKey()/isMockMode() stay SYNC (ai.js
// reads them everywhere). Call loadSettings() once at startup.
import { db } from './db.js';
import { config } from './config.js';

const nowIso = () => new Date().toISOString();
const KEY_OPENAI = 'openai_api_key';
const KEY_MOCK = 'mock_mode';

const cache = { openaiKey: null, mockMode: null };

export async function loadSettings() {
  try {
    const rs = await db.execute('SELECT key, value FROM settings');
    const map = Object.fromEntries(rs.rows.map((r) => [r.key, r.value]));
    cache.openaiKey = map[KEY_OPENAI] ?? null;
    cache.mockMode = KEY_MOCK in map ? map[KEY_MOCK] === 'true' : null;
  } catch (e) {
    console.warn('[DB] loadSettings failed:', e.message);
  }
}

async function persist(key, value) {
  if (value === null || value === undefined) {
    await db.execute({ sql: 'DELETE FROM settings WHERE key = ?', args: [key] });
  } else {
    await db.execute({
      sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [key, String(value), nowIso()],
    });
  }
}

// ---- Effective values (manual override > env) — SYNC ----
export function getApiKey() {
  return cache.openaiKey && cache.openaiKey.trim() ? cache.openaiKey.trim() : config.openai.apiKey;
}
export function isMockMode() {
  return cache.mockMode === null ? config.mockMode : cache.mockMode;
}

// ---- Mutators — async ----
export async function setApiKey(value) {
  if (value === undefined) return;
  cache.openaiKey = value === null || value === '' ? null : String(value).trim();
  await persist(KEY_OPENAI, cache.openaiKey);
}
export async function setMockMode(value) {
  if (value === undefined) return;
  cache.mockMode = value === null ? null : !!value;
  await persist(KEY_MOCK, cache.mockMode === null ? null : cache.mockMode ? 'true' : 'false');
}

// ---- Safe view (never leaks the full key) ----
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
    openai_key_source: cache.openaiKey ? 'manual' : config.openai.apiKey ? 'env' : 'none',
    chat_model: config.openai.chatModel,
    transcribe_model: config.openai.transcribeModel,
    tts_model: config.openai.ttsModel,
    tts_voice: config.openai.ttsVoice,
  };
}
