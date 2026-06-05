import express from 'express';
import cors from 'cors';
import db from './db.js';
import { config, warnOnConfig } from './config.js';
import { isMockMode } from './settings.js';
import interviewRouter from './routes/interview.js';
import adminRouter from './routes/admin.js';

// In mock/demo mode, make sure the sample interview link works immediately
// (matches the frontend's default redirect) — no manual `npm run seed` needed.
const SAMPLE_TOKEN = 'sample-dev-token-0000000000000000';
function ensureSampleSession() {
  if (!config.mockMode) return;
  const existing = db.prepare('SELECT status FROM sessions WHERE session_token = ?').get(SAMPLE_TOKEN);
  const now = new Date().toISOString();
  if (!existing) {
    const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    db.prepare(
      `INSERT INTO sessions (session_token, status, candidate_ref, created_at, expires_at)
       VALUES (?, 'pending', 'demo-candidate', ?, ?)`
    ).run(SAMPLE_TOKEN, now, expires);
  } else if (existing.status === 'completed') {
    db.prepare('DELETE FROM transcripts WHERE session_token = ?').run(SAMPLE_TOKEN);
    db.prepare(
      `UPDATE sessions SET status='pending', started_at=NULL, completed_at=NULL,
       result_json=NULL, webhook_delivered=0, question_count=0 WHERE session_token = ?`
    ).run(SAMPLE_TOKEN);
  }
}

const app = express();

app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin / curl (no origin) and any configured origin.
      if (!origin || config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')) {
        return cb(null, true);
      }
      return cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
  })
);
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mock_mode: isMockMode(), time: new Date().toISOString() });
});

app.use('/api/interview-session', interviewRouter);
app.use('/api/admin', adminRouter);

// 404 + error handlers
app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'server_error', message: err.message });
});

app.listen(config.port, () => {
  ensureSampleSession();
  console.log(`\n🎙️  Interview backend listening on http://localhost:${config.port}`);
  console.log(`    Mock mode: ${config.mockMode ? 'ON (no OpenAI calls)' : 'OFF (real OpenAI)'}`);
  console.log(`    Frontend base URL: ${config.appBaseUrl}`);
  if (config.mockMode) {
    console.log(`    Demo interview: ${config.appBaseUrl}/interview/${SAMPLE_TOKEN}\n`);
  } else {
    console.log('');
  }
  warnOnConfig();
});
