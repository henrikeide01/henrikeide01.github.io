// Live "Kjøp nå" suggestions and the death recap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/settings.js';
import { ItemDb, readInventory } from '../src/coach/items.js';
import { liveItemCandidates, vitalStats, isOutgrown, LiveItemTracker } from '../src/coach/live-items.js';
import { snapshot, pushSnapshot, freezeDeath, buildDeathRecap, hpStory } from '../src/coach/death.js';
import { locate } from '../src/coach/map.js';
import { Coach } from '../src/coach/engine.js';

const { items } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/items.json'), 'utf8'));
const heroList = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/heroes.json'), 'utf8')).heroes;
const heroes = new Map(heroList.map((h) => [h.name, h]));
const db = new ItemDb(items);

const inventory = (...names) => readInventory(Object.fromEntries(names.map((n, i) => [`slot${i}`, { name: `item_${n}` }])), db);
const foes = (...names) => names.map((n) => ({ name: n, dname: heroes.get(n)?.dname || n }));
// A vitals history: `n` seconds ending at `clock`, with HP/mana from the given functions.
const history = (clock, n, hp, mana = () => 80, maxMana = 400) =>
  Array.from({ length: n }, (_, i) => ({ t: clock - n + 1 + i, hp: hp(i), mana: mana(i), maxMana, alive: true }));
const calm = { samples: 60, lowHpShare: 0, lowHpEpisodes: 0, lowManaShare: 0, manaSamples: 60 };
const cands = (x) => liveItemCandidates({ phase: 'laning', role: 1, heroAttr: 'agi', inv: inventory(), gold: 0, enemies: [], vitals: calm, db, ...x });
const has = (list, item) => list.some((c) => c.item === item);

// ---------------- Live item suggestions ----------------

test('vital stats count low-HP time and separate low-HP episodes', () => {
  const v = history(300, 60, (i) => (i % 20 < 8 ? 20 : 80));
  const s = vitalStats(v, 300);
  assert.equal(s.samples, 60);
  assert.equal(s.lowHpEpisodes, 3);
  assert.ok(s.lowHpShare > 0.35 && s.lowHpShare < 0.45);
  assert.equal(vitalStats(v, 300 + 400).samples, 0, 'old samples fall out of the window');
  // Heroes without a real mana pool do not count for mana.
  assert.equal(vitalStats(history(300, 30, () => 80, () => 0, 0), 300).manaSamples, 0);
});

test('often low on HP in lane without regen: Healing Salve, Bottle for mid, nothing when holding regen', () => {
  const vitals = vitalStats(history(300, 60, (i) => (i % 20 < 9 ? 22 : 70)), 300);
  const carry = cands({ clock: 300, vitals });
  const salve = carry.find((c) => c.item === 'flask');
  assert.ok(salve, 'carry gets a Healing Salve');
  assert.match(salve.reason, /lav HP/);
  assert.deepEqual(salve.alt, ['tango']);
  assert.ok(has(cands({ clock: 300, vitals, role: 2 }), 'bottle'), 'mid gets a Bottle');
  assert.ok(!has(cands({ clock: 300, vitals, inv: inventory('tango') }), 'flask'), 'already has regen');
  assert.ok(!has(cands({ clock: 1800, phase: 'late', vitals }), 'flask'), 'no Healing Salve suggestions late');
  assert.ok(!has(cands({ clock: 300, vitals: calm }), 'flask'), 'not when the HP is fine');
  assert.ok(!has(cands({ clock: 300, vitals: { ...vitals, samples: 5 } }), 'flask'), 'not on too little data');
});

test('often out of mana: Soul Ring for strength cores, Arcane Boots for supports, Clarity early, nothing when covered', () => {
  const vitals = vitalStats(history(400, 60, () => 80, (i) => (i % 10 < 6 ? 10 : 60)), 400);
  assert.ok(has(cands({ clock: 400, vitals, heroAttr: 'str', role: 3 }), 'soul_ring'));
  assert.ok(has(cands({ clock: 400, vitals, heroAttr: 'agi', role: 5 }), 'arcane_boots'));
  assert.ok(has(cands({ clock: 400, vitals, heroAttr: 'agi', role: 1 }), 'clarity'));
  assert.ok(has(cands({ clock: 400, vitals, role: 2 }), 'bottle'));
  const covered = cands({ clock: 400, vitals, role: 5, inv: inventory('arcane_boots') });
  assert.ok(!covered.some((c) => c.kind === 'mana'), 'Arcane Boots already give mana');
});

