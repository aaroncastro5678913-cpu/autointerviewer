import React, { useState } from 'react';
import { getAdminSettings, saveAdminSettings, testAdminConnection } from '../api.js';

// Admin settings page — lets an operator paste the OpenAI API key manually.
// The admin secret is held only in this component's state (this browser session)
// and sent as a Bearer token. The API key is sent to the backend and stored
// server-side; the server only ever returns a masked preview.
export default function Admin() {
  const [secret, setSecret] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [settings, setSettings] = useState(null);

  const [apiKey, setApiKey] = useState('');
  const [mockMode, setMockMode] = useState(true);

  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const flash = (m, isErr = false) => {
    setMsg(isErr ? null : m);
    setErr(isErr ? m : null);
  };

  const load = async (sec) => {
    setBusy(true);
    flash(null);
    try {
      const s = await getAdminSettings(sec);
      setSettings(s);
      setMockMode(!!s.mock_mode);
      setUnlocked(true);
    } catch (e) {
      flash(e.message, true);
      setUnlocked(false);
    } finally {
      setBusy(false);
    }
  };

  const unlock = (e) => {
    e.preventDefault();
    if (secret) load(secret);
  };

  const save = async () => {
    setBusy(true);
    flash(null);
    try {
      const payload = { mock_mode: mockMode };
      // Only send the key field if the operator typed something.
      if (apiKey.trim()) payload.openai_api_key = apiKey.trim();
      const s = await saveAdminSettings(secret, payload);
      setSettings(s);
      setApiKey('');
      flash('Settings saved.');
    } catch (e) {
      flash(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    setBusy(true);
    flash(null);
    try {
      const s = await saveAdminSettings(secret, { openai_api_key: '' });
      setSettings(s);
      setApiKey('');
      flash('Manual key cleared (now using OPENAI_API_KEY from .env, if set).');
    } catch (e) {
      flash(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    flash(null);
    try {
      const r = await testAdminConnection(secret);
      if (r.ok) flash(r.mock ? r.note : `✅ Connection OK (model: ${r.model}).`);
      else flash(`❌ ${r.error}`, true);
    } catch (e) {
      flash(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  if (!unlocked) {
    return (
      <div className="card">
        <div className="emoji center">🔐</div>
        <h1 className="center">Admin settings</h1>
        <p className="muted center">Enter the admin secret to manage the OpenAI API key.</p>
        <form onSubmit={unlock}>
          <label className="field-label">Admin secret</label>
          <input
            className="field"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="ADMIN_API_SECRET"
            autoFocus
          />
          <button className="btn primary big" type="submit" disabled={busy || !secret}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </form>
        {err && <p className="err center">{err}</p>}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="emoji center">⚙️</div>
      <h1 className="center">Admin settings</h1>

      <div className="status-grid">
        <Row label="Effective mode" value={settings?.mock_mode ? 'MOCK (no OpenAI calls)' : 'LIVE (OpenAI)'} />
        <Row
          label="OpenAI key"
          value={
            settings?.openai_key_set
              ? `${settings.openai_key_masked}  ·  source: ${settings.openai_key_source}`
              : 'not set'
          }
        />
        <Row label="Chat model" value={settings?.chat_model} />
        <Row label="Transcribe model" value={settings?.transcribe_model} />
        <Row label="TTS model / voice" value={`${settings?.tts_model} · ${settings?.tts_voice}`} />
      </div>

      <hr className="sep" />

      <label className="field-label">OpenAI API key</label>
      <input
        className="field mono"
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={settings?.openai_key_set ? 'Enter a new key to replace the current one' : 'sk-...'}
        autoComplete="off"
      />
      <p className="muted small">Stored server-side only. Leave blank to keep the current key.</p>

      <label className="toggle">
        <input type="checkbox" checked={mockMode} onChange={(e) => setMockMode(e.target.checked)} />
        <span>
          Mock mode <span className="muted">(no real OpenAI calls — uses canned data)</span>
        </span>
      </label>
      <p className="muted small">Turn this off to use the API key above for real interviews.</p>

      <div className="btn-row">
        <button className="btn primary" type="button" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
        <button className="btn ghost" type="button" onClick={test} disabled={busy}>
          Test connection
        </button>
        <button className="btn ghost" type="button" onClick={clearKey} disabled={busy || !settings?.openai_key_set}>
          Clear key
        </button>
      </div>

      {msg && <p className="ok center">{msg}</p>}
      {err && <p className="err center">{err}</p>}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="status-row">
      <span className="muted">{label}</span>
      <b>{value ?? '—'}</b>
    </div>
  );
}
