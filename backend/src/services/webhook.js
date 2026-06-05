import { config } from '../config.js';

/**
 * Best-effort "interview started" ping to the Telegram bot. Fire-and-forget:
 * never throws, so it cannot affect the candidate's interview.
 */
export async function sendStartedWebhook(sessionToken) {
  if (!config.webhook.startedEndpoint) return;
  try {
    await fetch(config.webhook.startedEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.webhook.secret}`,
      },
      body: JSON.stringify({ session_token: sessionToken }),
    });
  } catch (err) {
    console.warn('[webhook] started ping failed:', err.message);
  }
}

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