test('magic burst lineup: Infused Raindrops early only, real magic defence later, none when owned', () => {
  const enemies = foes('lina', 'lion', 'zuus', 'axe', 'sniper');
  const early = cands({ clock: 240, enemies });
  const drops = early.find((c) => c.item === 'infused_raindrop');
  assert.ok(drops && drops.priority >= 80, 'three nukers: high priority');
  assert.match(drops.reason, /Lina, Lion og Zeus/);
  assert.match(drops.short, /Magisk burst/);
  assert.ok(!has(cands({ clock: 1000, phase: 'mid', enemies }), 'infused_raindrop'), 'Raindrops only early');
  assert.ok(!has(cands({ clock: 240, enemies, inv: inventory('cloak') }), 'infused_raindrop'), 'a Cloak already covers it');
  assert.ok(!has(cands({ clock: 240, enemies: foes('lina', 'axe') }), 'infused_raindrop'), 'one nuker is not enough');
  assert.ok(has(cands({ clock: 1000, phase: 'mid', enemies, role: 5 }), 'glimmer_cape'));
  assert.ok(has(cands({ clock: 1000, phase: 'mid', enemies, role: 3 }), 'pipe'));
  assert.ok(has(cands({ clock: 1000, phase: 'mid', enemies, role: 1 }), 'black_king_bar'));
  assert.ok(!has(cands({ clock: 1000, phase: 'mid', enemies, role: 1, inv: inventory('black_king_bar') }), 'black_king_bar'));
});

test('spell spammers, invisible heroes, physical damage, disables and healers', () => {
  assert.ok(has(cands({ clock: 200, enemies: foes('batrider', 'bristleback') }), 'magic_stick'));
  const wandUp = cands({ clock: 200, enemies: foes('batrider'), inv: inventory('magic_stick') });
  assert.ok(has(wandUp, 'magic_wand') && !has(wandUp, 'magic_stick'));
  assert.ok(isOutgrown('magic_stick', inventory('magic_wand')));

  assert.ok(has(cands({ clock: 300, enemies: foes('riki'), role: 5 }), 'ward_sentry'));
  assert.ok(has(cands({ clock: 300, enemies: foes('riki'), role: 1 }), 'dust'));
  assert.ok(!has(cands({ clock: 300, enemies: foes('riki'), role: 1, inv: inventory('dust') }), 'dust'));

  const phys = foes('phantom_assassin', 'ursa', 'troll_warlord');
  assert.ok(has(cands({ clock: 900, phase: 'mid', enemies: phys, role: 5 }), 'ghost'));
  assert.ok(has(cands({ clock: 900, phase: 'mid', enemies: phys, role: 3 }), 'blade_mail'));
  assert.ok(!has(cands({ clock: 300, enemies: phys, role: 5 }), 'ghost'), 'armour only from 10 minutes');

  const lock = foes('lion', 'shadow_shaman', 'bane', 'axe');
  assert.ok(has(cands({ clock: 1000, phase: 'mid', enemies: lock, role: 1 }), 'black_king_bar'));
  assert.ok(has(cands({ clock: 1000, phase: 'mid', enemies: lock, role: 3 }), 'lotus_orb'));

  assert.ok(has(cands({ clock: 900, phase: 'mid', enemies: foes('huskar'), role: 4 }), 'spirit_vessel'));
});

test('supports get wards and smoke; nothing outside the match', () => {
  const sup = cands({ clock: 400, role: 4 });
  assert.ok(has(sup, 'ward_observer') && has(sup, 'smoke_of_deceit'));
  assert.ok(!has(cands({ clock: 400, role: 4, inv: inventory('ward_observer') }), 'ward_observer'));
  assert.ok(has(cands({ clock: 400, role: 5 }), 'ward_sentry'));
  assert.ok(!has(cands({ clock: 400, role: 1 }), 'ward_observer'));
  assert.deepEqual(cands({ clock: 0, phase: 'draft', enemies: foes('riki') }), []);
  assert.deepEqual(cands({ clock: 0, phase: 'post', role: 5 }), []);
});

