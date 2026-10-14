import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/settings.js';
import { ItemDb, readInventory, buildFromPopularity, nextItem } from '../src/coach/items.js';
import { locate } from '../src/coach/map.js';
import { nextOccurrence, computeTimers } from '../src/coach/timers.js';
import { expectedSkillPoints } from '../src/coach/rules.js';
import { Coach, percentileOf, phaseOf } from '../src/coach/engine.js';
import { suggestHeroes, counterAdvantages } from '../src/coach/draft.js';
import { situationalItems } from '../src/coach/situational.js';
import { TIMINGS } from '../data/knowledge.js';

const { items } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/items.json'), 'utf8'));
const heroList = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/heroes.json'), 'utf8')).heroes;
const heroes = new Map(heroList.map((h) => [h.name, h]));
const db = new ItemDb(items);
const id = (n) => items[n].id;

test('remaining cost subtracts components already held', () => {
  const full = db.remainingCost('black_king_bar', new Map());
  assert.equal(full, db.cost('black_king_bar'));
  const withAxe = db.remainingCost('black_king_bar', new Map([['ogre_axe', 1]]));
  assert.equal(withAxe, db.cost('black_king_bar') - db.cost('ogre_axe'));
  // Owning the item itself in the pool does not make it free (we're asking what's left to buy).
  assert.equal(db.remainingCost('item_black_king_bar', new Map([['black_king_bar', 1]])), full);
});

test('inventory knows what upgraded items were built from', () => {
  const inv = readInventory(
    {
      slot0: { name: 'item_power_treads' },
      slot1: { name: 'empty' },
      stash0: { name: 'item_ogre_axe' },
      teleport0: { name: 'empty' },
    },
    db,
  );
  assert.deepEqual(inv.inventory, ['power_treads']);
  assert.deepEqual(inv.stash, ['ogre_axe']);
  assert.equal(inv.tp, null);
  assert.ok(inv.owned.has('boots'));
  assert.ok(inv.hasBootUpgrade);
});

test('build skips consumables, keeps one boot upgrade, and next item respects game phase', () => {
  const build = buildFromPopularity(
    {
      start_game_items: { [id('tango')]: 900, [id('quelling_blade')]: 800 },
      early_game_items: { [id('magic_wand')]: 700, [id('power_treads')]: 650, [id('phase_boots')]: 600, [id('ward_observer')]: 500 },
      mid_game_items: { [id('bfury')]: 400, [id('manta')]: 300, [id('tpscroll')]: 999 },
      late_game_items: { [id('butterfly')]: 300, [id('abyssal_blade')]: 200 },
    },
    db,
  );
  assert.deepEqual(build.start.map((x) => x.name), ['tango', 'quelling_blade']);
  assert.deepEqual(build.early.map((x) => x.name), ['magic_wand', 'power_treads']);
  assert.deepEqual(build.mid.map((x) => x.name), ['bfury', 'manta']);

  const empty = readInventory({}, db);
  assert.equal(nextItem(build, empty, 120).name, 'magic_wand');
  assert.equal(nextItem(build, empty, 700).name, 'bfury', 'early items are dropped after 10 minutes');

  const withBf = readInventory({ slot0: { name: 'item_bfury' } }, db);
  assert.equal(nextItem(build, withBf, 300).name, 'manta', 'early items are dropped once the player moved on');
});

test('map regions are relative to your team', () => {
  assert.equal(locate(4200, -6300, 'radiant').label, 'bot lane (din safe lane)');
  assert.equal(locate(4200, -6300, 'dire').label, 'bot lane (din offlane)');
  const enemyJungle = locate(1500, 3800, 'radiant');
  assert.equal(enemyJungle.label, 'fiendens jungel');
  assert.ok(enemyJungle.depth > 2500);
  assert.ok(locate(-6800, -6400, 'radiant').inOwnBase);
  assert.equal(locate(0, 0, 'radiant').zone, 'mid');
});

