import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ItemDb } from '../src/coach/items.js';
import { pointsAt, computeHeroSkills, nextSkillPoint, talentAdvice, neutralAdvice, enchantScore, artifactScore, findMyNeutral } from '../src/coach/skills.js';
import { PickTracker } from '../src/vision/picks.js';

const items = JSON.parse(fs.readFileSync(new URL('../data/items.json', import.meta.url), 'utf8')).items;
const db = new ItemDb(items);

// A small made-up hero: Q W E + ultimate R, two talents per tier.
const hero = {
  abilities: [
    { name: 'q', dname: 'Spell Q' },
    { name: 'w', dname: 'Spell W' },
    { name: 'e', dname: 'Spell E' },
    { name: 'sub', dname: 'Sub-spell' }, // never gets points
    { name: 'r', dname: 'Ult R' },
  ],
  talents: [
    { name: 't1a', tier: 1, dname: '+10 Damage' },
    { name: 't1b', tier: 1, dname: '+200 Health' },
    { name: 't2a', tier: 2, dname: '+Spell Q Damage' },
    { name: 't2b', tier: 2, dname: '+5 Armor' },
    { name: 't3a', tier: 3, dname: 'x' },
    { name: 't3b', tier: 3, dname: 'y' },
    { name: 't4a', tier: 4, dname: 'z' },
    { name: 't4b', tier: 4, dname: 'w' },
  ],
};
const ids = { 1: 'q', 2: 'w', 3: 'e', 4: 'r', 5: 't1a', 6: 't1b', 7: 't2a', 8: 't2b', 9: 'sub' };
const idOf = Object.fromEntries(Object.entries(ids).map(([id, n]) => [n, Number(id)]));
// Max Q first, then W, one point in E; ultimate at 6/12; talent at 10 and 15.
const ORDER = ['q', 'w', 'q', 'e', 'q', 'r', 'q', 'w', 'w', 't1a', 'w', 'r', 'e', 'e', 't2a', 'e'];
const cloak = items.cloak_of_flames.id;
const shield = items.poor_mans_shield.id;
const rows = [];
for (let i = 0; i < 40; i++) {
  const order = ORDER.map((n) => (n === 't1a' && i % 4 === 0 ? 't1b' : n));
  rows.push({ a: order.map((n) => idOf[n]), n: i % 2 ? cloak : shield, w: i % 3 !== 0 });
}
rows.push({ a: [1, 2], n: null, w: true }); // too short: ignored

const stats = computeHeroSkills(rows, hero, ids, db);
const ults = new Set(['r']);

test('skill points per hero level', () => {
  assert.equal(pointsAt(1), 1);
  assert.equal(pointsAt(16), 16);
  assert.equal(pointsAt(17), 16);
  assert.equal(pointsAt(18), 17);
  assert.equal(pointsAt(20), 18);
  assert.equal(pointsAt(25), 19);
  assert.equal(pointsAt(30), 19);
});

test('pro builds give a typical order, talent and neutral item percentages', () => {
  assert.equal(stats.games, 40);
  assert.deepEqual(stats.typical.slice(0, 6).map((t) => t.name), ['q', 'w', 'q', 'e', 'q', 'r']);
  assert.deepEqual(stats.abilities.map((a) => [a.name, a.max]), [['q', 4], ['w', 4], ['e', 4], ['r', 2]]);
  const t1 = stats.talents[0];
  assert.equal(t1.level, 10);
  assert.equal(t1.options.find((o) => o.name === 't1a').pct, 75);
  assert.equal(t1.options.find((o) => o.name === 't1b').pct, 25);
  assert.equal(stats.talents[2].options[0].pct, null); // nobody reached level 20 here
  assert.deepEqual(stats.neutrals.map((n) => [n.name, n.pct]).sort(), [['cloak_of_flames', 50], ['poor_mans_shield', 50]]);
});

