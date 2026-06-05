// Local dev server. In production the same app runs as a Netlify Function
// (netlify/functions/api.js); here we listen on a port and (optionally) run the
// Telegram bot in long-polling mode so it works without a public URL.
import { buildApp } from './app.js';
import { config, warnOnConfig } from './config.js';
import { initSchema } from './db.js';
import { loadSettings } from './settings.js';
import { ensureSampleSession, SAMPLE_TOKEN } from './store.js';
import { startPolling } from './telegram/bot.js';

async function main() {
  await initSchema();
  await loadSettings();
  await ensureSampleSession();

  const app = buildApp();
  app.listen(config.port, () => {
    console.log(`\n[API] 🎙️  Interview backend on http://localhost:${config.port}`);
    console.log(`[API] Mock mode: ${config.mockMode ? 'ON (no OpenAI calls)' : 'OFF (real OpenAI)'}`);
    console.log(`[API] Frontend: ${config.appBaseUrl}`);
    console.log(`[API] Demo interview: ${config.appBaseUrl}/interview/${SAMPLE_TOKEN}`);
    warnOnConfig();
    if (config.telegram.botToken && config.telegram.mode === 'polling') {
      startPolling();
    } else if (config.telegram.botToken && config.telegram.mode === 'webhook') {
      console.log('[BOT] webhook mode — POST updates to /api/telegram/webhook (run "npm run set-webhook").');
    }
  });
}

main().catch((err) => {
  console.error('[API] fatal startup error:', err.message);
  process.exit(1);
});
