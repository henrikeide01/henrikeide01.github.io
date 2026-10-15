// Hero meta (tier list) from OpenDota /heroStats and draft suggestions from /heroes/{id}/matchups.
import { positionsFor } from '../../data/positions.js';
import { synergiesWith } from '../../data/synergy.js';

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

// ---------- Team composition ----------
const has = (h, role) => Array.isArray(h?.roles) && h.roles.includes(role);

// Rough damage profile from the OpenDota roles: nukers deal magic damage, carries physical.
function damageOf(h) {
  const nuke = has(h, 'Nuker');
  const carry = has(h, 'Carry');
  if (nuke && carry) return { magic: 0.5, phys: 0.5 };
  if (nuke) return { magic: 1, phys: 0 };
  if (carry) return { magic: 0, phys: 1 };
  return { magic: 0, phys: 0 };
}
const sumOf = (team, f) => team.reduce((s, h) => s + f(h), 0);

// What a team usually wants. `lacking(team)` looks at the allies picked so far, `fills(hero)` says whether a
// candidate covers it. `minAllies`: only judge once that many allies are known; `w`: bonus in percentage points
// (the same scale as the counter score); `roles`: only for players on these positions (0 = position not set).
const NEEDS = [
  { id: 'initiation', label: 'initiering', w: 2.5, minAllies: 2, lacking: (t) => !t.some((h) => has(h, 'Initiator')), fills: (h) => has(h, 'Initiator') },
  { id: 'disable', label: 'stuns', w: 1.5, minAllies: 2, lacking: (t) => t.filter((h) => has(h, 'Disabler')).length < Math.min(2, t.length), fills: (h) => has(h, 'Disabler') },
  { id: 'frontline', label: 'en frontlinje', w: 2, minAllies: 2, lacking: (t) => !t.some((h) => has(h, 'Durable')), fills: (h) => has(h, 'Durable') },
  {
    id: 'waveclear',
    label: 'waveclear',
    w: 1.5,
    minAllies: 3,
    lacking: (t) => !t.some((h) => has(h, 'Pusher')) && t.filter((h) => has(h, 'Nuker')).length < 2,
    fills: (h) => has(h, 'Pusher') || has(h, 'Nuker'),
  },
  { id: 'magic', label: 'magisk skade', w: 1.5, minAllies: 2, lacking: (t) => sumOf(t, (h) => damageOf(h).magic) < 0.5, fills: (h) => damageOf(h).magic >= 0.5 },
  { id: 'physical', label: 'fysisk skade', w: 1.5, minAllies: 3, lacking: (t) => sumOf(t, (h) => damageOf(h).phys) < 0.5, fills: (h) => damageOf(h).phys >= 0.5 },
  {
    id: 'carry',
    label: 'en lategame-carry',
    w: 2.5,
    minAllies: 3,
    // A support is not asked to carry, and a pos 1 picks a carry anyway.
    roles: [0, 2, 3],
    lacking: (t) => !t.some((h) => has(h, 'Carry') && positionsFor(h)[0] === 1),
    fills: (h) => has(h, 'Carry'),
  },
];

// The needs of a team with these allies (hero objects), for a player on `role` (0 = any).
export function teamNeeds(allies = [], role = 0) {
  const team = allies.filter(Boolean);
  return NEEDS.filter((n) => team.length >= n.minAllies && (!n.roles || n.roles.includes(Number(role) || 0)) && n.lacking(team)).map(({ id, label, w, fills }) => ({ id, label, w, fills }));
}

// Bonus for a candidate that covers what the team lacks. Grows with the number of allies known (a need seen
// with two allies is less certain than one seen with four).
export function compositionScore(hero, needs, allyCount) {
  const k = Math.min(1, allyCount / 3);
  const fills = needs.filter((n) => n.fills(hero));
  // Capped, so a hero that ticks every box does not drown out the counters.
  return { score: Math.min(5, fills.reduce((s, n) => s + n.w * k, 0)), fills };
}

// "Laget mangler initiering og stuns" (empty when nothing is missing).
export function needsText(needs = []) {
  const labels = needs.map((n) => n.label).filter(Boolean);
  return labels.length ? `Laget mangler ${joinNames(labels)}` : '';
}

