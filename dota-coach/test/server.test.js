import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';
import { loadSettings } from '../src/settings.js';
import { gsiConfig, parseLibraryFolders } from '../src/setup.js';
import { makeFixtures } from '../tools/make-fixtures.js';

let srv;
let base;
const token = loadSettings().token;
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotacoach-'));
  makeFixtures(dir);
  srv = await startServer({ port: 0, quiet: true, fixturesDir: dir });
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
