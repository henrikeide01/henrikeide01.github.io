// Quick check that the app starts and the coach works. Run by the updater on freshly installed code
// (in a separate process); exits with code 0 when everything is fine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (msg) => {
  console.error(`Selvtest feilet: ${msg}`);
  process.exit(1);
};

// The Electron main file can only run inside Electron, so just syntax-check it.
const check = spawnSync(process.execPath, ['--check', path.join(root, 'overlay', 'main.cjs')], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
if (check.status !== 0) fail(`overlay/main.cjs: ${check.stderr.trim().split('\n').pop()}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dotacoach-selftest-'));
try {
  await import('./setup.js');
  await import('./updater.js');
  const { startServer } = await import('./server.js');
  const srv = await startServer({ port: 0, quiet: true, noWarmup: true, noUpdate: true, matchesDir: tmp });
  const ok = srv.handleGsi({
    auth: { token: (await import('./settings.js')).loadSettings().token },
    map: { matchid: 'selftest', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 300, game_time: 390, daytime: true },
    player: { team_name: 'radiant', gold: 500, gpm: 400, xpm: 400, last_hits: 30, deaths: 0 },
    hero: { name: 'npc_dota_hero_antimage', level: 6, alive: true, health_percent: 90, max_health: 900, xpos: 4000, ypos: -6000 },
    items: { teleport0: { name: 'item_tpscroll' } },
  });
  const state = srv.getState();
  if (!ok || !state || state.phase !== 'laning' || !state.hero) fail('coachen ga ingen gyldig tilstand');
  for (const page of ['/', '/overlay.html', '/js/dashboard.js', '/api/status']) {
    const res = await fetch(`http://127.0.0.1:${srv.port}${page}`);
    if (!res.ok) fail(`${page} svarte ${res.status}`);
  }
  await srv.close();
} catch (err) {
  fail(err.stack || err.message);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('Selvtest OK');
process.exit(0);
