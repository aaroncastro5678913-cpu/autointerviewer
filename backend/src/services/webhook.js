import { config } from '../config.js';

/**
 * POST the final result to the Telegram bot backend.
 * Returns { delivered: boolean, status?: number, error?: string }.
 */
export async function sendResultWebhook(resultJson) {
  if (!config.webhook.endpoint) {
    return { delivered: false, error: 'TELEGRAM_BOT_RESULT_ENDPOINT not configured' };
  }

  try {
    const res = await fetch(config.webhook.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.webhook.secret}`,
      },
      body: JSON.stringify(resultJson),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { delivered: false, status: res.status, error: text.slice(0, 500) };
    }
    return { delivered: true, status: res.status };
  } catch (err) {
    return { delivered: false, error: err.message };
  }
}
