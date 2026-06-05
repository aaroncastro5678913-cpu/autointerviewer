import express from 'express';
import { config } from '../config.js';
import { handleUpdate } from '../telegram/bot.js';

const router = express.Router();

// Telegram delivers updates here in webhook mode (production).
// POST /api/telegram/webhook
router.post('/webhook', (req, res) => {
  // Verify Telegram's secret header so only Telegram can call us.
  if (config.telegram.webhookSecret) {
    const provided = req.headers['x-telegram-bot-api-secret-token'];
    if (provided !== config.telegram.webhookSecret) {
      console.warn('[BOT] rejected webhook with bad/missing secret token');
      return res.status(401).json({ error: 'unauthorized' });
    }
  }
  // Acknowledge immediately, then process (Telegram retries on slow/failed replies).
  res.json({ ok: true });
  handleUpdate(req.body).catch((e) => console.error(`[BOT] webhook handler error: ${e.message}`));
});

export default router;
