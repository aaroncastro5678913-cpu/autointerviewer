import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import {
  getSession,
  isExpired,
  markStarted,
  markCompleted,
  markWebhookDelivered,
  addTranscriptTurn,
  getTranscript,
  getQuestionCount,
} from '../store.js';
import { nextQuestion, transcribeAudio, synthesizeSpeech, evaluateTranscript } from '../services/ai.js';
import { sendResultWebhook, sendStartedWebhook } from '../services/webhook.js';
import { notifyStarted, notifyResult, isChatId } from '../telegram/bot.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per answer clip
});

// Load a valid session or send a standard error. Returns null if not usable.
async function loadSession(req, res) {
  const session = await getSession(req.params.token);
  if (!session) {
    res.status(404).json({ valid: false, message: 'Invalid or expired interview link.' });
    return null;
  }
  if (isExpired(session) && session.status !== 'completed') {
    res.status(410).json({ valid: false, message: 'Invalid or expired interview link.' });
    return null;
  }
  return session;
}

// A. Validate token — GET /api/interview-session/:token
router.get('/:token', async (req, res) => {
  const session = await getSession(req.params.token);
  if (!session || (isExpired(session) && session.status !== 'completed')) {
    return res.json({ valid: false, message: 'Invalid or expired interview link.' });
  }
  res.json({
    valid: true,
    session_token: session.session_token,
    status: session.status,
    question_count: session.question_count,
    config: {
      max_minutes: config.interview.maxMinutes,
      min_questions: config.interview.minQuestions,
      max_questions: config.interview.maxQuestions,
      show_result_to_candidate: config.showResultToCandidate,
    },
  });
});

// B. Start — POST /api/interview-session/:token/start
router.post('/:token/start', async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return;
  if (session.status === 'completed') {
    return res.status(409).json({ error: 'completed', message: 'This interview has already been completed.' });
  }
  const wasPending = session.status === 'pending';
  await markStarted(session.session_token);
  if (wasPending) {
    console.log(`[INTERVIEW] started ${session.session_token}`);
    sendStartedWebhook(session.session_token); // external bot (if configured)
    if (config.telegram.botToken && isChatId(session.telegram_chat_id)) {
      notifyStarted(session.telegram_chat_id).catch(() => {}); // direct Telegram
    }
  }
  res.json({ ok: true, status: 'in_progress' });
});

// Next question — POST /api/interview-session/:token/next-question
router.post('/:token/next-question', async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return;
  if (session.status === 'completed') {
    return res.status(409).json({ error: 'completed', message: 'This interview has already been completed.' });
  }
  try {
    const history = await getTranscript(session.session_token);
    const asked = history.length;
    const minutesElapsed = session.started_at
      ? (Date.now() - new Date(session.started_at).getTime()) / 60000
      : 0;

    const timeUp = minutesElapsed >= config.interview.maxMinutes;
    const reachedMax = asked >= config.interview.maxQuestions;
    const reachedMin = asked >= config.interview.minQuestions;
    const done = reachedMax || (timeUp && reachedMin);

    if (done) {
      return res.json({ done: true, question_number: asked, total_estimate: config.interview.maxQuestions });
    }
    const isFinal = asked + 1 >= config.interview.maxQuestions || (timeUp && asked + 1 >= config.interview.minQuestions);
    const question = await nextQuestion({ history, isFinal });
    res.json({
      done: false,
      question,
      question_number: asked + 1,
      total_estimate: config.interview.maxQuestions,
      minutes_elapsed: Math.round(minutesElapsed),
      minutes_remaining: Math.max(0, Math.round(config.interview.maxMinutes - minutesElapsed)),
    });
  } catch (err) {
    console.error(`[INTERVIEW] next-question failed: ${err.message}`);
    res.status(500).json({ error: 'next_question_failed', message: err.message });
  }
});

// TTS — POST /api/interview-session/:token/tts  { text }
router.post('/:token/tts', async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return;
  const text = (req.body?.text || '').toString().slice(0, 1000);
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const { buffer, contentType } = await synthesizeSpeech(text);
    res.setHeader('Content-Type', contentType);
    res.send(buffer);
  } catch (err) {
    console.error(`[INTERVIEW] tts failed: ${err.message}`);
    res.status(500).json({ error: 'tts_failed', message: err.message });
  }
});

