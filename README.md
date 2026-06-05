# 中文口语面试 · AI Voice Interview for Chinese Proficiency

An automated AI voice interview that assesses a candidate's **spoken Chinese** through a ~15‑minute natural conversation, scores it 0–100, and sends the result back to a Telegram recruiter bot via webhook.

> **Fairness by design:** the pass/fail decision is based **only on Chinese language proficiency**. Age, date of birth, address, gender, nationality, ethnicity, religion, politics, health, and family status are never asked and never used for scoring — this is enforced in both the interviewer and evaluation prompts.

---

## Unified project (one package.json) + Netlify deploy

This is **one project**: the interview UI, the API, the Telegram bot, and the
database all live together. There is a single root `package.json` — `frontend/`
and `backend/` are just source folders, not separate npm projects.

```
Telegram ──webhook──▶ Netlify Function (/api/telegram/webhook)
                         │ creates a session (token + chat id) in libSQL, sends the link
Candidate opens {SITE}/interview/{token}   ← static UI (Netlify CDN)
                         │ /api/* → the same Netlify Function (interview + result)
                         ▼ evaluates, saves to libSQL, then
        the function sends the result to the candidate's Telegram chat
```

- **One Netlify deploy:** static frontend (Vite → `dist/`) + **one Netlify
  Function** (`netlify/functions/api.js`) that serves all `/api/*` routes
  (interview, admin, Telegram webhook) by wrapping the Express app.
- **Database = SQLite via libSQL:** a local file for dev (`file:./database/...`),
  **Turso** (free, SQLite-compatible) in production so it persists across
  serverless calls.
