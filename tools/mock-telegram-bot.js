// Minimal stand-in for the Telegram recruiter bot backend.
// It listens for interview result webhooks and prints them, verifying the
// Authorization: Bearer <RESULT_WEBHOOK_SECRET> header.
//
// Run:  node tools/mock-telegram-bot.js
// Env:  PORT (default 9000), RESULT_WEBHOOK_SECRET (default dev-webhook-secret)

import http from 'node:http';

const PORT = process.env.PORT || 9000;
const SECRET = process.env.RESULT_WEBHOOK_SECRET || 'dev-webhook-secret';

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/interview-result') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const auth = req.headers['authorization'] || '';
      const ok = auth === `Bearer ${SECRET}`;
      if (!ok) {
        console.warn('❌ Rejected webhook: bad/missing Authorization header.');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = body;
      }
      console.log('\n📨 Interview result received:');
      console.log(JSON.stringify(parsed, null, 2));
      console.log(
        `\n   → Bot action: candidate ${parsed.session_token} = ${String(parsed.pass_fail).toUpperCase()} ` +
          `(score ${parsed.chinese_score}, ${parsed.chinese_level})\n`
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, received: true }));
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false }));
});

server.listen(PORT, () => {
  console.log(`🤖 Mock Telegram bot backend listening on http://localhost:${PORT}`);
  console.log(`   Webhook endpoint: POST http://localhost:${PORT}/interview-result`);
  console.log(`   Expecting secret: ${SECRET}\n`);
});
