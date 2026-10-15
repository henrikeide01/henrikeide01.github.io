// Live route planner: where should the player go next, and which way?
// Pure logic on top of the schematic map in data/map.js (zone level, approximate positions).
//
// planRoute(c, mem) looks at role, phase, clock, position and the fight meter, builds a list of candidate stops
// (lane waves, own jungle areas, stacks, runes, wisdom shrine, objectives, retreat), scores them as
// "value minus travel time", and keeps the current target with hysteresis so the arrow on the minimap does not
// flip on every GSI update. The path is the cheapest way over a small graph of lane/river/jungle points where
// the enemy half of the map costs more unless the team is pressing.
import { LANES, LANE_MEET, RIVER, TOWERS, JUNGLE, RUNES, TORMENTORS, ROSHAN, FOUNTAINS, ANCIENTS, OUTPOSTS, CREEP_SPEED, WAVE_EVERY, HERO_SPEED } from '../../data/map.js';
import { nextOccurrence, fmtClock } from './timers.js';
import { safeLane, offLane } from './map.js';

const REACH = 700; // close enough to count as "there"
const SWITCH_MARGIN = 30; // a new target must be this much better (value in seconds) to replace the current one
const LINK = 2600; // nav graph: points closer than this are connected
const TIMED = new Set(['stack', 'power', 'water', 'bounty', 'wisdom', 'lotus']);
const PERSISTENT = new Set(['lane', 'retreat', 'vision', 'tower', 'tormentor', 'roshan']);
const LANE_NAME = { top: 'top lane', mid: 'mid', bot: 'bot lane' };
const AREA_NAME = {
  safe: ['egen safe-jungel', 'fiendens safe-jungel'],
  ancients: ['egne ancient-leirer', 'fiendens ancient-leirer'],
  triangle: ['egen offlane-jungel (triangelen)', 'fiendens offlane-jungel (triangelen)'],
};
const DANGER = { retreat: 2, farm: 1.4, neutral: 0.9, press: 0.35, fight: 0.15 };

// ---------------- Geometry ----------------
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const enemyTeam = (team) => (team === 'dire' ? 'radiant' : 'dire');
// > 0 means on the enemy half, in world units away from the river.
export const enemyDepth = (p, team) => ((p[0] + p[1]) / Math.SQRT2) * (team === 'dire' ? -1 : 1);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function lineLength(line) {
  let len = 0;
  for (let i = 1; i < line.length; i++) len += dist(line[i - 1], line[i]);
  return len;
}

function pointAt(line, s) {
  let left = Math.max(0, s);
  for (let i = 1; i < line.length; i++) {
    const seg = dist(line[i - 1], line[i]);
    if (left <= seg || i === line.length - 1) {
      const f = seg ? Math.min(1, left / seg) : 0;
      return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * f, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * f];
    }
    left -= seg;
  }
  return line[line.length - 1];
}

// Closest point on a polyline: { s (distance along the line), d (distance from it), p }.
function project(line, p) {
  let best = { s: 0, d: Infinity, p: line[0] };
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
    const q = [a[0] + vx * t, a[1] + vy * t];
    const d = dist(p, q);
    if (d < best.d) best = { s: acc + Math.sqrt(len2) * t, d, p: q };
    acc += Math.sqrt(len2);
  }
  return best;
}

const LANE_LEN = Object.fromEntries(Object.entries(LANES).map(([k, l]) => [k, lineLength(l)]));

export function laneOf(p) {
  let best = null;
  for (const [lane, line] of Object.entries(LANES)) {
    const pr = project(line, p);
    if (!best || pr.d < best.d) best = { lane, ...pr };
  }
  return best;
}

// ---------------- Navigation graph ----------------
// Lane and river points every ~1200 units plus every point of interest. No walls or cliffs: this is a schematic
// that keeps paths on lanes, river and jungle areas, which is what a coach would draw anyway.
const NODES = (() => {
  const pts = [];
  const sample = (line) => {
    const len = lineLength(line);
    const n = Math.max(1, Math.round(len / 1200));
    for (let i = 0; i <= n; i++) pts.push(pointAt(line, (len * i) / n));
  };
  for (const line of Object.values(LANES)) sample(line);
  sample(RIVER.line);
  for (const a of JUNGLE) {
    pts.push(a.pos);
    if (a.pull) pts.push(a.pull);
  }
  for (const r of RUNES) pts.push(r.pos);
  for (const o of [...OUTPOSTS, ...TORMENTORS]) pts.push(o.pos);
  pts.push(ROSHAN.pits.top, ROSHAN.pits.bot, FOUNTAINS.radiant, FOUNTAINS.dire, ANCIENTS.radiant, ANCIENTS.dire);
  const out = [];
  for (const p of pts) if (!out.some((q) => dist(p, q) < 300)) out.push([Math.round(p[0]), Math.round(p[1])]);
  return out;
})();
const EDGES = NODES.map((a, i) =>
  NODES.map((b, j) => (i !== j && dist(a, b) <= LINK ? j : -1)).filter((j) => j >= 0),
);

