// Post-game analysis: turns a recorded match into a report with a grade, what went well,
// what went badly and what to work on next game.
import { percentileOf } from './percentile.js';
import { situationalItems } from './situational.js';
import { fmtClock } from './timers.js';

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const GRADES = [
  [85, 'S'],
  [72, 'A'],
  [60, 'B'],
  [45, 'C'],
  [-Infinity, 'D'],
];
export const gradeOf = (score) => GRADES.find(([min]) => score >= min)[1];

const LH_TARGET_10 = { 1: 65, 2: 55, 3: 35 };
const TYPICAL_GPM = { 1: 560, 2: 540, 3: 470, 4: 330, 5: 290 };
const TYPICAL_XPM = { 1: 620, 2: 650, 3: 560, 4: 430, 5: 380 };
const KP_TARGET = { 1: 0.5, 2: 0.55, 3: 0.55, 4: 0.6, 5: 0.6 };

const WEIGHTS = {
  core: { laning: 0.2, farm: 0.25, survival: 0.2, items: 0.15, fighting: 0.1, discipline: 0.1 },
  support: { laning: 0.15, farm: 0.1, survival: 0.25, items: 0.1, fighting: 0.25, discipline: 0.15 },
};

const CATEGORY_LABEL = {
  laning: 'Laning',
  farm: 'Farm',
  survival: 'Overlevelse',
  items: 'Items og gull',
  fighting: 'Fights',
  discipline: 'Kart og disiplin',
};

export const TIP_LIBRARY = {
  'laning-lh': ['Bedre last hits', 'Øv 5 minutter i Demo Hero før kampen. Ikke slå creeps før det siste slaget, og bruk evner på bølgen når lanen er tøff.'],
  'laning-deaths': ['Tryggere laning', 'Stå bak dine egne creeps, og se på minikartet når fiendens mid eller supports forsvinner. Kjøp regen før du trenger den.'],
  'low-farm': ['Mer farm per minutt', 'Ha alltid en plan: bølge, så leir, så neste bølge. Stack leirer ved :53, og TP til sidelanes som pusher mot deg.'],
  'farm-dropoff': ['Hold farmen oppe etter 20 minutter', 'Når laget ikke kjemper, ta bølgene som går mot egne tårn og jungelen på egen side mellom fightene.'],
  'many-deaths': ['Færre dødsfall', 'Spør deg selv før du går inn: Er ulti og BKB klare? Ser du fiendene på kartet? Hvis ikke, farm trygt og vent på laget.'],
  'deaths-enemy-side': ['Farm på egen side', 'Hold deg på din side av elva når du ikke ser fiendene på kartet. Kjøp en observer ward til jungelen du farmer i.'],
  'bad-fight-timing': ['Kjemp på powerspikene dine', 'Følg fight-meteret. Gå inn når det viser KJEMP eller PRESS (rett etter et nytt item eller nivå 6), og farm når det viser FARM.'],
  'gold-lost': ['Bruk gullet før du tar sjanser', 'Upålitelig gull går tapt når du dør. Kjøp komponenter før fights, særlig når du har over 1000 gull.'],
  'unspent-gold': ['Gull i lomma gir ingen stats', 'Kjøp komponenter hver gang kureren er ledig, og bestem neste item før du går tilbake.'],
  'no-tp': ['Alltid TP Scroll', 'Kjøp ny TP med en gang du har brukt den. Den redder tårn, liv og fights.'],
  stash: ['Bruk kureren', 'Send items fra stashen med en gang, og legg kurer-knappen på en tast du når lett.'],
  'skill-points': ['Lær evner med en gang', 'Bruk Ctrl + tasten til evnen for å lære den raskt, også midt i en fight.'],
  'base-idle': ['Mindre tid i basen', 'Kjøp, send kureren og gå ut med en gang. Venter du på laget, farm en bølge i nærheten.'],
  deep: ['Vision før du går dypt', 'Gå bare inn i fiendens jungel når fiendene er synlige på kartet, eller når laget ditt er i nærheten.'],
  'low-kp': ['Vær med i flere fights', 'Følg minikartet og TP inn når laget starter en fight, særlig når fight-meteret viser KJEMP.'],
  'late-items': ['Raskere nøkkelitems', 'Prioriter farm til det første store itemet er ferdig, og ikke kjøp ting utenfor builden før det er klart.'],
};

