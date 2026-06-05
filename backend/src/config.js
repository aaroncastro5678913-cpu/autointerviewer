import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from the backend root regardless of where the process is started.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: int(process.env.PORT, 4000),

  // Database (libSQL = SQLite). Local dev uses a file; production uses Turso.
  //   local:  file:./database/interview.db
  //   prod:   libsql://<your-db>.turso.io  (+ DATABASE_AUTH_TOKEN)
  databaseUrl: process.env.DATABASE_URL || 'file:./database/interview.db',
  databaseAuthToken: process.env.DATABASE_AUTH_TOKEN || '',

  // Public URL of the frontend, used to build interview links.
  // PUBLIC_SITE_URL is the canonical name; APP_BASE_URL kept for compatibility.
  appBaseUrl: process.env.PUBLIC_SITE_URL || process.env.APP_BASE_URL || 'http://localhost:5173',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  mockMode: bool(process.env.MOCK_MODE, true),

  // Telegram bot (webhook for production, long-polling for local dev).
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
    // 'polling' (local) | 'webhook' (deployed) | 'off'
    mode: (process.env.TELEGRAM_MODE || 'polling').toLowerCase(),
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    chatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o',
    transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe',
    ttsModel: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    ttsVoice: process.env.OPENAI_TTS_VOICE || 'alloy',
  },

  webhook: {
    endpoint: process.env.TELEGRAM_BOT_RESULT_ENDPOINT || '',
    // Notifies the bot when the candidate starts. Defaults to the result
    // endpoint with the path swapped, so usually no extra config is needed.
    startedEndpoint:
      process.env.TELEGRAM_BOT_STARTED_ENDPOINT ||
      (process.env.TELEGRAM_BOT_RESULT_ENDPOINT || '').replace('/interview-result', '/interview-started'),
    secret: process.env.RESULT_WEBHOOK_SECRET || '',
  },

  adminSecret: process.env.ADMIN_API_SECRET || '',

  interview: {
    maxMinutes: int(process.env.INTERVIEW_MAX_MINUTES, 15),
    minQuestions: int(process.env.INTERVIEW_MIN_QUESTIONS, 10),
    maxQuestions: int(process.env.INTERVIEW_MAX_QUESTIONS, 15),
  },

  showResultToCandidate: bool(process.env.SHOW_RESULT_TO_CANDIDATE, false),

  // Decision bands for the overall interview score (0-100):
  //   >= passThreshold        -> pass
  //   <  reviewFloor          -> fail
  //   in between (or too few answers) -> needs_review
  passThreshold: int(process.env.PASS_THRESHOLD, 70),
  reviewFloor: int(process.env.REVIEW_FLOOR, 55),
  minAnswersForAutoDecision: int(process.env.MIN_ANSWERS_FOR_DECISION, 2),
};

// Helpful one-time warnings so misconfiguration is obvious at boot.
export function warnOnConfig(logger = console) {
  if (!config.mockMode && !config.openai.apiKey) {
    logger.warn('[config] MOCK_MODE is false but OPENAI_API_KEY is empty. OpenAI calls will fail.');
  }
  if (!config.webhook.endpoint) {
    logger.warn('[config] TELEGRAM_BOT_RESULT_ENDPOINT is empty. Results will not be delivered.');
  }
  if (!config.adminSecret) {
    logger.warn('[config] ADMIN_API_SECRET is empty. Admin session creation is disabled.');
  }
  if (!config.telegram.botToken) {
    logger.warn('[BOT] TELEGRAM_BOT_TOKEN is empty. The Telegram bot is disabled (no /start link, no result delivery).');
  } else if (config.telegram.mode === 'webhook' && !config.telegram.webhookSecret) {
    logger.warn('[BOT] TELEGRAM_MODE=webhook but TELEGRAM_WEBHOOK_SECRET is empty — webhook calls will not be verified.');
  }
}
