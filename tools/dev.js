// One command to run the whole interview app: backend + frontend together.
// Usage:  npm run dev   (from the Auto_interview folder)
// No extra dependencies — just spawns the two existing dev scripts and prefixes
// their output. Press Ctrl+C to stop both.
import { spawn } from 'node:child_process';

const services = [
  { name: 'backend', args: ['--prefix', 'backend', 'run', 'dev'] },
  { name: 'frontend', args: ['--prefix', 'frontend', 'run', 'dev'] },
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
  // shell:true so `npm` resolves on Windows.
  const child = spawn('npm', svc.args, { shell: true });
  child.stdout.on('data', (d) => process.stdout.write(tagLines(tag, d)));
  child.stderr.on('data', (d) => process.stderr.write(tagLines(tag, d)));
  child.on('exit', (code) => {
    console.log(`${tag} exited (code ${code}). Stopping the other service…`);
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

console.log('Starting interview backend + frontend…  (press Ctrl+C to stop both)\n');
