// One-click demo: starts the coach (unless it is already running), opens the dashboard and plays a simulated match.
import { exec } from 'node:child_process';
import { startServer } from '../src/server.js';
import { loadSettings } from '../src/settings.js';
import { runSimulation } from './simulate.js';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const settings = loadSettings();
let port = settings.port;
try {
  ({ port } = await startServer({ quiet: true }));
} catch (err) {
  if (err.code !== 'EADDRINUSE') throw err;
}
const url = `http://localhost:${port}`;
console.log(`\n  Dashboard: ${url}\n`);
if (!args.includes('--no-open')) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
await new Promise((r) => setTimeout(r, 2500));
await runSimulation({ port, token: settings.token, speed: Number(arg('speed', 12)), hero: arg('hero', 'antimage') });
console.log('\n  Demoen er ferdig. Lukk vinduet når du er ferdig med å se.\n');
