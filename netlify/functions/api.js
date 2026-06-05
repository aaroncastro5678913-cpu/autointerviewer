// Netlify Function that serves the whole API (interview + admin + Telegram
// webhook) by wrapping the shared Express app. The netlify.toml redirect maps
// /api/* -> /.netlify/functions/api/:splat, and the app normalizes the path.
import serverless from 'serverless-http';
import { buildApp } from '../../backend/src/app.js';

export const handler = serverless(buildApp());