// STT fallback — POST /api/interview-session/:token/transcribe (multipart: audio)
router.post('/:token/transcribe', upload.single('audio'), async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return;
  if (!req.file) return res.status(400).json({ error: 'audio file required (field "audio")' });
  try {
    const transcript = await transcribeAudio({
      buffer: req.file.buffer,
      filename: req.file.originalname || 'answer.webm',
      mimetype: req.file.mimetype || 'audio/webm',
    });
    res.json({ transcript });
  } catch (err) {
    console.error(`[INTERVIEW] transcribe failed: ${err.message}`);
    res.status(500).json({ error: 'transcribe_failed', message: err.message });
  }
});

// Save a Q&A turn — POST /api/interview-session/:token/transcript
router.post('/:token/transcript', async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return;
  if (session.status === 'completed') {
    return res.status(409).json({ error: 'completed', message: 'This interview has already been completed.' });
  }
  const { question, answer_transcript, timestamp } = req.body || {};
  if (!question) return res.status(400).json({ error: 'question required' });
  const { turnIndex, question_count } = await addTranscriptTurn(session.session_token, {
    question,
    answer_transcript: answer_transcript || '',
    timestamp,
  });
  res.json({ ok: true, turn_index: turnIndex, question_count });
});

// D. Complete — POST /api/interview-session/:token/complete
router.post('/:token/complete', async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return;

  if (session.status === 'completed') {
    const stored = session.result_json ? JSON.parse(session.result_json) : null;
    return res.status(200).json({ ok: true, already_completed: true, result: candidateView(stored) });
  }

  try {
    const transcript = await getTranscript(session.session_token);
    const evaluation = await evaluateTranscript(transcript);
    const durationMinutes = session.started_at
      ? Math.max(1, Math.round((Date.now() - new Date(session.started_at).getTime()) / 60000))
      : config.interview.maxMinutes;

    const result = {
      session_token: session.session_token,
      ...evaluation,
      question_count: await getQuestionCount(session.session_token),
      interview_duration_minutes: durationMinutes,
      raw_transcript: transcript.map((t) => ({
        question: t.question,
        answer_transcript: t.answer_transcript,
        timestamp: t.timestamp,
      })),
    };

    // Save BEFORE delivery so the link can't be reused even if a send is retried.
    await markCompleted(session.session_token, result);
    console.log(`[INTERVIEW] completed ${session.session_token} -> ${result.decision}`);
    console.log(`[DB] result saved for ${session.session_token} (score ${result.overall_score})`);

    // Deliver the result: external bot webhook (if set) and/or directly to the
    // candidate's Telegram chat from this server.
    const delivery = await sendResultWebhook(result);
    if (delivery.delivered) await markWebhookDelivered(session.session_token);
    else if (config.webhook.endpoint) {
      console.warn(`[INTERVIEW] result webhook not delivered: ${delivery.error || delivery.status}`);
    }
    if (config.telegram.botToken && isChatId(session.telegram_chat_id)) {
      notifyResult(session.telegram_chat_id, result)
        .then(() => console.log(`[BOT] result message sent to chat ${session.telegram_chat_id}`))
        .catch((e) => console.warn(`[BOT] result notify failed: ${e.message}`));
      await markWebhookDelivered(session.session_token);
    }

    res.json({ ok: true, webhook_delivered: delivery.delivered, result: candidateView(result) });
  } catch (err) {
    console.error(`[INTERVIEW] complete failed: ${err.message}`);
    res.status(500).json({ error: 'complete_failed', message: err.message });
  }
});

// What the candidate-facing client may see.
function candidateView(result) {
  if (!result) return null;
  const base = {
    session_token: result.session_token,
    question_count: result.question_count,
    interview_duration_minutes: result.interview_duration_minutes,
  };
  if (config.showResultToCandidate) {
    base.overall_score = result.overall_score;
    base.level = result.level;
    base.decision = result.decision;
    base.no_answer = result.no_answer;
    base.explanation = result.explanation;
    base.criteria = result.criteria;
  }
  return base;
}

export default router;