function edgeCost(a, b, team, w) {
  const len = dist(a, b);
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const depth = enemyDepth(mid, team);
  let f = 1 + w * Math.max(0, Math.min(2, depth / 3000));
  if (depth > 6500) f += 3 * w; // enemy base
  return len * f;
}

// Single-source shortest paths from `src` over the nav graph (cost = distance weighted by danger).
function shortestFrom(src, team, w) {
  const n = NODES.length;
  const cost = new Array(n).fill(Infinity);
  const len = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const done = new Array(n).fill(false);
  const near = NODES.map((p, i) => [i, dist(src, p)]).sort((a, b) => a[1] - b[1]);
  for (const [i, d] of near.filter(([, d], k) => d <= LINK || k < 3)) {
    cost[i] = edgeCost(src, NODES[i], team, w);
    len[i] = d;
  }
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && cost[i] < Infinity && (u < 0 || cost[i] < cost[u])) u = i;
    if (u < 0) break;
    done[u] = true;
    for (const v of EDGES[u]) {
      const c = cost[u] + edgeCost(NODES[u], NODES[v], team, w);
      if (c < cost[v]) {
        cost[v] = c;
        len[v] = len[u] + dist(NODES[u], NODES[v]);
        prev[v] = u;
      }
    }
  }
  return { src, team, w, cost, len, prev };
}

// Cost, length and path from the search source to an arbitrary point.
function routeTo(sp, target) {
  let best = null;
  const direct = dist(sp.src, target);
  if (direct <= LINK) best = { cost: edgeCost(sp.src, target, sp.team, sp.w), len: direct, via: -1 };
  const near = NODES.map((p, i) => [i, dist(target, p)]).sort((a, b) => a[1] - b[1]);
  for (const [i, d] of near.filter(([, d], k) => d <= LINK || k < 3)) {
    if (sp.cost[i] === Infinity) continue;
    const c = sp.cost[i] + edgeCost(NODES[i], target, sp.team, sp.w);
    if (!best || c < best.cost) best = { cost: c, len: sp.len[i] + d, via: i };
  }
  if (!best) return { cost: direct * 3, len: direct, path: [sp.src, target] };
  const path = [target];
  for (let i = best.via; i >= 0; i = sp.prev[i]) path.push(NODES[i]);
  path.push(sp.src);
  path.reverse();
  return { cost: best.cost, len: best.len, path: simplify(path) };
}

// Drops points that barely change direction, so the arrow on the minimap stays clean.
function simplify(path) {
  if (path.length <= 2) return path;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1];
    const b = path[i];
    const c = path[i + 1];
    const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let turn = Math.abs(a1 - a2);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > 0.2 && dist(a, b) > 250) out.push(b);
  }
  out.push(path[path.length - 1]);
  return out;
}

// ---------------- Buildings and waves ----------------
// true/false when GSI tells us, null when we have no data for that team (player-mode GSI often only sends your own).
function towerAlive(buildings, name) {
  const t = TOWERS[name];
  const block = buildings?.[t.team];
  if (!block || typeof block !== 'object') return null;
  const b = block[name];
  return !!b && !(typeof b.health === 'number' && b.health <= 0);
}

export function deadTowers(buildings) {
  const out = [];
  for (const name of Object.keys(TOWERS)) if (towerAlive(buildings, name) === false) out.push(name);
  return out;
}

const laneTowers = (team, lane) =>
  Object.entries(TOWERS)
    .filter(([, t]) => t.team === team && t.lane === lane)
    .sort((a, b) => a[1].tier - b[1].tier);

// The outermost standing tower of `team` in `lane` (s = distance along the lane from the Radiant end).
function outermost(buildings, team, lane, clock) {
  const list = laneTowers(team, lane);
  const known = towerAlive(buildings, list[0][0]) !== null;
  // Without data for that team (usually the enemy), guess from the clock how far the towers have fallen.
  const guessTier = clock < 1200 ? 1 : clock < 1800 ? 2 : 3;
  const alive = list.find(([name, t]) => (known ? towerAlive(buildings, name) : t.tier >= guessTier));
  if (!alive) return { s: team === 'radiant' ? 0 : LANE_LEN[lane], name: null, tier: 4, known };
  return { s: project(LANES[lane], alive[1].pos).s, name: alive[0], tier: alive[1].tier, pos: alive[1].pos, known };
}

