// Seed a known, fixed sample session token for local development / demos.
// Usage: npm run seed
import db from '../db.js';
import { config } from '../config.js';

const SAMPLE_TOKEN = 'sample-dev-token-0000000000000000';
const now = new Date().toISOString();
const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

// Reset the sample session back to a fresh "pending" state every time we seed,
// so the link is reusable for repeated local testing.
db.prepare('DELETE FROM transcripts WHERE session_token = ?').run(SAMPLE_TOKEN);
db.prepare('DELETE FROM sessions WHERE session_token = ?').run(SAMPLE_TOKEN);
db.prepare(
  `INSERT INTO sessions (session_token, status, candidate_ref, created_at, expires_at)
   VALUES (?, 'pending', 'demo-candidate', ?, ?)`
).run(SAMPLE_TOKEN, now, expires);

console.log('✅ Seeded sample session.');
console.log(`   session_token: ${SAMPLE_TOKEN}`);
console.log(`   interview_url: ${config.appBaseUrl}/interview/${SAMPLE_TOKEN}`);
