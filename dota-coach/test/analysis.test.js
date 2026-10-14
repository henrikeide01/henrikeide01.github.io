import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/settings.js';
import { ItemDb } from '../src/coach/items.js';
import { fightAdvice, heroStrength, levelFor } from '../src/coach/fight.js';
import { analyzeMatch, trends, expectedTime, enrichFromOpenDota, matchDetails, percentages } from '../src/coach/analysis.js';
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

const parsedMatch = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/parsed-match.json'), 'utf8'));
const sumPct = (block) => block.rows.reduce((s, r) => s + r.pct, 0);

test('details: a parsed match gives Dota Plus-style breakdowns whose percentages add up', () => {
  const r = analyzeMatch(record({ hero: { name: 'juggernaut', dname: 'Juggernaut' } }), { itemDb: db, heroes });
  const od = enrichFromOpenDota(r, parsedMatch(), { accountId: 123456789 });
  const d = od.details;
  assert.ok(d, 'details present');
  assert.equal(od.parsed, true);
  for (const key of ['damageTaken', 'damageTakenBy', 'damageTypes', 'damageDealt', 'damageDealtBy', 'gold', 'xp']) {
    assert.equal(sumPct(d[key]), 100, `${key} sums to 100 %`);
  }

  // Damage taken: enemy heroes biggest first, everything else in one bucket with its parts.
  assert.deepEqual(d.damageTaken.rows.map((x) => x.key), ['lina', 'phantom_assassin', 'axe', 'lion', 'witch_doctor', 'other']);
  assert.equal(d.damageTaken.rows[0].dname, 'Lina');
  assert.equal(d.damageTaken.rows[0].pct, 35);
  const other = d.damageTaken.rows.at(-1);
  assert.equal(other.value, 2100 + 900 + 120 + 650 + 310 + 700 + 480);
  assert.deepEqual(Object.fromEntries(other.parts.map((p) => [p.key, p.value])), { creep: 3120, neutral: 960, tower: 700, roshan: 480 });

  // By source: the "null" key is auto-attacks, abilities get names, owners and damage types.
  const [attack, laguna] = d.damageTakenBy.rows;
  assert.deepEqual([attack.key, attack.kind, attack.dname, attack.dmg, attack.value], ['attack', 'attack', 'Autoangrep', 'physical', 6200]);
  assert.deepEqual([laguna.dname, laguna.hero, laguna.heroDname, laguna.dmg], ['Laguna Blade', 'lina', 'Lina', 'magical']);
  assert.equal(d.damageTakenBy.rows.find((x) => x.key === 'axe_counter_helix').dmg, 'pure');
  assert.equal(d.damageTakenBy.rows.length, 9, 'top 8 + one folded row');
  assert.equal(d.damageTakenBy.rows.at(-1).dname, '3 andre');
  assert.deepEqual(d.damageTypes.pct, { physical: 34, magical: 58, pure: 6, unknown: 2 });

  // Damage dealt: heroes only; items with and without the item_ prefix are recognised.
  assert.equal(d.damageDealt.total, 19850);
  assert.ok(d.damageDealt.rows.every((x) => x.kind === 'hero'));
  const dealt = Object.fromEntries(d.damageDealtBy.rows.map((x) => [x.key, x]));
  assert.equal(dealt.attack.dname, 'Autoangrep');
  assert.deepEqual([dealt.bfury.kind, dealt.bfury.dname], ['item', 'Battle Fury']);
  assert.deepEqual([dealt.abyssal_blade.kind, dealt.abyssal_blade.dmg], ['item', 'physical']);

  assert.deepEqual(d.killedBy.rows.map((x) => [x.key, x.count]), [['phantom_assassin', 3], ['lina', 2], ['tower', 1]]);
  assert.deepEqual(d.kills.rows.map((x) => [x.key, x.count]), [['lina', 3], ['lion', 2], ['witch_doctor', 1], ['axe', 1]]);
  assert.equal(d.gold.rows[0].label, 'Creeps');
  assert.equal(d.gold.rows.find((x) => x.key === '14').label, 'Nøytrale leirer');
  assert.deepEqual([d.gold.lost, d.gold.buyback], [1450, 1280]);
  assert.equal(d.xp.rows[0].label, 'Creeps og nøytrale');
  assert.deepEqual(d.uses.slice(0, 2).map((u) => [u.dname, u.kind, u.count]), [['Phase Boots', 'item', 31], ['Blade Fury', 'ability', 24]]);
  assert.deepEqual(d.purchases.map((p) => p.name), ['phase_boots', 'bfury', 'manta', 'black_king_bar', 'abyssal_blade']);
  assert.deepEqual(d.stats.maxHit, { value: 702, t: 1852, source: { key: 'attack', kind: 'attack', dname: 'Autoangrep' }, target: { name: 'lina', dname: 'Lina' } });
  assert.equal(d.stats.runes.total, 6);
  assert.equal(d.stats.runes.rows[0].label, 'Bounty');
  assert.deepEqual([d.stats.lhAt10, d.stats.dnAt10, d.stats.timeDead, d.stats.buybacks, d.stats.stuns], [56, 8, 214, 1, 1.8]);
});