test('timers count down to the next spawn', () => {
  assert.equal(nextOccurrence(-30, 0, 240), 0);
  assert.equal(nextOccurrence(250, 0, 240), 480);
  assert.equal(nextOccurrence(360, 360, 120), 360);
  const t = Object.fromEntries(computeTimers(130, TIMINGS, { daytime: true }).map((x) => [x.id, x]));
  assert.equal(t.power.label, 'Water rune');
  assert.equal(t.power.at, 240);
  assert.equal(t.stack.at, 173);
  assert.equal(t.daynight.at, 300);
  const late = Object.fromEntries(computeTimers(1500, TIMINGS, { roshanKilledAt: 1400 }).map((x) => [x.id, x]));
  assert.equal(late.roshan.at, 1400 + TIMINGS.roshan.min);
});

test('skill points per level', () => {
  assert.equal(expectedSkillPoints(6), 6);
  assert.equal(expectedSkillPoints(17), 16);
  assert.equal(expectedSkillPoints(18), 17);
  assert.equal(expectedSkillPoints(25), 19);
});

test('percentile interpolation', () => {
  const pts = [
    { percentile: 0.1, value: 300 },
    { percentile: 0.5, value: 500 },
    { percentile: 0.9, value: 700 },
  ];
  assert.equal(percentileOf(pts, 500), 0.5);
  assert.ok(Math.abs(percentileOf(pts, 600) - 0.7) < 1e-9);
  assert.equal(percentileOf(pts, 900), 0.9);
  assert.equal(percentileOf([], 500), null);
});

test('phase detection', () => {
  assert.equal(phaseOf({ player: { activity: 'menu' } }), 'menu');
  assert.equal(phaseOf({ map: { game_state: 'DOTA_GAMERULES_STATE_HERO_SELECTION' } }), 'draft');
  assert.equal(phaseOf({ map: { game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 700 } }), 'mid');
});

test('counter advantage is from the candidate’s point of view', () => {
  const pa = heroes.get('phantom_assassin');
  const axe = heroes.get('axe');
  // Axe (the enemy) won only 30 of 100 games against PA, so PA is good against Axe.
  const matchups = new Map([['axe', [{ hero_id: pa.id, games_played: 100, wins: 30 }]]]);
  const [adv] = counterAdvantages(pa, [axe], matchups);
  assert.ok(adv.adv > 10);
  const stats = new Map(heroList.map((h) => [h.name, { '5_pick': 1000, '5_win': 500 }]));
  const res = suggestHeroes({ heroes: heroList, stats, matchups, enemies: [axe], role: 1, bracket: 5 });
  assert.equal(res.picks[0].name, 'phantom_assassin');
  assert.ok(res.picks.every((p) => p.positions.includes(1)));
  assert.ok(!res.picks.some((p) => p.name === 'axe'));
});

test('situational items depend on role and enemies', () => {
  const enemies = ['riki', 'phantom_assassin'].map((n) => heroes.get(n));
  const core = situationalItems(enemies, 1, db).map((x) => x.item);
  const support = situationalItems(enemies, 5, db).map((x) => x.item);
  assert.ok(core.includes('monkey_king_bar'));
  assert.ok(support.includes('ward_sentry'));
  assert.ok(!support.includes('monkey_king_bar'));
});

function makeCoach({ role = 1, meta = null, enemies = [] } = {}) {
  return new Coach({
    itemDb: db,
    heroes,
    getHeroMeta: () => meta,
    getDraft: () => ({ allies: [], enemies, bans: [] }),
    getSettings: () => ({ role }),
  });
}

function gsi(clock, extra = {}) {
  return {
    map: { matchid: '1', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: clock, game_time: clock + 90, daytime: true },
    player: { team_name: 'radiant', gold: 300, gold_unreliable: 100, gpm: 400, xpm: 400, last_hits: Math.round(clock / 10), deaths: 0, ...extra.player },
    hero: { name: 'npc_dota_hero_antimage', level: 5, alive: true, health_percent: 80, max_health: 1000, mana_percent: 80, max_mana: 300, xpos: 4200, ypos: -6300, ...extra.hero },
    abilities: { ability0: { name: 'a', level: 2 }, ability1: { name: 'b', level: 2 }, ability2: { name: 'c', level: 1 } },
    items: { slot0: { name: 'item_magic_wand' }, teleport0: { name: 'item_tpscroll' }, ...extra.items },
    ...extra.root,
  };
}

