// The counter knowledge base (data/counters.js) and the logic that turns it into suggestions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/settings.js';
import { ItemDb, readInventory } from '../src/coach/items.js';
import { HERO_COUNTERS } from '../data/counters.js';
import { counterItems, enemyBreakdown, knownMatchups, coveredByOwned, buyerKinds, heroStyle } from '../src/coach/counters.js';
import { suggestHeroes, suggestBans } from '../src/coach/draft.js';

const { items } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/items.json'), 'utf8'));
const heroList = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/heroes.json'), 'utf8')).heroes;
const heroes = new Map(heroList.map((h) => [h.name, h]));
const db = new ItemDb(items);
const H = (n) => heroes.get(n);
const foes = (...names) => names.map((n) => ({ name: n, dname: H(n)?.dname || n }));

// A small knowledge base for the logic tests (the real one is checked below).
const KB = {
  phantom_assassin: {
    style: 'attack',
    threats: ['evasion', 'physical'],
    tip: 'Phantom Assassin: kjøp MKB.',
    items: [
      { item: 'monkey_king_bar', who: ['carry'], when: 'mid', why: 'MKB treffer gjennom Blur.' },
      { item: 'ghost', who: ['support', 'caster'], when: 'mid', why: 'Ghost Scepter stopper angrepene hennes.' },
      { item: 'heavens_halberd', who: ['offlane'], when: 'mid', why: 'Disarm stopper henne.' },
      { item: 'black_king_bar', who: ['carry', 'caster'], when: 'mid', why: 'BKB mot Stifling Dagger.' },
    ],
    counters: [{ hero: 'axe', why: 'Counter Helix treffer gjennom Blur.' }],
  },
  windrunner: {
    style: 'hybrid',
    threats: ['evasion'],
    tip: 'Windranger: …',
    items: [
      { item: 'monkey_king_bar', who: ['carry'], when: 'mid', why: 'MKB treffer gjennom Windrun.' },
      { item: 'black_king_bar', who: ['carry', 'caster'], when: 'mid', why: 'BKB mot Shackleshot.' },
    ],
    counters: [{ hero: 'axe', why: 'Berserker’s Call.' }],
  },
  axe: {
    style: 'attack',
    threats: ['disable'],
    tip: 'Axe: …',
    items: [{ item: 'force_staff', who: ['any'], when: 'mid', why: 'Force Staff ut av Berserker’s Call.' }],
    counters: [{ hero: 'sniper', why: 'Sniper slår ham på avstand.' }],
  },
};

test('buyer kinds come from the position first, then the hero style', () => {
  assert.deepEqual([...buyerKinds(5, H('juggernaut'), KB)], ['support']);
  assert.deepEqual([...buyerKinds(3, H('juggernaut'), KB)], ['offlane']);
  assert.deepEqual([...buyerKinds(1, H('phantom_assassin'), KB)], ['carry']);
  assert.deepEqual([...buyerKinds(2, H('windrunner'), KB)].sort(), ['carry', 'caster']);
  // Unknown to the test KB: guessed from the OpenDota roles.
  assert.equal(heroStyle(H('zuus'), {}), 'spell');
  assert.equal(heroStyle(H('juggernaut'), {}), 'attack');
});

test('counter items: only what your hero and position buy, with every enemy it answers', () => {
  const enemies = foes('phantom_assassin', 'windrunner', 'axe');
  const carry = counterItems({ enemies, hero: H('juggernaut'), role: 1, db, kb: KB });
  assert.equal(carry[0].item, 'monkey_king_bar', 'answers two enemies first');
  assert.deepEqual(carry[0].vs.map((v) => v.hero), ['phantom_assassin', 'windrunner']);
  assert.match(carry[0].vs[0].why, /Blur/);
  assert.ok(!carry.some((x) => x.item === 'ghost'), 'no support item for a carry');
  assert.ok(carry.some((x) => x.item === 'force_staff'), '"any" items are for everyone');

  const support = counterItems({ enemies, hero: H('crystal_maiden'), role: 5, db, kb: KB });
  assert.ok(!support.some((x) => x.item === 'monkey_king_bar' || x.item === 'black_king_bar'));
  assert.ok(support.some((x) => x.item === 'ghost'));
  assert.equal(support.find((x) => x.item === 'ghost').fit.text, 'Passer en support');

  // A spell core gets no MKB, unless the hero's own pro players buy it.
  const zeus = { ...H('zuus') };
  assert.ok(!counterItems({ enemies, hero: zeus, role: 2, db, kb: { ...KB, zuus: { style: 'spell', threats: [], tip: '', items: [], counters: [] } } }).some((x) => x.item === 'monkey_king_bar'));
  const build = { early: [], mid: [{ name: 'monkey_king_bar' }], late: [] };
  const withBuild = counterItems({ enemies, hero: zeus, role: 2, build, db, kb: { ...KB, zuus: { style: 'spell', threats: [], tip: '', items: [], counters: [] } } });
  const mkb = withBuild.find((x) => x.item === 'monkey_king_bar');
  assert.ok(mkb && mkb.fit.inBuild);
  assert.match(mkb.fit.text, /Pro-spillere på Zeus/);
});

test('owned items and items that do the same job are marked', () => {
  const enemies = foes('phantom_assassin');
  const list = counterItems({ enemies, hero: H('juggernaut'), role: 1, db, owned: new Set(['bloodthorn', 'orchid']), kb: KB });
  assert.equal(list.find((x) => x.item === 'monkey_king_bar').owned, true, 'Bloodthorn already gives true strike');
  assert.ok(coveredByOwned('dust', new Set(['gem'])));
  assert.ok(!coveredByOwned('gem', new Set(['dust'])));
  assert.ok(!coveredByOwned('black_king_bar', new Set(['monkey_king_bar'])));
});

