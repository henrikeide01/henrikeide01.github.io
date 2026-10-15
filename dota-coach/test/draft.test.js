// Draft logic: GSI draft parsing, team composition, synergies, pick and ban suggestions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/settings.js';
import { parseGsiDraft, compactDraftSample, teamNeeds, compositionScore, needsText, suggestHeroes, suggestBans } from '../src/coach/draft.js';
import { SYNERGY, synergiesWith } from '../data/synergy.js';

const heroList = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/heroes.json'), 'utf8')).heroes;
const heroes = new Map(heroList.map((h) => [h.name, h]));
const H = (n) => heroes.get(n);
const id = (n) => H(n).id;
// Every hero equally strong, so only what is tested moves the ranking.
const flatStats = new Map(heroList.map((h) => [h.name, { '5_pick': 1000, '5_win': 500 }]));

test('GSI draft: the usual team2/team3 shape with ids, classes and bans', () => {
  const block = {
    activeteam: 3,
    pick: true,
    activeteam_time_remaining: 21.5,
    radiant_bonus_time: 130,
    dire_bonus_time: 130,
    team2: { home_team: true, pick0_id: id('axe'), pick0_class: 'axe', pick1_id: id('lion'), pick1_class: 'lion', pick2_id: 0, pick2_class: '', ban0_id: id('pudge'), ban0_class: 'pudge', ban1_id: 0 },
    team3: { home_team: false, pick0_id: id('zuus'), pick0_class: 'zuus', ban0_id: id('tinker'), ban0_class: 'tinker' },
  };
  const d = parseGsiDraft(block, heroes);
  assert.deepEqual(d.radiant, ['axe', 'lion']);
  assert.deepEqual(d.dire, ['zuus']);
  assert.deepEqual(d.bans.sort(), ['pudge', 'tinker']);
  assert.equal(d.activeTeam, 'dire');
  assert.equal(d.isPick, true);
  assert.equal(d.timeLeft, 21.5);
  assert.equal(d.count, 5);
});

test('GSI draft: other shapes (prefixed classes, ids only, string ids, radiant/dire keys, arrays, picks_bans)', () => {
  // Only ids, as numbers and strings; a hero array as the heroes argument.
  let d = parseGsiDraft({ team2: { pick0_id: String(id('axe')), pick1_id: id('lion') }, team3: { pick0_id: id('sven') } }, heroList);
  assert.deepEqual([d.radiant, d.dire], [['axe', 'lion'], ['sven']]);
  // Classes with the npc_dota_hero_ prefix and a wrong id: the class wins.
  d = parseGsiDraft({ team3: { pick0_class: 'npc_dota_hero_juggernaut', pick0_id: 99999, ban0_class: 'NPC_DOTA_HERO_AXE' } }, heroes);
  assert.deepEqual(d.dire, ['juggernaut']);
  assert.deepEqual(d.bans, ['axe']);
  // An unknown class falls back to the id.
  d = parseGsiDraft({ team2: { pick0_class: 'not_a_hero', pick0_id: id('lina') } }, heroes);
  assert.deepEqual(d.radiant, ['lina']);
  // radiant/dire keys, slot objects and pick/ban arrays.
  d = parseGsiDraft({ radiant: { pick0: { id: id('axe') }, picks: ['lion', { hero_id: id('sven') }] }, dire: { bans: [id('pudge'), 'npc_dota_hero_tinker'] }, activeteam: 'radiant', pick: 0 }, heroes);
  assert.deepEqual(d.radiant, ['axe', 'lion', 'sven']);
  assert.deepEqual(d.direBans, ['pudge', 'tinker']);
  assert.equal(d.activeTeam, 'radiant');
  assert.equal(d.isPick, false);
  // The Steam / OpenDota picks_bans list.
  d = parseGsiDraft({ picks_bans: [{ is_pick: true, hero_id: id('axe'), team: 0 }, { is_pick: false, hero_id: id('lion'), team: 1 }, { is_pick: true, hero_id: id('zuus'), team: 1 }] }, heroes);
  assert.deepEqual([d.radiant, d.dire, d.bans], [['axe'], ['zuus'], ['lion']]);
  // Never more than five picks per team, and a hero is counted once.
  d = parseGsiDraft({ team2: { picks: ['axe', 'lion', 'sven', 'zuus', 'lina', 'tinker', 'axe'] } }, heroes);
  assert.equal(d.radiant.length, 5);
});