test('next skill point follows the pros and is always legal', () => {
  // Level 4 with Q2 W1: pros put the 4th point into E.
  let next = nextSkillPoint(stats, { level: 4, levels: { q: 2, w: 1, e: 0, r: 0 }, ultimates: ults, talentTiers: new Set() });
  assert.equal(next.name, 'e');
  assert.equal(next.exact, true);
  assert.equal(next.toLevel, 1);
  assert.equal(next.pct, 100);

  // Level 6: the ultimate.
  next = nextSkillPoint(stats, { level: 6, levels: { q: 3, w: 1, e: 1, r: 0 }, ultimates: ults, talentTiers: new Set() });
  assert.equal(next.name, 'r');

  // An unusual build (no exact match): still a legal suggestion, never the ultimate before level 6 and never
  // more points than the hero level allows.
  next = nextSkillPoint(stats, { level: 3, levels: { q: 0, w: 0, e: 2, r: 0 }, ultimates: ults, talentTiers: new Set() });
  assert.equal(next.exact, false);
  assert.ok(['q', 'w'].includes(next.name), next.name);

  // Level 10: the talent; the pros mostly take t1a.
  next = nextSkillPoint(stats, { level: 10, levels: { q: 4, w: 3, e: 1, r: 1 }, ultimates: ults, talentTiers: new Set() });
  assert.equal(next.name, 't1a');
  assert.equal(next.talent, true);
  assert.equal(next.toLevel, null);

  // Everything maxed for the level: nothing to suggest.
  assert.equal(nextSkillPoint(stats, { level: 2, levels: { q: 1, w: 1 }, ultimates: ults, talentTiers: new Set() })?.name === 'q', false);
  assert.equal(nextSkillPoint(null, { level: 3, levels: {}, ultimates: ults, talentTiers: new Set() }), null);
});

test('talent advice: popular pick, better win rate, and a defensive hint when dying a lot', () => {
  const a = talentAdvice(stats, 1);
  assert.equal(a.pick, 't1a');
  assert.match(a.reason, /75 %/);
  assert.equal(a.hint, null);
  const b = talentAdvice(stats, 1, { dyingALot: true });
  assert.match(b.hint, /\+200 Health/);

  const manual = {
    talents: [{ tier: 1, level: 10, options: [{ name: 'x', dname: 'X', picks: 80, wins: 36, pct: 70, winPct: 45 }, { name: 'y', dname: 'Y', picks: 30, wins: 18, pct: 30, winPct: 60 }] }],
  };
  const c = talentAdvice(manual, 1);
  assert.equal(c.pick, 'y');
  assert.match(c.reason, /vinner oftere/);
});

test('enchantments: negative stats count against them, and the profile matters', () => {
  const vast = items.enhancement_vast; // + range, + damage, - armor
  const plain = { attrib: [{ key: 'attack_range', value: '60' }, { key: 'bonus_damage', value: '6' }] };
  assert.ok(enchantScore(vast, 'core', 1) < enchantScore(plain, 'core', 1));
  const mystical = items.enhancement_mystical;
  assert.ok(enchantScore(mystical, 'caster', 2) > enchantScore(mystical, 'core', 2));
  // A stat that is 0 at this level gives nothing.
  assert.equal(enchantScore({ attrib: [{ key: 'magic_res', value: '0 / 10' }] }, 'caster', 1), 0);
});

test('artifacts are scored by stats that fit the hero when pros give no data', () => {
  const agi = { attrib: [{ key: 'bonus_agility', value: '10' }] };
  assert.ok(artifactScore(agi, 'core', 'agi') > artifactScore(agi, 'core', 'str'));
  assert.equal(artifactScore({ attrib: [{ key: 'hp_regen', value: '0' }] }, 'core', 'agi'), 0);
});

