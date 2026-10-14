import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/settings.js';
import { ItemDb } from '../src/coach/items.js';
import { fightAdvice, heroStrength, levelFor } from '../src/coach/fight.js';
import { analyzeMatch, trends, expectedTime, enrichFromOpenDota } from '../src/coach/analysis.js';
import { Coach } from '../src/coach/engine.js';

const { items } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/items.json'), 'utf8'));
const heroList = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/heroes.json'), 'utf8')).heroes;
const heroes = new Map(heroList.map((h) => [h.name, h]));
const db = new ItemDb(items);

function ctx(over = {}) {
  return {
    phase: 'mid',
    clock: 900,
    heroKey: 'antimage',
    heroName: 'Anti-Mage',
    hero: { alive: true, level: 12, health_percent: 90, max_mana: 400, mana_percent: 80, buyback_cost: 800 },
    player: { gold: 300, gpm: 500 },
    gsi: { abilities: {}, items: {} },
    coreOwned: 0,
    enemyKeys: [],
    allyKeys: [],
    teamKills: 10,
    enemyKills: 10,
    next: null,
    role: 1,
    team: 'radiant',
    recentEvent: () => null,
    deathsSince: () => 0,
    ...over,
  };
}

test('fight meter: late-game hero without items should farm, low HP means retreat', () => {
  const farm = fightAdvice(ctx({ clock: 400, phase: 'laning' }));
  assert.ok(farm.score < 0);
  const low = fightAdvice(ctx({ hero: { alive: true, level: 12, health_percent: 20 } }));
  assert.equal(low.level, 'retreat');
  assert.equal(low.reasons[0].text, 'Lav HP (20 %)');
  assert.equal(fightAdvice(ctx({ hero: { alive: false } })).level, 'dead');
  assert.equal(fightAdvice(ctx({ phase: 'pregame' })), null);
});

test('fight meter: fresh power spike and a kill lead push towards fighting', () => {
  const spike = fightAdvice(
    ctx({
      coreOwned: 2,
      teamKills: 20,
      enemyKills: 8,
      recentEvent: (type) => (type === 'spike-item' ? { data: { dname: 'Battle Fury' } } : null),
      gsi: { abilities: { ability3: { name: 'ult', ultimate: true, level: 2, cooldown: 0, can_cast: true } }, items: {} },
    }),
  );
  assert.ok(spike.score >= 35, `score ${spike.score}`);
  assert.equal(spike.level, 'fight');
  assert.ok(spike.reasons.some((r) => r.text.includes('Battle Fury')));
});

test('fight meter: ultimate and BKB on cooldown count against fighting', () => {
  const f = fightAdvice(
    ctx({
      heroKey: 'axe',
      heroName: 'Axe',
      gsi: {
        abilities: { ability3: { ultimate: true, level: 2, cooldown: 40 } },
        items: { slot0: { name: 'item_black_king_bar', cooldown: 50 } },
      },
    }),
  );
  assert.ok(f.reasons.some((r) => r.text.startsWith('Ultimaten er på cooldown')));
  assert.ok(f.reasons.some((r) => r.text.startsWith('BKB er på cooldown')));
  assert.ok(heroStrength('antimage', 2000, 0) > heroStrength('antimage', 300, 0));
  assert.equal(levelFor(-50).level, 'retreat');
});

test('expected item timing grows with cost', () => {
  assert.ok(expectedTime(5760, 560) > 600 && expectedTime(5760, 560) < 900);
  assert.ok(expectedTime(20000, 560) > expectedTime(10000, 560));
});

function sample(t, over = {}) {
  return {
    t, gold: 400, un: 200, gpm: 600, xpm: 650, lh: Math.round((t / 60) * 7), dn: 5, k: 0, d: 0, a: 0, lvl: 10, alive: true, hp: 90,
    x: 4000, y: -6000, side: 'own', depth: -2000, base: false, label: 'bot lane', fight: 'neutral', fs: 0, tp: true, stash: 0,
    unspent: 0, tk: 20, ek: 15, bb: 900, night: false, ...over,
  };
}

function record(over = {}) {
  const samples = [];
  for (let t = 0; t <= 2400; t += 10) samples.push(sample(t, { k: Math.floor(t / 300), a: Math.floor(t / 200), d: 0 }));
  return {
    matchId: '1',
    result: 'win',
    duration: 2400,
    hero: { name: 'antimage', dname: 'Anti-Mage' },
    role: 1,
    team: 'radiant',
    enemies: ['phantom_assassin', 'lion', 'zuus'],
    allies: [],
    lhAt10: 70,
    samples,
    deaths: [],
    kaEvents: [],
    items: [{ name: 'bfury', dname: 'Battle Fury', t: 800, cost: 3900, core: true }],
    spikes: [],
    levels: [],
    roshan: [],
    ...over,
  };
}

