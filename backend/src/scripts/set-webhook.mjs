// Register (or clear) the Telegram webhook for the deployed backend.
//
// Usage:
//   node src/scripts/set-webhook.mjs https://your-backend.onrender.com/api/telegram/webhook
//   node src/scripts/set-webhook.mjs --delete
//
// Reads TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET from the environment / .env.
import { config } from '../config.js';
import { setWebhook, tg } from '../telegram/bot.js';

if (!config.telegram.botToken) {
  console.error('[BOT] TELEGRAM_BOT_TOKEN is not set.');
  process.exit(1);
}

const arg = process.argv[2];

if (arg === '--delete') {
  const r = await tg('deleteWebhook', { drop_pending_updates: false });
  console.log('[BOT] deleteWebhook:', JSON.stringify(r));
  process.exit(0);
}

const url =
  arg ||
  process.env.TELEGRAM_WEBHOOK_URL ||
  (process.env.BACKEND_URL ? `${process.env.BACKEND_URL.replace(/\/+$/, '')}/api/telegram/webhook` : '');

if (!url) {
  console.error('Usage: node src/scripts/set-webhook.mjs <https://your-backend/api/telegram/webhook>');
  process.exit(1);
}

const r = await setWebhook(url, config.telegram.webhookSecret);
console.log('[BOT] setWebhook ->', url);
console.log('[BOT] response:', JSON.stringify(r));
if (!config.telegram.webhookSecret) {
  console.warn('[BOT] No TELEGRAM_WEBHOOK_SECRET set — anyone could POST fake updates. Set one for production.');
}