test('coach: missing TP is flagged after a short hold, and spoken only once', () => {
  const coach = makeCoach();
  const noTp = { items: { teleport0: { name: 'empty' } } };
  let s = coach.update(gsi(200, noTp));
  assert.ok(!s.tips.some((t) => t.id === 'no-tp'), 'not before the hold time');
  s = coach.update(gsi(206, noTp));
  const tip = s.tips.find((t) => t.id === 'no-tp');
  assert.ok(tip);
  assert.equal(tip.say, 'Kjøp TP scroll');
  const again = coach.update(gsi(208, noTp)).tips.find((t) => t.id === 'no-tp');
  assert.equal(again.key, tip.key, 'same tip keeps its key while active');
  // The tip goes away and comes back quickly: shown again but not re-read inside the cooldown.
  coach.update(gsi(210));
  coach.update(gsi(212, noTp));
  const back = coach.update(gsi(218, noTp)).tips.find((t) => t.id === 'no-tp');
  assert.notEqual(back.key, tip.key);
  assert.equal(back.say, null);
});

test('coach: low HP, unspent skill points and stash', () => {
  const coach = makeCoach();
  let s = coach.update(gsi(300, { hero: { health_percent: 15 }, items: { stash0: { name: 'item_boots' } } }));
  assert.equal(s.tips[0].id, 'low-hp', 'alerts sort first');
  coach.update(gsi(305, { items: { stash0: { name: 'item_boots' } } }));
  s = coach.update(gsi(315, { items: { stash0: { name: 'item_boots' } } }));
  assert.ok(s.tips.some((t) => t.id === 'stash'));
  assert.ok(!s.tips.some((t) => t.id === 'unspent'), 'level 5 with 5 points spent');
  const c2 = makeCoach();
  c2.update(gsi(300, { hero: { level: 7 } }));
  s = c2.update(gsi(311, { hero: { level: 7 } }));
  const unspent = s.tips.find((t) => t.id === 'unspent');
  assert.ok(unspent);
  assert.match(unspent.text, /2 ubrukte/);
});

test('coach: death streak, Roshan event and new match reset', () => {
  const coach = makeCoach();
  coach.update(gsi(400, { player: { deaths: 0 } }));
  coach.update(gsi(410, { player: { deaths: 1 } }));
  let s = coach.update(gsi(500, { player: { deaths: 2 } }));
  assert.ok(s.tips.some((t) => t.id === 'death-streak'));

  s = coach.update(gsi(1500, { player: { deaths: 2 }, root: { events: [{ event_type: 'roshan_killed', game_time: 1480 + 90 }] } }));
  const rosh = s.timers.find((t) => t.id === 'roshan');
  assert.equal(rosh.at, 1480 + TIMINGS.roshan.min);
  assert.ok(s.tips.some((t) => t.id.startsWith('rosh-dead')));

  const other = gsi(100);
  other.map.matchid = '2';
  s = coach.update(other);
  assert.ok(!s.timers.some((t) => t.id === 'roshan'), 'state is reset for a new match');
});

test('coach: next item, afford tip and situational items from the draft', () => {
  const meta = {
    build: {
      start: [],
      early: [],
      mid: [{ name: 'bfury', dname: 'Battle Fury', cost: db.cost('bfury') }],
      late: [],
    },
    benchmarks: { gold_per_min: [{ percentile: 0.5, value: 400 }] },
  };
  const coach = makeCoach({ meta, enemies: ['phantom_assassin'] });
  const s = coach.update(gsi(800, { player: { gold: 5000 }, items: { slot1: { name: 'item_quelling_blade' } } }));
  assert.equal(s.next.name, 'bfury');
  assert.equal(s.next.remaining, db.cost('bfury') - db.cost('quelling_blade'));
  assert.ok(s.tips.some((t) => t.id === 'afford-bfury'));
  assert.ok(s.situational.some((x) => x.item === 'monkey_king_bar'));
  assert.equal(s.perf.gpmPct, 0.5);
});

test('coach: post-game summary', () => {
  const coach = makeCoach();
  coach.update(gsi(610, { player: { last_hits: 58 } }));
  const end = gsi(2000, { player: { deaths: 3, gpm: 610 } });
  end.map.game_state = 'DOTA_GAMERULES_STATE_POST_GAME';
  end.map.win_team = 'radiant';
  const tip = coach.update(end).tips.find((t) => t.id === 'post-game');
  assert.equal(tip.level, 'good');
  assert.match(tip.text, /3 dødsfall, 58 last hits ved 10:00/);
});
