import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';
import { loadSettings } from '../src/settings.js';
import { gsiConfig, parseLibraryFolders } from '../src/setup.js';
import { makeFixtures } from '../tools/make-fixtures.js';
import { fakePayload } from '../tools/simulate.js';

let srv;
let base;
const token = loadSettings().token;
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotacoach-'));
  makeFixtures(dir);
  srv = await startServer({ port: 0, quiet: true, fixturesDir: dir, matchesDir: path.join(dir, 'matches') });
  base = `http://127.0.0.1:${srv.port}`;
});

after(() => srv.close());

test('GSI with a wrong token is rejected', async () => {
  const res = await post('/gsi', { auth: { token: 'feil' } });
  assert.equal(res.status, 401);
});

test('GSI updates the coach state and loads the hero build', async () => {
  const payload = {
    auth: { token },
    map: { matchid: '9', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 300, game_time: 390, daytime: true },
    player: { team_name: 'radiant', gold: 900, gpm: 450, xpm: 480, last_hits: 30, deaths: 0 },
    hero: { name: 'npc_dota_hero_antimage', level: 6, alive: true, health_percent: 90, max_health: 900, xpos: 4000, ypos: -6200 },
    items: { slot0: { name: 'item_quelling_blade' }, teleport0: { name: 'item_tpscroll' } },
  };
  assert.equal((await post('/gsi', payload)).status, 200);
  await fetch(`${base}/api/hero/antimage`); // wait for the build to load
  await post('/gsi', payload);
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.phase, 'laning');
  assert.equal(state.hero.dname, 'Anti-Mage');
  assert.equal(state.location.label, 'bot lane (din safe lane)');
  assert.ok(state.build?.mid?.length > 0);
  assert.ok(state.next);
  assert.ok(state.timers.length > 3);
});

test('meta, draft and static files', async () => {
  const meta = await (await fetch(`${base}/api/meta?role=2&bracket=7`)).json();
  assert.ok(meta.rows.length > 10);
  assert.ok(meta.rows.every((r) => r.positions.includes(2)));

  const draft = await (await post('/api/draft', { enemies: ['axe', 'lion', 'riki', 'riki', 'not_a_hero'], role: 1 })).json();
  assert.deepEqual(draft.draft.enemies, ['axe', 'lion', 'riki']);
  assert.ok(draft.suggestions.picks.length > 0);
  assert.ok(draft.suggestions.hasMatchups);

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Dota Coach/);
  assert.equal((await fetch(`${base}/..%2fsrc%2fserver.js`)).status, 403);
});

test('only one window gets to read a tip aloud', async () => {
  const a = await (await post('/api/claim-speech', { key: 'x#1' })).json();
  const b = await (await post('/api/claim-speech', { key: 'x#1' })).json();
  assert.equal(a.ok, true);
  assert.equal(b.ok, false);
});