test('analysis: a clean game grades well and praises the right things', () => {
  const r = analyzeMatch(record(), { itemDb: db, heroes });
  assert.ok(r.score >= 72, `score ${r.score}`);
  assert.ok(['S', 'A'].includes(r.grade));
  assert.ok(r.good.some((g) => g.text.startsWith('Sterk laning')));
  assert.ok(r.good.some((g) => g.text.startsWith('Få dødsfall')));
  assert.equal(r.categories.length, 6);
  assert.ok(r.charts.lh.length > 50);
});

test('analysis: bad habits become concrete feedback and tips', () => {
  const rec = record({ lhAt10: 30 });
  rec.samples = rec.samples.map((s) => ({ ...s, d: Math.min(8, Math.floor(s.t / 300)), gold: 3000, tp: s.t < 600, unspent: s.t > 1000 && s.t < 1200 ? 1 : 0 }));
  rec.deaths = [300, 600, 900, 1200, 1500, 1800, 2100, 2400].map((t, i) => ({ t, x: 2000, y: 3000, side: 'enemy', depth: 3500, lost: 300, fight: i % 2 ? 'farm' : 'neutral', night: false, hadTp: false, label: 'fiendens jungel' }));
  const r = analyzeMatch(rec, { itemDb: db, heroes });
  for (const tag of ['laning-lh', 'many-deaths', 'deaths-enemy-side', 'bad-fight-timing', 'unspent-gold', 'no-tp', 'skill-points', 'gold-lost']) {
    assert.ok(r.tags.includes(tag), `mangler ${tag}`);
  }
  assert.ok(r.score < 60, `score ${r.score}`);
  assert.ok(r.tips.length >= 3);
  assert.ok(r.deaths[0].why.includes('på fiendens side'));
  assert.ok(r.tips.some((t) => t.tag === 'counter-items'), 'suggests counter items vs PA/Lion/Zeus');

  const t = trends([r, r, analyzeMatch(record(), { itemDb: db, heroes })]);
  assert.equal(t.games, 3);
  assert.ok(t.common.some((c) => c.tag === 'deaths-enemy-side' && c.count === 2));
});

test('analysis: OpenDota match data adds damage numbers', () => {
  const r = analyzeMatch(record(), { itemDb: db, heroes });
  const match = {
    players: [
      { account_id: 42, hero_id: 1, isRadiant: true, hero_damage: 30000, tower_damage: 500, net_worth: 25000, benchmarks: { hero_damage_per_min: { pct: 0.8 }, tower_damage: { pct: 0.1 } } },
      { account_id: 7, hero_id: 2, isRadiant: true, hero_damage: 35000, tower_damage: 4000, net_worth: 20000 },
    ],
  };
  const od = enrichFromOpenDota(r, match, { accountId: 42 });
  assert.equal(od.teamRank.heroDamage, 2);
  assert.equal(od.teamRank.netWorth, 1);
  assert.ok(od.good[0].startsWith('Mye skade på helter'));
  assert.ok(od.bad[0].startsWith('Lite tårnskade'));
  assert.equal(enrichFromOpenDota(r, { players: [] }, { accountId: 42 }), null);
});

test('engine records the match and hands it over when the game ends', () => {
  const coach = new Coach({ itemDb: db, heroes, getHeroMeta: () => null, getDraft: () => ({ allies: [], enemies: [], bans: [] }), getSettings: () => ({ role: 1 }) });
  const payload = (clock, state = 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', extra = {}) => ({
    map: { matchid: '55', game_state: state, clock_time: clock, game_time: clock + 90, daytime: true, radiant_score: 5, dire_score: 3, win_team: extra.win || 'none' },
    player: { team_name: 'radiant', gold: 500, gold_unreliable: 200, gpm: 500, xpm: 500, last_hits: clock / 8, deaths: clock > 400 ? 1 : 0, kills: 0, assists: 0 },
    hero: { name: 'npc_dota_hero_antimage', level: clock > 360 ? 7 : 5, alive: true, health_percent: 80, xpos: 4000, ypos: -6000 },
    items: { slot0: { name: clock > 500 ? 'item_bfury' : 'item_quelling_blade' }, teleport0: { name: 'item_tpscroll' } },
  });
  for (let t = 0; t <= 700; t += 5) coach.update(payload(t));
  assert.equal(coach.popFinished().length, 0);
  const s = coach.update(payload(705));
  assert.ok(s.fight, 'fight meter present in game');
  coach.update(payload(710, 'DOTA_GAMERULES_STATE_POST_GAME', { win: 'radiant' }));
  const [rec] = coach.popFinished();
  assert.equal(rec.result, 'win');
  assert.equal(rec.deaths.length, 1);
  assert.equal(rec.levels[0].level, 6);
  assert.ok(rec.items.some((i) => i.name === 'bfury'));
  assert.ok(rec.samples.length > 60);
});