- **Telegram = webhook** in production (Functions can't poll); **long-polling**
  locally so `npm run dev` works with no public URL.

### Structure
```
package.json            # ONE root package.json
vite.config.js          # builds frontend/ -> dist/
netlify.toml            # publish dist/, functions, /api/* + SPA redirects
netlify/functions/
  api.js                # serverless-http(expressApp) — all /api/* routes
frontend/               # interview UI (React/Vite) — source folder, not its own project
backend/src/            # server logic (source folder, not its own project)
  app.js                # builds the Express app (shared by dev server + function)
  index.js              # local dev server (listens + bot polling)
  db.js                 # libSQL client + schema
  store.js              # sessions / answers / results / telegram users (async)
  settings.js           # runtime settings (cached)
  routes/               # interview.js, admin.js, telegram.js
  telegram/bot.js       # candidate bot (webhook + polling + result delivery)
database/schema.sql     # documented schema (+ the local .db lives here)
```

### Run locally
```bash
npm install
npm run dev      # backend (API + bot polling) + Vite UI together
```
Open `http://localhost:5173/interview/sample-dev-token-0000000000000000` for the
demo, or (with a `TELEGRAM_BOT_TOKEN` set) message your bot `/start`.
Other scripts: `npm run build` (UI → `dist/`), `npm run start` (prod server),
`npm run set-webhook`.

### Deploy to Netlify
1. Create a free **Turso** DB: `turso db create autointerview` then
   `turso db show --url autointerview` and `turso db tokens create autointerview`.
2. On Netlify, connect this repo (build/publish are in `netlify.toml`).
3. Set Netlify **environment variables** (below). The first request creates the
   tables automatically.

### Configure the Telegram webhook (once, after deploy)
```bash
# uses TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET from your env/.env
npm run set-webhook -- https://YOUR-SITE.netlify.app/api/telegram/webhook
```
(`npm run set-webhook -- --delete` reverts to polling for local dev.)

### Required environment variables

| Variable | Where | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | both | Bot token from @BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | prod | Secret Telegram echoes on each webhook call. |
| `TELEGRAM_MODE` | local=`polling`, prod=`webhook` | Bot transport. |
| `PUBLIC_SITE_URL` | both | Site URL used to build interview links. |
| `DATABASE_URL` | both | `file:./database/interview.db` (dev) / `libsql://…turso.io` (prod). |
| `DATABASE_AUTH_TOKEN` | prod | Turso token (remote DB only). |
| `OPENAI_API_KEY` | optional | Real evaluation/STT/TTS (omit ⇒ `MOCK_MODE`). |
| `ADMIN_API_SECRET` | both | Auth for admin session APIs. |
| `MOCK_MODE` | optional | `true` runs with no OpenAI key. |

> The Python recruiter bot in `../telegram_recruiter_bot` is separate and optional.
> Don't run it on the same Telegram token as this bot at the same time.

---

## How it works

```
Telegram bot ──(admin API)──▶ creates session ──▶ sends link
                                                     │
Candidate opens  https://your-domain/interview/{session_token}
                                                     │
  ┌──────────────────────────────────────────────────────────────┐
  │ Frontend (React)        Backend (Express + SQLite + OpenAI)    │
  │ 1. validate token  ───▶ GET  /api/interview-session/:token     │
  │ 2. welcome + mic                                               │
  │ 3. start          ───▶ POST .../start                          │
  │ 4. get question   ───▶ POST .../next-question  (OpenAI chat)   │
  │ 5. play question  ───▶ POST .../tts            (OpenAI TTS)    │
  │ 6. record answer                                              │
  │ 7. transcribe     ───▶ POST .../transcribe     (OpenAI STT)   │
  │ 8. save turn      ───▶ POST .../transcript                    │
  │    repeat 4–8 for ~10–15 questions / ~15 min                  │
  │ 9. complete       ───▶ POST .../complete   (OpenAI evaluate)  │
  └──────────────────────────────────┬───────────────────────────┘
                                      ▼
                       POST {TELEGRAM_BOT_RESULT_ENDPOINT}
                       Authorization: Bearer {RESULT_WEBHOOK_SECRET}
```

- **Frontend:** React + Vite (`frontend/`)
- **Backend:** Node.js + Express (`backend/`)
- **Database:** SQLite via Node's built‑in `node:sqlite` (no native build step)
- **AI:** OpenAI Chat (interviewer + evaluation), TTS (questions), Transcription (answers)
- **Mock mode:** runs the whole flow with **no OpenAI key** for local dev / CI / demos

---

## 1. Setup

Requires **Node.js >= 22.5** (for the built‑in `node:sqlite`). Check with `node --version`.

```bash
# from the project root
npm run install:all        # installs backend + frontend deps
# or manually:
#   cd backend  && npm install
#   cd frontend && npm install
```

Create the backend env file:

```bash
cd backend
cp .env.example .env        # Windows: copy .env.example .env
```

(Optional) frontend env, only needed if your backend isn't on `localhost:4000`:

```bash
cd frontend
cp .env.example .env        # set VITE_BACKEND_URL
```

---

## 2. Environment variables

All secrets live in `backend/.env`. **Nothing sensitive is ever sent to the browser.**

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | Backend port (default `4000`). |
| `APP_BASE_URL` | yes | Public URL of the **frontend**, used to build interview links. |
| `CORS_ORIGINS` | yes | Comma‑separated allowed browser origins. |
| `OPENAI_API_KEY` | yes (unless mock) | OpenAI key. **Backend only.** |
| `OPENAI_CHAT_MODEL` | no | Default `gpt-4o`. |
| `OPENAI_TRANSCRIBE_MODEL` | no | Default `gpt-4o-transcribe`. |
| `OPENAI_TTS_MODEL` | no | Default `gpt-4o-mini-tts`. |
| `OPENAI_TTS_VOICE` | no | Default `alloy`. |
| `MOCK_MODE` | no | `true` ⇒ no OpenAI calls (canned data). Default `true`. |
| `TELEGRAM_BOT_RESULT_ENDPOINT` | yes | Where final results are POSTed. |
| `RESULT_WEBHOOK_SECRET` | yes | Sent as `Authorization: Bearer <secret>`. |
| `ADMIN_API_SECRET` | yes | Auth for creating sessions (used by the Telegram bot). |
| `INTERVIEW_MAX_MINUTES` | no | Default `15`. |
| `INTERVIEW_MIN_QUESTIONS` | no | Default `10`. |
| `INTERVIEW_MAX_QUESTIONS` | no | Default `15`. |
| `SHOW_RESULT_TO_CANDIDATE` | no | `true` reveals score/pass‑fail on the completion screen. Default `false`. |

Frontend (`frontend/.env`):

| Variable | Description |
|---|---|
| `VITE_BACKEND_URL` | Backend URL the dev proxy forwards `/api` to (default `http://localhost:4000`). |

---

## 3. Run frontend / backend

**Easiest — one command (from the project root):**

```bash
npm run dev          # starts backend (4000) + frontend (5173) together
```

In mock mode the backend auto-creates the demo session on startup, so you can
open the interview link right away — **no `npm run seed` needed**:

```
http://localhost:5173/interview/sample-dev-token-0000000000000000
```

<details>
<summary>Or run services separately (e.g. to also watch the mock bot)</summary>

```bash
npm run dev:backend   # http://localhost:4000
npm run dev:frontend  # http://localhost:5173
npm run mock:bot      # http://localhost:9000  (only if testing without the real bot)
```
</details>

### What the candidate sees
A single clean screen: an **illustrated hiring-manager avatar (“Alex”)** that
**speaks** each question (TTS, with a browser-speech fallback), and either a
**🎤 record** button or a **⌨️ text box** for the answer (auto-falls back to text
if the mic is unavailable). At the end an AI review shows a clear
**Pass / Fail / Needs Review** status with four criteria
(communication, technical accuracy, confidence, job fit) and a short explanation.

> The frontend dev server proxies `/api/*` to the backend, so the browser never needs the backend origin and there are no CORS issues in dev.

---

## 4. Test with the mock interview (no OpenAI key)

With `MOCK_MODE=true` (the default), the system uses:
- the built‑in **Chinese question bank** for questions,
- a canned **Chinese transcript** for every recorded answer,
- a fixed, realistic **evaluation** (score `85`, level `Advanced`, `pass`).

Steps:
1. `npm run mock:bot` (project root) — starts the fake recruiter‑bot backend.
2. `cd backend && npm run seed && npm run dev`.
3. `cd frontend && npm run dev`.
4. Open the seeded link, click **Allow microphone → Start Interview**, and answer each question (any speech works in mock mode).
5. After 15 questions the interview completes and the result is POSTed to the mock bot — watch Terminal 3 print the payload and `→ Bot action: ... = PASS (score 85, Advanced)`.

### Quick API test with curl

```bash
B=http://localhost:4000
T=sample-dev-token-0000000000000000

curl -s $B/api/health
curl -s $B/api/interview-session/$T
curl -s -X POST $B/api/interview-session/$T/start
curl -s -X POST $B/api/interview-session/$T/next-question
curl -s -X POST $B/api/interview-session/$T/transcript \
  -H "Content-Type: application/json" \
  -d '{"question":"请简单介绍一下你自己。","answer_transcript":"你好，我叫李明。"}'
curl -s -X POST $B/api/interview-session/$T/complete
```

### Test the webhook submission directly

The `complete` call delivers automatically. To simulate the exact webhook the backend sends:

```bash
curl -s -X POST http://localhost:9000/interview-result \
  -H "Authorization: Bearer dev-webhook-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "session_token": "sample-dev-token-0000000000000000",
    "chinese_score": 85,
    "chinese_level": "Advanced",
    "pass_fail": "pass",
    "transcript_summary": "The candidate understood most questions and responded naturally in Chinese.",
    "recruiter_summary": "Strong Chinese communication ability; suitable for Chinese-speaking roles.",
    "strengths": ["Good fluency", "Clear answers"],
    "weaknesses": ["Minor grammar mistakes"],
    "question_count": 12,
    "interview_duration_minutes": 15,
    "raw_transcript": []
  }'
```

### Switch to real OpenAI

Two ways:

**a) Admin settings page (enter the key manually — no file edits, no restart):**
Open **`http://localhost:5173/admin`**, enter the `ADMIN_API_SECRET` to unlock, paste your OpenAI API key, untick **Mock mode**, and click **Save settings**. Use **Test connection** to verify the key with a tiny live call. The key is stored server-side (SQLite `settings` table) and used immediately; the browser only ever sees a masked preview (`sk-t••••cdef`). Click **Clear key** to fall back to the `.env` value.

