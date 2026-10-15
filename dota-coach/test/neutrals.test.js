// Neutral items (patch 7.38+ madstone crafting): a tolerant reader for the unverified GSI shape, upgrade advice
// for what is equipped, the tier-open and craft tips, and the diagnostics sample.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ItemDb } from '../src/coach/items.js';
import {
  neutralAdvice,
  findMyNeutral,
  locateNeutralPlayer,
  readNeutralTiers,
  readEquippedNeutral,
  neutralGearAdvice,
  neutralByTier,
  compactSample,
} from '../src/coach/skills.js';
import { Coach } from '../src/coach/engine.js';

const items = JSON.parse(fs.readFileSync(new URL('../data/items.json', import.meta.url), 'utf8')).items;
const db = new ItemDb(items);
const heroes = new Map(JSON.parse(fs.readFileSync(new URL('../data/heroes.json', import.meta.url), 'utf8')).heroes.map((h) => [h.name, h]));
const advice = (gsiNeutral, extra = {}) => neutralAdvice({ gsiNeutral, team: 'radiant', teamSlot: 0, stats: null, itemDb: db, role: 1, attr: 'agi', ...extra });
const names = (list) => list.map((x) => x.name).sort();

// The shape the parser was first written for.
const ORIGINAL = {
  team2: {
    player0: {
      current_madstone: 12,
      tier1: {
        tier: 1,
        trinket_choices: { choice0: { item_name: 'item_essence_ring', item_level: 2 }, choice1: { item_name: 'item_poor_mans_shield', item_level: 2 } },
        enchantment_choices: { choice0: { item_name: 'item_enhancement_mystical', item_level: 2 }, choice1: { item_name: 'item_enhancement_tough', item_level: 2 } },
      },
    },
  },
};

test('the original shape: tier, madstone, ranked choices', () => {
  const n = advice(ORIGINAL);
  assert.equal(n.tier, 2);
  assert.equal(n.madstone, 12);
  assert.equal(n.source, 'team2.player0');
  assert.deepEqual(names(n.artifacts), ['essence_ring', 'poor_mans_shield']);
  assert.deepEqual(names(n.enchantments), ['enhancement_mystical', 'enhancement_tough']);
  assert.equal(n.pickEnchantment, 'enhancement_tough');
});

test('alternative key names: radiant/player_3, tier_N, arrays, name/item fields, item ids', () => {
  const block = {
    radiant: {
      player_3: {
        madstone_count: '7',
        tier_2: {
          artifact_options: [{ name: 'item_cloak_of_flames' }, 'item_psychic_headband', { item: 'stormcrafter', lvl: 3 }, { name: 'Unrelenting Eye' }, { name: 'Not An Item!' }],
          enchant_list: { a: { item: 'item_enhancement_tough', level: 3 }, b: { item_id: items.enhancement_vast.id } },
        },
      },
      player_1: { tier_2: { artifact_options: ['item_chipped_vest'] } },
    },
  };
  const n = advice(block, { teamSlot: 3 });
  assert.equal(n.source, 'radiant.player_3');
  assert.equal(n.tier, 3); // from the artifacts' own tier, whatever the key says
  assert.equal(n.madstone, 7);
  assert.deepEqual(names(n.artifacts), ['cloak_of_flames', 'psychic_headband', 'stormcrafter', 'unrelenting_eye']);
  assert.deepEqual(names(n.enchantments), ['enhancement_tough', 'enhancement_vast']);
});

test('numeric tier keys, choices straight on the player, and the player object as the whole block', () => {
  const numeric = { team2: { player0: { 1: { trinket_choices: ['item_essence_ring', 'item_seeds_of_serenity'] } } } };
  assert.equal(advice(numeric).tier, 2);
  const flat = { current_madstone: 3, crafting_tier: 0, trinket_choices: { choice0: { item_name: 'item_chipped_vest' } }, enchantment_choices: { choice0: { item_name: 'item_enhancement_brawny' } } };
  const n = advice(flat);
  assert.equal(n.tier, 1);
  assert.equal(n.madstone, 3);
  assert.deepEqual(names(n.artifacts), ['chipped_vest']);
  // Unknown artifacts (not in our data): the tier comes from the crafting tier, then from the clock.
  const unknown = { team2: { player0: { total_madstone: 60, madstone_needed: 30, madstone_count: 1, trinket_choices: ['item_brand_new_thing'], crafting_tier: 3 } } };
  assert.equal(advice(unknown).tier, 4);
  assert.equal(advice(unknown).madstone, 1, 'not the total or the cost');
  assert.equal(advice({ team2: { player0: { trinket_choices: ['item_brand_new_thing'] } } }, { clockTier: 2 }).tier, 2);
  // One-based tier keys (tier5 without tier0).
  const oneBased = readNeutralTiers({ tier5: { trinket_choices: ['item_brand_new_thing'] }, tier4: { trinket_choices: ['item_other_new_thing'] } }, db);
  assert.deepEqual(oneBased.map((g) => g.tier).sort(), [4, 5]);
});

