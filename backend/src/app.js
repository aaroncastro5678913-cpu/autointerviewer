// Builds the Express app (no listen). Shared by the local dev server
// (backend/src/index.js) and the Netlify Function (netlify/functions/api.js).
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { initSchema } from './db.js';
import { loadSettings } from './settings.js';
import interviewRouter from './routes/interview.js';
import adminRouter from './routes/admin.js';
import telegramRouter from './routes/telegram.js';

export function buildApp() {
  const app = express();

  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')) {
          return cb(null, true);
        }
        return cb(new Error(`Origin ${origin} not allowed by CORS`));
      },
    })
  );
  app.use(express.json({ limit: '2mb' }));

  // Normalize the path so routes match whether we're behind a Netlify Function
  // (/.netlify/functions/api/...) or hit directly in local dev (/api/...).
  app.use((req, _res, next) => {
    req.url = req.url.replace(/^\/\.netlify\/functions\/api/, '');
    if (!req.url.startsWith('/api')) req.url = '/api' + (req.url === '/' ? '' : req.url);
    next();
  });

  // Ensure the DB schema + cached settings are ready (cheap after the first call).
  let ready = null;
  app.use(async (_req, _res, next) => {
    try {
      if (!ready) ready = initSchema().then(loadSettings);
      await ready;
      next();
    } catch (e) {
      ready = null;
      next(e);
    }
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/interview-session', interviewRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/telegram', telegramRouter);

  app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[API] error:', err.message);
    res.status(500).json({ error: 'server_error', message: err.message });
  });

  return app;
}
