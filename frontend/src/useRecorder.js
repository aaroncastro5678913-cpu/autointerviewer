import { useRef, useState, useCallback } from 'react';

// Pick a mime type the browser actually supports.
function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const resolveRef = useRef(null);

  const requestPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop immediately; we only wanted to confirm permission on the landing page.
      stream.getTracks().forEach((t) => t.stop());
      setError(null);
      return true;
    } catch (err) {
      setError(err.message || 'Microphone permission denied');
      return false;
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    chunksRef.current = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const mimeType = pickMimeType();
    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRef.current = mr;
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (resolveRef.current) {
        resolveRef.current(blob);
        resolveRef.current = null;
      }
    };
    mr.start();
    setRecording(true);
  }, []);

  // Stop and resolve with the recorded Blob.
  const stop = useCallback(() => {
    return new Promise((resolve) => {
      const mr = mediaRef.current;
      if (!mr || mr.state === 'inactive') {
        resolve(new Blob([], { type: 'audio/webm' }));
        return;
      }
      resolveRef.current = resolve;
      mr.stop();
      setRecording(false);
    });
  }, []);

  return { recording, error, requestPermission, start, stop };
}