test('neutral item craft: pro pick rates, the enchantment for the role, and what is already chosen', () => {
  const gsi = {
    team2: {
      player0: { current_madstone: 5, tier0: { tier: 0, trinket_choices: {}, enchantment_choices: {} } },
      player1: {
        current_madstone: 12,
        tier1: {
          tier: 1,
          trinket_choices: {
            choice0: { item_name: 'item_essence_ring', item_level: 2 },
            choice1: { item_name: 'item_poor_mans_shield', item_level: 2 },
          },
          enchantment_choices: {
            choice0: { item_name: 'item_enhancement_mystical', item_level: 2, selected: true },
            choice1: { item_name: 'item_enhancement_tough', item_level: 2 },
          },
        },
      },
    },
  };
  assert.equal(findMyNeutral(gsi, 'radiant', 1).current_madstone, 12);
  assert.equal(findMyNeutral(gsi, 'dire', 1), null);
  const n = neutralAdvice({ gsiNeutral: gsi, team: 'radiant', teamSlot: 1, stats, itemDb: db, role: 1, attr: 'agi' });
  assert.equal(n.tier, 2);
  assert.equal(n.madstone, 12);
  assert.equal(n.pickArtifact, 'poor_mans_shield'); // 50 % of the pros
  assert.equal(n.artifacts[0].pct, 50);
  assert.equal(n.pickEnchantment, 'enhancement_tough'); // damage + armor for a carry
  assert.equal(n.enchantments.find((e) => e.name === 'enhancement_mystical').selected, true);
  assert.match(n.enchantments.find((e) => e.name === 'enhancement_tough').stats, /\+10 Damage/);
  assert.equal(neutralAdvice({ gsiNeutral: null, team: 'radiant', teamSlot: 0, stats, itemDb: db, role: 1 }), null);
});

test('picks seen on screen count after two scans in a row and stay for the match', () => {
  const t = new PickTracker();
  const scan = (...heroes) => ({ heroes: heroes.map(([name, side, score = 0.9]) => ({ name, side, score })) });
  let r = t.add(scan(['axe', 'left'], ['lion', 'right']));
  assert.deepEqual([r.left, r.right], [[], []]);
  r = t.add(scan(['axe', 'left'], ['lion', 'right'], ['zuus', 'right']));
  assert.deepEqual([r.left, r.right, r.changed], [['axe'], ['lion'], true]);
  r = t.add(scan(['zuus', 'right']));
  assert.deepEqual([r.left, r.right], [['axe'], ['lion', 'zuus']]);
  r = t.add(scan(['zuus', 'right']));
  assert.equal(r.changed, false);
  // A one-off misdetection on the other side does not move a confirmed hero.
  r = t.add(scan(['axe', 'right']));
  assert.deepEqual(r.left, ['axe']);
  // At most five per side: the best scores win.
  const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((n, i) => [n, 'left', 0.7 + i * 0.01]);
  t.reset();
  t.add(scan(...many));
  r = t.add(scan(...many));
  assert.deepEqual(r.left, ['b', 'c', 'd', 'e', 'f']);
});

test('an ultimate that pros learn before level 6 (Meepo) is suggested on time', async () => {
  const meepo = {
    abilities: [{ name: 'q', dname: 'Earthbind' }, { name: 'w', dname: 'Poof' }, { name: 'e', dname: 'Ransack' }, { name: 'dwst', dname: 'Divided We Stand' }],
    talents: hero.talents,
  };
  const mids = { 1: 'q', 2: 'w', 3: 'e', 4: 'dwst', 5: 't1a' };
  const order = [2, 1, 2, 4, 2, 1, 2, 1, 1, 5, 4, 3, 3, 3, 3, 4].map((id) => id);
  const rows = Array.from({ length: 30 }, () => ({ a: order, n: null, w: true }));
  const st = computeHeroSkills(rows, meepo, mids, db);
  assert.deepEqual(st.abilities.find((a) => a.name === 'dwst').unlock, [4, 11, 16]);
  const ult = new Set(['dwst']);
  const next = nextSkillPoint(st, { level: 4, levels: { w: 2, q: 1 }, ultimates: ult, talentTiers: new Set() });
  assert.equal(next.name, 'dwst');
  assert.equal(next.toLevel, 1);
  // A normal hero still can't take its ultimate before 6, even if one odd pro row did.
  const { ultCap } = await import('../src/coach/skills.js');
  assert.equal(ultCap({ name: 'x', unlock: [6, 12, 18] }, 5), 0);
  assert.equal(ultCap({ name: 'x', unlock: [7, 13] }, 6), 1);
  assert.equal(ultCap({ name: 'meepo_divided_we_stand' }, 4), 1);
});