// Where our waves meet the enemy waves in each lane, when the next one arrives there, and where the next wave
// is right now. Player-mode GSI has no creep positions, so this is an estimate from the clock (waves leave every
// 30 s and walk at creep speed) unless the `minimap` block gave us real creep positions.
export function estimateWaves(clock, team, buildings, seen = {}) {
  const out = [];
  for (const lane of Object.keys(LANES)) {
    const line = LANES[lane];
    const len = LANE_LEN[lane];
    const own = outermost(buildings, team, lane, clock);
    const enemy = outermost(buildings, enemyTeam(team), lane, clock);
    const radiantS = team === 'radiant' ? own.s : enemy.s;
    const direS = team === 'radiant' ? enemy.s : own.s;
    let s = project(line, LANE_MEET[lane]).s;
    if (own.tier > 1 || enemy.tier > 1) s = (radiantS + direS) / 2;
    s = Math.max(Math.min(radiantS, direS) + 500, Math.min(Math.max(radiantS, direS) - 500, s));
    const startS = team === 'radiant' ? 0 : len;
    const travel = Math.abs(s - startS) / CREEP_SPEED;
    // The next wave to reach the meeting point left at t0 (multiples of 30 s from 0:00).
    const t0 = Math.max(0, Math.ceil((clock - travel) / WAVE_EVERY) * WAVE_EVERY);
    const walked = Math.max(0, clock - t0) * CREEP_SPEED;
    const incomingS = team === 'radiant' ? Math.min(s, startS + walked) : Math.max(s, startS - walked);
    let meet = pointAt(line, s);
    let source = 'estimate';
    const live = seen[lane];
    if (live && clock - live.at <= 3) {
      meet = [live.x, live.y];
      source = 'minimap';
    }
    const inc = pointAt(line, incomingS);
    out.push({
      lane,
      x: Math.round(meet[0]),
      y: Math.round(meet[1]),
      nx: Math.round(inc[0]),
      ny: Math.round(inc[1]),
      arrivesIn: Math.max(0, Math.round(t0 + travel - clock)),
      source,
    });
  }
  return out;
}

// ---------------- GSI minimap block ----------------
// Valve documents nothing about it; parse whatever shape arrives and never throw.
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const teamNum = (team) => (team === 'dire' ? 3 : 2);

export function parseMinimap(block, team) {
  const out = { count: 0, keys: [], sample: [], laneCreeps: [], neutrals: [] };
  if (!block || typeof block !== 'object') return out;
  let entries;
  try {
    entries = Array.isArray(block) ? block : Object.values(block);
    out.keys = Object.keys(block).slice(0, 5);
  } catch {
    return out;
  }
  out.count = entries.length;
  for (const e of entries) {
    if (out.sample.length < 5) out.sample.push(compactEntry(e));
    if (!e || typeof e !== 'object') continue;
    const x = Number(e.xpos ?? e.x);
    const y = Number(e.ypos ?? e.y);
    if (!finite(x) || !finite(y) || Math.abs(x) > 9500 || Math.abs(y) > 9500) continue;
    const name = `${typeof e.unitname === 'string' ? e.unitname : ''} ${typeof e.image === 'string' ? e.image : ''} ${typeof e.name === 'string' ? e.name : ''}`.toLowerCase();
    const t = Number(e.team);
    if (/neutral/.test(name) || t === 4) out.neutrals.push({ x, y });
    else if (/creep/.test(name) && !/hero|courier|ward/.test(name)) {
      const ours = finite(t) ? t === teamNum(team) : team === 'dire' ? /badguys/.test(name) : /goodguys/.test(name);
      if (ours) out.laneCreeps.push({ x, y });
    }
  }
  return out;
}

function compactEntry(e) {
  if (!e || typeof e !== 'object') return String(e).slice(0, 80);
  const o = {};
  for (const [k, v] of Object.entries(e).slice(0, 12)) {
    if (v === null || ['number', 'boolean'].includes(typeof v)) o[k] = v;
    else if (typeof v === 'string') o[k] = v.slice(0, 80);
    else o[k] = Array.isArray(v) ? '[array]' : '[object]';
  }
  return o;
}

// ---------------- Planner memory ----------------
export function newMemory() {
  return {
    current: null, // { id, kind, since }
    changedAt: null,
    changeWhy: 'start',
    visited: {}, // id -> clock (camps and waves already taken)
    done: {}, // `${id}@${eventAt}` -> clock (runes and stacks already done)
    lastClock: null,
    learned: [], // neutral creep spots seen on the minimap { x, y, n }
    seenWaves: {}, // lane -> { x, y, at } front of our creeps seen on the minimap
    minimap: null, // diagnostics: { at, count, sample, laneCreeps, neutrals }
  };
}

