// Thin API client. The browser always talks to /api (proxied to the backend in
// dev, reverse-proxied in prod), so OpenAI keys never reach the frontend.

const base = (token) => `/api/interview-session/${encodeURIComponent(token)}`;

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data) throw new Error(`HTTP ${res.status}`);
  return data;
}

export async function validateSession(token) {
  return json(await fetch(base(token)));
}

export async function startInterview(token) {
  return json(await fetch(`${base(token)}/start`, { method: 'POST' }));
}

export async function getNextQuestion(token) {
  return json(
    await fetch(`${base(token)}/next-question`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
  );
}

// Returns a Blob URL for the question audio (TTS).
export async function fetchQuestionAudio(token, text) {
  const res = await fetch(`${base(token)}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error('TTS failed');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// Upload a recorded audio Blob, get back the transcript text.
export async function transcribeAnswer(token, blob) {
  const form = new FormData();
  const ext = blob.type.includes('webm') ? 'webm' : blob.type.includes('ogg') ? 'ogg' : 'wav';
  form.append('audio', blob, `answer.${ext}`);
  const res = await fetch(`${base(token)}/transcribe`, { method: 'POST', body: form });
  return json(res);
}

export async function saveTranscriptTurn(token, { question, answer_transcript }) {
  return json(
    await fetch(`${base(token)}/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, answer_transcript, timestamp: new Date().toISOString() }),
    })
  );
}

export async function completeInterview(token) {
  return json(await fetch(`${base(token)}/complete`, { method: 'POST' }));
}

// ---- Admin: runtime settings (manual API key entry) ----
// `secret` is the ADMIN_API_SECRET, kept only in the admin's browser session.

function adminHeaders(secret, extra = {}) {
  return { Authorization: `Bearer ${secret}`, ...extra };
}

export async function getAdminSettings(secret) {
  const res = await fetch('/api/admin/settings', { headers: adminHeaders(secret) });
  if (res.status === 401) throw new Error('Unauthorized — check the admin secret.');
  return json(res);
}

export async function saveAdminSettings(secret, payload) {
  const res = await fetch('/api/admin/settings', {
    method: 'POST',
    headers: adminHeaders(secret, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  if (res.status === 401) throw new Error('Unauthorized — check the admin secret.');
  return json(res);
}

export async function testAdminConnection(secret) {
  const res = await fetch('/api/admin/settings/test', { method: 'POST', headers: adminHeaders(secret) });
  if (res.status === 401) throw new Error('Unauthorized — check the admin secret.');
  return json(res);
}