**b) Env file:** in `backend/.env` set `MOCK_MODE=false` and `OPENAI_API_KEY=sk-...`, then restart the backend.

> Precedence: a key entered via the admin page overrides `OPENAI_API_KEY` from `.env`. Likewise the admin Mock-mode toggle overrides `MOCK_MODE`.

---

## 5. Connect with the Telegram bot

The Telegram recruiter bot integrates in two directions.

### a) Minting an interview link (bot → this service)

When a candidate reaches the interview stage, the bot calls the **admin API** to create a session and gets back a ready‑to‑send link:

```bash
curl -s -X POST http://localhost:4000/api/admin/sessions \
  -H "Authorization: Bearer $ADMIN_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"candidate_ref":"<telegram_chat_id>","ttl_hours":72}'
# → { "session_token": "...", "interview_url": "https://.../interview/...", "expires_at": "..." }
```

`candidate_ref` is an opaque id (e.g. the Telegram chat id) so the bot can map the result back to the candidate. **It is never used for scoring.** Send `interview_url` to the candidate.

### b) Receiving the result (this service → bot)

When the interview completes, the backend POSTs the [result JSON](#webhook-payload) to `TELEGRAM_BOT_RESULT_ENDPOINT` with header `Authorization: Bearer <RESULT_WEBHOOK_SECRET>`.

Your bot endpoint should:
1. Verify the `Authorization` header matches your shared secret.
2. Look up the candidate by `session_token` (or `candidate_ref` you stored).
3. Update candidate status using `pass_fail` (`pass` if `chinese_score >= 70`).
4. Respond `200`.

`tools/mock-telegram-bot.js` is a complete reference implementation of such an endpoint.

---

## 6. API endpoints

Base path: `/api`

### Candidate / interview flow
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness + mock‑mode flag. |
| `GET` | `/interview-session/:token` | Validate token. → `{ valid, status, ... }` or `{ valid:false, message }`. |
| `POST` | `/interview-session/:token/start` | Mark session started. |
| `POST` | `/interview-session/:token/next-question` | Get next Chinese question, or `{ done:true }`. |
| `POST` | `/interview-session/:token/tts` | `{ text }` → audio bytes for the question. |
| `POST` | `/interview-session/:token/transcribe` | multipart `audio` → `{ transcript }`. |
| `POST` | `/interview-session/:token/transcript` | Save a Q&A turn `{ question, answer_transcript, timestamp }`. |
| `POST` | `/interview-session/:token/complete` | Evaluate, store result, deliver webhook. |

### Admin (require `Authorization: Bearer ADMIN_API_SECRET`)
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/admin/sessions` | Create a session → `{ session_token, interview_url, expires_at }`. |
| `GET` | `/admin/sessions/:token` | Inspect status, result, and full transcript. |
| `GET` | `/admin/settings` | Current effective settings (API key returned **masked** only). |
| `POST` | `/admin/settings` | Set `{ openai_api_key?, mock_mode? }` at runtime. `""` clears the key. |
| `POST` | `/admin/settings/test` | Verify the configured key with a tiny live OpenAI call. |

Admin UI for the settings above: **`/admin`** on the frontend.

---

## 7. Webhook payload

POSTed to `TELEGRAM_BOT_RESULT_ENDPOINT` on completion:

```json
{
  "session_token": "string",
  "chinese_score": 85,
  "chinese_level": "Advanced",
  "pass_fail": "pass",
  "transcript_summary": "The candidate understood most questions and responded naturally in Chinese.",
  "recruiter_summary": "Candidate has strong Chinese communication ability and is suitable for Chinese-speaking recruiter roles.",
  "strengths": ["Good fluency", "Clear answers", "Strong comprehension"],
  "weaknesses": ["Minor grammar mistakes"],
  "subscores": {
    "pronunciation": 84, "fluency": 86, "listening_comprehension": 88,
    "grammar": 82, "vocabulary": 83, "naturalness": 86,
    "coherence": 85, "confidence": 84
  },
  "question_count": 12,
  "interview_duration_minutes": 15,
  "raw_transcript": [
    { "question": "请简单介绍一下你自己。", "answer_transcript": "...", "timestamp": "..." }
  ]
}
```

**Scoring → level → pass/fail**

| Score | Level | Result |
|---|---|---|
| 0–30 | Beginner | fail |
| 31–55 | Elementary | fail |
| 56–70 | Intermediate | fail |
| 71–85 | Advanced | **pass** |
| 86–100 | Native‑like / Professional | **pass** |

Pass threshold: **`chinese_score >= 70`**.

---

## 8. Security

- `OPENAI_API_KEY` is **backend‑only**; all OpenAI calls happen server‑side. The browser only ever calls `/api/*`.
- A key entered via the **`/admin`** page is stored server‑side and never returned to any browser (only a masked preview). The page itself is gated by `ADMIN_API_SECRET`. In production, additionally restrict `/admin` and `/api/admin/*` to trusted networks/operators.
- Webhook is authenticated with `RESULT_WEBHOOK_SECRET` (Bearer token); the bot must verify it.
- Admin session creation requires `ADMIN_API_SECRET`.
- Session tokens are 32‑char random ids with an expiry (`ttl_hours`, default 72h).
- **Duplicate submissions prevented:** a session is marked `completed` *before* the webhook is sent; re‑calling `complete` returns the stored result without re‑evaluating or re‑charging OpenAI.
- **Completed links cannot be reused:** `start`/`transcript`/`next-question` return `409` once completed.
- Transcripts are stored server‑side in SQLite; the candidate‑facing completion screen hides the score/pass‑fail unless `SHOW_RESULT_TO_CANDIDATE=true`.
- Set restrictive `CORS_ORIGINS` in production.

---

## 9. Deployment notes

- **Node >= 22.5** required (built‑in SQLite). No native modules ⇒ trivial to containerize.
- **Backend:** run `node src/index.js` behind a process manager (pm2/systemd) or in a container. Persist `backend/data/` (the SQLite db) on a volume. For higher concurrency or multi‑instance deployments, point `db.js` at PostgreSQL.
- **Frontend:** `npm run build` → static files in `frontend/dist/`. Serve them from any static host/CDN.
- **Routing:** put the frontend and backend behind one domain and route `/api/*` to the backend (so the browser uses same‑origin). Example nginx:
  ```nginx
  location /api/ { proxy_pass http://backend:4000; }
  location /     { root /var/www/interview/dist; try_files $uri /index.html; }
  ```
  Alternatively host them separately and set `CORS_ORIGINS` + a frontend rewrite for `/api`.
- **HTTPS is required** for microphone access (`getUserMedia`) on any non‑localhost domain.
- Set `MOCK_MODE=false`, a real `OPENAI_API_KEY`, and strong random `RESULT_WEBHOOK_SECRET` / `ADMIN_API_SECRET` in production.
- `APP_BASE_URL` must be the public HTTPS URL of the frontend so generated interview links are correct.

---

## Project structure

```
.
├── backend/
│   ├── src/
│   │   ├── index.js            # Express app + server
│   │   ├── config.js           # env-based config
│   │   ├── db.js               # node:sqlite schema
│   │   ├── store.js            # session/transcript data access
│   │   ├── settings.js         # runtime settings (manual API key / mock toggle)
│   │   ├── prompts.js          # interviewer + evaluation prompts, question bank, level map
│   │   ├── routes/
│   │   │   ├── interview.js     # candidate flow endpoints
│   │   │   └── admin.js         # session creation/inspection
│   │   ├── services/
│   │   │   ├── ai.js            # OpenAI (chat/STT/TTS/eval) + mock mode
│   │   │   └── webhook.js       # result delivery to Telegram bot
│   │   └── scripts/seed.js      # seed a fixed sample token
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── main.jsx            # router
│   │   ├── api.js              # /api client
│   │   ├── useRecorder.js      # MediaRecorder hook
│   │   ├── pages/Interview.jsx # landing → conversation → completion
│   │   ├── pages/Admin.jsx     # /admin — manual API key entry + settings
│   │   └── styles.css
│   ├── vite.config.js          # dev proxy /api → backend
│   └── .env.example
├── tools/mock-telegram-bot.js   # fake recruiter-bot webhook receiver
└── package.json                 # root convenience scripts
```