function learnFromMinimap(mem, parsed, team, clock) {
  mem.minimap = { clock, count: parsed.count, keys: parsed.keys, sample: parsed.sample, laneCreeps: parsed.laneCreeps.length, neutrals: parsed.neutrals.length, learnedCamps: mem.learned.length };
  for (const p of parsed.neutrals) {
    const hit = mem.learned.find((q) => dist([q.x, q.y], [p.x, p.y]) < 450);
    if (hit) {
      hit.x = Math.round((hit.x * hit.n + p.x) / (hit.n + 1));
      hit.y = Math.round((hit.y * hit.n + p.y) / (hit.n + 1));
      hit.n = Math.min(hit.n + 1, 50);
    } else if (mem.learned.length < 60) mem.learned.push({ x: Math.round(p.x), y: Math.round(p.y), n: 1 });
  }
  const fronts = {};
  for (const p of parsed.laneCreeps) {
    const l = laneOf([p.x, p.y]);
    if (!l || l.d > 1200) continue;
    const ahead = team === 'radiant' ? l.s : -l.s;
    if (!fronts[l.lane] || ahead > fronts[l.lane].ahead) fronts[l.lane] = { ahead, x: Math.round(p.x), y: Math.round(p.y) };
  }
  for (const [lane, f] of Object.entries(fronts)) mem.seenWaves[lane] = { x: f.x, y: f.y, at: clock };
  mem.minimap.learnedCamps = mem.learned.length;
}

// ---------------- Candidates ----------------
const roleLane = (role, team) => (role === 1 || role === 5 ? safeLane(team) : role === 2 ? 'mid' : offLane(team));

function areaPos(area, mem, from) {
  // A camp position learned from the minimap beats the schematic centre of the area.
  const learned = mem.learned.filter((q) => q.n >= 2 && dist([q.x, q.y], area.pos) <= area.r * 1.2);
  if (!learned.length) return area.pos;
  learned.sort((a, b) => dist([a.x, a.y], from) - dist([b.x, b.y], from));
  return [learned[0].x, learned[0].y];
}