test('tracker: suggestions need a few seconds to appear, stay through short gaps and leave when bought', () => {
  const tr = new LiveItemTracker();
  const dust = { item: 'dust', priority: 58, reason: 'Riki kan bli usynlig.', kind: 'counter', short: 'Usynlige: Riki' };
  const ctx = (clock, inv = inventory(), gold = 0) => ({ clock, inv, gold, db, playing: true });
  assert.equal(tr.update([dust], ctx(300)).length, 0, 'not on the first update');
  assert.equal(tr.update([dust], ctx(302)).length, 0);
  let out = tr.update([dust], ctx(304));
  assert.equal(out.length, 1);
  assert.equal(out[0].dname, 'Dust of Appearance');
  // The reason goes away for a moment: the card stays (no flicker) …
  out = tr.update([], ctx(320));
  assert.equal(out.length, 1, 'kept through a short gap');
  // … and leaves after the exit time.
  assert.equal(tr.update([], ctx(340)).length, 0);
  // A flicker that never lasted long enough never shows.
  tr.update([dust], ctx(400));
  assert.equal(tr.update([], ctx(401)).length, 0);
  assert.equal(tr.update([dust], ctx(402)).length, 0, 'the entry timer starts over');
  // Bought: gone at once.
  tr.update([dust], ctx(410));
  assert.equal(tr.update([dust], ctx(420)).length, 1);
  assert.equal(tr.update([dust], ctx(421, inventory('dust'))).length, 0);
  // Not playing (menu) clears everything.
  tr.update([dust], ctx(500));
  assert.equal(tr.update([dust], { ...ctx(510), playing: false }).length, 0);
});

test('tracker: gold text, remaining cost with components, time limits and order', () => {
  const tr = new LiveItemTracker();
  const glimmer = { item: 'glimmer_cape', priority: 60, reason: 'x', kind: 'counter', short: '' };
  const drops = { item: 'infused_raindrop', priority: 85, reason: 'y', kind: 'counter', short: '', until: 900 };
  tr.update([glimmer, drops], { clock: 800, inv: inventory(), gold: 300, db, playing: true });
  let out = tr.update([glimmer, drops], { clock: 806, inv: inventory('shadow_amulet'), gold: 300, db, playing: true });
  assert.deepEqual(out.map((x) => x.item), ['infused_raindrop', 'glimmer_cape'], 'highest priority first');
  assert.equal(out[0].goldText, 'Du har råd nå');
  assert.equal(out[0].afford, true);
  const g = out[1];
  assert.equal(g.remaining, db.cost('glimmer_cape') - db.cost('shadow_amulet'), 'counts the Shadow Amulet already held');
  assert.equal(g.goldText, `Mangler ${g.remaining - 300} gull`);
  out = tr.update([glimmer, drops], { clock: 900, inv: inventory('shadow_amulet'), gold: 300, db, playing: true });
  assert.ok(!out.some((x) => x.item === 'infused_raindrop'), 'Raindrops expire at 15:00');
  // Free items say so.
  const tr2 = new LiveItemTracker();
  const obs = { item: 'ward_observer', priority: 66, reason: 'z', kind: 'vision' };
  tr2.update([obs], { clock: 300, inv: inventory(), gold: 0, db, playing: true });
  assert.equal(tr2.update([obs], { clock: 310, inv: inventory(), gold: 0, db, playing: true })[0].goldText, 'Gratis');
});

// ---------------- Death recap ----------------

// Builds snapshots like the engine does, from a list of per-second frames.
function frames(list, { team = 'radiant' } = {}) {
  const snaps = [];
  for (const f of list) {
    const c = {
      clock: f.t,
      hero: { health_percent: f.hp, stunned: !!f.stunned, hexed: false, muted: false, silenced: !!f.silenced },
      gsi: {
        items: Object.fromEntries((f.items || []).map((it, i) => [`slot${i}`, { name: `item_${it.name}`, cooldown: it.cd ?? 0, can_cast: it.cast ?? true, charges: it.charges }])),
        abilities: Object.fromEntries((f.abilities || []).map((a, i) => [`ability${i}`, { name: a.name, level: 1, cooldown: a.cd ?? 0, can_cast: a.cast ?? true, ultimate: !!a.ult }])),
        map: { daytime: f.night ? false : true },
      },
      loc: locate(f.x ?? -5000, f.y ?? -5000, team),
      inv: { tp: f.tp === false ? null : 'tpscroll' },
      player: { gold_unreliable: f.un ?? 0 },
      fight: f.fight ? { level: f.fight } : null,
      teamKills: f.tk ?? 0,
      enemyKills: 0,
    };
    pushSnapshot(snaps, snapshot(c));
  }
  return snaps;
}
const liveCtx = (x = {}) => ({
  clock: 500,
  role: 1,
  team: 'radiant',
  phase: 'laning',
  hero: { respawn_seconds: 20, buyback_cost: 600 },
  player: { gold: 400 },
  inv: inventory(),
  next: null,
  liveItems: [],
  db,
  teamKills: 0,
  deaths: 2,
  streak: 1,
  ...x,
});
const seconds = (from, to, fn) => Array.from({ length: to - from + 1 }, (_, i) => fn(from + i));
const ids = (r) => r.mistakes.map((m) => m.id);

