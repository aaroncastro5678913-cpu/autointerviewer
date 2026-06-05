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
import { sendResultWebhook } from '../services/webhook.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per answer clip
});

// Helper: load a session or send a standard error.
function loadSession(req, res) {
  const session = getSession(req.params.token);
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

// A. Session validation
// GET /api/interview-session/:token
router.get('/:token', (req, res) => {
  const session = getSession(req.params.token);
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

// B. Start interview
// POST /api/interview-session/:token/start
router.post('/:token/start', (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;

  if (session.status === 'completed') {
    return res.status(409).json({ error: 'completed', message: 'This interview has already been completed.' });
  }
  markStarted(session.session_token);
  res.json({ ok: true, status: 'started' });
});

// Interviewer: fetch the next question (in Chinese).
// POST /api/interview-session/:token/next-question
router.post('/:token/next-question', async (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;
  if (session.status === 'completed') {
    return res.status(409).json({ error: 'completed', message: 'This interview has already been completed.' });
  }

  try {
    const history = getTranscript(session.session_token);
    const asked = history.length;
    const minutesElapsed = session.started_at
      ? (Date.now() - new Date(session.started_at).getTime()) / 60000
      : 0;

    // Decide whether the interview should end.
    const timeUp = minutesElapsed >= config.interview.maxMinutes;
    const reachedMax = asked >= config.interview.maxQuestions;
    const reachedMin = asked >= config.interview.minQuestions;
    const done = reachedMax || (timeUp && reachedMin);

    if (done) {
      return res.json({
        done: true,
        question_number: asked,
        total_estimate: config.interview.maxQuestions,
      });
    }

    // Last question if the next one will hit the max or time is nearly up at the min.
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
    console.error('[next-question]', err);
    res.status(500).json({ error: 'next_question_failed', message: err.message });
  }
});

// Text-to-speech for a question.
// POST /api/interview-session/:token/tts  { text }
router.post('/:token/tts', async (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;
  const text = (req.body?.text || '').toString().slice(0, 1000);
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const { buffer, contentType } = await synthesizeSpeech(text);
    res.setHeader('Content-Type', contentType);
    res.send(buffer);
  } catch (err) {
    console.error('[tts]', err);
    res.status(500).json({ error: 'tts_failed', message: err.message });
  }
});

// Speech-to-text: candidate uploads recorded audio, gets transcript back.
// POST /api/interview-session/:token/transcribe  (multipart, field: audio)
router.post('/:token/transcribe', upload.single('audio'), async (req, res) => {
  const session = loadSession(req, res);
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
    console.error('[transcribe]', err);
    res.status(500).json({ error: 'transcribe_failed', message: err.message });
  }
});

// C. Save transcript turn
// POST /api/interview-session/:token/transcript
router.post('/:token/transcript', (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;
  if (session.status === 'completed') {
    return res.status(409).json({ error: 'completed', message: 'This interview has already been completed.' });
  }
  const { question, answer_transcript, timestamp } = req.body || {};
  if (!question) return res.status(400).json({ error: 'question required' });

  const { turnIndex, question_count } = addTranscriptTurn(session.session_token, {
    question,
    answer_transcript: answer_transcript || '',
    timestamp,
  });
  res.json({ ok: true, turn_index: turnIndex, question_count });
});

// D. Complete interview: evaluate, store result, deliver webhook.
// POST /api/interview-session/:token/complete
router.post('/:token/complete', async (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;

  // Prevent duplicate submissions / reuse of completed links.
  if (session.status === 'completed') {
    const stored = session.result_json ? JSON.parse(session.result_json) : null;
    return res.status(200).json({
      ok: true,
      already_completed: true,
      result: candidateView(stored),
    });
  }

  try {
    const transcript = getTranscript(session.session_token);
    const evaluation = await evaluateTranscript(transcript);

    const durationMinutes = session.started_at
      ? Math.max(1, Math.round((Date.now() - new Date(session.started_at).getTime()) / 60000))
      : config.interview.maxMinutes;

    const result = {
      session_token: session.session_token,
      ...evaluation, // overall_score, level, decision, explanation, criteria, + legacy chinese_*/pass_fail
      question_count: getQuestionCount(session.session_token),
      interview_duration_minutes: durationMinutes,
      raw_transcript: transcript.map((t) => ({
        question: t.question,
        answer_transcript: t.answer_transcript,
        timestamp: t.timestamp,
      })),
    };

    // Mark completed BEFORE webhook so the link can never be reused even if delivery is retried.
    markCompleted(session.session_token, result);

    // Deliver to Telegram bot backend.
    const delivery = await sendResultWebhook(result);
    if (delivery.delivered) markWebhookDelivered(session.session_token);
    else console.warn('[complete] webhook not delivered:', delivery.error || delivery.status);

    res.json({
      ok: true,
      webhook_delivered: delivery.delivered,
      result: candidateView(result),
    });
  } catch (err) {
    console.error('[complete]', err);
    res.status(500).json({ error: 'complete_failed', message: err.message });
  }
});

// What the candidate-facing client is allowed to see.
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
    base.decision = result.decision; // pass | fail | needs_review
    base.no_answer = result.no_answer; // true when nothing was said
    base.explanation = result.explanation;
    base.criteria = result.criteria; // pronunciation, grammar, vocabulary, response_speed, coherence, naturalness
  }
  return base;
}

export default router;
