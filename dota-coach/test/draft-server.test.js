// The pick phase end to end: a GSI "draft" block fills the draft, beats the screen reading, and the overlay's
// suggestions (state.draftHelp) follow within a second.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';
import { loadSettings } from '../src/settings.js';
import { makeFixtures } from '../tools/make-fixtures.js';

let srv;
let base;
const token = loadSettings().token;
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const get = async (p) => (await fetch(base + p)).json();

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotacoach-draft-'));
  makeFixtures(dir);
  srv = await startServer({ port: 0, quiet: true, fixturesDir: dir, matchesDir: path.join(dir, 'matches'), noWarmup: true, noUpdate: true });
  base = `http://127.0.0.1:${srv.port}`;
});

after(() => srv.close());

const gsi = (matchid, extra = {}) => ({
  auth: { token },
  map: { matchid, game_state: 'DOTA_GAMERULES_STATE_HERO_SELECTION', clock_time: -50 },
  player: { team_name: 'radiant' },
  hero: { id: 0 },
  ...extra,
});

// Polls the state until `ok(state)` (at most `ms`).
async function waitState(ok, ms = 1000) {
  const t0 = Date.now();
  let st;
  do {
    st = await get('/api/state');
    if (ok(st)) return { st, ms: Date.now() - t0 };
    await new Promise((r) => setTimeout(r, 25));
  } while (Date.now() - t0 < ms);
  return { st, ms: Date.now() - t0 };
}

test('a GSI draft block fills the draft and the suggestions within a second', async () => {
  await post('/api/draft', { reset: true, enemies: [], allies: [], bans: [] });
  const block = {
    activeteam: 3,
    pick: true,
    activeteam_time_remaining: 25,
    team2: { home_team: true, pick0_id: 2, pick0_class: 'axe', pick1_id: 0, pick1_class: '', ban0_id: 0, ban0_class: '' },
    team3: { pick0_id: 0, pick0_class: 'npc_dota_hero_lion', pick1_id: 22, ban0_class: 'pudge' },
  };
  assert.equal((await post('/gsi', gsi('5001', { draft: block }))).status, 200);
  const d = await get('/api/draft');
  assert.deepEqual(d.allies, ['axe']);
  assert.deepEqual(d.enemies.sort(), ['lion', 'zuus']);
  assert.deepEqual(d.bans, ['pudge']);
  assert.equal(d.source, 'gsi');
  assert.equal(d.sources.lion, 'gsi');
  assert.deepEqual(d.autoBans, ['pudge']);

  const { st, ms } = await waitState((s) => s.draftHelp?.enemyList?.length === 2);
  assert.ok(ms < 1000, `draftHelp after ${ms} ms`);
  const dh = st.draftHelp;
  assert.equal(dh.source, 'gsi');
  assert.ok(dh.enemyList.every((h) => h.src === 'gsi'));
  assert.deepEqual(dh.allyList.map((h) => h.name), ['axe']);
  assert.ok(dh.picks.length > 0);
  assert.ok(!dh.picks.some((p) => ['axe', 'lion', 'zuus', 'pudge'].includes(p.name)), 'picked and banned heroes are not suggested');
  assert.ok(dh.picks.every((p) => Array.isArray(p.reasons)));

  // The matchups for the enemies arrive in the background and refine the suggestions.
  const refined = await waitState((s) => s.draftHelp?.hasMatchups && !s.draftHelp.loading, 3000);
  assert.ok(refined.st.draftHelp.hasMatchups);

  // The diagnostics keep a compact copy of what Dota sent.
  const diag = await get('/api/diagnostics');
  assert.equal(diag.draft.source, 'gsi');
  assert.equal(diag.draft.gsiSample.heroes, 4);
  assert.equal(diag.draft.gsiSample.block.team3.pick1_id, 22);
  assert.ok(!('pick1_id' in diag.draft.gsiSample.block.team2), 'empty slots are left out');
  assert.deepEqual(diag.draft.gsi.dire.sort(), ['lion', 'zuus']);
});