function candidates(x, mem) {
  const { clock, role, team, level, T, pos } = x;
  const out = [];
  const add = (c) => out.push(c);
  const core = role <= 3;
  const support = role >= 4;
  const laning = clock < 600;
  const early = x.phase === 'strategy' || x.phase === 'pregame' || clock < 0;
  const myLane = roleLane(role, team);
  const ownAreas = JUNGLE.filter((a) => a.team === team);
  const doneKey = (id, at) => `${id}@${at}`;
  const isDone = (id, at) => mem.done[doneKey(id, at)] !== undefined;
  const pressing = level === 'press' || level === 'fight';

  // Retreat beats everything while it lasts.
  const hp = x.hpPct;
  const inOwnBase = enemyDepth(pos, team) < -6500;
  // Low HP starts a retreat at 25 % and keeps it until 45 %, so the target does not flip around one value.
  const lowHp = typeof hp === 'number' && (hp <= 25 || (mem.current?.kind === 'retreat' && hp < 45));
  if (!early && (level === 'retreat' || lowHp) && !inOwnBase) {
    const depth = enemyDepth(pos, team);
    const behind = Object.entries(TOWERS)
      .filter(([name, t]) => t.team === team && towerAlive(x.buildings, name) !== false && enemyDepth(t.pos, team) < depth - 400)
      .sort((a, b) => dist(a[1].pos, pos) - dist(b[1].pos, pos))[0];
    const toFountain = !behind || (typeof hp === 'number' && hp <= 20);
    add({
      id: toFountain ? 'retreat:fountain' : `retreat:${behind[0]}`,
      kind: 'retreat',
      label: toFountain ? 'Tilbake til fontenen' : `Trekk deg til T${behind[1].tier}-tårnet (${LANE_NAME[behind[1].lane] || 'basen'})`,
      pos: toFountain ? FOUNTAINS[team] : behind[1].pos,
      value: 400,
      why: level === 'retreat' ? 'Fight-meteret sier trekk deg: kom deg i sikkerhet bak egne tårn før du farmer igjen.' : 'Lav HP: trekk deg tilbake og heal før du går videre.',
    });
  }

  const waves = x.waves;
  const wave = (lane) => waves.find((w) => w.lane === lane);

  // Stay in lane in the laning phase (and walk there before the horn).
  if (early || laning) {
    const w = wave(myLane);
    const why = {
      1: 'Last hits og denies. Ta en leir i safe-jungelen bare når bølgen er pushet.',
      2: 'Vinn mid på last hits, og vær ved runen når den spawner.',
      3: 'Press fiendens carry og få nivåer. Trekk leiren hvis bølgen presses mot tårnet ditt.',
      4: 'Harass i lanen. Stack, ta runer og roter når det er mulig.',
      5: 'Hold carryen i live. Pull og stack når lanen presses mot carryen.',
    }[role];
    add({ id: `lane:${myLane}`, kind: 'lane', label: `Bli i ${LANE_NAME[myLane]}`, pos: [w.x, w.y], value: core ? 60 : 50, why });
  }

  // Timed events (only when the player can make it, and until shortly after).
  const timed = (c, at, lead, after) => {
    if (isDone(c.id, at)) return;
    c.at = at;
    c.lead = lead;
    c.after = after;
    c.timed = true;
    add(c);
  };
  if (!early) {
    // Stacks: be at the camp by :50, pull at :53.
    if (support && clock >= 100 && clock < 2400 && level !== 'retreat') {
      const minute = Math.floor((clock + 5) / 60) * 60;
      const at = minute + (T.stackSecond ?? 53);
      for (const a of ownAreas) {
        timed(
          { id: `stack:${a.id}`, kind: 'stack', label: `Stack i ${AREA_NAME[a.kind][0]}`, pos: areaPos(a, mem, pos), value: 170 + (role === 5 && a.kind === 'safe' ? 12 : role === 4 && a.kind === 'triangle' ? 12 : 0), why: `Vær ved leiren innen ${fmtClock(at - 3)} og trekk den ved ${fmtClock(at)}.`, area: a.id },
          at,
          12,
          2,
        );
      }
    }
    // Power and water runes (mid; pos 4 helps in the laning phase).
    if ((role === 2 && clock < 1800) || (role === 4 && laning)) {
      const water = T.waterRunes.find((t) => t + 15 >= clock && t < T.powerRune.first);
      const at = water ?? nextOccurrence(Math.max(clock - 15, 0), T.powerRune.first, T.powerRune.every);
      const kind = water !== undefined ? 'water' : 'power';
      for (const r of RUNES.filter((q) => q.kind === 'power')) {
        timed(
          {
            id: `${kind}:${r.id}`,
            kind,
            label: `${kind === 'water' ? 'Water' : 'Power'} rune (${r.id.endsWith('top') ? 'topp' : 'bunn'})`,
            pos: r.pos,
            value: role === 2 ? 200 : 120,
            why: kind === 'water' ? `Water rune ${fmtClock(at)} fyller på HP og mana.` : `Power rune ${fmtClock(at)}. Den kommer på én av de to spottene i elva: start med den nærmeste og bruk den til en gank.`,
          },
          at,
          15,
          15,
        );
      }
    }
    // Bounty runes for supports.
    if (support) {
      const at = nextOccurrence(Math.max(clock - 20, 0), T.bountyRune.first, T.bountyRune.every);
      for (const r of RUNES.filter((q) => q.kind === 'bounty' && q.side === team)) {
        timed({ id: `bounty:${r.id}`, kind: 'bounty', label: 'Bounty rune', pos: r.pos, value: (laning ? 160 : 120) + (laneOf(r.pos).lane === myLane ? 10 : 0), why: `Bounty runes spawner ${fmtClock(at)}. Ta den på din side, så får hele laget gull.` }, at, 12, 20);
      }
    }
    // Wisdom shrine for offlaners and supports.
    if (role >= 3) {
      const at = nextOccurrence(Math.max(clock - 20, 0), T.wisdomShrine.first, T.wisdomShrine.every);
      for (const r of RUNES.filter((q) => q.kind === 'wisdom' && q.side === team)) {
        timed({ id: `wisdom:${r.id}`, kind: 'wisdom', label: 'Wisdom shrine', pos: r.pos, value: 190, why: `Wisdom shrinen gir mye XP ${fmtClock(at)}. Ikke la fienden ta den.` }, at, 15, 20);
      }
    }
    // Lotus pools: only when close by.
    if (support && clock < 2100) {
      const at = nextOccurrence(Math.max(clock - 10, 0), T.lotus.first, T.lotus.every);
      for (const r of RUNES.filter((q) => q.kind === 'lotus')) {
        timed({ id: `lotus:${r.id}`, kind: 'lotus', label: 'Lotus pool', pos: r.pos, value: 80, why: `Lotus poolen gir en Healing Lotus ${fmtClock(at)}.`, maxEta: 25 }, at, 5, 10);
      }
    }
  } else if (support && clock < 0) {
    // Before the horn: supports stand at their bounty rune.
    for (const r of RUNES.filter((q) => q.kind === 'bounty' && q.side === team)) {
      add({ id: `bounty:${r.id}`, kind: 'bounty', label: 'Bounty rune', pos: r.pos, value: 120 + (laneOf(r.pos).lane === myLane ? 15 : 0), at: 0, timed: true, why: 'Bounty runes spawner ved 0:00. Stå klar ved runen på din side.' });
    }
  }

  // Farm loop after the laning phase: waves, then own jungle, then the next wave.
  if (!early && !laning) {
    const farmW = support ? -25 : 0;
    for (const w of waves) {
      const p = [w.x, w.y];
      const depth = enemyDepth(p, team);
      let value = 75 + (w.lane === myLane ? 12 : 0) + farmW;
      if (!pressing && depth > 800) value -= (depth - 800) / 30;
      if (mem.visited[`wave:${w.lane}`] !== undefined && clock - mem.visited[`wave:${w.lane}`] < 25) continue;
      add({ id: `wave:${w.lane}`, kind: 'wave', label: `Bølgen i ${LANE_NAME[w.lane]}`, pos: p, value, why: `Neste bølge når dit om ca. ${w.arrivesIn} s (estimat fra klokka).`, lane: w.lane });
    }
    for (const a of JUNGLE) {
      const own = a.team === team;
      const p = own ? areaPos(a, mem, pos) : a.pos;
      const depth = enemyDepth(p, team);
      let value = (own ? 65 : 55) + farmW;
      if (!own) value -= Math.max(0, depth) / (pressing ? 120 : 30);
      const v = mem.visited[`camp:${a.id}`];
      if (v !== undefined && Math.floor(clock / 60) <= Math.floor(v / 60)) continue; // camps respawn on the minute
      add({ id: `camp:${a.id}`, kind: 'camp', label: cap(AREA_NAME[a.kind][own ? 0 : 1]), pos: p, value, why: own ? 'Leirene i egen jungel er trygg farm mellom bølgene.' : 'Fiendens jungel: bare med vision og når fiendene er synlige andre steder.' });
    }
  }

  // Objectives when the team is strong.
  if (!early && !laning && pressing) {
    const bonus = level === 'fight' ? 25 : 0;
    for (const lane of Object.keys(LANES)) {
      const t = outermost(x.buildings, enemyTeam(team), lane, clock);
      if (!t.name) continue;
      add({ id: `tower:${t.name}`, kind: 'tower', label: `Press T${t.tier} i ${LANE_NAME[lane]}`, pos: t.pos, value: 130 + bonus, why: `Laget er sterkt nå: press bølgen inn og ta fiendens T${t.tier}-tårn i ${LANE_NAME[lane]}${t.known ? '' : ' (hvis det fortsatt står)'}.` });
    }
    if (clock >= T.tormentor.first) {
      for (const tm of TORMENTORS) add({ id: `tormentor:${tm.id}`, kind: 'tormentor', label: tm.label, pos: tm.pos, value: 115 + bonus, why: "Ta Tormentor med 2–3 helter. Den gir Aghanim's Shard." });
    }
    const roshUp = x.roshanKilledAt == null ? clock >= 900 : clock >= x.roshanKilledAt + T.roshan.min;
    if (roshUp && (level === 'fight' || clock >= 1500)) {
      const pit = x.daytime === false ? ROSHAN.night : ROSHAN.day;
      add({ id: `roshan:${pit}`, kind: 'roshan', label: `Roshan (${pit === 'top' ? 'topp' : 'bunn'}-pit)`, pos: ROSHAN.pits[pit], value: 150 + bonus, why: x.roshanKilledAt == null ? 'Roshan er oppe. Ward rundt pit-en og ta ham med laget.' : 'Roshan-vinduet er åpent: han kan være oppe. Sjekk pit-en med laget.' });
    }
  }

  // Supports between their jobs: vision toward the next objective.
  if (!early && !laning && support) {
    const pit = ROSHAN.pits[x.daytime === false ? ROSHAN.night : ROSHAN.day];
    const toward = FOUNTAINS[team];
    const d = dist(pit, toward) || 1;
    const p = [pit[0] + ((toward[0] - pit[0]) / d) * 900, pit[1] + ((toward[1] - pit[1]) / d) * 900];
    add({ id: 'vision:roshan', kind: 'vision', label: 'Vision ved Roshan-pit-en', pos: p, value: 55, why: 'Plasser observer og sentry rundt elva og Roshan før neste objektiv.' });
  }

  return out;
}

