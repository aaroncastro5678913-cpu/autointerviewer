import { useRef, useCallback } from 'react';

// Real speech-to-text using the browser's Web Speech API (free, no install,
// works in Chrome/Edge). It both captures the mic AND transcribes, with
// built-in end-of-speech detection — so a silent candidate yields an EMPTY
// transcript (which the backend then scores as "No answer"), never a fake one.

const SR =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export const speechRecognitionSupported = !!SR;

export function useSpeechRecognition() {
  const recRef = useRef(null);

  // Listen for one answer. Resolves with { transcript, heardSpeech }.
  // Auto-stops when the candidate stops speaking, on error, or at maxMs.
  const listen = useCallback(({ lang = 'zh-CN', maxMs = 30000, onInterim } = {}) => {
    return new Promise((resolve) => {
      if (!SR) {
        resolve({ transcript: '', heardSpeech: false, supported: false });
        return;
      }
      const rec = new SR();
      recRef.current = rec;
      rec.lang = lang;
      rec.continuous = false; // stop automatically at end of speech
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      let finalText = '';
      let heardSpeech = false;
      let settled = false;
      let timer = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          rec.onresult = rec.onerror = rec.onend = null;
          rec.stop();
        } catch {
          /* ignore */
        }
        resolve({ transcript: finalText.trim(), heardSpeech, supported: true });
      };

      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (finalText || interim) heardSpeech = true;
        if (onInterim) onInterim((finalText + interim).trim());
      };
      rec.onerror = () => finish(); // 'no-speech', 'aborted', 'network', etc.
      rec.onend = () => finish();

      try {
        rec.start();
      } catch {
        finish();
        return;
      }
      timer = setTimeout(finish, maxMs);
    });
  }, []);

  const abort = useCallback(() => {
    try {
      recRef.current?.abort?.();
    } catch {
      /* ignore */
    }
  }, []);

  return { listen, abort, supported: speechRecognitionSupported };
}