test('per-enemy breakdown and known matchups both ways', () => {
  const b = enemyBreakdown({ enemies: foes('phantom_assassin'), hero: H('juggernaut'), role: 1, db, kb: KB, heroes });
  assert.equal(b[0].tip, 'Phantom Assassin: kjøp MKB.');
  assert.equal(b[0].items[0].item, 'monkey_king_bar');
  assert.equal(b[0].counters[0].dname, 'Axe');
  const km = knownMatchups(H('axe'), foes('phantom_assassin', 'windrunner'), KB);
  assert.deepEqual(km.good.map((g) => g.name), ['phantom_assassin', 'windrunner']);
  assert.deepEqual(knownMatchups(H('axe'), foes('sniper'), KB).bad.map((g) => g.name), ['sniper']);
});

// ---------------- The real knowledge base ----------------

test('knowledge base: every hero, valid items and heroes, Norwegian reasons', () => {
  const names = Object.keys(HERO_COUNTERS);
  if (!names.length) return; // not generated yet
  const missing = heroList.filter((h) => !HERO_COUNTERS[h.name]).map((h) => h.name);
  assert.deepEqual(missing, [], 'every hero has an entry');
  for (const [name, d] of Object.entries(HERO_COUNTERS)) {
    assert.ok(heroes.has(name), `${name} is a hero`);
    assert.ok(['attack', 'spell', 'hybrid'].includes(d.style), `${name} style`);
    assert.ok(d.tip.length > 10, `${name} tip`);
    assert.ok(d.items.length >= 3, `${name} has items`);
    for (const it of d.items) {
      assert.ok(db.get(it.item), `${name}: ${it.item} exists`);
      assert.ok(!db.isNeutral(it.item), `${name}: ${it.item} is not a neutral item`);
      assert.ok(it.why.length > 10, `${name}/${it.item} has a reason`);
    }
    for (const c of d.counters) assert.ok(heroes.has(c.hero) && c.hero !== name, `${name}: counter ${c.hero}`);
  }
});

test('knowledge base: standard answers are there', () => {
  if (!Object.keys(HERO_COUNTERS).length) return;
  const items = (n) => HERO_COUNTERS[n].items.map((i) => i.item);
  assert.ok(items('phantom_assassin').includes('monkey_king_bar'), 'MKB vs PA');
  assert.ok(items('riki').some((i) => ['dust', 'ward_sentry', 'gem'].includes(i)), 'detection vs Riki');
  assert.ok(items('huskar').includes('spirit_vessel'), 'Spirit Vessel vs Huskar');
  assert.ok(HERO_COUNTERS.riki.threats.includes('invis'));
  assert.ok(HERO_COUNTERS.phantom_assassin.threats.includes('evasion'));
  // A support is never told to buy MKB against PA.
  const sup = counterItems({ enemies: foes('phantom_assassin'), hero: H('crystal_maiden'), role: 5, db });
  assert.ok(sup.length && !sup.some((x) => x.item === 'monkey_king_bar'));
});

test('pick suggestions use known counters and show the parts of the score', () => {
  const flat = new Map(heroList.map((h) => [h.name, { '5_pick': 1000, '5_win': 500 }]));
  const res = suggestHeroes({ heroes: heroList, stats: flat, enemies: [H('phantom_assassin'), H('windrunner')], role: 3, bracket: 5, kb: KB });
  const axe = res.picks.find((p) => p.name === 'axe');
  assert.ok(axe, 'Axe is suggested');
  assert.equal(axe.parts.known, 4);
  assert.deepEqual(axe.knownGood.map((k) => k.name), ['phantom_assassin', 'windrunner']);
  assert.match(axe.reasons[0].text, /Counter mot Phantom Assassin og Windranger/);
  assert.equal(res.picks[0].name, 'axe', 'with a flat meta the known counter wins');

  // Countered by an enemy: on the avoid list, with the reason.
  const kb2 = { ...KB, phantom_assassin: { ...KB.phantom_assassin, counters: [] }, juggernaut: { style: 'attack', threats: [], tip: 'x', items: [], counters: [{ hero: 'phantom_assassin', why: 'Blur og Coup de Grace slår ham i duell.' }] } };
  const vsPa = suggestHeroes({ heroes: heroList, stats: flat, enemies: [H('phantom_assassin')], role: 1, bracket: 5, kb: kb2 });
  const jug = vsPa.avoid.find((p) => p.name === 'juggernaut');
  assert.ok(jug, 'Juggernaut is on the avoid list');
  assert.equal(jug.parts.known, -2);
  assert.match(jug.knownBad[0].why, /Blur/);
  assert.ok(jug.reasons.some((r) => r.kind === 'neg' && /Svak mot Phantom Assassin/.test(r.text)));
});

test('ban suggestions: a known counter to your team is worth banning', () => {
  const stats = new Map(heroList.map((h) => [h.name, { '5_pick': 1000, '5_win': h.name === 'phantom_assassin' ? 530 : 500 }]));
  const bans = suggestBans({ heroes: heroList, stats, allies: [H('axe')], role: 3, bracket: 5, kb: KB });
  const sniper = bans.find((b) => b.name === 'sniper');
  assert.ok(sniper, 'Sniper, a known counter to Axe, is suggested');
  assert.ok(sniper.reasons.includes('Counter mot Axe'));
});
