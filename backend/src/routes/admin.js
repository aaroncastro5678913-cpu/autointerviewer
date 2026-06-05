import express from 'express';
import { config } from '../config.js';
import { createSession, getSession, getTranscript } from '../store.js';
import { settingsView, setApiKey, setMockMode } from '../settings.js';
import { testApiKey } from '../services/ai.js';

const router = express.Router();

// Require the admin secret for all admin routes.
router.use((req, res, next) => {
  if (!config.adminSecret) {
    return res.status(503).json({ error: 'admin_disabled', message: 'ADMIN_API_SECRET is not configured.' });
  }
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== config.adminSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

// ---- Runtime settings (manual API key entry) ----

// Current effective settings. The full API key is never returned — only masked.
// GET /api/admin/settings
router.get('/settings', (_req, res) => {
  res.json(settingsView());
});

// Update settings. Body: { openai_api_key?, mock_mode? }
// - openai_api_key: "" or null clears the manual key (falls back to env).
// - mock_mode: boolean.
// POST /api/admin/settings
router.post('/settings', (req, res) => {
  const body = req.body || {};
  if ('openai_api_key' in body) setApiKey(body.openai_api_key);
  if ('mock_mode' in body) setMockMode(!!body.mock_mode);
  res.json({ ok: true, ...settingsView() });
});

// Verify the configured key with a tiny live OpenAI call.
// POST /api/admin/settings/test
router.post('/settings/test', async (_req, res) => {
  const result = await testApiKey();
  res.status(result.ok ? 200 : 400).json(result);
});

// Create a new interview session and return the link the Telegram bot should send.
// POST /api/admin/sessions   { candidate_ref?, ttl_hours? }
router.post('/sessions', (req, res) => {
  const candidateRef = req.body?.candidate_ref ? String(req.body.candidate_ref) : null;
  const ttlHours = Number(req.body?.ttl_hours) || 72;
  const session = createSession({ candidateRef, ttlHours });
  res.status(201).json({
    session_token: session.session_token,
    interview_url: `${config.appBaseUrl}/interview/${session.session_token}`,
    status: session.status,
    expires_at: session.expires_at,
  });
});

// Inspect a session (status + result + transcript) — useful for the bot / debugging.
// GET /api/admin/sessions/:token
router.get('/sessions/:token', (req, res) => {
  const session = getSession(req.params.token);
  if (!session) return res.status(404).json({ error: 'not_found' });
  res.json({
    session_token: session.session_token,
    status: session.status,
    candidate_ref: session.candidate_ref,
    created_at: session.created_at,
    started_at: session.started_at,
    completed_at: session.completed_at,
    expires_at: session.expires_at,
    question_count: session.question_count,
    webhook_delivered: !!session.webhook_delivered,
    result: session.result_json ? JSON.parse(session.result_json) : null,
    transcript: getTranscript(session.session_token),
  });
});

export default router;
