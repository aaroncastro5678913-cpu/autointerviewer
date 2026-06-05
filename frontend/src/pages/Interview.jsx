import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  validateSession,
  startInterview,
  getNextQuestion,
  transcribeAnswer,
  saveTranscriptTurn,
  completeInterview,
} from '../api.js';
import { useVoiceAnswer, micSupported } from '../useVoiceAnswer.js';
import { useSpeechRecognition, speechRecognitionSupported } from '../useSpeechRecognition.js';
import { primeSpeech, speakText, cancelSpeech } from '../speech.js';
import InterviewerAvatar from '../components/InterviewerAvatar.jsx';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Meeting chrome -------------------------------------------------------

function useClock() {
  const [t, setT] = useState(() => fmtTime(new Date()));
  useEffect(() => {
    const id = setInterval(() => setT(fmtTime(new Date())), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}
function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MeetHeader({ sub }) {
  const clock = useClock();
  return (
    <div className="meet-header">
      <div className="meet-title">
        Chinese Speaking Interview
        {sub && <span className="meet-sub"> · {sub}</span>}
      </div>
      <div className="meet-clock">{clock}</div>
    </div>
  );
}

function MeetShell({ sub, children, bar }) {
  return (
    <div className="meet">
      <MeetHeader sub={sub} />
      <div className="meet-stage">{children}</div>
      {bar}
    </div>
  );
}

function InterviewerTile({ speaking }) {
  return (
    <div className={`meet-tile ${speaking ? 'speaking' : ''}`}>
      <InterviewerAvatar speaking={speaking} />
      <div className="name-chip">
        Recruiter {speaking && <span className="chip-dot" />}
      </div>
    </div>
  );
}

function SelfTile({ listening, level }) {
  const meterPct = Math.min(100, Math.round(level * 400));
  return (
    <div className={`meet-self ${listening ? 'live' : ''}`}>
      <div className="self-avatar">You</div>
      <div className="self-foot">
        <span className="self-mic">{listening ? '🎤' : '🔇'}</span>
        {listening && (
          <span className="self-meter">
            <span style={{ width: `${meterPct}%` }} />
          </span>
        )}
      </div>
    </div>
  );
}

// ---- Page -----------------------------------------------------------------

export default function Interview() {
  const { token } = useParams();
  const [phase, setPhase] = useState('loading'); // loading|invalid|prejoin|voice|text|done
  const [error, setError] = useState(null);
  const voice = useVoiceAnswer();

  useEffect(() => {
    let alive = true;
    validateSession(token)
      .then((res) => {
        if (!alive) return;
        if (!res.valid) {
          setError(res.message || 'Invalid or expired interview link.');
          setPhase('invalid');
        } else if (res.status === 'completed') {
          setPhase('done');
        } else {
          setPhase('prejoin');
        }
      })
      .catch(() => {
        if (!alive) return;
        setError('Could not reach the interview server.');
        setPhase('invalid');
      });
    return () => {
      alive = false;
    };
  }, [token]);

  if (phase === 'loading') {
    return (
      <MeetShell>
        <div className="meet-center">
          <div className="meet-spinner" />
          <p className="meet-muted">Connecting…</p>
        </div>
      </MeetShell>
    );
  }
  if (phase === 'invalid') {
    return (
      <MeetShell>
        <div className="meet-center">
          <div className="meet-emoji">⚠️</div>
          <h2>Can’t join this interview</h2>
          <p className="meet-muted">{error}</p>
          <p className="meet-muted small">Please ask the recruiter for a new link.</p>
        </div>
      </MeetShell>
    );
  }
  if (phase === 'done') return <MeetEnd result={null} />;
  if (phase === 'prejoin') return <PreJoin token={token} voice={voice} onJoin={(m) => setPhase(m)} />;
  if (phase === 'voice') return <Meeting token={token} voice={voice} onNeedText={() => setPhase('text')} />;
  if (phase === 'text') return <TextMeeting token={token} />;
  return null;
}

function PreJoin({ token, voice, onJoin }) {
  const [joining, setJoining] = useState(false);

  const join = async () => {
    setJoining(true);
    // Unlock audio + speech inside this user gesture.
    primeSpeech();
    try {
      await startInterview(token);
    } catch {
      /* continue */
    }
    const micOk = micSupported ? await voice.prime() : false;
    onJoin(micOk ? 'voice' : 'text');
  };

  return (
    <div className="meet">
      <MeetHeader />
      <div className="meet-stage">
        <InterviewerTile speaking={false} />
      </div>
      <div className="prejoin-panel">
        <h2>Ready to join?</h2>
        <p className="meet-muted">
          You’ll <b>hear</b> each question from the recruiter and just <b>answer out loud</b>. It’s fully automatic —
          no buttons during the test.
        </p>
        <button className="meet-join" onClick={join} disabled={joining} type="button">
          {joining ? 'Joining…' : '🎧 Join now'}
        </button>
        {!micSupported && <p className="meet-muted small">No microphone detected — you’ll type your answers.</p>}
      </div>
    </div>
  );
}

const STAGE_LABEL = {
  thinking: 'Preparing the next question…',
  asking: 'Recruiter is speaking…',
  listening: 'Listening — please answer out loud',
  processing: 'Got it…',
};

function Meeting({ token, voice, onNeedText }) {
  const [stage, setStage] = useState('thinking');
  const [qNumber, setQNumber] = useState(0);
  const [total, setTotal] = useState(12);
  const [level, setLevel] = useState(0);
  const [revealText, setRevealText] = useState(null);
  const [err, setErr] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState(null);

  const sr = useSpeechRecognition();
  const cancelRef = useRef(false);
  const finishedRef = useRef(false);

  const finish = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    cancelRef.current = true;
    voice.abort();
    sr.abort();
    cancelSpeech();
    setFinishing(true);
    try {
      const res = await completeInterview(token);
      setResult(res.result || null);
    } catch {
      setResult(null);
    } finally {
      setDone(true);
    }
  }, [token, voice]);

  useEffect(() => {
    cancelRef.current = false;
    let fails = 0;

    (async () => {
      while (!cancelRef.current) {
        setStage('thinking');
        let nq;
        try {
          nq = await getNextQuestion(token);
          fails = 0;
        } catch {
          fails += 1;
          if (fails >= 3) {
            setErr('Connection problem — could not load the next question.');
            return;
          }
          await delay(1200);
          continue;
        }
        if (cancelRef.current) return;
        if (nq.done) {
          await finish();
          return;
        }
        if (nq.question_number) setQNumber(nq.question_number);
        if (nq.total_estimate) setTotal(nq.total_estimate);

        // Speak the question aloud (no on-screen Chinese unless audio is impossible).
        setStage('asking');
        const spoken = await speakText(nq.question);
        setRevealText(spoken ? null : nq.question);
        if (cancelRef.current) return;

        // Listen automatically and transcribe with REAL speech recognition.
        setStage('listening');
        let transcript = '';
        if (speechRecognitionSupported) {
          const res = await sr.listen({ lang: 'zh-CN', maxMs: 30000 });
          transcript = res.transcript || '';
        } else {
          // Fallback: capture audio + server-side STT (OpenAI when configured).
          let blob;
          try {
            blob = await voice.recordAnswer({ onLevel: setLevel, onState: setStage });
          } catch {
            blob = new Blob([]);
          }
          if (blob === null) {
            onNeedText(); // mic became unavailable
            return;
          }
          if (blob && blob.size > 0) {
            try {
              const r = await transcribeAnswer(token, blob);
              transcript = r.transcript || '';
            } catch {
              /* keep empty */
            }
          }
        }
        setLevel(0);
        if (cancelRef.current) return;

        // Save the REAL transcript (empty if nothing was said -> scored as No Answer).
        setStage('processing');
        try {
          await saveTranscriptTurn(token, { question: nq.question, answer_transcript: transcript });
        } catch {
          /* ignore and continue */
        }
      }
    })();

    return () => {
      cancelRef.current = true;
      voice.abort();
      sr.abort();
      cancelSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  if (done) return <MeetEnd result={result} />;
  if (finishing) return <Completing />;

  const retry = () => {
    setErr(null);
    setAttempt((a) => a + 1);
  };

  return (
    <MeetShell
      sub={`Question ${qNumber || 1} of ~${total}`}
      bar={
        <div className="meet-bar">
          <div className="meet-caption">{revealText ? '(audio unavailable)' : STAGE_LABEL[stage]}</div>
          <div className="meet-controls">
            <button className={`round-btn ${stage === 'listening' ? 'active' : ''}`} type="button" title="Microphone">
              🎤
            </button>
            <button className="round-btn danger" type="button" onClick={finish} title="End interview">
              End
            </button>
          </div>
        </div>
      }
    >
      <InterviewerTile speaking={stage === 'asking'} />
      <SelfTile listening={stage === 'listening'} level={level} />

      {revealText && (
        <div className="reveal-banner">
          <span className="meet-muted small">Audio unavailable on this device — question:</span>
          <div className="reveal-q">{revealText}</div>
        </div>
      )}

      {err && (
        <div className="error-overlay">
          <div className="meet-emoji">😕</div>
          <p>{err}</p>
          <button className="meet-join" type="button" onClick={retry}>
            Retry
          </button>
        </div>
      )}
    </MeetShell>
  );
}

// Typed fallback when no microphone is available. Question is still read aloud.
function TextMeeting({ token }) {
  const [question, setQuestion] = useState(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState(null);
  const startedRef = useRef(false);

  const finish = useCallback(async () => {
    setFinishing(true);
    try {
      const res = await completeInterview(token);
      setResult(res.result || null);
    } catch {
      setResult(null);
    } finally {
      setDone(true);
    }
  }, [token]);

  const loadNext = useCallback(async () => {
    setBusy(true);
    try {
      const nq = await getNextQuestion(token);
      if (nq.done) {
        await finish();
        return;
      }
      setQuestion(nq);
      speakText(nq.question);
      setBusy(false);
    } catch {
      setBusy(false);
    }
  }, [token, finish]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    loadNext();
  }, [loadNext]);

  const submit = async () => {
    if (busy || !question) return;
    const answer = typed.trim();
    setTyped('');
    setBusy(true);
    try {
      await saveTranscriptTurn(token, { question: question.question, answer_transcript: answer });
    } catch {
      /* ignore */
    }
    await loadNext();
  };

  if (done) return <MeetEnd result={result} />;
  if (finishing) return <Completing />;

  return (
    <MeetShell sub={`Question ${question?.question_number || 1}`}>
      <InterviewerTile speaking={false} />
      <div className="text-fallback">
        <p className="meet-muted small">Microphone unavailable — type your answer (the question is read aloud).</p>
        <textarea
          className="meet-textarea"
          rows={3}
          placeholder="Type your answer in Chinese, then press Enter…"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={busy}
        />
        <button className="meet-join" type="button" onClick={submit} disabled={busy || !typed.trim()}>
          Send answer
        </button>
      </div>
    </MeetShell>
  );
}

function Completing() {
  return (
    <MeetShell>
      <div className="meet-center">
        <div className="meet-spinner" />
        <h2>Evaluating your Chinese…</h2>
        <p className="meet-muted">Scoring your fluency. Please wait a moment.</p>
      </div>
    </MeetShell>
  );
}

// ---- Result ("call ended") ------------------------------------------------

const DECISION_META = {
  pass: { label: 'PASS', cls: 'badge-pass', icon: '✅' },
  fail: { label: 'FAIL', cls: 'badge-fail', icon: '❌' },
  needs_review: { label: 'NEEDS REVIEW', cls: 'badge-review', icon: '🟡' },
};

const CRITERIA_LABELS = {
  pronunciation: 'Pronunciation',
  grammar: 'Grammar',
  vocabulary: 'Vocabulary',
  response_speed: 'Response speed',
  coherence: 'Coherence',
  naturalness: 'Naturalness',
};

function MeetEnd({ result }) {
  const decision = result?.decision;
  const meta = result?.no_answer
    ? { label: 'NO ANSWER', cls: 'badge-fail', icon: '🚫' }
    : decision
    ? DECISION_META[decision]
    : null;
  return (
    <div className="meet">
      <MeetHeader sub="Interview ended" />
      <div className="meet-stage meet-end">
        <div className="meet-panel">
          {meta ? (
            <>
              <div className="meet-emoji">{meta.icon}</div>
              <h2>Chinese test complete</h2>
              <div className={`decision-badge ${meta.cls}`}>{meta.label}</div>
              {typeof result.overall_score === 'number' && (
                <p className="meet-muted">
                  Fluency score: <b>{result.overall_score}/100</b>
                  {result.level ? <> · {result.level}</> : null}
                </p>
              )}
              {result.criteria && (
                <div className="criteria">
                  {Object.entries(CRITERIA_LABELS).map(([k, label]) => (
                    <CriteriaBar key={k} label={label} value={result.criteria[k]} />
                  ))}
                </div>
              )}
              {result.explanation && <p className="explanation">{result.explanation}</p>}
              <p className="meet-muted small">The recruiter will follow up. You may close this window.</p>
            </>
          ) : (
            <>
              <div className="meet-emoji">✅</div>
              <h2>Thank you!</h2>
              <p className="meet-muted">Your Chinese test is complete. The recruiter will review the result.</p>
              <p className="meet-muted small">You may now close this window.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CriteriaBar({ label, value }) {
  const v = typeof value === 'number' ? value : 0;
  return (
    <div className="criteria-row">
      <span className="criteria-label">{label}</span>
      <span className="criteria-track">
        <span className="criteria-fill" style={{ width: `${Math.min(100, Math.max(0, v))}%` }} />
      </span>
      <span className="criteria-value">{v}</span>
    </div>
  );
}