test('finding our player: slot keys, identity fields, both teams, and never a teammate by guess', () => {
  const both = {
    team2: { player0: { trinket_choices: ['item_chipped_vest'] } },
    team3: { player0: { trinket_choices: ['item_cloak_of_flames'] }, player1: { trinket_choices: ['item_essence_ring'] } },
  };
  assert.equal(names(advice(both, { team: 'dire', teamSlot: 1 }).artifacts)[0], 'essence_ring');
  assert.equal(names(advice(both, { team: 'radiant', teamSlot: 4 }).artifacts)[0], 'chipped_vest'); // the only one on our side
  // Global player slots (5-9 for Dire).
  const global = { team3: { player5: { trinket_choices: ['item_essence_ring'] }, player6: { trinket_choices: ['item_chipped_vest'] } } };
  assert.equal(advice(global, { team: 'dire', teamSlot: 0 }).artifacts[0].name, 'essence_ring');
  // steamid / accountid / team_slot fields.
  const ids = { team2: { a: { steamid: '111', trinket_choices: ['item_essence_ring'] }, b: { steamid: '222', trinket_choices: ['item_chipped_vest'] } } };
  assert.equal(advice(ids, { teamSlot: undefined, who: { steamid: '222' } }).artifacts[0].name, 'chipped_vest');
  const slots = { team2: { player0: { team_slot: 2, trinket_choices: ['item_essence_ring'] }, player1: { team_slot: 0, trinket_choices: ['item_chipped_vest'] } } };
  assert.equal(advice(slots, { teamSlot: 0 }).artifacts[0].name, 'chipped_vest', 'a team_slot field beats the key');
  // Several players and nothing tells which one is us: nothing rather than a teammate's choice.
  assert.equal(advice({ team2: { player0: { trinket_choices: ['item_essence_ring'] }, player1: { trinket_choices: ['item_chipped_vest'] } } }, { teamSlot: undefined }), null);
  // Only the other team's block: only if it is clearly us.
  assert.equal(findMyNeutral({ team2: { player0: { trinket_choices: ['item_essence_ring'] }, player1: {} } }, 'dire', 1), null);
  assert.equal(locateNeutralPlayer({ team2: { player0: { accountid: 9, trinket_choices: [] } } }, 'dire', { accountid: 9 }).path, 'team2.player0');
});

test('choices already made: selected flags, a chosen-item key, and finished crafts of older tiers', () => {
  const block = {
    team2: {
      player0: {
        tier0: { selected_trinket: 'item_chipped_vest', chosen_enchantment: { name: 'item_enhancement_brawny' } },
        tier1: {
          trinket_choices: { choice0: { item_name: 'item_essence_ring', chosen: 1 }, choice1: { item_name: 'item_poor_mans_shield' } },
          enchantment_choices: { choice0: { item_name: 'item_enhancement_tough' } },
        },
      },
    },
  };
  const n = advice(block);
  assert.equal(n.tier, 2, 'the newest tier with something left to choose');
  assert.equal(n.artifacts.find((a) => a.name === 'essence_ring').selected, true);
  assert.equal(n.enchantments.some((e) => e.selected), false);
  // Everything chosen for tier 1 while tier 2 is open by the clock: no stale craft card.
  const done = { team2: { player0: { tier0: { selected_trinket: 'item_chipped_vest', selected_enchantment: 'item_enhancement_brawny' } } } };
  assert.equal(advice(done, { clockTier: 2 }), null);
  assert.equal(advice(done, { clockTier: 1 }).artifacts[0].selected, true);
});