test('the live coach names one talent everywhere, and gives time to skill after every level-up', async () => {
  const { Coach } = await import('../src/coach/engine.js');
  const heroes = new Map(JSON.parse(fs.readFileSync(new URL('../data/heroes.json', import.meta.url), 'utf8')).heroes.map((h) => [h.name, h]));
  // 70 % take t1a but t1b wins far more often: the advice is t1b, in the next-point box and in the tip.
  const talentRows = [];
  for (let i = 0; i < 100; i++) {
    const take = i < 70 ? 't1a' : 't1b';
    const won = i < 70 ? i % 2 === 0 : i % 10 < 8;
    talentRows.push({ a: ORDER.map((n) => (n === 't1a' ? take : n)).map((n) => idOf[n]), n: null, w: won });
  }
  const st = computeHeroSkills(talentRows, hero, ids, db);
  const coach = new Coach({ itemDb: db, heroes, getHeroMeta: () => ({ build: null, benchmarks: null, skills: st }), getDraft: () => ({ allies: [], enemies: [], bans: [] }), getSettings: () => ({ role: 1 }) });
  const payload = (clock, level, levels, talents = {}) => ({
    map: { matchid: 'm1', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: clock, game_time: clock + 90 },
    player: { team_name: 'radiant', gold: 100, gpm: 400, xpm: 400, last_hits: 10, deaths: 0 },
    hero: { name: 'npc_dota_hero_antimage', level, alive: true, health_percent: 90, max_health: 1000, xpos: 4200, ypos: -6300, ...talents },
    abilities: Object.fromEntries(Object.entries(levels).map(([n, l], i) => [`ability${i}`, { name: n, level: l, ultimate: n === 'r' }])),
    items: { teleport0: { name: 'item_tpscroll' } },
  });
  // Level 10, talent point open.
  let s;
  for (const t of [600, 603, 606]) s = coach.update(payload(t, 10, { q: 4, w: 3, e: 1, r: 1 }));
  assert.equal(s.skills.next.talent, true);
  assert.equal(s.skills.next.name, 't1b');
  assert.equal(s.skills.talent.pick, 't1b');
  const tips = s.tips.filter((t) => t.id === 'unspent' || t.id.startsWith('talent-'));
  assert.ok(tips.every((t) => !t.text.includes('+10 Damage»')), 'no tip names the other talent');
  assert.match(tips.find((t) => t.id === 'unspent').text, /\+200 Health/);

  // Grace time: the point is spent, then a new level-up. No tip on the first update after it.
  s = coach.update(payload(610, 10, { q: 4, w: 3, e: 1, r: 1 }, { talent_2: true }));
  assert.ok(!s.tips.some((t) => t.id === 'unspent'));
  s = coach.update(payload(700, 11, { q: 4, w: 3, e: 1, r: 1 }, { talent_2: true }));
  assert.ok(!s.tips.some((t) => t.id === 'unspent'), 'not straight away');
  s = coach.update(payload(705, 11, { q: 4, w: 3, e: 1, r: 1 }, { talent_2: true }));
  assert.ok(s.tips.some((t) => t.id === 'unspent'), 'after a few seconds');
  assert.equal(s.skills.unspent, 1);
  assert.equal(s.skills.spent, 10);
});
