// One command to run the whole project locally: backend (API + Telegram bot in
// polling mode) + the Vite frontend. No extra deps — just spawns two npm scripts
// and prefixes their output. Press Ctrl+C to stop both.
import { spawn } from 'node:child_process';

const services = [
  { name: 'server', args: ['run', 'dev:server'] },
  { name: 'web', args: ['run', 'dev:web'] },
];

function tagLines(tag, buf) {
  return (
    buf
      .toString()
      .split(/\r?\n/)
      .filter((l) => l.length)
      .map((l) => `${tag} ${l}`)
      .join('\n') + '\n'
  );
}

const children = services.map((svc) => {
  const tag = `[${svc.name}]`;
  const child = spawn('npm', svc.args, { shell: true }); // shell:true for Windows
  child.stdout.on('data', (d) => process.stdout.write(tagLines(tag, d)));
  child.stderr.on('data', (d) => process.stderr.write(tagLines(tag, d)));
  child.on('exit', (code) => {
    console.log(`${tag} exited (code ${code}). Stopping the other…`);
    shutdown();
  });
  return child;
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('Starting backend (API + bot) + frontend…  (Ctrl+C to stop both)\n');