test('GSI draft: garbage never throws and gives nothing', () => {
  for (const g of [null, undefined, 0, 42, 'draft', true, [], [1, 2], () => 1]) assert.equal(parseGsiDraft(g, heroes), null);
  const junk = [
    {},
    { team2: null, team3: 'x' },
    { team2: [1, 2, 3] },
    { team2: { pick0_id: -1, pick1_id: 0, pick2_id: 'abc', pick3_id: 1.5, pick4_id: {}, pick5_class: 42, ban0_id: null, pickX_id: 1 } },
    { team2: { pick0: { id: { nested: true } } }, picks_bans: [null, 1, 'x', { hero_id: 'nope' }] },
    { activeteam: 'purple', pick: 'maybe', activeteam_time_remaining: 'soon' },
    { team2: { pick0_id: 999999 } },
  ];
  for (const g of junk) {
    const d = parseGsiDraft(g, heroes);
    assert.ok(d, JSON.stringify(g));
    assert.equal(d.count, 0, JSON.stringify(g));
    assert.equal(d.activeTeam, null);
  }
  assert.equal(parseGsiDraft({ activeteam: 'purple', pick: 'maybe' }, heroes).isPick, null);
  // No hero list at all: nothing can be resolved, but nothing breaks either.
  assert.equal(parseGsiDraft({ team2: { pick0_id: 1 } }, null).count, 0);
});

test('GSI draft sample for the diagnostics is compact', () => {
  const s = compactDraftSample({ activeteam: 2, team2: { home_team: true, pick0_id: 0, pick0_class: '', pick1_id: 5, pick1_class: 'crystal_maiden', ban0_id: -1 } });
  assert.deepEqual(s, { activeteam: 2, team2: { home_team: true, pick1_id: 5, pick1_class: 'crystal_maiden' } });
  const big = compactDraftSample({ team2: Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`x${i}`, 'y'.repeat(200)])) });
  assert.equal(big.truncated, true);
  assert.ok(big.json.length <= 4000);
  assert.equal(compactDraftSample(null), null);
  assert.equal(compactDraftSample('x'), 'x');
});

test('team needs: what the allies lack, in Norwegian', () => {
  // Two supports without initiation or a frontline.
  const needs = teamNeeds([H('crystal_maiden'), H('witch_doctor')], 3);
  const ids = needs.map((n) => n.id);
  assert.ok(ids.includes('initiation'));
  assert.ok(ids.includes('frontline'));
  assert.match(needsText(needs), /^Laget mangler .*initiering/);
  // One ally is too little to judge.
  assert.deepEqual(teamNeeds([H('crystal_maiden')], 3), []);
  // Axe + Lion: initiation, stuns and a frontline are covered.
  const covered = teamNeeds([H('axe'), H('lion')], 1).map((n) => n.id);
  assert.ok(!covered.includes('initiation') && !covered.includes('frontline') && !covered.includes('disable'));
  // Three allies without a real carry: a mid or offlaner is asked for one, a support is not.
  const noCarry = [H('crystal_maiden'), H('lion'), H('axe')];
  assert.ok(teamNeeds(noCarry, 2).some((n) => n.id === 'carry'));
  assert.ok(!teamNeeds(noCarry, 5).some((n) => n.id === 'carry'));
  // Nothing missing: no text.
  assert.equal(needsText([]), '');
  // Garbage in the team is ignored.
  assert.deepEqual(teamNeeds([null, undefined], 1), []);
});

test('composition score rewards covering what is missing, more with more allies known', () => {
  const needs = teamNeeds([H('crystal_maiden'), H('witch_doctor')], 3);
  const axe = compositionScore(H('axe'), needs, 2);
  const am = compositionScore(H('antimage'), needs, 2);
  assert.ok(axe.score > 0);
  assert.ok(axe.fills.some((n) => n.id === 'initiation'));
  assert.ok(axe.score > am.score);
  assert.ok(compositionScore(H('axe'), needs, 4).score >= axe.score);
  assert.ok(compositionScore(H('axe'), needs, 4).score <= 5, 'capped');
});

