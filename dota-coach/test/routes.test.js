import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRoute, newMemory, parseMinimap, estimateWaves, enemyDepth, RoutePlanner } from '../src/coach/routes.js';
import { TIMINGS } from '../data/knowledge.js';
import { MAP, JUNGLE, FOUNTAINS, TOWERS, BOUNDS } from '../data/map.js';

// A minimal live context the way engine.js builds it.
const ctx = (o = {}) => ({
  team: 'radiant',
  clock: 300,
  role: 1,
  T: TIMINGS,
  phase: 'laning',
  fightLevel: 'neutral',
  gsi: { map: { daytime: true } },
  ...o,
  hero: { xpos: 0, ypos: 0, alive: true, health_percent: 90, ...(o.hero || {}) },
});
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ownAreas = (team) => JUNGLE.filter((a) => a.team === team);

test('the map data is complete and inside the bounds', () => {
  assert.equal(Object.keys(TOWERS).length, 22);
  for (const t of Object.values(TOWERS)) for (const v of t.pos) assert.ok(v > BOUNDS.min && v < BOUNDS.max);
  assert.ok(MAP.lanes.top.length >= 2 && MAP.lanes.mid.length >= 2 && MAP.lanes.bot.length >= 2);
  assert.ok(MAP.runes.some((r) => r.kind === 'power') && MAP.runes.some((r) => r.kind === 'bounty') && MAP.runes.some((r) => r.kind === 'wisdom'));
  assert.ok(MAP.roshan.pits.top && MAP.roshan.pits.bot && MAP.tormentors.length === 2);
  assert.match(MAP.note, /omtrentlige/);
  // Radiant towers are on the Radiant half, Dire towers on the Dire half.
  for (const t of Object.values(TOWERS)) assert.ok(enemyDepth(t.pos, t.team) < 0, `${t.team} T${t.tier} ${t.lane}`);
});

test('a support routes to the nearest own camp before :53 to stack', () => {
  // Pos 5 in the Radiant safe lane (bot) at 2:40: the stack at 2:53 is the target, in own jungle, near the lane.
  const r = planRoute(ctx({ role: 5, clock: 160, hero: { xpos: 4500, ypos: -6100 } }));
  assert.equal(r.target.kind, 'stack');
  assert.equal(r.target.at, 173);
  assert.ok(r.target.at - r.target.eta >= 160 + 3, 'arrives before the pull');
  const nearest = ownAreas('radiant').sort((a, b) => Math.hypot(a.pos[0] - 4500, a.pos[1] + 6100) - Math.hypot(b.pos[0] - 4500, b.pos[1] + 6100))[0];
  // The camp itself or its lane-side pull spot, whichever is closer.
  assert.ok([nearest.pos, nearest.pull].filter(Boolean).some((p) => p[0] === r.target.x && p[1] === r.target.y), JSON.stringify([r.target.x, r.target.y]));
  assert.ok(r.path.length >= 2);
  assert.deepEqual(r.path[0], { x: 4500, y: -6100 });
  assert.deepEqual(r.path[r.path.length - 1], { x: r.target.x, y: r.target.y });
  assert.match(r.reason, /2:50/);

  // A Dire pos 4 in its offlane (bot) goes to the camp on the Dire side.
  const dire = planRoute(ctx({ team: 'dire', role: 4, clock: 220, hero: { xpos: 6200, ypos: -1500 } }));
  assert.equal(dire.target.kind, 'stack');
  assert.ok(enemyDepth([dire.target.x, dire.target.y], 'dire') < 0);

  // Long before the stack (xx:10) the support stays in lane.
  const early = planRoute(ctx({ role: 5, clock: 130, hero: { xpos: 4500, ypos: -6100 } }));
  assert.notEqual(early.target.kind, 'stack');
  assert.ok(early.steps.length >= 2, 'the stack shows up as a later stop');
});

test('a mid goes for the power rune before 6:00', () => {
  const r = planRoute(ctx({ role: 2, clock: 340, hero: { xpos: -300, ypos: -300 } }));
  assert.equal(r.target.kind, 'power');
  assert.equal(r.target.at, 360);
  assert.ok(r.timing);
  // Earlier in the minute the mid stays in lane, with the rune as a later stop.
  const lane = planRoute(ctx({ role: 2, clock: 300, hero: { xpos: -300, ypos: -300 } }));
  assert.equal(lane.target.kind, 'lane');
  assert.ok(lane.steps.some((s) => s.kind === 'power' && s.at === 360));
});

