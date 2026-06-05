import { useRef, useCallback } from 'react';

// Hands-free voice answer capture with automatic end-of-answer (silence)
// detection — no buttons. Records the candidate, watches the mic level with a
// Web Audio analyser, and stops automatically when they stop speaking.

export const micSupported =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia;

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export function useVoiceAnswer() {
  const ctxRef = useRef(null);
  const cancelRef = useRef(null);

  // Must be called from a user gesture (the Start button) so the browser allows
  // audio playback + microphone capture for the rest of the automatic flow.
  const prime = useCallback(async () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && !ctxRef.current) ctxRef.current = new Ctx();
      if (ctxRef.current?.state === 'suspended') await ctxRef.current.resume();
      // Pre-request mic permission so the first question doesn't stall on a prompt.
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  }, []);

  // Record one answer. Resolves with a Blob (possibly empty if no speech).
  // Options:
  //   silenceMs       end after this much silence once the person has spoken
  //   maxMs           hard cap on answer length
  //   startTimeoutMs  if no speech at all, give up and return empty
  //   threshold       RMS level treated as "speaking"
  //   onLevel/onState UI callbacks
  const recordAnswer = useCallback(
    async ({
      silenceMs = 1800,
      maxMs = 45000,
      startTimeoutMs = 12000,
      threshold = 0.02,
      onLevel,
      onState,
    } = {}) => {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        return null; // mic unavailable
      }

      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = ctxRef.current || new Ctx();
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          /* ignore */
        }
      }
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);

      const mimeType = pickMimeType();
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      return await new Promise((resolve) => {
        let raf = 0;
        let speechSeen = false;
        let lastVoice = performance.now();
        const begin = performance.now();
        let settled = false;

        const cleanup = () => {
          cancelAnimationFrame(raf);
          try {
            source.disconnect();
          } catch {
            /* ignore */
          }
        };

        mr.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          if (settled) return;
          settled = true;
          resolve(new Blob(chunks, { type: mimeType || 'audio/webm' }));
        };

        const stopNow = () => {
          cleanup();
          onState?.('processing');
          try {
            if (mr.state !== 'inactive') mr.stop();
            else if (!settled) {
              settled = true;
              resolve(new Blob(chunks, { type: mimeType || 'audio/webm' }));
            }
          } catch {
            if (!settled) {
              settled = true;
              resolve(new Blob(chunks, { type: mimeType || 'audio/webm' }));
            }
          }
        };

        // Allow the caller to abort (e.g. on unmount).
        cancelRef.current = stopNow;

        mr.start();
        onState?.('listening');

        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          onLevel?.(rms);

          const now = performance.now();
          if (rms > threshold) {
            speechSeen = true;
            lastVoice = now;
          }
          const elapsed = now - begin;

          if (!speechSeen && elapsed > startTimeoutMs) return stopNow(); // no answer
          if (speechSeen && now - lastVoice > silenceMs) return stopNow(); // finished talking
          if (elapsed > maxMs) return stopNow(); // safety cap

          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      });
    },
    []
  );

  const abort = useCallback(() => {
    if (cancelRef.current) cancelRef.current();
  }, []);

  return { prime, recordAnswer, abort };
}