const minutes = (secs) => Math.round((secs / 60) * 10) / 10;
const pct = (p) => Math.round(p * 100);

// Seconds spent in samples matching `fn` (samples are ~10 s apart).
function timeWhere(samples, fn) {
  let total = 0;
  for (let i = 1; i < samples.length; i++) if (fn(samples[i - 1])) total += samples[i].t - samples[i - 1].t;
  return total;
}

function lhRateBetween(samples, from, to) {
  const a = samples.find((s) => s.t >= from);
  const b = [...samples].reverse().find((s) => s.t <= to);
  if (!a || !b || b.t - a.t < 240) return null;
  return ((b.lh - a.lh) / (b.t - a.t)) * 60;
}

// When a median player has earned `gold` (incl. 600 starting gold). Final GPM is a whole-game average,
// and GPM grows during a match, so early on players earn ~60 % of it.
export function expectedTime(gold, medianGpm) {
  for (let t = 30; t <= 5400; t += 15) {
    const ramp = Math.min(1, 0.6 + (0.4 * t) / 2400);
    if (600 + medianGpm * (t / 60) * ramp >= gold) return t;
  }
  return 5400;
}

// meta: { benchmarks, build } from OpenDota (may be null), itemDb, heroes (Map)
export function analyzeMatch(rec, { meta = null, itemDb = null, heroes = new Map() } = {}) {
  const samples = rec.samples || [];
  const last = samples[samples.length - 1] || {};
  const role = rec.role || 1;
  const support = role >= 4;
  const duration = rec.duration || last.t || 0;
  const durMin = Math.max(1, duration / 60);
  const heroName = rec.hero?.dname || 'helten din';
  const bench = meta?.benchmarks || null;
  const good = [];
  const bad = [];
  const tags = new Set();
  const flag = (tag, text) => {
    tags.add(tag);
    bad.push({ tag, text });
  };

  // ---------- Stats ----------
  const kills = last.k ?? 0;
  const deaths = last.d ?? 0;
  const assists = last.a ?? 0;
  const teamKills = last.tk ?? 0;
  const kp = teamKills >= 5 ? Math.min(1, (kills + assists) / teamKills) : null;
  const gpm = last.gpm ?? 0;
  const xpm = last.xpm ?? 0;
  const gpmPct = bench ? percentileOf(bench.gold_per_min, gpm) : null;
  const xpmPct = bench ? percentileOf(bench.xp_per_min, xpm) : null;
  const lhPct = bench ? percentileOf(bench.last_hits_per_min, (last.lh ?? 0) / durMin) : null;
  const est = (value, typical) => clamp(0.5 + (value - typical) / 400, 0.02, 0.98);
  const gpmScore = gpmPct ?? est(gpm, TYPICAL_GPM[role]);
  const xpmScore = xpmPct ?? est(xpm, TYPICAL_XPM[role]);

  const alive = (s) => s.alive;
  const timeDead = timeWhere(samples, (s) => !s.alive);
  const late = (s) => s.t >= 1500 && s.gold <= s.bb * 1.2; // saving for buyback is fine
  const aliveAfter5 = samples.filter((s) => s.alive && s.t >= 300 && !late(s));
  const avgUnspent = aliveAfter5.length ? aliveAfter5.reduce((sum, s) => sum + s.gold, 0) / aliveAfter5.length : 0;
  const noTp = timeWhere(samples, (s) => s.alive && s.t >= 120 && !s.tp);
  const stashTime = timeWhere(samples, (s) => s.alive && s.stash > 0);
  const skillTime = timeWhere(samples, (s) => s.unspent > 0);
  const baseIdle = support ? 0 : timeWhere(samples, (s) => s.alive && s.t >= 600 && s.base);
  const deepTime = timeWhere(samples, (s) => s.alive && s.t >= 600 && s.side === 'enemy' && s.depth > 2500);
  const lowHpTime = timeWhere(samples, (s) => s.alive && s.hp < 25);
  const goldLost = rec.deaths.reduce((sum, d) => sum + (d.lost || 0), 0);

  // ---------- Deaths ----------
  const deathsOut = rec.deaths.map((d, i) => {
    const why = [];
    if (d.side === 'enemy') why.push('på fiendens side');
    if (d.fight === 'farm' || d.fight === 'retreat') why.push('mens coachen sa FARM');
    if (d.lost >= 400) why.push(`mistet ${d.lost} gull`);
    if (!d.hadTp) why.push('uten TP');
    if (d.night) why.push('om natten');
    if (d.noBuyback) why.push('uten buyback');
    const prev = rec.deaths[i - 1];
    if (prev && d.t - prev.t <= 90) why.push('rett etter forrige dødsfall');
    return { ...d, n: i + 1, why };
  });
  const before10 = rec.deaths.filter((d) => d.t < 600).length;
  const enemySide = rec.deaths.filter((d) => d.side === 'enemy').length;
  const wrongTime = rec.deaths.filter((d) => d.fight === 'farm' || d.fight === 'retreat').length;

  // ---------- Categories ----------
  const cat = {};
  const target10 = LH_TARGET_10[role];
  if (duration >= 600) {
    if (!support && rec.lhAt10 != null) {
      const ratio = rec.lhAt10 / target10;
      cat.laning = clamp(ratio * 85 + (ratio >= 1 ? 10 : 0) - before10 * 12);
      if (ratio >= 1) good.push({ text: `Sterk laning: ${rec.lhAt10} last hits ved 10:00 (mål ${target10}).` });
      else if (ratio < 0.75) flag('laning-lh', `Svak laning: bare ${rec.lhAt10} last hits ved 10:00 (mål ${target10}).`);
    } else {
      const assists10 = (rec.kaEvents || []).filter((e) => e.t < 600).reduce((s, e) => s + e.assists + e.kills, 0);
      cat.laning = clamp(80 - before10 * 15 + assists10 * 4);
    }
    if (before10 >= 2) flag('laning-deaths', `Du døde ${before10} ganger i laningfasen.`);
    else if (before10 === 0) good.push({ text: 'Ingen dødsfall i laningfasen.' });
  }

  const idlePenalty = (baseIdle / 60) * 4;
  if (support) {
    cat.farm = clamp(xpmScore * 100 - idlePenalty);
  } else {
    cat.farm = clamp((gpmScore * 0.6 + (lhPct ?? gpmScore) * 0.4) * 100 - idlePenalty);
    if (gpmScore >= 0.7) good.push({ text: `God farm: GPM ${gpm}${gpmPct != null ? `, bedre enn ${pct(gpmPct)} % av ${heroName}-spillerne` : ''}.` });
    else if (gpmScore <= 0.3) flag('low-farm', `Lav farm: GPM ${gpm}${gpmPct != null ? `, lavere enn ${100 - pct(gpmPct)} % av ${heroName}-spillerne` : ''}.`);
    const early = lhRateBetween(samples, 600, 1200);
    const later = lhRateBetween(samples, 1200, 1800);
    if (early && later != null && duration >= 1680 && later < early * 0.6) {
      flag('farm-dropoff', `Farmen stoppet opp etter 20 minutter (${early.toFixed(1)} → ${later.toFixed(1)} last hits i minuttet).`);
    }
  }

  const per10 = deaths / (durMin / 10);
  const allowance = support ? 1.5 : 0.9;
  const badDeaths = deathsOut.filter((d) => d.why.length >= 2).length;
  cat.survival = clamp(100 - Math.max(0, per10 - allowance) * 35 - badDeaths * 4);
  if (deaths <= Math.max(1, allowance * (durMin / 10) * 0.6)) good.push({ text: `Få dødsfall (${deaths} på ${Math.round(durMin)} min).` });
  else if (per10 > allowance * 1.6) flag('many-deaths', `${deaths} dødsfall er mye for en kamp på ${Math.round(durMin)} minutter.`);
  if (enemySide >= 2) flag('deaths-enemy-side', `${enemySide} av dødsfallene skjedde på fiendens side av kartet.`);
  if (wrongTime >= 2) flag('bad-fight-timing', `${wrongTime} dødsfall skjedde mens fight-meteret viste FARM eller TREKK DEG.`);
  if (goldLost >= 1000) flag('gold-lost', `Du mistet rundt ${goldLost} gull på dødsfall.`);

  // Items: timing of core items vs. what the median player on this hero would have.
  const medGpm = bench?.gold_per_min?.find((p) => p.percentile === 0.5)?.value || TYPICAL_GPM[role];
  let cum = 0;
  let lateCore = 0;
  const itemsOut = [];
  for (const it of rec.items || []) {
    cum += it.cost || 0;
    const expected = expectedTime(cum, medGpm);
    const row = { name: it.name, dname: it.dname, t: it.t, core: !!it.core };
    if (it.core && it.cost >= 1500) {
      row.expected = Math.round(expected);
      if (it.t > expected * 1.2 + 60) lateCore += 1;
    }
    itemsOut.push(row);
  }
  const firstCore = itemsOut.find((i) => i.expected);
  if (firstCore && !support) {
    const diff = (firstCore.t - firstCore.expected) / 60;
    if (diff > 2) flag('late-items', `${firstCore.dname} kom ${fmtClock(firstCore.t)}, omtrent ${Math.round(diff)} min senere enn vanlig for ${heroName}.`);
    else if (diff < -1) good.push({ text: `Rask ${firstCore.dname}: ${fmtClock(firstCore.t)}.` });
  }
  const unspentLimit = support ? 900 : 1300;
  if (avgUnspent > unspentLimit + 300) flag('unspent-gold', `Du gikk i snitt med ${Math.round(avgUnspent)} ubrukt gull.`);
  else if (avgUnspent < unspentLimit * 0.6) good.push({ text: 'Du brukte gullet effektivt.' });
  if (noTp >= 120) flag('no-tp', `Du var uten TP Scroll i ${minutes(noTp)} min.`);
  if (stashTime >= 120) flag('stash', `Items lå i stashen i ${minutes(stashTime)} min.`);

  const enemies = (rec.enemies || []).map((n) => heroes.get(n)).filter(Boolean);
  const counters = itemDb && enemies.length ? situationalItems(enemies, role, itemDb) : [];
  const ownedNames = new Set((rec.items || []).map((i) => i.name));
  const missedCounters = counters.filter((x) => !ownedNames.has(x.item) && x.cost >= 1000).slice(0, 2);
  cat.items = clamp(
    100 - Math.min(45, Math.max(0, avgUnspent - unspentLimit) / 30) - (noTp / 60) * 6 - (stashTime / 60) * 6 - lateCore * 10 - (support ? 0 : missedCounters.length * 6),
  );

  if (kp != null) {
    const kpTarget = KP_TARGET[role];
    cat.fighting = clamp((kp / kpTarget) * 80 + 10 - wrongTime * 6);
    if (kp >= kpTarget * 1.15) good.push({ text: `Høy deltakelse i fights: med på ${pct(kp)} % av lagets kills.` });
    else if (kp < kpTarget * 0.7) flag('low-kp', `Lav deltakelse i fights: med på bare ${pct(kp)} % av lagets kills.`);
  }
  for (const sp of rec.spikes || []) {
    const after = (rec.kaEvents || []).filter((e) => e.t >= sp.t && e.t <= sp.t + 180).reduce((s, e) => s + e.kills + e.assists, 0);
    if (after >= 2) {
      good.push({ text: `Du brukte powerspiket etter ${sp.dname} godt (${after} kills/assists de neste 3 minuttene).` });
      break;
    }
  }

  cat.discipline = clamp(100 - (deepTime / 60) * 5 - (skillTime / 60) * 12 - (baseIdle / 60) * 6 - (lowHpTime / 60) * 8);
  if (skillTime >= 60) flag('skill-points', `Du hadde ubrukte ferdighetspoeng i ${minutes(skillTime)} min.`);
  if (baseIdle >= 120) flag('base-idle', `Du sto ${minutes(baseIdle)} min i basen etter 10:00.`);
  if (deepTime >= 180) flag('deep', `Du var ${minutes(deepTime)} min dypt inne på fiendens side.`);

  // ---------- Overall ----------
  const weights = WEIGHTS[support ? 'support' : 'core'];
  let wsum = 0;
  let total = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (cat[k] == null) continue;
    wsum += w;
    total += cat[k] * w;
  }
  const score = Math.round(wsum ? total / wsum : 50);

  const categories = Object.keys(weights)
    .filter((k) => cat[k] != null)
    .map((k) => ({ id: k, label: CATEGORY_LABEL[k], score: Math.round(cat[k]), grade: gradeOf(cat[k]) }));

  // ---------- Tips: worst areas first ----------
  const catOfTag = {
    'laning-lh': 'laning', 'laning-deaths': 'laning', 'low-farm': 'farm', 'farm-dropoff': 'farm', 'base-idle': 'farm',
    'many-deaths': 'survival', 'deaths-enemy-side': 'survival', 'bad-fight-timing': 'fighting', 'gold-lost': 'survival',
    'unspent-gold': 'items', 'no-tp': 'items', stash: 'items', 'late-items': 'items', 'low-kp': 'fighting',
    'skill-points': 'discipline', deep: 'discipline',
  };
  const tips = [...tags]
    .filter((t) => TIP_LIBRARY[t])
    .sort((a, b) => (cat[catOfTag[a]] ?? 100) - (cat[catOfTag[b]] ?? 100))
    .slice(0, 4)
    .map((t) => ({ tag: t, title: TIP_LIBRARY[t][0], text: TIP_LIBRARY[t][1] }));
  if (missedCounters.length && !support) {
    tags.add('counter-items');
    tips.push({
      tag: 'counter-items',
      title: 'Items mot fiendelaget',
      text: `Mot dette laget kunne ${missedCounters.map((x) => x.dname).join(' eller ')} ha hjulpet. ${missedCounters[0].why}`,
    });
  }
  if (!tips.length) tips.push({ tag: 'keep', title: 'Fortsett sånn', text: 'Ingen store svakheter i denne kampen. Prøv å presse tempoet: ta objektiver rett etter powerspikes.' });

  // ---------- Key moments and charts ----------
  const moments = [];
  for (const d of deathsOut) moments.push({ t: d.t, icon: '💀', kind: 'death', text: `Død: ${d.label || 'ukjent sted'}${d.why.length ? ` – ${d.why.join(', ')}` : ''}` });
  for (const sp of rec.spikes || []) moments.push({ t: sp.t, icon: '⚡', kind: 'spike', text: `${sp.dname} ferdig (powerspike)` });
  for (const l of rec.levels || []) moments.push({ t: l.t, icon: '⭐', kind: 'level', text: 'Nivå 6 (ultimate)' });
  for (const r of rec.roshan || []) moments.push({ t: r.t, icon: '🐲', kind: 'roshan', text: r.ours ? 'Laget ditt tok Roshan' : 'Fienden tok Roshan' });
  for (const e of rec.kaEvents || []) if (e.kills >= 2) moments.push({ t: e.t, icon: '🔥', kind: 'kills', text: `${e.kills} kills på kort tid` });
  moments.sort((a, b) => a.t - b.t);

  const every = Math.max(1, Math.ceil(samples.length / 120));
  const charts = {
    lh: samples.filter((_, i) => i % every === 0).map((s) => [s.t, s.lh]),
    gold: samples.filter((_, i) => i % every === 0).map((s) => [s.t, s.gold]),
    fight: samples.filter((s, i) => i % every === 0 && s.fs != null).map((s) => [s.t, s.fs]),
    lhTargetPerMin: support ? null : { 1: 7, 2: 6.2, 3: 3.8 }[role],
    unspentLimit,
  };

  return {
    version: 1,
    matchId: rec.matchId,
    date: rec.endedAt || new Date().toISOString(),
    duration,
    result: rec.result,
    hero: rec.hero,
    role,
    team: rec.team,
    enemies: enemies.map((e) => ({ name: e.name, dname: e.dname })),
    score,
    grade: gradeOf(score),
    categories,
    good: good.slice(0, 6),
    bad: bad.slice(0, 8),
    tips,
    tags: [...tags],
    stats: {
      kills, deaths, assists, kp, teamKills,
      lastHits: last.lh ?? 0, denies: last.dn ?? 0, lhAt10: rec.lhAt10, lhTarget10: support ? null : target10,
      gpm, xpm, gpmPct, xpmPct, lhPct, level: last.lvl ?? null,
      timeDead, avgUnspent: Math.round(avgUnspent), goldLost,
    },
    items: itemsOut,
    deaths: deathsOut.map(({ n, t, x, y, label, side, why }) => ({ n, t, x, y, label, side, why })),
    moments,
    charts,
    opendota: null,
  };
}

