import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Interview from './pages/Interview.jsx';
import Admin from './pages/Admin.jsx';
import { initVoices } from './speech.js';
import './styles.css';

// Warm up the browser TTS voice list as early as possible.
initVoices();

function NotFound() {
  return (
    <div className="app-shell">
      <div className="card center">
        <h1>404</h1>
        <p className="muted">Nothing to see here. Interview links look like /interview/&lt;token&gt;.</p>
      </div>
    </div>
  );
}

// NOTE: StrictMode intentionally omitted. Its dev-only double-invoke of effects
// restarts the automatic interview loop and was causing a stuck "Preparing".
createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Navigate to="/interview/sample-dev-token-0000000000000000" replace />} />
      <Route path="/interview/:token" element={<Interview />} />
      <Route path="/admin" element={<div className="app-shell"><Admin /></div>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </BrowserRouter>
);
