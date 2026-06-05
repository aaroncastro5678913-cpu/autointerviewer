import express from 'express';
import { config } from '../config.js';
import { createSession, getSession, getTranscript, setInterviewUrl } from '../store.js';
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
router.get('/settings', (_req, res) => {
  res.json(settingsView());
});

router.post('/settings', async (req, res) => {
  const body = req.body || {};
  if ('openai_api_key' in body) await setApiKey(body.openai_api_key);
  if ('mock_mode' in body) await setMockMode(!!body.mock_mode);
  res.json({ ok: true, ...settingsView() });
});

router.post('/settings/test', async (_req, res) => {
  const result = await testApiKey();
  res.status(result.ok ? 200 : 400).json(result);
});

// Create a session and return the link (used by the external Python bot).
// POST /api/admin/sessions   { candidate_ref?, ttl_hours? }
router.post('/sessions', async (req, res) => {
  const ref = req.body?.candidate_ref ? String(req.body.candidate_ref) : null;
  const ttlHours = Number(req.body?.ttl_hours) || 72;
  // For a private chat the user id and chat id are the same value.
  const session = await createSession({ telegramUserId: ref, telegramChatId: ref, ttlHours });
  const interviewUrl = `${config.appBaseUrl.replace(/\/+$/, '')}/interview/${session.session_token}`;
  await setInterviewUrl(session.session_token, interviewUrl);
  console.log(`[INTERVIEW] link generated ${session.session_token} (ref ${ref})`);
  res.status(201).json({
    session_token: session.session_token,
    interview_url: interviewUrl,
    status: session.status,
    expires_at: session.expires_at,
  });
});

// Inspect a session — GET /api/admin/sessions/:token
router.get('/sessions/:token', async (req, res) => {
  const session = await getSession(req.params.token);
  if (!session) return res.status(404).json({ error: 'not_found' });
  res.json({
    session_token: session.session_token,
    status: session.status,
    telegram_user_id: session.telegram_user_id,
    telegram_chat_id: session.telegram_chat_id,
    interview_url: session.interview_url,
    created_at: session.created_at,
    started_at: session.started_at,
    completed_at: session.completed_at,
    expires_at: session.expires_at,
    question_count: session.question_count,
    score: session.score,
    webhook_delivered: !!session.webhook_delivered,
    result: session.result_json ? JSON.parse(session.result_json) : null,
    transcript: await getTranscript(session.session_token),
  });
});

export default router;