// Patterns across several games ("you often die on the enemy side").
export function trends(reports) {
  const list = reports.slice(0, 10);
  if (!list.length) return null;
  const avg = (fn) => {
    const vals = list.map(fn).filter((v) => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const tagCount = {};
  for (const r of list) for (const t of r.tags || []) tagCount[t] = (tagCount[t] || 0) + 1;
  // Most frequent first; on a tie, the habit that costs the most games first.
  const PRIORITY = ['many-deaths', 'deaths-enemy-side', 'bad-fight-timing', 'laning-lh', 'low-farm', 'late-items', 'unspent-gold', 'low-kp', 'gold-lost', 'farm-dropoff', 'laning-deaths', 'no-tp', 'stash', 'skill-points', 'base-idle', 'deep'];
  const rank = (t) => (PRIORITY.includes(t) ? PRIORITY.indexOf(t) : 99);
  const common = Object.entries(tagCount)
    .filter(([t, n]) => n >= 2 && TIP_LIBRARY[t])
    .sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]))
    .slice(0, 3)
    .map(([tag, n]) => ({ tag, count: n, title: TIP_LIBRARY[tag][0], text: TIP_LIBRARY[tag][1] }));
  const decided = list.filter((r) => r.result === 'win' || r.result === 'loss');
  return {
    games: list.length,
    avgScore: Math.round(avg((r) => r.score)),
    winrate: decided.length ? decided.filter((r) => r.result === 'win').length / decided.length : null,
    avgDeaths: avg((r) => r.stats.deaths),
    avgLhAt10: avg((r) => (r.stats.lhTarget10 ? r.stats.lhAt10 : null)),
    avgGpm: avg((r) => r.stats.gpm),
    common,
    scores: list.map((r) => ({ matchId: r.matchId, score: r.score, grade: r.grade, hero: r.hero, result: r.result })).reverse(),
  };
}