test('setup helpers', () => {
  const vdf = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}';
  assert.deepEqual(parseLibraryFolders(vdf), ['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
  const cfg = gsiConfig({ port: 3355, token: 'abc' });
  assert.match(cfg, /"uri"\s+"http:\/\/127\.0\.0\.1:3355\/gsi"/);
  assert.match(cfg, /"token"\s+"abc"/);
});

test('a finished match is analysed and shows up in the match history', async () => {
  const s = { phase: 'GAME', clock: 0, hero: 'juggernaut', heroId: 8, deaths: 0, alive: true, respawn: 0, lowHp: false, matchId: '424242' };
  for (let t = 0; t <= 900; t += 15) {
    s.clock = t;
    if (t === 450) s.deaths = 1;
    await post('/gsi', fakePayload(s, token));
  }
  s.phase = 'POST';
  await post('/gsi', fakePayload(s, token));
  let list;
  for (let i = 0; i < 20; i++) {
    list = await (await fetch(`${base}/api/matches`)).json();
    if (list.matches.length) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(list.matches.length, 1);
  assert.equal(list.matches[0].hero.name, 'juggernaut');
  assert.equal(list.matches[0].result, 'win');
  const report = await (await fetch(`${base}/api/matches/424242`)).json();
  assert.ok(report.categories.length >= 5);
  assert.ok(report.tips.length >= 1);
  assert.equal((await fetch(`${base}/api/matches/finnes-ikke`)).status, 404);

  // OpenDota (fixture) has the parsed match: the report gets the Dota Plus-style details by itself.
  let enriched;
  for (let i = 0; i < 40; i++) {
    enriched = await (await fetch(`${base}/api/matches/424242`)).json();
    if (enriched.opendota) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const d = enriched.opendota?.details;
  assert.ok(d, 'details added automatically after the match');
  assert.equal(enriched.opendota.parsed, true);
  assert.equal(d.damageTaken.rows[0].dname, 'Lina');
  assert.equal(d.damageTakenBy.rows[0].dname, 'Autoangrep');
  assert.ok(d.insights.length >= 1);

  // «Hent nå» fetches again and returns the same details.
  const res = await (await post('/api/matches/424242/opendota', {})).json();
  assert.equal(res.found, true);
  assert.equal(res.parsed, true);
  assert.deepEqual(res.report.opendota.details.damageTypes.pct, d.damageTypes.pct);
});

test('update API: check, install into a copy of the app, then restart', async () => {
  const { gitBlobSha, normalize } = await import('../src/updater.js');
  const http = await import('node:http');
  // A copy of the app that is one version behind.
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dotacoach-app-'));
  const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  fs.cpSync(src, appRoot, { recursive: true, filter: (f) => !/[\\/](node_modules|matches|cache|backup|\.git)([\\/]|$)/.test(f) && !/settings\.json$/.test(f) });
  fs.writeFileSync(path.join(appRoot, 'version.json'), JSON.stringify({ version: '0.9.0', changes: [] }));

  // "GitHub" serves the real app files plus a newer version.json.
  const files = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(appRoot, full).split(path.sep).join('/');
      if (e.isDirectory()) walk(full);
      else files.set(`app/${rel}`, normalize(rel, fs.readFileSync(full)));
    }
  };
  walk(appRoot);
  files.set('app/version.json', Buffer.from(JSON.stringify({ version: '9.9.9', changes: [{ version: '9.9.9', notes: ['Test'] }] })));
  const gh = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/api/repos/o/r/commits/main') return res.end(JSON.stringify({ sha: 'c', commit: { tree: { sha: 't' } } }));
    if (p === '/api/repos/o/r/git/trees/t') return res.end(JSON.stringify({ tree: [...files].map(([f, b]) => ({ path: f, type: 'blob', sha: gitBlobSha(b) })) }));
    const m = p.match(/^\/raw\/o\/r\/(?:refs\/heads\/main|c)\/(.+)$/);
    if (m && files.has(m[1])) return res.end(files.get(m[1]));
    res.writeHead(404);
    res.end('{}');
  });
  await new Promise((r) => gh.listen(0, '127.0.0.1', r));
  const ghBase = `http://127.0.0.1:${gh.address().port}`;

  let restarted = false;
  const s2 = await startServer({
    port: 0,
    quiet: true,
    noWarmup: true,
    noUpdate: true,
    root: appRoot,
    matchesDir: path.join(appRoot, 'matches'),
    updateChannel: { repo: 'o/r', branches: ['main'], path: 'app', apiBase: `${ghBase}/api`, rawBase: `${ghBase}/raw` },
    onRestart: () => (restarted = true),
  });
  const b2 = `http://127.0.0.1:${s2.port}`;
  try {
    const chk = await (await fetch(`${b2}/api/update/check`, { method: 'POST' })).json();
    assert.equal(chk.available, true);
    assert.equal(chk.latest, '9.9.9');
    const res = await (await fetch(`${b2}/api/update/apply`, { method: 'POST' })).json();
    assert.equal(res.ok, true, res.error);
    assert.deepEqual(res.result.updated, ['version.json']);
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(restarted, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(appRoot, 'version.json'), 'utf8')).version, '9.9.9');
    const info = await (await fetch(`${b2}/api/update`)).json();
    assert.equal(info.backups.length, 1);
    const diag = await (await fetch(`${b2}/api/diagnostics`)).json();
    assert.equal(diag.app, '9.9.9');
    assert.ok(!JSON.stringify(diag).includes('dotacoach-local'), 'the GSI token is not in the diagnostics');
  } finally {
    await s2.close();
    gh.close();
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
});
