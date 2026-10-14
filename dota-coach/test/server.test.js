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

test('heroes recognised on screen fill the draft; the user can remove a wrong one', async () => {
  const draftPayload = (team) => ({ auth: { token }, map: { matchid: '777', game_state: 'DOTA_GAMERULES_STATE_HERO_SELECTION', clock_time: -60 }, player: { team_name: team }, hero: { id: 0 } });
  await post('/api/draft', { reset: true, enemies: [], allies: [] }); // start from an empty draft
  // Team not known yet: the heroes are only listed as recognised.
  await post('/gsi', { ...draftPayload('radiant'), player: {} });
  let res = await (await post('/api/draft/auto', { left: ['axe', 'lion'], right: ['phantom_assassin', 'zuus', 'nope'] })).json();
  assert.deepEqual(res.draft.enemies, []);
  assert.deepEqual(res.draft.unassigned.sort(), ['axe', 'lion', 'phantom_assassin', 'zuus']);

  // Dire: the heroes on the left are the enemies.
  await post('/gsi', draftPayload('dire'));
  const d = await (await fetch(`${base}/api/draft`)).json();
  assert.deepEqual(d.enemies.sort(), ['axe', 'lion']);
  assert.deepEqual(d.allies.sort(), ['phantom_assassin', 'zuus']);
  assert.equal(d.team, 'dire');

  // Pick suggestions for the overlay show up in the state during the draft.
  let state;
  for (let i = 0; i < 50 && !state?.draftHelp?.enemies?.length; i++) {
    await new Promise((r) => setTimeout(r, 50));
    state = await (await fetch(`${base}/api/state`)).json();
  }
  assert.equal(state.phase, 'draft');
  assert.ok(state.draftHelp.picks.length > 0);
  assert.ok(!state.draftHelp.picks.some((p) => ['axe', 'lion', 'zuus'].includes(p.name)));
  assert.deepEqual(state.draft.autoEnemies.sort(), ['axe', 'lion']);

  // Lion was a misdetection: removed by hand, it stays out even though the screen still shows it.
  res = await (await post('/api/draft', { enemies: ['axe', 'tinker'], allies: ['phantom_assassin', 'zuus'], removed: ['lion'] })).json();
  assert.deepEqual(res.draft.enemies.sort(), ['axe', 'tinker']);
  res = await (await post('/api/draft/auto', { left: ['axe', 'lion', 'riki'], right: ['phantom_assassin', 'zuus'] })).json();
  assert.deepEqual(res.draft.enemies.sort(), ['axe', 'riki', 'tinker']);
  assert.deepEqual(res.draft.autoEnemies.sort(), ['axe', 'riki']);

  // The desktop app reports in; the status shows it.
  const v = await (await post('/api/vision/status', { found: 5, heroes: [] })).json();
  assert.equal(v.ok, true);
  const st = await (await fetch(`${base}/api/status`)).json();
  assert.equal(st.vision.active, true);
  await post('/api/draft', { reset: true });
});

test('the live coach says which ability to skill and which neutral item to pick', async () => {
  await fetch(`${base}/api/hero/juggernaut`); // pro skill builds from the fixtures
  const s = { phase: 'GAME', clock: 425, hero: 'juggernaut', heroId: 8, deaths: 0, alive: true, respawn: 0, lowHp: false, matchId: '778' };
  let state;
  for (let i = 0; i < 8; i++) {
    s.clock += 1;
    assert.equal((await post('/gsi', fakePayload(s, token))).status, 200);
    await new Promise((r) => setTimeout(r, 30));
  }
  state = await (await fetch(`${base}/api/state`)).json();
  assert.ok(state.skills?.games > 0, 'skill stats loaded');
  assert.ok(state.skills.next, 'a recommendation for the unspent point');
  const tip = state.tips.find((t) => t.id === 'unspent');
  assert.ok(tip, 'unspent tip');
  assert.match(tip.text, new RegExp(state.skills.next.dname));
  assert.ok(state.skills.neutral?.artifacts.length);
  assert.ok(state.tips.some((t) => t.id.startsWith('neutral-')));
});

test('draft: own hero is never suggested, removals stick, and a new match clears the draft', async () => {
  await post('/api/draft', { reset: true, enemies: [], allies: [] });
  const g = (matchid, hero, clock = -50) => ({ auth: { token }, map: { matchid, game_state: 'DOTA_GAMERULES_STATE_HERO_SELECTION', clock_time: clock }, player: { team_name: 'radiant' }, hero });
  await post('/gsi', g('880', { id: 0 }));
  let st = await (await fetch(`${base}/api/state`)).json();
  // Pick the top suggestion, then it must disappear from the suggestions (and never be an enemy).
  let res = await (await post('/api/draft', { enemies: ['axe'], allies: [] })).json();
  const top = res.suggestions.picks[0].name;
  await post('/gsi', g('880', { id: 1, name: `npc_dota_hero_${top}` }));
  res = await (await post('/api/draft/auto', { left: [top], right: ['axe', top] })).json();
  assert.ok(!res.draft.enemies.includes(top));
  res = await (await post('/api/draft', { suggestOnly: true })).json();
  assert.ok(!res.suggestions.picks.some((p) => p.name === top));

  // A body that still lists a hero the user just removed keeps it removed; «Nullstill» keeps removals.
  await post('/api/draft/auto', { left: [], right: ['axe', 'zuus'] });
  res = await (await post('/api/draft', { enemies: ['axe', 'zuus'], allies: [], removed: ['zuus'] })).json();
  assert.ok(!res.draft.enemies.includes('zuus'));
  await post('/api/draft', { reset: true, enemies: [], allies: [] });
  res = await (await post('/api/draft/auto', { left: [], right: ['axe', 'zuus', 'lion'] })).json();
  assert.deepEqual(res.draft.enemies.sort(), ['axe', 'lion']);
  const rev = res.draft.rev;
  assert.ok(rev > 0);
  // suggestOnly does not touch the draft.
  res = await (await post('/api/draft', { suggestOnly: true })).json();
  assert.equal(res.draft.rev, rev);
});