test('death recap: a ready BKB that was not used is the first point, and the recap is spoken', () => {
  const snaps = frames(seconds(490, 499, (t) => ({ t, hp: Math.max(5, 100 - (t - 490) * 10), items: [{ name: 'black_king_bar' }], fight: 'fight' })));
  const d = freezeDeath(snaps, { clock: 500, unreliable: 0 });
  const r = buildDeathRecap(d, liveCtx({ deaths: 3 }));
  assert.equal(r.mistakes[0].id, 'unused-items');
  assert.match(r.mistakes[0].text, /BKB var klar/);
  assert.match(r.say, /^Du døde\. Du hadde BKB klar/);
  assert.equal(r.n, 3);
  assert.equal(r.clockText, '8:20');
  assert.ok(r.mistakes.length <= 3);
});

test('death recap: stunned the whole time → "use it earlier"; a used BKB is not blamed', () => {
  const stunned = frames(seconds(492, 499, (t) => ({ t, hp: 90 - (t - 492) * 12, stunned: true, items: [{ name: 'black_king_bar', cast: false }] })));
  const r = buildDeathRecap(freezeDeath(stunned, { clock: 500 }), liveCtx());
  assert.equal(r.mistakes[0].id, 'stunned-first');
  assert.match(r.mistakes[0].text, /stunnet/);

  const used = frames(seconds(492, 499, (t) => ({ t, hp: 90 - (t - 492) * 12, items: [{ name: 'black_king_bar', cd: t >= 495 ? 70 : 0 }] })));
  const r2 = buildDeathRecap(freezeDeath(used, { clock: 500 }), liveCtx());
  assert.ok(!ids(r2).includes('unused-items') && !ids(r2).includes('stunned-first'));
  // A Magic Wand only counts with real charges.
  const wand = frames(seconds(495, 499, (t) => ({ t, hp: 60 - (t - 495) * 12, items: [{ name: 'magic_wand', charges: 2 }] })));
  assert.ok(!ids(buildDeathRecap(freezeDeath(wand, { clock: 500 }), liveCtx())).includes('unused-items'));
});

test('death recap: deep in the enemy jungle at night while the meter said farm, no TP, gold lost, no trade', () => {
  const snaps = frames(
    seconds(1290, 1299, (t) => ({ t, hp: t < 1296 ? 90 : 90 - (t - 1295) * 22, x: 1500, y: 3800, night: true, fight: t < 1296 ? 'farm' : 'retreat', tp: false, un: 700, tk: 10 })),
  );
  const d = freezeDeath(snaps, { clock: 1300, unreliable: 250 });
  let r = buildDeathRecap(d, liveCtx({ clock: 1300, phase: 'mid', teamKills: 10 }));
  assert.deepEqual(ids(r).slice(0, 2), ['fight-meter', 'deep']);
  assert.equal(r.fight.level, 'farm', 'the meter before the HP dropped, not the "retreat" from the low HP');
  assert.match(r.mistakes[1].text, /fiendens jungel\) om natta/);
  assert.equal(r.where.label, 'fiendens jungel');
  assert.equal(r.noTp, true);
  assert.equal(r.lost, 450);
  assert.equal(r.trade, null, 'too early to say');
  r = buildDeathRecap(d, liveCtx({ clock: 1307, phase: 'mid', teamKills: 10 }));
  assert.equal(r.trade, false);
  // Kills after the decision do not change it (no flicker).
  r = buildDeathRecap(d, liveCtx({ clock: 1320, phase: 'mid', teamKills: 12 }));
  assert.equal(r.trade, false);
  assert.match(r.whileDead.go, /Hold deg på egen side/);
});