test('the game beats the screen, and an empty draft block does not wipe the draft', async () => {
  // The screen reads other heroes for Dire: Dota's own data wins for that team.
  let res = await (await post('/api/draft/auto', { left: ['axe', 'sven'], right: ['tinker', 'riki'] })).json();
  assert.deepEqual(res.draft.enemies.sort(), ['lion', 'zuus']);
  // Radiant has heroes from the game too, so the screen's Sven is not taken.
  assert.deepEqual(res.draft.allies, ['axe']);

  // Dota stops filling the block: what we had stays.
  await post('/gsi', gsi('5001', { draft: {} }));
  await post('/gsi', gsi('5001', { draft: { team2: { pick0_id: 0 }, team3: {} } }));
  const d = await get('/api/draft');
  assert.deepEqual(d.enemies.sort(), ['lion', 'zuus']);
  const diag = await get('/api/diagnostics');
  assert.equal(diag.draft.gsiSample.heroes, 0);
  assert.equal(diag.draft.gsiSampleWithHeroes.heroes, 4);

  // Garbage in the draft block is ignored.
  for (const junk of ['x', 42, null, [1, 2], { team2: 'x', team3: [null] }, { team2: { pick0_id: { a: 1 } } }]) {
    assert.equal((await post('/gsi', gsi('5001', { draft: junk }))).status, 200);
  }
  assert.deepEqual((await get('/api/draft')).enemies.sort(), ['lion', 'zuus']);

  // A removed hero stays removed even though the game still lists it.
  res = await (await post('/api/draft', { enemies: ['lion'], allies: ['axe'], bans: [], removed: ['zuus', 'pudge'] })).json();
  assert.deepEqual(res.draft.enemies, ['lion']);
  assert.deepEqual(res.draft.bans, []);
  await post('/api/draft', { reset: true, enemies: [], allies: [], bans: [] });
});

test('your own hero from GSI: the suggestions turn to your teammates and what the team lacks', async () => {
  const block = { team2: { pick0_class: 'crystal_maiden', pick1_class: 'witch_doctor' }, team3: { pick0_class: 'sven' } };
  await post('/gsi', gsi('5002', { draft: block }));
  await post('/gsi', gsi('5002', { draft: block, hero: { id: 5, name: 'npc_dota_hero_crystal_maiden' } }));
  const d = await get('/api/draft');
  // A new match: the draft Dota sent for the last one is gone.
  assert.deepEqual(d.enemies, ['sven']);
  assert.equal(d.ownHero, 'crystal_maiden');
  assert.deepEqual(d.allies, ['witch_doctor'], 'your own hero is not one of the allies');
  const { st } = await waitState((s) => s.draftHelp?.ownHero?.name === 'crystal_maiden');
  const dh = st.draftHelp;
  assert.equal(dh.forTeam, true);
  assert.ok(!dh.picks.some((p) => ['crystal_maiden', 'witch_doctor', 'sven'].includes(p.name)));
  // Two supports and no initiator: the team lacks initiation and says so in Norwegian.
  assert.match(dh.needsText, /^Laget mangler .*initiering/);
  assert.ok(dh.needs.some((n) => n.id === 'initiation'));
  assert.equal(st.phase, 'draft');
});

test('ban suggestions while bans are made', async () => {
  // Captains mode style: Dota says it is a ban turn.
  await post('/gsi', gsi('5003', { draft: { activeteam: 2, pick: false, team2: { ban0_class: 'pudge' }, team3: {} } }));
  const { st } = await waitState((s) => s.draftHelp?.banPhase && s.draftHelp.bans?.length > 0);
  assert.equal(st.draftHelp.banPhase, true);
  assert.ok(st.draftHelp.bans.length > 0);
  assert.ok(!st.draftHelp.bans.some((b) => b.name === 'pudge'));
  assert.ok(st.draftHelp.bans.every((b) => b.reasons.length > 0));

  // Picks are being made: no ban list in the overlay.
  await post('/gsi', gsi('5003', { draft: { activeteam: 3, pick: true, team2: { ban0_class: 'pudge', pick0_class: 'axe' }, team3: {} } }));
  const after = await waitState((s) => s.draftHelp?.banPhase === false);
  assert.equal(after.st.draftHelp.banPhase, false);

  // The dashboard's draft tab gets ban suggestions too.
  const res = await (await post('/api/draft', { suggestOnly: true, role: 2 })).json();
  assert.ok(res.suggestions.bans.length > 0);
  assert.ok(typeof res.suggestions.loading === 'boolean');
});

test('review fix: the same draft block sent 4 times a second is not a new draft each time', async () => {
  await post('/api/draft', { reset: true, enemies: [], allies: [], bans: [] });
  const block = { pick: true, team2: { pick0_class: 'axe' }, team3: { pick0_class: 'lion', pick1_id: 22, ban0_class: 'pudge' } };
  await post('/gsi', gsi('5099', { draft: block }));
  const first = (await get('/api/draft')).rev;
  for (let i = 0; i < 6; i++) await post('/gsi', gsi('5099', { draft: block }));
  assert.equal((await get('/api/draft')).rev, first);
});