// Next timing events for this role (used for the "after that" steps).
function upcoming(x) {
  const { clock, role, team, T } = x;
  const out = [];
  if (x.phase !== 'laning' && x.phase !== 'mid' && x.phase !== 'late') return out;
  if (role >= 4 && clock < 2400) {
    const at = nextOccurrence(clock + 1, T.stackSecond ?? 53, 60);
    const a = JUNGLE.filter((q) => q.team === team).sort((p, q) => dist(p.pos, x.pos) - dist(q.pos, x.pos))[0];
    out.push({ id: `stack:${a.id}`, kind: 'stack', label: `Stack i ${AREA_NAME[a.kind][0]}`, pos: a.pos, at, value: 150, why: `Trekk leiren ved ${fmtClock(at)}.` });
  }
  if (role === 2 && clock < 1800) {
    const at = nextOccurrence(clock + 1, T.powerRune.first, T.powerRune.every);
    const r = RUNES.filter((q) => q.kind === 'power').sort((p, q) => dist(p.pos, x.pos) - dist(q.pos, x.pos))[0];
    out.push({ id: `power:${r.id}`, kind: 'power', label: 'Power rune', pos: r.pos, at, value: 170, why: `Power rune ${fmtClock(at)}.` });
  }
  if (role >= 4) {
    const at = nextOccurrence(clock + 1, T.bountyRune.first, T.bountyRune.every);
    const r = RUNES.filter((q) => q.kind === 'bounty' && q.side === team).sort((p, q) => dist(p.pos, x.pos) - dist(q.pos, x.pos))[0];
    out.push({ id: `bounty:${r.id}`, kind: 'bounty', label: 'Bounty rune', pos: r.pos, at, value: 110, why: `Bounty runes ${fmtClock(at)}.` });
  }
  if (role >= 3) {
    const at = nextOccurrence(clock + 1, T.wisdomShrine.first, T.wisdomShrine.every);
    const r = RUNES.find((q) => q.kind === 'wisdom' && q.side === team);
    out.push({ id: `wisdom:${r.id}`, kind: 'wisdom', label: 'Wisdom shrine', pos: r.pos, at, value: 160, why: `Wisdom shrine ${fmtClock(at)}.` });
  }
  return out;
}