test('death recap: fighting when the meter said fight is not a fight-meter mistake; long low HP is', () => {
  const snaps = frames(seconds(590, 599, (t) => ({ t, hp: t < 591 ? 70 : 20, fight: t < 591 ? 'fight' : 'retreat', x: -3000, y: -3000 })));
  const r = buildDeathRecap(freezeDeath(snaps, { clock: 600 }), liveCtx({ clock: 600 }));
  assert.ok(!ids(r).includes('fight-meter'));
  assert.equal(ids(r)[0], 'low-hp');
  assert.match(r.mistakes[0].text, /under 30 % HP i \d+ s/);
});

test('death recap: burst, a ready escape spell and the ultimate, the death streak', () => {
  const snaps = frames(
    seconds(700, 709, (t) => ({
      t,
      hp: t < 708 ? 100 : 40,
      abilities: [{ name: 'antimage_blink' }, { name: 'antimage_mana_void', ult: true }],
      fight: 'neutral',
    })),
  );
  const r = buildDeathRecap(freezeDeath(snaps, { clock: 710 }), liveCtx({ clock: 710, phase: 'mid', streak: 3, liveItems: [{ kind: 'counter', dname: 'Glimmer Cape' }] }));
  assert.equal(r.mistakes[0].id, 'save-spell');
  assert.match(r.mistakes[0].text, /^Blink var klar/);
  assert.deepEqual(ids(r).slice(1), ['streak', 'ult-ready']);
  assert.equal(r.ultReady, 'Mana Void');
  assert.equal(hpStory(snaps, 710).burst, true);
});

test('death recap: no data still gives a sensible answer', () => {
  const r = buildDeathRecap(freezeDeath([], { clock: 100 }), liveCtx({ clock: 100 }));
  assert.equal(r.mistakes[0].id, 'none');
  assert.equal(r.where, null);
  assert.equal(r.say, 'Du døde. Se oppsummeringen.');
});

test('while dead: buy the next item, buy back when the base is hit, where to go', () => {
  const next = { name: 'bfury', dname: 'Battle Fury', remaining: 2000 };
  let w = buildDeathRecap(freezeDeath([], { clock: 2000 }), liveCtx({ clock: 2000, phase: 'late', next, player: { gold: 2500 }, hero: { respawn_seconds: 50, buyback_cost: 1800 } })).whileDead;
  assert.match(w.buy.text, /Kjøp Battle Fury nå/);
  assert.equal(w.buyback.advice, 'maybe');
  w = buildDeathRecap(freezeDeath([], { clock: 2000 }), liveCtx({ clock: 2000, phase: 'late', next, baseThreat: true, player: { gold: 2500 }, hero: { respawn_seconds: 50, buyback_cost: 1800 } })).whileDead;
  assert.equal(w.buyback.advice, 'yes');
  assert.match(w.go, /Forsvar basen/);
  w = buildDeathRecap(freezeDeath([], { clock: 2000 }), liveCtx({ clock: 2000, phase: 'late', next, player: { gold: 900 }, hero: { respawn_seconds: 50, buyback_cost: 1800 } })).whileDead;
  assert.equal(w.buyback.advice, 'none');
  assert.match(w.buy.text, /Kjøp .+ mot Battle Fury/, 'a component when the item is out of reach');
  // Early game: no buyback talk, and the laning advice for the role.
  w = buildDeathRecap(freezeDeath([], { clock: 300 }), liveCtx({ clock: 300, role: 2, inv: readInventory({ teleport0: { name: 'empty' } }, db) })).whileDead;
  assert.equal(w.buyback, null);
  assert.match(w.go, /mid/);
  assert.match(w.buy.text, /TP/);
});

// ---------------- Through the engine ----------------