test('garbage never throws', () => {
  const cyclic = { team2: { player0: { tier0: {} } } };
  cyclic.team2.player0.tier0.trinket_choices = { self: cyclic, choice0: 'item_chipped_vest' };
  cyclic.team2.player0.loop = cyclic.team2.player0;
  const evil = { team2: { player0: {} } };
  Object.defineProperty(evil.team2.player0, 'trinket_choices', { enumerable: true, get() { throw new Error('boom'); } });
  const inputs = [
    null, undefined, 0, 5, 'abc', true, [], [null], {}, { team2: null }, { team2: 'x' }, { team2: { player0: 'x' } },
    { team2: { player0: null } }, { team2: { player0: { tier0: null } } }, { team2: { player0: { tier0: { trinket_choices: null } } } },
    { team2: { player0: { trinket_choices: [null, 1, -1, 1e99, NaN, {}, [], 'empty', 'item_', ''] } } },
    { team2: { player0: { trinket_choices: { choice0: { item_name: { nested: true } } } } } },
    { team2: { player0: { tier999: { trinket_choices: ['item_chipped_vest'] } } } },
    cyclic, evil,
  ];
  for (const g of inputs) {
    for (const team of ['radiant', 'dire', undefined]) {
      assert.doesNotThrow(() => advice(g, { team }));
      assert.doesNotThrow(() => findMyNeutral(g, team, 0));
      assert.doesNotThrow(() => readEquippedNeutral(g, db));
      assert.doesNotThrow(() => compactSample(g));
    }
  }
  assert.equal(advice({ team2: { player0: { trinket_choices: [null, 1, 'empty', ''] } } }), null, 'nothing usable: no advice');
  assert.equal(advice(cyclic).artifacts[0].name, 'chipped_vest');
  assert.equal(neutralByTier({ tier: 2, stats: null, itemDb: { items: null }, role: 1 }), null);
  assert.equal(neutralGearAdvice({ equipped: null, tier: 2 }), null);
});

test('the equipped neutral: neutral0 / neutral1, a nested enchantment, and an empty slot', () => {
  let e = readEquippedNeutral({ slot0: { name: 'item_blink' }, neutral0: { name: 'item_chipped_vest' }, neutral1: { name: 'item_enhancement_brawny', item_level: 2 } }, db);
  assert.deepEqual([e.seen, e.artifact.name, e.artifact.tier, e.enchantment.name, e.enchantment.level], [true, 'chipped_vest', 1, 'enhancement_brawny', 2]);
  e = readEquippedNeutral({ neutral0: { name: 'item_essence_ring', enhancement: 'item_enhancement_tough' } }, db);
  assert.deepEqual([e.artifact.name, e.enchantment.name], ['essence_ring', 'enhancement_tough']);
  e = readEquippedNeutral({ neutral0: { name: 'empty' } }, db);
  assert.deepEqual([e.seen, e.artifact, e.enchantment], [true, null, null]);
  assert.equal(readEquippedNeutral({ slot0: { name: 'item_blink' } }, db).seen, false);
});

test('upgrade advice: old tier, empty slot, clearly worse picks', () => {
  const rec2 = neutralByTier({ tier: 2, stats: null, itemDb: db, role: 1, attr: 'agi' });
  const gear = (equipped, extra = {}) => neutralGearAdvice({ equipped: { seen: true, artifact: null, enchantment: null, ...equipped }, tier: 2, sinceOpen: 120, clock: 1020, rec: rec2, stats: null, itemDb: db, role: 1, attr: 'agi', ...extra });
  const vest = { name: 'chipped_vest', dname: 'Chipped Vest', tier: 1 };
  const up = gear({ artifact: vest });
  assert.equal(up.kind, 'upgrade');
  assert.match(up.text, /^Tier 2 er åpen, men du har fortsatt Chipped Vest \(tier 1\)/);
  assert.match(up.text, new RegExp(rec2.items[0].dname));
  assert.equal(gear({ artifact: vest }, { sinceOpen: 20 }), null, 'not right after the tier opens (the tier tip speaks then)');
  assert.equal(gear({ artifact: { name: rec2.items[0].name, dname: rec2.items[0].dname, tier: 2 } }), null, 'already the best');
  assert.equal(gear({}).kind, 'empty');
  assert.equal(gear({}, { clock: 500 }), null);
  assert.equal(neutralGearAdvice({ equipped: { seen: false }, tier: 2, rec: rec2, itemDb: db, role: 1 }), null, 'no slot data: no claims');
  // Pro data shows a clear favourite and the equipped one is (almost) never used.
  const stats = { neutrals: [{ name: 'poor_mans_shield', pct: 45 }, { name: 'essence_ring', pct: 2 }] };
  const recPro = neutralByTier({ tier: 2, stats, itemDb: db, role: 1, attr: 'agi' });
  const worse = gear({ artifact: { name: 'essence_ring', dname: 'Essence Ring', tier: 2 } }, { rec: recPro, stats });
  assert.equal(worse.kind, 'worse-artifact');
  assert.match(worse.text, /Essence Ring passer dårlig.*45 % av pro-spillerne tar Poor Man's Shield/);
  // An enchantment that gives a carry nothing.
  const ench = gear({ artifact: { name: rec2.items[0].name, dname: 'x', tier: 2 }, enchantment: { name: 'enhancement_wise', dname: 'Wise' } });
  assert.equal(ench?.kind, 'worse-enchantment');
});

test('compact diagnostics sample stays small', () => {
  const huge = { team2: {} };
  for (let p = 0; p < 10; p++) {
    huge.team2[`player${p}`] = {};
    for (let t = 0; t < 5; t++) huge.team2[`player${p}`][`tier${t}`] = { trinket_choices: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`choice${i}`, { item_name: `item_${'x'.repeat(200)}`, item_level: i }])) };
  }
  const s = compactSample(huge, 3000);
  assert.ok(JSON.stringify(s).length <= 3000, JSON.stringify(s).length);
  assert.ok(s.team2, 'keeps the top of the shape');
  assert.deepEqual(compactSample(ORIGINAL), ORIGINAL, 'a normal block is kept whole');
});