// ---------------- The planner ----------------
export function planRoute(c, mem = newMemory()) {
  const team = c.team === 'dire' ? 'dire' : 'radiant';
  const clock = typeof c.clock === 'number' ? c.clock : 0;
  const alive = c.hero?.alive !== false;
  const hx = c.hero?.xpos;
  const hy = c.hero?.ypos;
  const havePos = finite(hx) && finite(hy);
  const role = Number(c.role) || 1;
  const T = c.T;

  if (mem.lastClock !== null && clock < mem.lastClock - 5) Object.assign(mem, { ...newMemory(), learned: mem.learned, minimap: mem.minimap });
  mem.lastClock = clock;

  // While dead, plan from the fountain: "where to go after respawn".
  const pos = !alive || !havePos ? FOUNTAINS[team] : [hx, hy];
  const level = alive ? c.fightLevel || c.fight?.level || 'neutral' : 'neutral';
  const x = {
    clock,
    role,
    team,
    T,
    level: level === 'dead' ? 'neutral' : level,
    phase: c.phase,
    pos,
    hpPct: alive ? c.hero?.health_percent : 100,
    buildings: c.gsi?.buildings,
    daytime: c.gsi?.map?.daytime,
    roshanKilledAt: c.roshanKilledAt ?? null,
  };
  x.waves = estimateWaves(clock, team, x.buildings, mem.seenWaves);

  const w = (DANGER[x.level] ?? 0.9) * (x.daytime === false ? 1.15 : 1);
  const sp = shortestFrom(pos, team, w);
  const routes = new Map();
  const route = (c2) => {
    if (!routes.has(c2.id)) routes.set(c2.id, routeTo(sp, c2.pos));
    return routes.get(c2.id);
  };

  // Score everything: value minus (danger-weighted) travel time, and drop timed stops we cannot make.
  let list = candidates(x, mem)
    .map((c2) => {
      const r = route(c2);
      const eta = r.len / HERO_SPEED;
      return { ...c2, eta, score: c2.value - r.cost / HERO_SPEED };
    })
    .filter((c2) => {
      if (!c2.timed || c2.lead === undefined) return true;
      if (c2.maxEta !== undefined && c2.eta > c2.maxEta) return false;
      const left = c2.at - clock;
      return left <= c2.eta + c2.lead && left + c2.after >= c2.eta - 3 && clock <= c2.at + c2.after;
    });

  // Reached the current target?
  let reachedWhy = null;
  const cur = mem.current && list.find((c2) => c2.id === mem.current.id);
  if (cur && alive && havePos && dist(pos, cur.pos) <= REACH) {
    if (cur.timed && cur.at !== undefined) {
      if (clock >= cur.at) {
        mem.done[`${cur.id}@${cur.at}`] = clock;
        reachedWhy = 'reached';
      }
    } else if (!PERSISTENT.has(cur.kind)) {
      mem.visited[cur.id] = clock;
      reachedWhy = 'reached';
    }
    if (reachedWhy) list = list.filter((c2) => !(c2.id === cur.id || (c2.timed && mem.done[`${c2.id}@${c2.at}`] !== undefined)));
  }
  // A stack in one area counts for all areas this minute.
  for (const k of Object.keys(mem.done)) {
    const m = k.match(/^stack:.+@(\d+)$/);
    if (m) list = list.filter((c2) => !(c2.kind === 'stack' && c2.at === Number(m[1])));
  }

  list.sort((a, b) => b.score - a.score);
  const best = list[0] || null;
  const keep = list.find((c2) => c2.id === mem.current?.id) || null;
  let target = best;
  if (keep && best && keep !== best) {
    const urgent = (best.timed || best.kind === 'retreat') && !(keep.timed || keep.kind === 'retreat');
    if (!urgent && best.score < keep.score + SWITCH_MARGIN) target = keep;
  }
  if (target && target.id !== mem.current?.id) {
    mem.changeWhy = !mem.current ? 'start' : reachedWhy || (target.kind === 'retreat' ? 'danger' : target.timed ? 'timing' : keep ? 'better' : 'expired');
    mem.current = { id: target.id, kind: target.kind, since: clock };
    mem.changedAt = clock;
  } else if (!target) mem.current = null;

  const towersDead = deadTowers(x.buildings);
  const base = {
    waves: x.waves,
    deadTowers: towersDead,
    respawn: !alive,
    from: { x: Math.round(pos[0]), y: Math.round(pos[1]) },
    estimate: true,
  };
  if (!target) return { ...base, target: null, path: [], steps: [], reason: null, headline: null, changedAt: mem.changedAt, changeWhy: mem.changeWhy, timing: false };

  const r = route(target);
  const steps = [toStep(target)];
  // "After that": greedy chain over the other stops, seen from the target.
  const pool = [...list.filter((c2) => c2.id !== target.id && c2.kind !== 'retreat' && c2.kind !== 'lane'), ...upcoming(x)];
  // In the laning phase the lane itself is the home base: pull a camp when the wave is pushed, then back.
  if (target.kind === 'lane' && !(c.phase === 'strategy' || c.phase === 'pregame' || clock < 0)) {
    const myLane = roleLane(role, team);
    const area = JUNGLE.filter((a) => a.team === team).sort((a, b) => dist(a.pull || a.pos, target.pos) - dist(b.pull || b.pos, target.pos))[0];
    pool.push({ id: `camp:${area.id}`, kind: 'camp', label: `Leiren nær lanen (${AREA_NAME[area.kind][0]})`, pos: area.pull || area.pos, value: 45, why: 'Når bølgen er pushet: ta eller pull leiren, og gå tilbake før neste bølge.', lane: myLane });
  }
  if (target.kind !== 'lane' && (c.phase === 'laning' || clock < 0)) {
    const lane = roleLane(role, team);
    const wv = x.waves.find((q) => q.lane === lane);
    pool.push({ id: `lane:${lane}`, kind: 'lane', label: `Tilbake til ${LANE_NAME[lane]}`, pos: [wv.x, wv.y], value: 60, why: 'Tilbake til lanen før neste bølge.' });
  }
  let at = clock + (target.eta || 0) + dwell(target);
  let from = target.pos;
  const used = new Set([target.id, `${target.kind}@${target.at}`]);
  while (steps.length < 4) {
    let pick = null;
    for (const c2 of pool) {
      if (used.has(c2.id) || used.has(`${c2.kind}@${c2.at}`)) continue;
      const travel = (dist(from, c2.pos) * 1.2) / HERO_SPEED;
      const arrive = at + travel;
      if (c2.at !== undefined && (arrive > c2.at + 20 || c2.at - arrive > 75)) continue;
      const s = c2.value - travel - (c2.at !== undefined ? Math.max(0, c2.at - arrive) * 0.3 : 0);
      if (!pick || s > pick.s) pick = { c: c2, s, arrive };
    }
    if (!pick) break;
    used.add(pick.c.id);
    if (pick.c.at !== undefined) used.add(`${pick.c.kind}@${pick.c.at}`);
    steps.push(toStep(pick.c));
    at = Math.max(pick.arrive, pick.c.at ?? 0) + dwell(pick.c);
    from = pick.c.pos;
  }

  const path = r.path.map((p) => ({ x: Math.round(p[0]), y: Math.round(p[1]) }));
  const eta = Math.round(target.eta);
  return {
    ...base,
    target: { id: target.id, kind: target.kind, label: target.label, x: Math.round(target.pos[0]), y: Math.round(target.pos[1]), eta, at: target.at ?? null },
    path,
    steps,
    reason: target.why,
    headline: `${!alive ? 'Etter respawn: ' : ''}${target.label}${eta > 3 && alive ? ` (ca. ${eta} s unna)` : ''}`,
    changedAt: mem.changedAt,
    changeWhy: mem.changeWhy,
    timing: !!target.timed,
  };
}

function dwell(c) {
  return { camp: 25, wave: 15, stack: 4, power: 3, water: 3, bounty: 3, wisdom: 3, lotus: 3, lane: 20 }[c.kind] ?? 10;
}

function toStep(c) {
  return { id: c.id, kind: c.kind, label: c.label, x: Math.round(c.pos[0]), y: Math.round(c.pos[1]), at: c.at ?? null, why: c.why };
}

// Keeps the planner's memory for one match and feeds it the optional GSI minimap block.
export class RoutePlanner {
  constructor() {
    this.mem = newMemory();
  }

  reset() {
    this.mem = newMemory();
  }

  update(c) {
    if (c.gsi?.minimap !== undefined) {
      try {
        learnFromMinimap(this.mem, parseMinimap(c.gsi.minimap, c.team), c.team, c.clock);
      } catch {
        // garbage in the minimap block must never break the route
      }
    }
    return planRoute(c, this.mem);
  }

  diagnostics() {
    return this.mem.minimap || { received: false };
  }
}
