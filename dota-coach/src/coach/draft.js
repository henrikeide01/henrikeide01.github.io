// Hero meta (tier list) from OpenDota /heroStats and draft suggestions from /heroes/{id}/matchups.
import { positionsFor } from '../../data/positions.js';

export const BRACKETS = { 1: 'Herald', 2: 'Guardian', 3: 'Crusader', 4: 'Archon', 5: 'Legend', 6: 'Ancient', 7: 'Divine', 8: 'Immortal' };

// Winrate in the chosen bracket, shrunk towards 50 % when the sample is small.
function bracketStats(stat, bracket) {
  const picks = Number(stat?.[`${bracket}_pick`]) || 0;
  const wins = Number(stat?.[`${bracket}_win`]) || 0;
  const k = 200;
  return { picks, wins, wr: (wins + 0.5 * k) / (picks + k), rawWr: picks ? wins / picks : null };
}

function roleFit(hero, role) {
  if (!role) return 1;
  const idx = positionsFor(hero).indexOf(Number(role));
  return idx === -1 ? 0 : [1, 0.85, 0.7, 0.6, 0.5][idx];
}

const TIERS = [
  [1.1, 'S'],
  [0.4, 'A'],
  [-0.4, 'B'],
  [-1.1, 'C'],
  [-Infinity, 'D'],
];

// heroes: [{id,name,dname,roles,...}], stats: Map name -> heroStats entry
export function tierList(heroes, stats, { bracket = 5, role = 0 } = {}) {
  const rows = heroes
    .filter((h) => roleFit(h, role) > 0)
    .map((h) => {
      const b = bracketStats(stats.get(h.name), bracket);
      return { hero: h, ...b };
    })
    .filter((r) => r.picks > 0);
  if (!rows.length) return [];

  const totalPicks = rows.reduce((s, r) => s + r.picks, 0);
  const allPicks = [...stats.values()].reduce((s, st) => s + (Number(st[`${bracket}_pick`]) || 0), 0) || totalPicks;
  const mean = rows.reduce((s, r) => s + r.wr, 0) / rows.length;
  const sd = Math.sqrt(rows.reduce((s, r) => s + (r.wr - mean) ** 2, 0) / rows.length) || 0.01;

  return rows
    .map((r) => {
      const z = (r.wr - mean) / sd;
      return {
        name: r.hero.name,
        dname: r.hero.dname,
        id: r.hero.id,
        winrate: r.rawWr,
        pickrate: (r.picks / allPicks) * 10, // share of matches the hero appears in
        picks: r.picks,
        z,
        tier: TIERS.find(([min]) => z >= min)[1],
        positions: positionsFor(r.hero),
      };
    })
    .sort((a, b) => b.z - a.z);
}

// matchups: Map enemyName -> [{hero_id, games_played, wins}] (wins are the enemy's wins vs hero_id)
// Returns the advantage (percentage points) `candidate` has against each enemy.
export function counterAdvantages(candidate, enemies, matchups) {
  const out = [];
  for (const e of enemies) {
    const rows = matchups.get(e.name);
    if (!rows) continue;
    const row = rows.find((r) => r.hero_id === candidate.id);
    if (!row || !row.games_played) continue;
    const g = row.games_played;
    const candWins = g - row.wins;
    const k = 40;
    const adv = ((candWins + 0.5 * k) / (g + k) - 0.5) * 100;
    out.push({ enemy: e, adv, games: g });
  }
  return out;
}

export function suggestHeroes({ heroes, stats, matchups, allies = [], enemies = [], bans = [], role = 0, bracket = 5, limit = 12 }) {
  const taken = new Set([...allies, ...enemies, ...bans].map((h) => h.name));
  const tiers = new Map(tierList(heroes, stats, { bracket, role }).map((t) => [t.name, t]));

  const rows = [];
  for (const h of heroes) {
    if (taken.has(h.name)) continue;
    const fit = roleFit(h, role);
    if (fit <= 0) continue;
    const t = tiers.get(h.name);
    const metaPP = t ? (t.winrate !== null ? t.z * 1.5 : 0) : 0;
    const adv = counterAdvantages(h, enemies, matchups);
    const counterPP = adv.reduce((s, a) => s + a.adv, 0);
    const score = metaPP + counterPP * 0.5 + (fit - 1) * 3;
    rows.push({
      name: h.name,
      dname: h.dname,
      id: h.id,
      score,
      tier: t?.tier || '?',
      winrate: t?.winrate ?? null,
      counter: counterPP,
      good: adv.filter((a) => a.adv >= 1.5).sort((a, b) => b.adv - a.adv).slice(0, 3).map((a) => ({ name: a.enemy.name, dname: a.enemy.dname, adv: a.adv })),
      bad: adv.filter((a) => a.adv <= -1.5).sort((a, b) => a.adv - b.adv).slice(0, 2).map((a) => ({ name: a.enemy.name, dname: a.enemy.dname, adv: a.adv })),
      positions: positionsFor(h),
    });
  }
  rows.sort((a, b) => b.score - a.score);
  const avoid = rows
    .filter((r) => r.counter <= -4 && (r.tier === 'S' || r.tier === 'A' || r.tier === 'B'))
    .sort((a, b) => a.counter - b.counter)
    .slice(0, 5);
  return { picks: rows.slice(0, limit), avoid };
}
