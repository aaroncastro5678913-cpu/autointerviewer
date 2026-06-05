// Minimal candidate-facing Telegram bot for the interview system.
// Works in two modes (no extra dependencies, just the Bot API over fetch):
//   - polling  : local dev (getUpdates loop) — works without a public URL
//   - webhook  : production — updates delivered to /api/telegram/webhook
//
// Candidate flow only:
//   /start  -> create an interview session (chat id stored) + send the link
//   result  -> delivered back to that chat by the interview routes
import { config } from '../config.js';
import { createSession, upsertTelegramUser, setInterviewUrl } from '../store.js';

const tgApi = (method) => `https://api.telegram.org/bot${config.telegram.botToken}/${method}`;

// True for a real Telegram chat id (so we never try to message a non-chat ref).
export function isChatId(ref) {
  return typeof ref !== 'undefined' && ref !== null && /^-?\d+$/.test(String(ref));
}

export async function tg(method, body) {
  if (!config.telegram.botToken) return null;
  try {
    const res = await fetch(tgApi(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) console.warn(`[BOT] ${method} failed: ${data.description}`);
    return data;
  } catch (err) {
    console.warn(`[BOT] ${method} request error: ${err.message}`);
    return null;
  }
}

export function sendMessage(chatId, text, extra = {}) {
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

function interviewLink(token) {
  return `${config.appBaseUrl.replace(/\/+$/, '')}/interview/${token}`;
}

// Handle one Telegram update (shared by webhook route and polling loop).
export async function handleUpdate(update) {
  const msg = update?.message || update?.edited_message;
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;
  const userId = msg.from?.id ?? chatId;
  const username = msg.from?.username || null;
  const text = (msg.text || '').trim();
  console.log(`[BOT] webhook received: chat ${chatId}, text "${text.slice(0, 40)}"`);

  if (/^\/(start|apply|interview|begin)\b/i.test(text)) {
    try {
      await upsertTelegramUser({ telegramUserId: userId, telegramChatId: chatId, username });
      console.log(`[BOT] user ${userId} completed Telegram step`);
      const session = await createSession({ telegramUserId: userId, telegramChatId: chatId, ttlHours: 72 });
      const link = interviewLink(session.session_token);
      await setInterviewUrl(session.session_token, link);
      console.log(`[INTERVIEW] link generated ${session.session_token} for chat ${chatId}`);
      await sendMessage(
        chatId,
        '👋 欢迎！这是您的<b>中文语音面试</b>链接（约 15 分钟）：\n\n' +
          `${link}\n\n` +
          '请用 Chrome / Edge 浏览器打开，按页面提示用中文作答。完成后我会把结果发给您。'
      );
    } catch (err) {
      console.error(`[BOT] failed to create session for chat ${chatId}: ${err.message}`);
      await sendMessage(chatId, '⚠️ 暂时无法生成面试链接，请稍后再试。');
    }
    return;
  }
  if (/^\/help\b/i.test(text)) {
    await sendMessage(chatId, 'ℹ️ 发送 /start 获取您的面试链接。完成面试后会自动收到结果。');
    return;
  }
  await sendMessage(chatId, '发送 /start 开始您的中文面试。');
}

// --- Candidate notifications used by the interview routes ---

export async function notifyStarted(chatId) {
  if (!isChatId(chatId)) return;
  await sendMessage(chatId, '🎙️ 您的中文面试已开始，请按页面提示用中文作答，祝您顺利！');
}

export async function notifyResult(chatId, result) {
  if (!isChatId(chatId)) return;
  const decision = result.decision || result.pass_fail;
  const lines = [];
  if (result.no_answer) {
    lines.push('您的面试已结束。我们<b>未检测到有效作答</b>，本次无法评估。');
  } else if (decision === 'pass') {
    lines.push('🎉 <b>恭喜！</b>您通过了中文面试。');
  } else if (decision === 'fail') {
    lines.push('感谢您完成面试。很遗憾，本次<b>未通过</b>。');
  } else {
    lines.push('感谢您完成面试，我们会尽快<b>复核</b>您的结果。');
  }
  if (typeof result.overall_score === 'number') {
    lines.push(`综合得分：<b>${result.overall_score}/100</b>${result.level ? `（${result.level}）` : ''}`);
  }
  await sendMessage(chatId, lines.join('\n'));
}

// --- Mode management ---

export async function setWebhook(url, secret) {
  return tg('setWebhook', {
    url,
    secret_token: secret || undefined,
    allowed_updates: ['message'],
  });
}

let polling = false;

export async function startPolling() {
  if (!config.telegram.botToken) {
    console.warn('[BOT] TELEGRAM_BOT_TOKEN not set — bot disabled.');
    return;
  }
  // Polling and webhook are mutually exclusive on the same token.
  await tg('deleteWebhook', { drop_pending_updates: false });
  polling = true;
  let offset = 0;
  console.log('[BOT] long-polling Telegram for updates…');
  while (polling) {
    try {
      const res = await fetch(`${tgApi('getUpdates')}?timeout=25&offset=${offset}`);
      const data = await res.json();
      if (data.ok) {
        for (const u of data.result) {
          offset = u.update_id + 1;
          handleUpdate(u).catch((e) => console.error(`[BOT] handleUpdate error: ${e.message}`));
        }
      }
    } catch (err) {
      console.warn(`[BOT] getUpdates error: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export function stopPolling() {
  polling = false;
}