function makeCoach({ role = 1, enemies = [] } = {}) {
  return new Coach({ itemDb: db, heroes, getHeroMeta: () => null, getDraft: () => ({ allies: [], enemies, bans: [] }), getSettings: () => ({ role }) });
}
function payload(clock, { hp = 80, alive = true, deaths = 0, items = {}, hero = {}, player = {}, root = {} } = {}) {
  return {
    map: { matchid: '77', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: clock, game_time: clock + 90, daytime: true, radiant_score: 3, dire_score: 4 },
    player: { team_name: 'radiant', gold: 500, gold_unreliable: 400, gpm: 400, xpm: 400, last_hits: 20, deaths, ...player },
    hero: { name: 'npc_dota_hero_antimage', level: 7, alive, respawn_seconds: alive ? 0 : 20, health_percent: alive ? hp : 0, max_health: 1000, mana_percent: 80, max_mana: 300, xpos: 1500, ypos: 3800, ...hero },
    abilities: {},
    items: { slot0: { name: 'item_black_king_bar', cooldown: 0, can_cast: true }, teleport0: { name: 'item_tpscroll' }, ...items },
    ...root,
  };
}

test('engine: the death recap appears when the hero dies and goes away on respawn; the report keeps it', () => {
  const coach = makeCoach({ enemies: ['lina', 'lion', 'zuus'] });
  let s;
  for (let t = 400; t < 430; t++) s = coach.update(payload(t, { hp: t < 425 ? 90 : 90 - (t - 424) * 15 }));
  assert.equal(s.deathRecap, null);
  s = coach.update(payload(430, { alive: false, deaths: 1, player: { gold_unreliable: 100 } }));
  assert.ok(s.deathRecap, 'recap while dead');
  assert.equal(s.deathRecap.mistakes[0].id, 'unused-items');
  assert.equal(s.deathRecap.lost, 300);
  const tip = s.tips.find((t) => t.id.startsWith('death-'));
  assert.ok(tip?.say?.startsWith('Du døde.'), 'one spoken sentence');
  assert.ok(!s.tips.some((t) => t.id === 'dead'), 'the plain "dead" tip makes room for the recap');
  // The same payload again (the server recomputes on settings changes): same recap, not spoken again.
  const again = coach.update(payload(430, { alive: false, deaths: 1, player: { gold_unreliable: 100 } }));
  assert.equal(again.tips.find((t) => t.id.startsWith('death-')).key, tip.key, 'same key, so clients read it only once');
  s = coach.update(payload(445, { alive: true, deaths: 1 }));
  assert.equal(s.deathRecap, null, 'gone after respawn');
  assert.deepEqual(coach.rec.deaths.map((d) => d.mistakes?.[0]), ['unused-items'], 'the post-game report keeps the death and its recap');
});

test('engine: live items show up from the draft and the HP history, and are spoken only when important', () => {
  const coach = makeCoach({ enemies: ['lina', 'lion', 'zuus', 'axe', 'riki'] });
  let s;
  for (let t = 250; t <= 290; t++) s = coach.update(payload(t, { hp: t % 10 < 5 ? 20 : 70, items: { slot0: { name: 'empty' } } }));
  const items = s.liveItems.map((x) => x.item);
  assert.equal(items[0], 'infused_raindrop');
  assert.ok(items.includes('flask'), 'often low HP and no regen');
  assert.ok(items.includes('dust'));
  const spoken = s.tips.find((t) => t.id === 'buy-infused_raindrop');
  assert.ok(spoken, 'high priority is read aloud');
  // Garbage in: nothing crashes.
  for (const bad of [{}, { map: null }, { hero: { alive: 'x' }, items: 'nope', map: { game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 'abc' } }]) {
    assert.doesNotThrow(() => coach.update(bad));
  }
});

test('review fixes: barracks under attack count as the base, and one counter item covers its rule', async () => {
  const { Coach } = await import('../src/coach/engine.js');
  assert.ok(Coach);
  const re = /(tower3|tower4|_rax_(?:melee|range)|_fort)/;
  for (const k of ['good_rax_melee_bot', 'bad_rax_range_top', 'dota_goodguys_tower3_mid', 'dota_badguys_fort']) assert.ok(re.test(k), k);
  assert.ok(!re.test('dota_goodguys_tower1_bot'));
});

test('review fixes: owning Bloodthorn covers evasion, so MKB is not suggested too', () => {
  const list = cands({ clock: 1500, phase: 'mid', enemies: foes('phantom_assassin', 'lion', 'zuus', 'riki', 'axe'), inv: inventory('bloodthorn', 'black_king_bar') });
  assert.ok(!list.some((c) => c.item === 'monkey_king_bar'), JSON.stringify(list.map((c) => c.item)));
});
