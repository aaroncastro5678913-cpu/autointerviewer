// Browser text-to-speech (Web Speech API). Reliable + audible with no API key,
// which is what the interview needs in mock/dev. The OpenAI TTS endpoint stays
// available on the backend but the UI no longer depends on it for audibility.

export const speechSupported =
  typeof window !== 'undefined' && 'speechSynthesis' in window;

let cachedVoices = [];

export function initVoices() {
  if (!speechSupported) return;
  const load = () => {
    const v = window.speechSynthesis.getVoices();
    if (v && v.length) cachedVoices = v;
  };
  load();
  // Voices often load asynchronously.
  window.speechSynthesis.onvoiceschanged = load;
}

// Must run inside a user gesture (the Join/Start click) to satisfy autoplay
// policies. Speaks a silent utterance to "unlock" speech for the session.
export function primeSpeech() {
  if (!speechSupported) return false;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    cachedVoices = synth.getVoices() || cachedVoices;
    const u = new SpeechSynthesisUtterance('​'); // zero-width space
    u.volume = 0;
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}

function pickChineseVoice() {
  const voices = (speechSupported && window.speechSynthesis.getVoices()) || cachedVoices || [];
  return (
    voices.find((v) => /^zh\b|^zh[-_]|^cmn/i.test(v.lang)) ||
    voices.find((v) => /zh|chinese|mandarin/i.test(v.lang)) ||
    voices.find((v) => /chinese|mandarin|中文|普通话|huihui|yaoyao|kangkang|xiaoxiao|tingting/i.test(v.name)) ||
    null
  );
}

// Speak `text` aloud. Resolves true when speech finished (or was attempted),
// false only if the browser has no speech synthesis at all (caller may then
// reveal the text). Always resolves — never hangs — thanks to a safety timeout.
export function speakText(text) {
  return new Promise((resolve) => {
    if (!speechSupported || !text) {
      resolve(false);
      return;
    }
    const synth = window.speechSynthesis;
    let settled = false;
    const done = (ok) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickChineseVoice();
      u.lang = 'zh-CN';
      if (voice) u.voice = voice;
      u.rate = 0.95;
      u.pitch = 1;
      u.onend = () => done(true);
      // If the engine errors (e.g. no Chinese voice / playback blocked), report
      // failure so the caller can reveal the text as a fallback.
      u.onerror = () => done(false);
      synth.speak(u);
      // Some browsers never fire onend; estimate a duration as a backstop.
      const ms = Math.min(16000, 2500 + text.length * 240);
      setTimeout(() => done(true), ms);
    } catch {
      done(false);
    }
  });
}

export function cancelSpeech() {
  if (!speechSupported) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}