test('a carry farming in the mid game loops on its own side', () => {
  for (const team of ['radiant', 'dire']) {
    const start = team === 'radiant' ? { xpos: 1000, ypos: -4000 } : { xpos: -1000, ypos: 4000 };
    const r = planRoute(ctx({ team, phase: 'mid', clock: 900, fightLevel: 'farm', hero: start }));
    assert.ok(['wave', 'camp'].includes(r.target.kind), r.target.kind);
    assert.ok(r.steps.length >= 3);
    for (const s of r.steps) assert.ok(['wave', 'camp'].includes(s.kind), s.kind);
    for (const s of r.steps) assert.ok(enemyDepth([s.x, s.y], team) < 1500, `${s.label} is on the enemy side`);
    assert.ok(r.steps.some((s) => s.kind === 'camp'));
    assert.ok(r.steps.some((s) => s.kind === 'wave'));
  }
});

test('when the team presses, objectives come first', () => {
  const r = planRoute(ctx({ phase: 'mid', clock: 1300, fightLevel: 'press', hero: { xpos: 0, ypos: 0 } }));
  assert.ok(['tower', 'tormentor', 'roshan'].includes(r.target.kind), r.target.kind);
  assert.ok(r.steps.filter((s) => s.kind === 'tormentor').length <= 1);
});

test('RETREAT goes home', () => {
  const r = planRoute(ctx({ phase: 'mid', clock: 900, fightLevel: 'retreat', hero: { xpos: 2000, ypos: 2000, health_percent: 60 } }));
  assert.equal(r.target.kind, 'retreat');
  assert.ok(enemyDepth([r.target.x, r.target.y], 'radiant') < enemyDepth([2000, 2000], 'radiant') - 1000);
  // Very low HP: straight to the fountain.
  const low = planRoute(ctx({ phase: 'mid', clock: 900, fightLevel: 'neutral', hero: { xpos: 2000, ypos: 2000, health_percent: 12 } }));
  assert.equal(low.target.kind, 'retreat');
  assert.deepEqual([low.target.x, low.target.y], FOUNTAINS.radiant);
});

test('while dead the route starts at the fountain', () => {
  const r = planRoute(ctx({ phase: 'mid', clock: 900, fightLevel: 'farm', hero: { xpos: 2000, ypos: 2000, alive: false, health_percent: 0 } }));
  assert.equal(r.respawn, true);
  assert.deepEqual(r.from, { x: FOUNTAINS.radiant[0], y: FOUNTAINS.radiant[1] });
  assert.match(r.headline, /^Etter respawn/);
});

test('hysteresis keeps the target stable across small moves', () => {
  const mem = newMemory();
  const ids = new Set();
  let x = 1000;
  let y = -4000;
  for (let t = 900; t < 915; t += 0.25) {
    // Jitter around a slow walk.
    x += 20 + (Math.sin(t * 7) * 150);
    y -= 15 + (Math.cos(t * 5) * 150);
    const r = planRoute(ctx({ phase: 'mid', clock: t, fightLevel: 'farm', hero: { xpos: x, ypos: y } }), mem);
    ids.add(r.target.id);
  }
  assert.equal(ids.size, 1, [...ids].join(', '));

  // A fight meter that wobbles between farm and neutral does not flip it either.
  const mem2 = newMemory();
  const ids2 = new Set();
  for (let t = 900; t < 910; t += 0.25) {
    const r = planRoute(ctx({ phase: 'mid', clock: t, fightLevel: t % 1 ? 'farm' : 'neutral', hero: { xpos: 1000, ypos: -4000 } }), mem2);
    ids2.add(r.target.id);
  }
  assert.equal(ids2.size, 1, [...ids2].join(', '));
});

test('the target changes when it is reached or a timing event comes', () => {
  const mem = newMemory();
  const first = planRoute(ctx({ role: 5, clock: 140, hero: { xpos: 4500, ypos: -6100 } }), mem);
  assert.equal(first.target.kind, 'lane');
  const stack = planRoute(ctx({ role: 5, clock: 158, hero: { xpos: 4500, ypos: -6100 } }), mem);
  assert.equal(stack.target.kind, 'stack');
  assert.equal(stack.changeWhy, 'timing');
  // Standing at the camp after the pull: the stack is done and the route moves on.
  const after = planRoute(ctx({ role: 5, clock: 174, hero: { xpos: stack.target.x, ypos: stack.target.y } }), mem);
  assert.notEqual(after.target.id, stack.target.id);
});

