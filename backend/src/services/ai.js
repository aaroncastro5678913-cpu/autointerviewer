import OpenAI from 'openai';
import { config } from '../config.js';
import { getApiKey, isMockMode } from '../settings.js';
import {
  INTERVIEWER_SYSTEM_PROMPT,
  EVALUATION_SYSTEM_PROMPT,
  EVALUATION_INSTRUCTIONS,
  QUESTION_BANK,
  levelForScore,
} from '../prompts.js';

let client = null;
let clientKey = null;
function openai() {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No OpenAI API key configured. Set it via the admin settings page or OPENAI_API_KEY.');
  // Rebuild the client if the key changed at runtime (e.g. entered via admin UI).
  if (!client || clientKey !== apiKey) {
    client = new OpenAI({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

/**
 * Verify the currently-configured OpenAI API key with a tiny live request.
 * Returns { ok, model? , error? }.
 */
export async function testApiKey() {
  if (isMockMode()) {
    return { ok: true, mock: true, note: 'Mock mode is ON — no real OpenAI calls are made.' };
  }
  try {
    const resp = await openai().chat.completions.create({
      model: config.openai.chatModel,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return { ok: true, model: resp.model || config.openai.chatModel };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Produce the next interview question (in Chinese) given the conversation so far.
 * `history` is an array of { question, answer_transcript }.
 * `isFinal` requests a polite closing question.
 */
export async function nextQuestion({ history = [], isFinal = false }) {
  // The very first question is always a fixed, safe opener.
  if (history.length === 0) {
    return QUESTION_BANK[0];
  }

  if (isMockMode()) {
    if (isFinal) return '好的，最后一个问题：你有什么问题想问我们吗？';
    const idx = Math.min(history.length, QUESTION_BANK.length - 1);
    return QUESTION_BANK[idx];
  }

  const messages = [
    { role: 'system', content: INTERVIEWER_SYSTEM_PROMPT },
  ];
  for (const turn of history) {
    messages.push({ role: 'assistant', content: turn.question });
    messages.push({ role: 'user', content: turn.answer_transcript || '（无回答）' });
  }
  messages.push({
    role: 'system',
    content: isFinal
      ? '这是面试的最后一个问题。请用中文礼貌地提出一个简短的收尾问题（例如询问对方是否有问题想问）。只输出这一个问题。'
      : '请根据以上对话，用中文提出下一个合适的问题。只输出这一个问题，不要编号，不要解释。',
  });

  const resp = await openai().chat.completions.create({
    model: config.openai.chatModel,
    temperature: 0.7,
    max_tokens: 120,
    messages,
  });
  const text = resp.choices?.[0]?.message?.content?.trim();
  if (!text) {
    const idx = Math.min(history.length, QUESTION_BANK.length - 1);
    return QUESTION_BANK[idx];
  }
  return text;
}

/**
 * Transcribe an audio buffer to text (Chinese).
 * Returns the transcript string.
 */
export async function transcribeAudio({ buffer, filename = 'answer.webm', mimetype = 'audio/webm' }) {
  if (isMockMode()) {
    // IMPORTANT: do NOT fabricate an answer. Mock mode cannot really transcribe
    // audio, so it must return empty — otherwise silence would be scored as a
    // real answer. Real transcription happens in the browser (Web Speech API)
    // or via OpenAI when MOCK_MODE is off.
    return '';
  }

  // OpenAI SDK accepts a File-like object.
  const file = await OpenAI.toFile(buffer, filename, { type: mimetype });
  const resp = await openai().audio.transcriptions.create({
    file,
    model: config.openai.transcribeModel,
    language: 'zh',
  });
  return (resp.text || '').trim();
}

/**
 * Synthesize speech for a Chinese question.
 * Returns { buffer, contentType }.
 */
export async function synthesizeSpeech(text) {
  if (isMockMode()) {
    // Tiny silent WAV so the frontend can attempt playback without erroring.
    return { buffer: SILENT_WAV, contentType: 'audio/wav' };
  }
  const resp = await openai().audio.speech.create({
    model: config.openai.ttsModel,
    voice: config.openai.ttsVoice,
    input: text,
    response_format: 'mp3',
  });
  const arrayBuffer = await resp.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType: 'audio/mpeg' };
}

/**
 * Evaluate Chinese proficiency from the full transcript.
 * Returns the normalized evaluation object (without session_token / counts).
 */
// An answer must have at least this many non-space characters to count.
const MIN_ANSWER_CHARS = 2;
// The whole interview must have at least this much speech to be scorable.
const MIN_TOTAL_CHARS = 8;

function contentLen(s) {
  return String(s || '').replace(/\s+/g, '').length; // counts CJK characters well
}

function analyzeTranscript(transcript) {
  let answeredTurns = 0;
  let totalChars = 0;
  for (const t of transcript) {
    const len = contentLen(t.answer_transcript);
    if (len >= MIN_ANSWER_CHARS) answeredTurns += 1;
    totalChars += len;
  }
  return { answeredTurns, totalChars };
}

// A real, non-fabricated zero result for empty / too-short interviews.
function zeroEvaluation(note) {
  const criteria = {
    pronunciation: 0,
    grammar: 0,
    vocabulary: 0,
    response_speed: 0,
    coherence: 0,
    naturalness: 0,
  };
  return {
    overall_score: 0,
    level: levelForScore(0),
    decision: 'fail',
    no_answer: true,
    explanation: note,
    criteria,
    chinese_score: 0,
    chinese_level: levelForScore(0),
    pass_fail: 'fail',
    subscores: criteria,
    transcript_summary: note,
    recruiter_summary: note,
    strengths: [],
    weaknesses: [note],
  };
}

// Honest, length-based mock score (NOT a constant). Only used in mock mode and
// clearly labelled. Real scoring requires MOCK_MODE=false + an OpenAI key.
function mockScore(totalChars, answeredTurns) {
  const base = 15 + Math.min(50, totalChars * 0.7) + Math.min(12, answeredTurns * 2);
  return clampScore(base);
}

export async function evaluateTranscript(transcript) {
  const { answeredTurns, totalChars } = analyzeTranscript(transcript);

  // --- Hard guards: never invent a score when there is no real answer. ---
  if (answeredTurns === 0) {
    return zeroEvaluation('No answer detected — the candidate did not provide a spoken response.');
  }
  if (totalChars < MIN_TOTAL_CHARS) {
    return zeroEvaluation('Speech was too short to evaluate.');
  }

  if (isMockMode()) {
    const score = mockScore(totalChars, answeredTurns);
    return normalizeEvaluation({
      overall_score: score,
      criteria: {
        pronunciation: score,
        grammar: clampScore(score - 2),
        vocabulary: clampScore(score - 1),
        response_speed: score,
        coherence: score,
        naturalness: clampScore(score - 1),
      },
      explanation: `Mock estimate based on ${totalChars} characters across ${answeredTurns} answer(s). This is NOT a real fluency judgment — set MOCK_MODE=false with an OpenAI key for real evaluation.`,
      transcript_summary: `Candidate gave ${answeredTurns} spoken answer(s), about ${totalChars} characters total.`,
      recruiter_summary: 'Mock-mode length estimate only — enable real evaluation for an accurate fluency score.',
      strengths: [],
      weaknesses: [],
    });
  }

  const transcriptText = transcript
    .map((t, i) => `Q${i + 1}（面试官）: ${t.question}\nA${i + 1}（候选人）: ${t.answer_transcript || '（无回答）'}`)
    .join('\n\n');

  const resp = await openai().chat.completions.create({
    model: config.openai.chatModel,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: EVALUATION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `${EVALUATION_INSTRUCTIONS}\n\n=== TRANSCRIPT ===\n${transcriptText}`,
      },
    ],
  });

  let parsed;
  try {
    parsed = JSON.parse(resp.choices[0].message.content);
  } catch {
    parsed = { overall_score: 0, explanation: 'Evaluation could not be parsed.' };
  }
  return normalizeEvaluation(parsed);
}

function clampScore(n) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return 0;
  return Math.min(100, Math.max(0, x));
}

// Pass / Fail / Needs Review from the overall score.
function decideOutcome(overall) {
  if (overall >= config.passThreshold) return 'pass';
  if (overall < config.reviewFloor) return 'fail';
  return 'needs_review';
}

function normalizeEvaluation(raw) {
  const criteria = {
    pronunciation: clampScore(raw.criteria?.pronunciation),
    grammar: clampScore(raw.criteria?.grammar),
    vocabulary: clampScore(raw.criteria?.vocabulary),
    response_speed: clampScore(raw.criteria?.response_speed),
    coherence: clampScore(raw.criteria?.coherence),
    naturalness: clampScore(raw.criteria?.naturalness),
  };
  const vals = Object.values(criteria);
  const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  const overall = raw.overall_score != null ? clampScore(raw.overall_score) : avg;
  const decision = decideOutcome(overall);

  return {
    // New, primary fields
    overall_score: overall,
    level: levelForScore(overall),
    decision, // 'pass' | 'fail' | 'needs_review'
    no_answer: false,
    explanation: raw.explanation || '',
    criteria,

    // Legacy field names kept so the Telegram bot webhook stays compatible.
    chinese_score: overall,
    chinese_level: levelForScore(overall),
    pass_fail: decision,
    subscores: criteria,

    transcript_summary: raw.transcript_summary || '',
    recruiter_summary: raw.recruiter_summary || '',
    strengths: Array.isArray(raw.strengths) ? raw.strengths.slice(0, 8) : [],
    weaknesses: Array.isArray(raw.weaknesses) ? raw.weaknesses.slice(0, 8) : [],
  };
}

// 0.1s of silence, 8kHz mono PCM WAV — valid header so <audio> won't throw in mock mode.
const SILENT_WAV = (() => {
  const sampleRate = 8000;
  const numSamples = Math.floor(sampleRate * 0.1);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
})();