test('synergy table: valid heroes, symmetric lookup', () => {
  for (const s of SYNERGY) {
    assert.ok(heroes.has(s.a), s.a);
    assert.ok(heroes.has(s.b), s.b);
    assert.ok(s.bonus > 0 && s.bonus <= 5);
    assert.ok(s.why.length > 5);
  }
  assert.equal(synergiesWith('earthshaker', ['enigma'])[0].ally, 'enigma');
  assert.equal(synergiesWith('enigma', ['earthshaker'])[0].ally, 'earthshaker');
  assert.deepEqual(synergiesWith('earthshaker', ['axe']), []);
});

test('pick suggestions: composition and synergy count, picks and bans are left out', () => {
  const allies = [H('crystal_maiden'), H('witch_doctor')];
  const res = suggestHeroes({ heroes: heroList, stats: flatStats, matchups: new Map(), allies, bans: [H('axe')], role: 3, bracket: 5 });
  assert.ok(res.needs.some((n) => n.id === 'initiation'));
  assert.ok(!res.picks.some((p) => ['axe', 'crystal_maiden', 'witch_doctor'].includes(p.name)));
  // The top picks are initiators for a team without one, and say so.
  assert.ok(res.picks.slice(0, 3).every((p) => p.fills.includes('initiation')));
  assert.match(res.picks[0].reasons.map((r) => r.text).join(' '), /Gir laget .*initiering/);

  // With Enigma on the team, Earthshaker (Echo Slam in Black Hole) gets the combo bonus.
  const withEnigma = suggestHeroes({ heroes: heroList, stats: flatStats, allies: [H('enigma')], role: 4, bracket: 5 });
  const es = withEnigma.picks.find((p) => p.name === 'earthshaker');
  assert.ok(es, 'Earthshaker is suggested');
  assert.equal(es.synergy[0].name, 'enigma');
  assert.ok(es.reasons.some((r) => /Kombo med Enigma/.test(r.text)));
  assert.equal(withEnigma.picks[0].name, 'earthshaker');

  // Counters still count: a hero that beats the enemy comes first.
  const pa = H('phantom_assassin');
  const matchups = new Map([['axe', [{ hero_id: pa.id, games_played: 400, wins: 120 }]]]);
  const vsAxe = suggestHeroes({ heroes: heroList, stats: flatStats, matchups, enemies: [H('axe')], role: 1, bracket: 5 });
  assert.equal(vsAxe.picks[0].name, 'phantom_assassin');
  assert.match(vsAxe.picks[0].reasons[0].text, /Sterk mot Axe/);

  // Garbage in the lists is ignored.
  const g = suggestHeroes({ heroes: heroList, stats: flatStats, allies: [undefined], enemies: [null], bans: [undefined], role: 2 });
  assert.ok(g.picks.length > 0);
});

test('ban suggestions: heroes good against our team, else the meta threats for your lane', () => {
  // Our carry is Anti-Mage; Axe beats him in this (made-up) data.
  const am = H('antimage');
  const matchups = new Map([['antimage', heroList.filter((h) => h.name !== 'antimage').map((h) => ({ hero_id: h.id, games_played: 500, wins: h.name === 'axe' ? 180 : 250 }))]]);
  const bans = suggestBans({ heroes: heroList, stats: flatStats, matchups, allies: [am], role: 5, bracket: 5 });
  assert.equal(bans[0].name, 'axe');
  assert.match(bans[0].reasons.join(' '), /Sterk mot Anti-Mage/);
  assert.ok(!bans.some((b) => b.name === 'antimage'));

  // Nobody picked yet: the strongest heroes you meet in your lane (a mid meets mids).
  const stats = new Map(heroList.map((h) => [h.name, { '5_pick': 2000, '5_win': h.name === 'invoker' ? 1150 : h.name === 'storm_spirit' ? 1120 : 1000 }]));
  const mid = suggestBans({ heroes: heroList, stats, role: 2, bracket: 5 });
  assert.equal(mid[0].name, 'invoker');
  assert.ok(mid.every((b) => b.reasons.length > 0));
  assert.ok(mid.every((b) => ['S', 'A', 'B'].includes(b.tier)), 'weak heroes are not worth a ban');
  // Already banned or picked heroes are not suggested again.
  const again = suggestBans({ heroes: heroList, stats, role: 2, bracket: 5, bans: [H('invoker')], enemies: [H('storm_spirit')] });
  assert.ok(!again.some((b) => ['invoker', 'storm_spirit'].includes(b.name)));
  // No stats at all: no suggestions, no crash.
  assert.deepEqual(suggestBans({ heroes: heroList, stats: new Map(), role: 2 }), []);
});