test('details: concrete Norwegian insights, at most four', () => {
  const od = enrichFromOpenDota({ role: 1, duration: 2460 }, parsedMatch(), { heroId: 8 });
  const ins = od.details.insights;
  assert.ok(ins.length > 0 && ins.length <= 4);
  const byTag = Object.fromEntries(ins.map((i) => [i.tag, i]));
  assert.match(byTag['dmg-magical'].text, /^58 % av skaden du tok var magisk – BKB eller Eternal Shroud/);
  assert.match(byTag['top-damage-hero'].text, /^Lina sto for 35 % av skaden du tok \(mest Laguna Blade\) og drepte deg 2 ganger/);
  assert.match(byTag['killed-by'].text, /^Du døde 3 ganger til Phantom Assassin – se etter Ghost Scepter/);
  assert.match(byTag['few-neutrals'].text, /^Bare 9 % av gullet kom fra nøytrale leirer/);
  assert.ok(ins.every((i) => i.label && i.text));

  // A support gets support items and no farm advice.
  const sup = enrichFromOpenDota({ role: 5, duration: 2460 }, parsedMatch(), { heroId: 8 }).details.insights;
  assert.match(sup.find((i) => i.tag === 'dmg-magical').text, /Glimmer Cape eller Pipe/);
  assert.ok(!sup.some((i) => i.tag === 'few-neutrals'));
});

