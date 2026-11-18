// Hero-vs-hero numbers from public ranked matches (src/coach/matchups.js) and how the draft uses them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/settings.js';
import { buildMatchupIndex, overlayHero, pairStats, heroTotals, bestAndWorst, expectedWinrate, publicMatchupSql } from '../src/coach/matchups.js';
import { suggestHeroes, counterAdvantages } from '../src/coach/draft.js';

const heroList = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/heroes.json'), 'utf8')).heroes;
const H = (n) => heroList.find((h) => h.name === n);

// A tiny snapshot: three heroes, Legend (5) and Ancient (6).
// Hero 1 wins 60 % against hero 2 although both win 50 % overall: a real counter.
function snapshot() {
  const ids = [1, 2, 3];
  const N = 3;
  const mk = (pairs, totals) => {
    const g = new Array(N * N).fill(0);
    const w = new Array(N * N).fill(0);
    for (const [a, b, games, wins] of pairs) {
      g[a * N + b] = games;
      w[a * N + b] = wins;
      g[b * N + a] = games;
      w[b * N + a] = games - wins;
    }
    return { t: totals, g, w };
  };
  return {
    heroes: ids,
    from: '2026-11-11T00:00:00Z',
    to: '2026-11-18T00:00:00Z',
    matches: 30000,
    brackets: {
      5: mk([[0, 1, 2000, 1200], [0, 2, 2000, 1000], [1, 2, 100, 50]], [[20000, 10000], [20000, 10000], [20000, 10000]]),
      6: mk([[0, 1, 1000, 500], [1, 2, 900, 450]], [[8000, 4000], [8000, 4000], [8000, 4000]]),
    },
  };
}

test('expected win rate from two overall win rates', () => {
  assert.equal(expectedWinrate(0.5, 0.5), 0.5);
  assert.ok(expectedWinrate(0.55, 0.5) > 0.54 && expectedWinrate(0.55, 0.5) < 0.56);
  assert.ok(expectedWinrate(0.45, 0.55) < 0.41);
});

test('pair stats: advantage against expectation, shrunk by sample size, neighbours for small samples', () => {
  const idx = buildMatchupIndex(snapshot());
  const s = pairStats(idx, 1, 2, 5);
  assert.equal(s.games, 2000);
  assert.equal(s.wr, 0.6);
  assert.ok(s.adv > 8 && s.adv < 10, `advantage ${s.adv}`);
  assert.deepEqual(s.brackets, [5]);
  // The other way round.
  assert.ok(pairStats(idx, 2, 1, 5).adv < -8);
  // Only 100 games in Legend: Ancient is added.
  const small = pairStats(idx, 2, 3, 5);
  assert.equal(small.games, 1000);
  assert.deepEqual(small.brackets, [5, 6]);
  assert.equal(pairStats(idx, 1, 1, 5), null);
  assert.equal(pairStats(idx, 1, 99, 5), null);
  assert.equal(heroTotals(idx, 1, 5).wr, 0.5);
});

test('best and worst matchups', () => {
  const idx = buildMatchupIndex(snapshot());
  const bw = bestAndWorst(idx, 1, 5, { minGames: 100 });
  assert.equal(bw.best[0].id, 2);
  assert.equal(bw.worst[0].id, 3);
});

test('fresh explorer rows replace one hero in the snapshot', () => {
  const idx = buildMatchupIndex(snapshot());
  // Hero 2 now wins 55 % against hero 1 in Legend.
  const next = overlayHero(idx, 2, [[5, 1, 3000, 1650], [5, 3, 2000, 1000], [5, 0, 25000, 12500]]);
  const s = pairStats(next, 1, 2, 5);
  assert.equal(s.games, 3000);
  assert.equal(s.wins, 1350);
  assert.equal(heroTotals(next, 2, 5).games, 25000);
  assert.equal(pairStats(idx, 1, 2, 5).games, 2000, 'the old index is unchanged');
  assert.equal(overlayHero(idx, 99, [[5, 1, 1, 1]]), idx, 'unknown hero: nothing changes');
});

test('the explorer SQL is for one hero, ranked matches, about a week', () => {
  const sql = publicMatchupSql(44);
  assert.match(sql, /44 = ANY\(radiant_team\)/);
  assert.match(sql, /lobby_type = 7/);
  assert.match(sql, /9000000/);
  assert.throws(() => publicMatchupSql('1; DROP TABLE x'));
});

test('draft: public matchups drive the counter score and carry the numbers', () => {
  // Real hero ids: Juggernaut wins 60 % against Phantom Assassin, Axe 50 % (both 50 % overall).
  const jug = H('juggernaut');
  const axe = H('axe');
  const pa = H('phantom_assassin');
  const ids = [jug.id, axe.id, pa.id];
  const N = 3;
  const g = new Array(N * N).fill(0);
  const w = new Array(N * N).fill(0);
  const set = (a, b, games, wins) => {
    g[a * N + b] = games;
    w[a * N + b] = wins;
    g[b * N + a] = games;
    w[b * N + a] = games - wins;
  };
  set(0, 2, 4000, 2400);
  set(1, 2, 4000, 2000);
  const idx = buildMatchupIndex({ heroes: ids, brackets: { 5: { t: [[40000, 20000], [40000, 20000], [40000, 20000]], g, w } } });
  const [adv] = counterAdvantages(jug, [pa], new Map(), { index: idx, bracket: 5 });
  assert.equal(adv.source, 'public');
  assert.equal(adv.games, 4000);
  assert.equal(adv.wr, 0.6);
  const flat = new Map(heroList.map((h) => [h.name, { '5_pick': 1000, '5_win': 500 }]));
  const res = suggestHeroes({ heroes: heroList, stats: flat, enemies: [pa], role: 1, bracket: 5, pub: { index: idx, bracket: 5 }, kb: {} });
  assert.equal(res.picks[0].name, 'juggernaut');
  const v = res.picks[0].vs[0];
  assert.equal(v.name, 'phantom_assassin');
  assert.equal(v.source, 'public');
  assert.equal(v.games, 4000);
  assert.ok(res.picks[0].parts.matchups > 5);
});

test('the shipped snapshot covers every hero and every bracket', () => {
  const file = path.join(ROOT, 'data/matchups.json');
  if (!fs.existsSync(file)) return;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const idx = buildMatchupIndex(raw);
  assert.ok(idx, 'valid file');
  // OpenDota has no Immortal bracket in public_matches: Immortal players get Divine (and Ancient).
  assert.deepEqual([...idx.brackets.keys()].sort(), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(pairStats(idx, H('axe').id, H('phantom_assassin').id, 8).brackets.includes(7));
  const missing = heroList.filter((h) => !idx.pos.has(h.id)).map((h) => h.name);
  assert.deepEqual(missing, []);
  assert.ok(raw.matches > 100000, 'enough matches');
  // Legend: every hero has games, and pairs are consistent both ways.
  const pa = H('phantom_assassin').id;
  const jug = H('juggernaut').id;
  const a = pairStats(idx, pa, jug, 5);
  const b = pairStats(idx, jug, pa, 5);
  assert.ok(a.games > 300);
  // Both sides come from separate queries over the same matches; OpenDota may add a few late matches in between.
  assert.ok(Math.abs(a.games - b.games) <= a.games * 0.01);
  assert.ok(Math.abs(a.wins - (b.games - b.wins)) <= a.games * 0.01);
});