// Adds numbers only OpenDota has (hero damage, tower damage, wards …) once the match is public.
export function enrichFromOpenDota(report, match, { accountId = null, heroId = null } = {}) {
  const players = Array.isArray(match?.players) ? match.players : [];
  const me = players.find((p) => accountId && p.account_id === accountId) || players.find((p) => heroId && p.hero_id === heroId);
  if (!me) return null;
  const mates = players.filter((p) => p.isRadiant === me.isRadiant);
  const rank = (key) => 1 + mates.filter((p) => (p[key] ?? 0) > (me[key] ?? 0)).length;
  const b = me.benchmarks || {};
  const support = report.role >= 4;
  const good = [];
  const bad = [];
  const pctOf = (k) => (typeof b[k]?.pct === 'number' ? b[k].pct : null);

  const dmgPct = pctOf('hero_damage_per_min');
  if (dmgPct != null && dmgPct >= 0.7) good.push(`Mye skade på helter (${me.hero_damage}, bedre enn ${Math.round(dmgPct * 100)} % av spillerne på helten).`);
  else if (dmgPct != null && dmgPct <= 0.3 && !support) bad.push(`Lite skade på helter (${me.hero_damage}). Vær med i flere fights, og slå de riktige målene.`);
  const towerPct = pctOf('tower_damage');
  if (towerPct != null && towerPct <= 0.3 && report.role <= 3) bad.push(`Lite tårnskade (${me.tower_damage}). Bruk farmen og powerspikes til å presse tårn.`);
  else if (towerPct != null && towerPct >= 0.75) good.push(`God tårnskade (${me.tower_damage}).`);
  if (typeof me.lane_efficiency_pct === 'number' && !support) {
    if (me.lane_efficiency_pct >= 70) good.push(`Effektiv lane: ${me.lane_efficiency_pct} % av mulig gull de første 10 minuttene.`);
    else if (me.lane_efficiency_pct < 45) bad.push(`Lav lane-effektivitet: ${me.lane_efficiency_pct} % av mulig gull de første 10 minuttene.`);
  }
  if (support && typeof me.obs_placed === 'number') {
    const per10 = me.obs_placed / Math.max(1, report.duration / 600);
    if (per10 < 2) bad.push(`Bare ${me.obs_placed} observer wards plassert. Prøv å ha 2–3 wards ute hele tiden.`);
    else good.push(`${me.obs_placed} observer wards plassert.`);
  }
  if (typeof me.camps_stacked === 'number' && me.camps_stacked >= 4) good.push(`${me.camps_stacked} leirer stacket.`);

  return {
    fetchedAt: new Date().toISOString(),
    parsed: typeof me.obs_placed === 'number' || typeof me.lane_efficiency_pct === 'number',
    heroDamage: me.hero_damage ?? null,
    towerDamage: me.tower_damage ?? null,
    healing: me.hero_healing ?? null,
    netWorth: me.net_worth ?? me.total_gold ?? null,
    obsPlaced: me.obs_placed ?? null,
    campsStacked: me.camps_stacked ?? null,
    teamRank: { heroDamage: rank('hero_damage'), towerDamage: rank('tower_damage'), netWorth: rank('net_worth') },
    good,
    bad,
  };
}