// ---------- In the live coach ----------

function makeCoach(stats = null) {
  return new Coach({ itemDb: db, heroes, getHeroMeta: () => ({ build: null, benchmarks: null, skills: stats }), getDraft: () => ({ allies: [], enemies: [], bans: [] }), getSettings: () => ({ role: 1 }) });
}
const payload = (clock, { neutral0, neutralitems, team_slot = 0 } = {}) => ({
  map: { matchid: 'n1', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: clock, game_time: clock + 90 },
  player: { team_name: 'radiant', team_slot, gold: 100, gpm: 400, xpm: 400, last_hits: 10, deaths: 0 },
  hero: { name: 'npc_dota_hero_antimage', level: 12, alive: true, health_percent: 90, max_health: 1000, xpos: 4200, ypos: -6300 },
  items: { teleport0: { name: 'item_tpscroll' }, ...(neutral0 !== undefined ? { neutral0: { name: neutral0 } } : {}) },
  ...(neutralitems ? { neutralitems } : {}),
});

test('a new tier: one spoken tip naming what to take, then an upgrade tip for an old-tier item', () => {
  const coach = makeCoach();
  let s = coach.update(payload(880, { neutral0: 'item_chipped_vest' }));
  assert.ok(!s.tips.some((t) => t.id.startsWith('neutral-tier')));
  s = coach.update(payload(901, { neutral0: 'item_chipped_vest' }));
  const open = s.tips.find((t) => t.id === 'neutral-tier-2');
  assert.ok(open, 'tier 2 tip');
  const rec = s.skills.proNeutrals;
  assert.equal(rec.tier, 2);
  assert.equal(open.say, `Nøytrale items tier 2 er åpne – ta ${rec.items[0].dname} og ${rec.enchantments[0].dname}`);
  assert.ok(!s.tips.some((t) => t.id.startsWith('swap-neutral')), 'no upgrade nag while the tier tip is up');
  s = coach.update(payload(905, { neutral0: 'item_chipped_vest' }));
  assert.equal(s.tips.find((t) => t.id === 'neutral-tier-2').key, open.key, 'the same tip (clients read a key aloud once)');
  // After the tier tip: the upgrade tip (held for a few seconds, said once).
  const said = new Map();
  for (let t = 910; t <= 1100; t += 5) {
    s = coach.update(payload(t, { neutral0: 'item_chipped_vest' }));
    for (const tip of s.tips) if (tip.say && /neutral/.test(tip.id) && tip.key !== open.key) said.set(tip.key, tip.id);
  }
  assert.deepEqual([...said.values()], ['swap-neutral-upgrade-2']);
  const up = s.tips.find((t) => t.id === 'swap-neutral-upgrade-2');
  assert.match(up.text, /Chipped Vest \(tier 1\)/);
  assert.equal(s.skills.neutralGear.artifact.name, 'chipped_vest');
  // Upgraded: the tip goes away.
  for (let t = 1105; t <= 1130; t += 5) s = coach.update(payload(t, { neutral0: `item_${rec.items[0].name}` }));
  assert.ok(!s.tips.some((t) => t.id.startsWith('swap-neutral')));
});