test('waves are estimated from the clock and stay on the lanes', () => {
  const w = estimateWaves(300, 'radiant', undefined);
  assert.equal(w.length, 3);
  for (const x of w) {
    assert.equal(x.source, 'estimate');
    assert.ok(x.arrivesIn >= 0 && x.arrivesIn <= 60);
  }
});

test('minimap parsing tolerates garbage and learns what it can', () => {
  for (const junk of [null, undefined, 42, 'x', [], {}, [null, 1, 'a', { xpos: 'NaN' }], { a: { xpos: 1e9, ypos: 0 } }, { o1: { xpos: 0 } }]) {
    const p = parseMinimap(junk, 'radiant');
    assert.ok(Array.isArray(p.laneCreeps) && Array.isArray(p.neutrals) && Array.isArray(p.sample));
  }
  const block = {
    o0: { xpos: 3000, ypos: -6300, team: 2, unitname: 'npc_dota_creep_goodguys_melee', image: 'minimap_creep' },
    o1: { xpos: 3100, ypos: -6300, team: 3, unitname: 'npc_dota_creep_badguys_melee', image: 'minimap_creep' },
    o2: { xpos: 900, ypos: -4100, team: 4, unitname: 'npc_dota_neutral_kobold', image: 'minimap_creep' },
    o3: { xpos: 'garbage', ypos: {}, unitname: 7 },
    o4: 'not an object',
    o5: { xpos: 0, ypos: 0, image: 'minimap_herocircle', unitname: 'npc_dota_hero_axe', team: 3 },
  };
  const p = parseMinimap(block, 'radiant');
  assert.equal(p.laneCreeps.length, 1);
  assert.equal(p.neutrals.length, 1);
  assert.equal(p.sample.length, 5);

  // The planner keeps working with any block, and keeps a compact sample for /api/diagnostics.
  const planner = new RoutePlanner();
  for (const junk of [null, 'x', [1, 2, 3], { deep: { deeper: {} } }, block]) {
    const r = planner.update(ctx({ phase: 'mid', clock: 900, fightLevel: 'farm', hero: { xpos: 1000, ypos: -4000 }, gsi: { map: { daytime: true }, minimap: junk } }));
    assert.ok(r.target);
  }
  const diag = planner.diagnostics();
  assert.equal(diag.count, 6);
  assert.ok(diag.sample.length <= 5);
  assert.ok(JSON.stringify(diag).length < 3000);
  // Our creeps seen on the minimap place the bot wave.
  const r = planner.update(ctx({ phase: 'mid', clock: 900.5, fightLevel: 'farm', hero: { xpos: 1000, ypos: -4000 }, gsi: { map: { daytime: true }, minimap: block } }));
  const bot = r.waves.find((x) => x.lane === 'bot');
  assert.equal(bot.source, 'minimap');
  assert.deepEqual([bot.x, bot.y], [3000, -6300]);
});

test('the planner never throws on odd input', () => {
  for (const c of [
    ctx({ hero: { xpos: undefined, ypos: undefined } }),
    ctx({ phase: 'strategy', clock: -80 }),
    ctx({ phase: 'pregame', clock: -30, role: 5 }),
    ctx({ phase: 'late', clock: 4000, fightLevel: 'fight', gsi: { buildings: { radiant: {}, dire: 'x' }, map: {} } }),
    ctx({ role: 'x', team: 'spectator', clock: NaN }),
  ]) {
    const r = planRoute(c);
    assert.ok(r && Array.isArray(r.path) && Array.isArray(r.steps));
  }
  const all = planRoute(ctx({ phase: 'mid', clock: 1300, gsi: { map: {}, buildings: { radiant: { dota_goodguys_tower1_bot: { health: 0 } } } } }));
  assert.ok(all.deadTowers.includes('dota_goodguys_tower1_bot'));
});

test('a few hundred route updates take little time', () => {
  const mem = newMemory();
  const t0 = performance.now();
  for (let i = 0; i < 400; i++) planRoute(ctx({ phase: 'mid', clock: 900 + i / 4, fightLevel: 'farm', hero: { xpos: (i * 37) % 8000 - 4000, ypos: -4000 } }), mem);
  assert.ok(performance.now() - t0 < 2000);
});