// "A", "A og B", "A, B og C"
const joinNames = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} og ${list[list.length - 1]}` : list[0] || '');
const pct = (x) => `${(x * 100).toFixed(1).replace('.', ',')} %`;

// Pick suggestions: meta in the bracket + counters against the enemies + what the team lacks + known combos
// with the allies. Banned and picked heroes are left out.
export function suggestHeroes({ heroes, stats = new Map(), matchups = new Map(), allies = [], enemies = [], bans = [], role = 0, bracket = 5, limit = 12 }) {
  allies = allies.filter(Boolean);
  enemies = enemies.filter(Boolean);
  const taken = new Set([...allies, ...enemies, ...bans.filter(Boolean)].map((h) => h.name));
  const tiers = new Map(tierList(heroes, stats, { bracket, role }).map((t) => [t.name, t]));
  const needs = teamNeeds(allies, role);
  const allyNames = allies.map((h) => h.name);
  const allyDname = new Map(allies.map((h) => [h.name, h.dname]));

  const rows = [];
  for (const h of heroes) {
    if (taken.has(h.name)) continue;
    const fit = roleFit(h, role);
    if (fit <= 0) continue;
    const t = tiers.get(h.name);
    const metaPP = t ? (t.winrate !== null ? t.z * 1.5 : 0) : 0;
    const adv = counterAdvantages(h, enemies, matchups);
    const counterPP = adv.reduce((s, a) => s + a.adv, 0);
    const comp = compositionScore(h, needs, allies.length);
    const syn = synergiesWith(h.name, allyNames).map((s) => ({ ...s, dname: allyDname.get(s.ally) || s.ally }));
    const synergyPP = Math.min(6, syn.reduce((s, x) => s + x.bonus, 0));
    const score = metaPP + counterPP * 0.5 + (fit - 1) * 3 + comp.score + synergyPP;
    const good = adv.filter((a) => a.adv >= 1.5).sort((a, b) => b.adv - a.adv).slice(0, 3).map((a) => ({ name: a.enemy.name, dname: a.enemy.dname, adv: a.adv }));
    const bad = adv.filter((a) => a.adv <= -1.5).sort((a, b) => a.adv - b.adv).slice(0, 2).map((a) => ({ name: a.enemy.name, dname: a.enemy.dname, adv: a.adv }));

    // Short reasons, the most important first (the overlay shows one line of them).
    const reasons = [];
    if (good.length) reasons.push({ text: `Sterk mot ${joinNames(good.slice(0, 2).map((g) => g.dname))}`, kind: 'pos' });
    for (const s of syn.slice(0, 1)) reasons.push({ text: `Kombo med ${s.dname}: ${s.why}`, kind: 'pos' });
    if (comp.fills.length) reasons.push({ text: `Gir laget ${joinNames(comp.fills.map((n) => n.label))}`, kind: 'pos' });
    if (bad.length) reasons.push({ text: `Svak mot ${joinNames(bad.map((b) => b.dname))}`, kind: 'neg' });
    if (t && ['S', 'A'].includes(t.tier) && reasons.length < 2) reasons.push({ text: `${t.tier}-tier i meta`, kind: 'info' });

    rows.push({
      name: h.name,
      dname: h.dname,
      id: h.id,
      score,
      tier: t?.tier || '?',
      winrate: t?.winrate ?? null,
      meta: metaPP,
      counter: counterPP,
      comp: comp.score,
      synergy: syn.map((s) => ({ name: s.ally, dname: s.dname, why: s.why, bonus: s.bonus })),
      fills: comp.fills.map((n) => n.id),
      reasons: reasons.slice(0, 4),
      good,
      bad,
      positions: positionsFor(h),
    });
  }
  rows.sort((a, b) => b.score - a.score);
  const avoid = rows
    .filter((r) => r.counter <= -4 && (r.tier === 'S' || r.tier === 'A' || r.tier === 'B'))
    .sort((a, b) => a.counter - b.counter)
    .slice(0, 5);
  return { picks: rows.slice(0, limit), avoid, needs: needs.map(({ id, label }) => ({ id, label })) };
}

// The positions a player on `role` meets in lane (safe lane vs offlane, mid vs mid).
const LANE_OPPONENTS = { 1: [3, 4], 2: [2], 3: [1, 5], 4: [1, 5], 5: [3, 4] };

// Heroes worth banning: strong in the bracket and good against our team so far (the allies' and your own
// matchups, read the other way round). With nobody on our team yet: the strongest meta heroes you would
// meet in your lane, weighted a little by how often they are picked.
export function suggestBans({ heroes, stats = new Map(), matchups = new Map(), allies = [], ownHero = null, enemies = [], bans = [], role = 0, bracket = 5, limit = 5 }) {
  const team = [...allies, ownHero].filter(Boolean);
  const taken = new Set([...team, ...enemies, ...bans].filter(Boolean).map((h) => h.name));
  const tiers = tierList(heroes, stats, { bracket, role: 0 });
  if (!tiers.length) return [];
  const known = team.filter((h) => matchups.has(h.name));
  const opp = LANE_OPPONENTS[Number(role)] || [];
  const byName = new Map(heroes.map((h) => [h.name, h]));

  const rows = [];
  for (const t of tiers) {
    // Only heroes that are strong in the bracket are worth a ban (C/D tier counters are rarely picked anyway).
    if (taken.has(t.name) || t.tier === 'C' || t.tier === 'D') continue;
    const h = byName.get(t.name);
    if (!h) continue;
    let score = t.z * 1.2 + Math.min(1.5, t.pickrate * 4);
    const reasons = [];
    let threat = 0;
    if (known.length) {
      const adv = counterAdvantages(h, known, matchups);
      threat = adv.reduce((s, a) => s + a.adv, 0);
      score += threat * 0.6;
      const vs = adv.filter((a) => a.adv >= 1.5).sort((a, b) => b.adv - a.adv).slice(0, 2);
      if (vs.length) reasons.push(`Sterk mot ${joinNames(vs.map((a) => a.enemy.dname))}`);
    } else if (opp.length) {
      if (!t.positions.some((p) => opp.includes(p))) continue;
      if (opp.includes(t.positions[0])) score += 0.5;
      reasons.push('Møter deg ofte i lanen');
    }
    if (['S', 'A'].includes(t.tier)) reasons.unshift(`${t.tier}-tier${t.winrate != null ? ` (${pct(t.winrate)} seier)` : ''}`);
    if (!reasons.length) continue;
    rows.push({ name: t.name, dname: t.dname, id: t.id, tier: t.tier, winrate: t.winrate, threat, score, reasons });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------- Draft data from Game State Integration ----------
// Dota sends a "draft" block when spectating and in some modes (captains mode, …). Its usual shape:
//   { activeteam: 2, pick: true, activeteam_time_remaining: 25, radiant_bonus_time: 130, dire_bonus_time: 130,
//     team2: { home_team: true, pick0_id: 1, pick0_class: "antimage", ban0_id: 2, ban0_class: "axe", … },
//     team3: { … } }
// team2 = Radiant, team3 = Dire, an id of 0 (or -1) is an empty slot. The parser is tolerant: it also takes
// "radiant"/"dire" keys, "npc_dota_hero_" classes, ids as strings, slot objects, pick/ban arrays and the
// Steam "picks_bans" list, and ignores everything else.
const TEAM_KEYS = [
  ['team2', 'radiant'],
  ['team3', 'dire'],
  ['radiant', 'radiant'],
  ['dire', 'dire'],
];
const SIDE_OF = { 2: 'radiant', 3: 'dire', radiant: 'radiant', dire: 'dire', team2: 'radiant', team3: 'dire', goodguys: 'radiant', badguys: 'dire' };

// heroes: Map name -> hero, or an array of heroes. Returns null for anything that is not a draft block.
export function parseGsiDraft(block, heroes) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  const list = heroes instanceof Map ? [...heroes.values()] : Array.isArray(heroes) ? heroes : [];
  const byName = new Map(list.map((h) => [h.name, h]));
  const byId = new Map(list.map((h) => [Number(h.id), h]));

  const resolve = (id, cls) => {
    if (typeof cls === 'string' && cls) {
      const n = cls.trim().toLowerCase().replace(/^npc_dota_hero_/, '');
      if (byName.has(n)) return n;
    }
    if (typeof id === 'string' && id.trim() && !/^-?\d+$/.test(id.trim())) return resolve(null, id); // an id field holding a name
    const num = Number(id);
    if (Number.isInteger(num) && num > 0 && byId.has(num)) return byId.get(num).name;
    return null;
  };
  // An array entry may be an id, a name, or an object with them.
  const resolveAny = (v) => (v && typeof v === 'object' ? resolve(v.id ?? v.hero_id ?? v.heroid, v.class ?? v.name ?? v.hero) : resolve(v, null));

  const out = { radiant: [], dire: [], radiantBans: [], direBans: [], bans: [], activeTeam: null, isPick: null, timeLeft: null, count: 0 };
  const seen = new Set();
  const add = (arr, name) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    arr.push(name);
  };

  for (const [key, side] of TEAM_KEYS) {
    const t = block[key];
    if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
    const slots = new Map();
    for (const [k, v] of Object.entries(t)) {
      const m = /^(pick|ban)_?(\d{1,2})(?:_(id|class|hero_id|name))?$/i.exec(k);
      if (!m) continue;
      const kind = m[1].toLowerCase();
      const slotKey = `${kind}${Number(m[2])}`;
      const s = slots.get(slotKey) || { kind, idx: Number(m[2]), id: null, cls: null };
      const field = (m[3] || '').toLowerCase();
      if (v && typeof v === 'object') {
        s.id = v.id ?? v.hero_id ?? s.id;
        s.cls = v.class ?? v.name ?? s.cls;
      } else if (field === 'class' || field === 'name') s.cls = v;
      else s.id = v;
      slots.set(slotKey, s);
    }
    const sorted = [...slots.values()].sort((a, b) => (a.kind === b.kind ? a.idx - b.idx : a.kind === 'pick' ? -1 : 1));
    for (const s of sorted) add(s.kind === 'pick' ? out[side] : out[`${side}Bans`], resolve(s.id, s.cls));
    for (const v of Array.isArray(t.picks) ? t.picks : []) add(out[side], resolveAny(v));
    for (const v of Array.isArray(t.bans) ? t.bans : []) add(out[`${side}Bans`], resolveAny(v));
  }
  // The Steam / OpenDota shape: picks_bans: [{ is_pick, hero_id, team: 0 | 1 }].
  for (const pb of Array.isArray(block.picks_bans) ? block.picks_bans : []) {
    if (!pb || typeof pb !== 'object') continue;
    const side = pb.team === 1 || pb.team === 3 || pb.team === 'dire' ? 'dire' : 'radiant';
    add(pb.is_pick === false ? out[`${side}Bans`] : out[side], resolveAny(pb));
  }

  out.radiant = out.radiant.slice(0, 5);
  out.dire = out.dire.slice(0, 5);
  out.bans = [...out.radiantBans, ...out.direBans];
  const active = block.activeteam ?? block.active_team;
  out.activeTeam = SIDE_OF[typeof active === 'string' ? active.toLowerCase() : Number(active)] || null;
  if (typeof block.pick === 'boolean') out.isPick = block.pick;
  else if (block.pick === 1 || block.pick === 0) out.isPick = !!block.pick;
  const left = Number(block.activeteam_time_remaining);
  if (block.activeteam_time_remaining != null && Number.isFinite(left) && left >= 0) out.timeLeft = left;
  out.count = out.radiant.length + out.dire.length + out.bans.length;
  return out;
}

// A compact copy of a raw GSI draft block for /api/diagnostics: empty slots dropped, size capped.
export function compactDraftSample(block) {
  if (!block || typeof block !== 'object') return block ?? null;
  const empty = (v) => v === 0 || v === -1 || v === '' || v === '0' || v === null;
  const strip = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 3) return o;
    if (Array.isArray(o)) return o.slice(0, 30).map((v) => strip(v, depth + 1));
    const r = {};
    for (const [k, v] of Object.entries(o).slice(0, 80)) {
      if (/^(pick|ban)/i.test(k) && empty(v)) continue;
      r[k] = strip(v, depth + 1);
    }
    return r;
  };
  const out = strip(block, 0);
  const json = JSON.stringify(out);
  return json.length > 4000 ? { truncated: true, json: json.slice(0, 4000) } : out;
}