test('a craft choice on screen: one spoken craft tip, no tier or upgrade tips on top of it', () => {
  const coach = makeCoach();
  const neutralitems = {
    team2: {
      player0: {
        current_madstone: 20,
        tier1: {
          trinket_choices: { choice0: { item_name: 'item_essence_ring' }, choice1: { item_name: 'item_poor_mans_shield' } },
          enchantment_choices: { choice0: { item_name: 'item_enhancement_tough' }, choice1: { item_name: 'item_enhancement_mystical' } },
        },
      },
    },
  };
  let s;
  const said = new Map();
  for (let t = 900; t <= 1000; t += 5) {
    // The block flickers (missing every third update): still said only once.
    s = coach.update(payload(t, { neutral0: 'item_chipped_vest', neutralitems: t % 15 || t === 900 ? neutralitems : undefined }));
    for (const tip of s.tips) if (tip.say && /neutral/.test(tip.id)) said.set(tip.key, `${tip.id}: ${tip.say}`);
  }
  s = coach.update(payload(1005, { neutral0: 'item_chipped_vest', neutralitems }));
  assert.equal(said.size, 1, [...said.values()].join(' | '));
  assert.match([...said.values()][0], /^neutral-craft-2: Velg (.+ og )?(Tough|Mystical)$/);
  assert.ok(s.tips.some((t) => t.id === 'neutral-craft-2'));
  assert.ok(!s.tips.some((t) => t.id.startsWith('swap-neutral') || t.id.startsWith('neutral-tier')));
  // Chosen: the craft tip is gone.
  const chosen = structuredClone(neutralitems);
  chosen.team2.player0.tier1.trinket_choices.choice0.selected = true;
  chosen.team2.player0.tier1.enchantment_choices.choice0.selected = true;
  s = coach.update(payload(1010, { neutral0: 'item_essence_ring', neutralitems: chosen }));
  assert.ok(!s.tips.some((t) => t.id.startsWith('neutral-craft')));
});

test('the diagnostics keep a compact sample of the raw block and what the parser made of it', () => {
  const coach = makeCoach();
  coach.update(payload(600, { neutral0: 'empty' }));
  assert.equal(coach.neutralDiag.last.block, '(ingen neutralitems i GSI)');
  coach.neutralDiag.sampledAt = 0;
  const odd = { team_2: { player_0: { madstones: 4, tier_0: { trinket_offer: ['item_chipped_vest', 'item_possessed_mask'] } } } };
  coach.update(payload(605, { neutral0: 'empty', neutralitems: odd }));
  const d = coach.neutralDiag;
  assert.deepEqual(d.last.block, odd);
  assert.deepEqual(d.last.slots, { neutral0: { name: 'empty' } });
  assert.equal(d.last.parsed.player, 'team_2.player_0');
  assert.deepEqual(d.last.parsed.artifacts.sort(), ['chipped_vest', 'possessed_mask']);
  assert.equal(d.withChoices.parsed.tier, 1);
  assert.ok(JSON.stringify(d).length < 10000);
});

test('/api/diagnostics includes the neutral item sample', async () => {
  const { startServer } = await import('../src/server.js');
  const { makeFixtures } = await import('../tools/make-fixtures.js');
  const { loadSettings } = await import('../src/settings.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotacoach-neutral-'));
  makeFixtures(dir);
  const srv = await startServer({ port: 0, quiet: true, fixturesDir: dir, matchesDir: path.join(dir, 'matches'), noWarmup: true, noUpdate: true });
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const body = { auth: { token: loadSettings().token }, ...payload(700, { neutral0: 'item_chipped_vest', neutralitems: ORIGINAL }) };
    assert.equal((await fetch(`${base}/gsi`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 200);
    const diag = await (await fetch(`${base}/api/diagnostics`)).json();
    assert.equal(diag.neutral.last.parsed.player, 'team2.player0');
    assert.deepEqual(diag.neutral.last.slots, { neutral0: { name: 'item_chipped_vest' } });
    assert.equal(diag.neutral.last.block.team2.player0.current_madstone, 12);
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('review fixes: enchantments are only recommended for tiers where the game offers them', async () => {
  const { neutralByTier, ENCHANT_TIERS } = await import('../src/coach/skills.js');
  const { ItemDb } = await import('../src/coach/items.js');
  const fs = await import('node:fs');
  const items = JSON.parse(fs.readFileSync(new URL('../data/items.json', import.meta.url), 'utf8')).items;
  const db = new ItemDb(items);
  for (const tier of [1, 2, 3, 4, 5]) {
    for (const role of [1, 3, 5]) {
      const r = neutralByTier({ tier, stats: null, itemDb: db, role, attr: role === 3 ? 'str' : 'agi' });
      for (const e of r?.enchantments || []) {
        const t = ENCHANT_TIERS[e.name.replace('enhancement_', '')];
        assert.ok(t && tier >= t[0] && tier <= t[1], `${e.name} at tier ${tier}`);
      }
    }
  }
});