test('details: unknown keys and odd values are handled', () => {
  const m = parsedMatch();
  const me = m.players[0];
  me.damage_inflictor_received.lina_brand_new_spell = 500;
  me.damage_inflictor_received.mystery_thing = 300;
  me.damage_inflictor_received.dota_unknown = 100;
  me.damage_inflictor_received.broken = 'lots';
  me.damage_taken.npc_dota_weird_summon = 250;
  me.gold_reasons['99'] = 70;
  me.xp_reasons['42'] = 30;
  me.runes['17'] = 1;
  me.item_uses.item_unheard_of = 50;
  me.killed_by.npc_dota_hero_juggernaut = 1; // denied yourself? still not an enemy hero
  const d = enrichFromOpenDota({ role: 1, duration: 2460 }, m, { heroId: 8 }).details;
  for (const key of ['damageTaken', 'damageTakenBy', 'damageTypes', 'gold', 'xp']) assert.equal(sumPct(d[key]), 100, key);
  const attack = d.damageTakenBy.rows.find((x) => x.key === 'attack');
  assert.equal(attack.value, 6300, 'dota_unknown counts as an auto-attack');
  const rest = d.damageTakenBy.rows.at(-1);
  assert.equal(rest.kind, 'rest');
  assert.equal(d.damageTaken.rows.find((x) => x.key === 'other').parts.find((p) => p.key === 'other').value, 250);
  assert.equal(d.gold.rows.find((x) => x.key === '0').value, 600 + 70, 'unknown gold reason counts as «Annet»');
  assert.equal(d.xp.rows.find((x) => x.key === '0').value, 800 + 30);
  assert.ok(d.stats.runes.rows.some((x) => x.label === 'Annen rune'));
  assert.ok(d.uses.some((u) => u.key === 'unheard_of' && u.dname === 'Unheard Of'));
  assert.ok(!d.killedBy.rows.some((x) => x.key === 'juggernaut'));

  // Unknown abilities still get a readable name and, from the name prefix, an owner.
  const all = enrichFromOpenDota({ role: 1 }, { players: [{ hero_id: 8, isRadiant: true, damage_inflictor_received: { lina_brand_new_spell: 500, mystery_thing: 300 } }] }, { heroId: 8 }).details;
  const spell = all.damageTakenBy.rows.find((x) => x.key === 'lina_brand_new_spell');
  assert.deepEqual([spell.dname, spell.hero, spell.dmg], ['Brand New Spell', 'lina', null]);
  assert.equal(all.damageTakenBy.rows.find((x) => x.key === 'mystery_thing').dname, 'Mystery Thing');
  assert.equal(all.damageTypes.pct.unknown, 100);
});

test('details: unparsed matches and missing data never crash', () => {
  const m = parsedMatch();
  for (const p of m.players) {
    for (const k of ['damage', 'damage_taken', 'damage_inflictor', 'damage_inflictor_received', 'killed', 'killed_by', 'gold_reasons', 'xp_reasons', 'ability_uses', 'item_uses', 'runes', 'max_hero_hit', 'purchase_log', 'lh_t', 'dn_t', 'obs_placed', 'lane_efficiency_pct']) p[k] = null;
  }
  const od = enrichFromOpenDota({ role: 1, duration: 2460 }, m, { heroId: 8 });
  assert.equal(od.details, null);
  assert.equal(od.parsed, false);
  assert.equal(od.heroDamage, 19850);

  // Only some fields parsed, odd shapes, no hero data at all.
  const partial = { players: [{ hero_id: 8, isRadiant: true, gold_reasons: { 13: 1000 }, damage_taken: [], killed_by: {}, runes: null, lh_t: [1, 2] }] };
  const d = enrichFromOpenDota({ role: 2, duration: 600 }, partial, { heroId: 8, data: { heroes: [], items: {}, abilities: {}, abilityInfo: {} } }).details;
  assert.equal(d.gold.rows[0].pct, 100);
  for (const key of ['damageTaken', 'damageTakenBy', 'damageTypes', 'damageDealt', 'damageDealtBy', 'killedBy', 'kills', 'xp', 'uses', 'purchases']) assert.equal(d[key], null, key);
  assert.equal(d.stats.lhAt10, null);
  assert.deepEqual(d.insights, []);
  assert.equal(percentages([]).length, 0);
  assert.deepEqual(percentages([1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(percentages([0, 0]), [0, 0]);
});

test('details: works with the server hero Map as name data', () => {
  const data = { heroes, items, abilities: JSON.parse(fs.readFileSync(path.join(ROOT, 'data/abilities.json'), 'utf8')).heroes, abilityInfo: {} };
  const d = matchDetails(parsedMatch().players[0], parsedMatch(), { role: 1, data });
  assert.equal(d.damageTaken.rows[0].dname, 'Lina');
  // Without ability-info, owners and names still come from the per-hero ability lists.
  const laguna = d.damageTakenBy.rows.find((x) => x.key === 'lina_laguna_blade');
  assert.deepEqual([laguna.dname, laguna.hero, laguna.dmg], ['Laguna Blade', 'lina', null]);
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
