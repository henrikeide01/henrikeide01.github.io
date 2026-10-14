// Post-game analysis: turns a recorded match into a report with a grade, what went well,
// what went badly and what to work on next game.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../settings.js';
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

// ---------- Dota Plus-style details from a parsed OpenDota match ----------

// Keys of gold_reasons / xp_reasons are Dota's EDOTA_ModifyGold_Reason / EDOTA_ModifyXP_Reason codes.
// Unknown codes are counted as «Annet»; 1 (lost on death) and 2 (buyback) are costs, not income.
const GOLD_REASON = {
  0: 'Annet',
  5: 'Fra spiller som forlot kampen',
  6: 'Salg av items',
  10: 'Passiv inntekt',
  11: 'Tårn og bygninger',
  12: 'Helter (kills og assists)',
  13: 'Creeps',
  14: 'Nøytrale leirer',
  15: 'Roshan',
  16: 'Kurerer',
  17: 'Bounty-runer',
  18: 'Delt gull',
  19: 'Evner',
  20: 'Wards',
};
const GOLD_ALIAS = { 21: 16 }; // courier killed by this player
const XP_REASON = {
  0: 'Annet',
  1: 'Helter (kills og assists)',
  2: 'Creeps og nøytrale',
  3: 'Roshan',
  4: 'Tome of Knowledge',
  5: 'Utposter',
  6: 'Innhenting (catch-up)',
  7: 'Evner',
};
const RUNE = { 0: 'Dobbel skade', 1: 'Fart', 2: 'Illusjon', 3: 'Usynlighet', 4: 'Regenerering', 5: 'Bounty', 6: 'Arcane', 7: 'Vann', 8: 'Visdom', 9: 'Skjold' };
const DMG_TYPES = ['physical', 'magical', 'pure', 'unknown'];
const DMG_LABEL = { physical: 'Fysisk', magical: 'Magisk', pure: 'Ren (pure)', unknown: 'Ukjent' };
const UNIT_LABEL = { creep: 'Creeps', neutral: 'Nøytrale', tower: 'Tårn og bygninger', roshan: 'Roshan', other: 'Andre enheter' };
// Damage type of items that deal damage themselves (dotaconstants has no dmg_type for items).
// Blade Mail is left out on purpose: it returns damage with the original type.
const ITEM_DMG = {
  radiance: 'magical', maelstrom: 'magical', mjollnir: 'magical', gungir: 'magical', dagon: 'magical', dagon_2: 'magical', dagon_3: 'magical',
  dagon_4: 'magical', dagon_5: 'magical', shivas_guard: 'magical', ethereal_blade: 'magical', monkey_king_bar: 'magical', javelin: 'magical',
  orchid: 'magical', bloodthorn: 'magical', meteor_hammer: 'magical', overwhelming_blink: 'magical', revenants_brooch: 'magical', cyclone: 'magical',
  wind_waker: 'magical', phylactery: 'magical', khanda: 'magical', witch_blade: 'magical', devastator: 'magical', fallen_sky: 'magical',
  gunpowder_gauntlets: 'magical', bfury: 'physical', basher: 'physical', abyssal_blade: 'physical', silver_edge: 'physical',
  invis_sword: 'physical', diffusal_blade: 'physical', disperser: 'physical',
};

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const numEntries = (o) => (isObj(o) ? Object.entries(o).filter(([, v]) => num(v) != null) : []);
const sum = (list) => list.reduce((s, v) => s + v, 0);
const humanize = (s) =>
  String(s || '')
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

// Whole-number percentages of `values` that add up to exactly 100 (largest remainder method).
export function percentages(values) {
  const vals = values.map((v) => Math.max(0, v || 0));
  const total = sum(vals);
  if (!total) return vals.map(() => 0);
  const raw = vals.map((v) => (v / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - sum(out);
  for (const [, i] of raw.map((v, j) => [v - out[j], j]).sort((a, b) => b[0] - a[0])) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

// { total, rows } with each row's share as whole percent, or null when there is nothing to show.
const withPct = (rows) => {
  const total = sum(rows.map((r) => r.value));
  if (!rows.length || !total) return null;
  const pcts = percentages(rows.map((r) => r.value));
  return { total, rows: rows.map((r, i) => ({ ...r, pct: pcts[i] })) };
};

// Keeps the `top` biggest rows and folds the rest into one «N andre» row.
function fold(rows, top) {
  if (rows.length <= top + 1) return rows;
  const rest = rows.slice(top);
  return [...rows.slice(0, top), { key: 'rest', kind: 'rest', dname: `${rest.length} andre`, dmg: null, value: sum(rest.map((r) => r.value)) }];
}

let bundled = null;
function bundledData() {
  if (!bundled) {
    const read = (f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
      } catch {
        return {};
      }
    };
    bundled = { heroes: read('heroes.json').heroes || [], items: read('items.json').items || {}, abilities: read('abilities.json').heroes || {}, abilityInfo: read('ability-info.json').abilities || {} };
  }
  return bundled;
}

// Name lookups for OpenDota's unit names (npc_dota_hero_lina) and damage sources (lina_laguna_blade, item_radiance, null).
// data: { heroes (array or Map name -> hero), items, abilities (per-hero lists), abilityInfo (data/ability-info.json) }
function makeLookup(data) {
  const heroList = data.heroes instanceof Map ? [...data.heroes.values()] : data.heroes || [];
  const heroByName = new Map(heroList.map((h) => [h.name, h]));
  const heroById = new Map(heroList.map((h) => [h.id, h]));
  const byLength = [...heroByName.keys()].sort((a, b) => b.length - a.length);
  const listed = new Map();
  for (const [hero, info] of Object.entries(data.abilities || {})) for (const a of info.abilities || []) listed.set(a.name, { hero, dname: a.dname });
  const info = data.abilityInfo || {};
  const items = data.items || {};
  const heroDname = (name) => heroByName.get(name)?.dname || humanize(name);

  function unit(key) {
    const k = String(key || '');
    if (k.startsWith('npc_dota_hero_')) {
      const name = k.slice('npc_dota_hero_'.length);
      return { kind: 'hero', name, dname: heroDname(name) };
    }
    if (k.includes('roshan')) return { kind: 'roshan' };
    if (k.startsWith('npc_dota_neutral_')) return { kind: 'neutral' };
    if (/_tower|_fort|_rax|barracks|_healers|_fillers?\b|_effigy|_outpost/.test(k)) return { kind: 'tower' };
    if (/^npc_dota_creep_(goodguys|badguys)|_siege|^npc_dota_creep_lane/.test(k)) return { kind: 'creep' };
    return { kind: 'other' };
  }

  function item(key) {
    const name = String(key || '').replace(/^item_/, '');
    return { key: name, kind: 'item', dname: items[name]?.dname || humanize(name), dmg: ITEM_DMG[name] || null, hero: null, heroDname: null };
  }

  // OpenDota writes auto-attacks as the inflictor null (the JSON key "null").
  function source(key) {
    const k = key == null ? 'null' : String(key);
    if (!k || k === 'null' || k === 'undefined' || k === 'dota_unknown') return { key: 'attack', kind: 'attack', dname: 'Autoangrep', dmg: 'physical', hero: null, heroDname: null };
    if (info[k] || listed.has(k)) {
      const hero = info[k]?.hero || listed.get(k)?.hero || null;
      return { key: k, kind: 'ability', dname: info[k]?.dname || listed.get(k).dname, dmg: info[k]?.dmg || null, hero, heroDname: hero ? heroDname(hero) : null };
    }
    if (k.startsWith('item_') || items[k]) return item(k);
    const hero = byLength.find((h) => k.startsWith(`${h}_`)) || null;
    return { key: k, kind: 'other', dname: humanize(hero ? k.slice(hero.length + 1) : k), dmg: null, hero, heroDname: hero ? heroDname(hero) : null };
  }

  return { heroById, heroDname, unit, item, source, items };
}

// Damage per source (ability, item, auto-attack), merged by display key and sorted, biggest first.
function sources(map, L) {
  const agg = new Map();
  for (const [k, v] of numEntries(map)) {
    if (v <= 0) continue;
    const s = L.source(k);
    const prev = agg.get(s.key);
    if (prev) prev.value += v;
    else agg.set(s.key, { ...s, value: v });
  }
  return [...agg.values()].sort((a, b) => b.value - a.value);
}

// Hero damage per enemy hero; everything else goes into one bucket with its parts (creeps, towers …).
function damageByUnit(map, L, isEnemy, { otherBucket }) {
  const heroes = new Map();
  const other = { creep: 0, neutral: 0, tower: 0, roshan: 0, other: 0 };
  for (const [k, v] of numEntries(map)) {
    if (v <= 0) continue;
    const u = L.unit(k);
    if (u.kind === 'hero' && isEnemy(u.name)) heroes.set(u.name, (heroes.get(u.name) || 0) + v);
    else other[u.kind === 'hero' ? 'other' : u.kind] += v;
  }
  const rows = [...heroes].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ key: name, kind: 'hero', name, dname: L.heroDname(name), value }));
  const otherTotal = sum(Object.values(other));
  if (otherBucket && otherTotal > 0) {
    rows.push({
      key: 'other',
      kind: 'other',
      dname: 'Creeps, tårn og annet',
      value: otherTotal,
      parts: Object.entries(other)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([key, value]) => ({ key, dname: UNIT_LABEL[key], value })),
    });
  }
  return withPct(rows);
}

function damageTypes(all) {
  if (!all.length) return null;
  const by = Object.fromEntries(DMG_TYPES.map((t) => [t, 0]));
  for (const s of all) by[s.dmg || 'unknown'] += s.value;
  const res = withPct(DMG_TYPES.filter((t) => by[t] > 0).map((t) => ({ key: t, label: DMG_LABEL[t], value: by[t] })));
  if (!res) return null;
  res.pct = Object.fromEntries(DMG_TYPES.map((t) => [t, res.rows.find((r) => r.key === t)?.pct || 0]));
  return res;
}

function countByUnit(map, L, isEnemy, { heroesOnly }) {
  const rows = new Map();
  for (const [k, v] of numEntries(map)) {
    if (v <= 0) continue;
    const u = L.unit(k);
    if (u.kind === 'hero' && isEnemy(u.name)) rows.set(u.name, { key: u.name, kind: 'hero', name: u.name, dname: u.dname, count: (rows.get(u.name)?.count || 0) + v });
    else if (!heroesOnly) {
      const kind = u.kind === 'hero' ? 'other' : u.kind;
      rows.set(kind, { key: kind, kind, dname: UNIT_LABEL[kind], count: (rows.get(kind)?.count || 0) + v });
    }
  }
  const list = [...rows.values()].sort((a, b) => b.count - a.count);
  return list.length ? { total: sum(list.map((r) => r.count)), rows: list } : null;
}

// Income per reason code (unknown codes count as 0 «Annet»). gold: codes 1/2 are gold lost on death / spent on buyback.
function reasons(map, labels, { alias = {}, gold = false } = {}) {
  const agg = new Map();
  let lost = 0;
  let buyback = 0;
  for (const [k, v] of numEntries(map)) {
    if (gold && k === '1') lost += Math.abs(v);
    else if (gold && k === '2') buyback += Math.abs(v);
    else if (v > 0) {
      const code = String(alias[k] ?? (labels[k] ? k : 0));
      agg.set(code, (agg.get(code) || 0) + v);
    }
  }
  const res = withPct([...agg].sort((a, b) => b[1] - a[1]).map(([key, value]) => ({ key, label: labels[key], value })));
  if (!res) return null;
  return gold ? { ...res, lost, buyback } : res;
}

// What an enemy hero mostly hurt you with: their own abilities (if they explain most of their damage) or auto-attacks.
function heroProfile(name, taken, takenAll) {
  const own = takenAll.filter((s) => s.hero === name);
  const attributed = sum(own.map((s) => s.value));
  const heroTotal = taken?.rows.find((r) => r.key === name)?.value || 0;
  if (own.length && attributed >= heroTotal * 0.5) {
    const by = {};
    for (const s of own) by[s.dmg || 'unknown'] = (by[s.dmg || 'unknown'] || 0) + s.value;
    const type = Object.entries(by).sort((a, b) => b[1] - a[1])[0][0];
    return { main: own[0].dname, type };
  }
  return { main: 'autoangrep', type: 'physical' };
}

function counterItems(type, role) {
  const support = role >= 4;
  if (type === 'magical') return support ? 'Glimmer Cape eller Pipe' : role === 3 ? 'Pipe, BKB eller Eternal Shroud' : 'BKB eller Eternal Shroud';
  if (type === 'physical') {
    if (support) return 'Ghost Scepter, Force Staff eller Solar Crest';
    return { 1: 'Ghost Scepter, Butterfly eller Assault Cuirass', 2: "Ghost Scepter, Blade Mail eller Shiva's Guard", 3: "Heaven's Halberd, Blade Mail eller Crimson Guard" }[role] || 'Ghost Scepter';
  }
  if (type === 'pure') return support ? 'Aeon Disk eller Force Staff' : 'Aeon Disk eller mer HP';
  return null;
}

function buildInsights({ role, duration, taken, takenAll, types, killedBy, gold, stats }) {
  const out = [];
  const add = (tag, label, text) => out.push({ tag, label, text });

  if (types && types.total >= 1500) {
    const p = types.pct;
    if (p.magical >= 50) add('dmg-magical', 'Skadetype', `${p.magical} % av skaden du tok var magisk – ${counterItems('magical', role)} hjelper.`);
    else if (p.pure >= 25) add('dmg-pure', 'Skadetype', `${p.pure} % av skaden du tok var ren skade (pure), som går gjennom både rustning og magisk motstand – ${counterItems('pure', role)} hjelper.`);
    else if (p.physical >= 70) add('dmg-physical', 'Skadetype', `${p.physical} % av skaden du tok var fysisk – ${counterItems('physical', role)} hjelper.`);
  }

  const topHero = taken?.rows.find((r) => r.kind === 'hero');
  const killers = (killedBy?.rows || []).filter((r) => r.kind === 'hero');
  let topHeroName = null;
  if (topHero && topHero.pct >= 30 && taken.total >= 2000) {
    topHeroName = topHero.name;
    const prof = heroProfile(topHero.name, taken, takenAll);
    const deaths = killers.find((k) => k.name === topHero.name)?.count || 0;
    const advice =
      prof.type === 'magical'
        ? `hold deg utenfor rekkevidde, og vurder ${role >= 4 ? 'Glimmer Cape eller Force Staff' : "Linken's Sphere eller BKB"}`
        : prof.type === 'unknown'
          ? `se etter ${topHero.dname} på kartet før du går inn, og hold avstand`
          : `hold avstand, og vurder ${counterItems(prof.type, role)}`;
    add(
      'top-damage-hero',
      'Farligste fiende',
      `${topHero.dname} sto for ${topHero.pct} % av skaden du tok (mest ${prof.main})${deaths >= 2 ? ` og drepte deg ${deaths} ganger` : ''} – ${advice}.`,
    );
  }

  const killer = killers[0];
  if (killer && killer.count >= 3 && killer.name !== topHeroName) {
    const prof = heroProfile(killer.name, taken, takenAll);
    const items = counterItems(prof.type, role);
    add('killed-by', 'Dødsfall', `Du døde ${killer.count} ganger til ${killer.dname} – ${items ? `se etter ${items}` : 'hold deg nær laget når du ikke ser helten på kartet'}.`);
  }

  if (gold && role <= 3 && duration >= 1200 && gold.total >= 4000) {
    const share = (gold.rows.find((r) => r.key === '14')?.value || 0) / gold.total;
    if (share < 0.15) {
      const p = Math.round(share * 100);
      add('few-neutrals', 'Farm', `${p >= 1 ? `Bare ${p} %` : 'Nesten ingenting'} av gullet kom fra nøytrale leirer – farm jungelen mellom bølgene.`);
    }
  }

  const runes = stats.runes?.total;
  if (role === 2 && duration >= 1200 && runes != null && runes < duration / 400) {
    add('few-runes', 'Runer', `Bare ${runes} runer på ${Math.round(duration / 60)} minutter – som mid bør du ta power-runene og stjele bounty-runer når du kan.`);
  }

  if (stats.timeDead != null && duration > 0 && stats.timeDead / duration >= 0.15) {
    add('time-dead', 'Tid død', `Du var død i ${fmtClock(stats.timeDead)} (${Math.round((stats.timeDead / duration) * 100)} % av kampen) – det er farm og fights du går glipp av.`);
  }
  return out.slice(0, 4);
}

// The per-match breakdowns Dota Plus shows (damage taken/dealt by hero and ability, gold/XP sources …).
// Only parsed matches have these fields; returns null for an unparsed match.
export function matchDetails(me, match, { role = 1, duration = 0, data = bundledData() } = {}) {
  const PARSED = ['damage_taken', 'damage_inflictor_received', 'damage', 'damage_inflictor', 'killed_by', 'killed', 'gold_reasons', 'xp_reasons', 'ability_uses', 'item_uses'];
  if (!me || !PARSED.some((k) => isObj(me[k]))) return null;
  const L = makeLookup(data);
  const myName = L.heroById.get(me.hero_id)?.name || null;
  const players = Array.isArray(match?.players) ? match.players : [];
  const enemies = new Set(players.filter((p) => p.isRadiant !== me.isRadiant).map((p) => L.heroById.get(p.hero_id)?.name).filter(Boolean));
  const isEnemy = (name) => name !== myName && (!enemies.size || enemies.has(name));
  const dur = num(match?.duration) || duration || 0;

  const takenAll = sources(me.damage_inflictor_received, L);
  const dealtAll = sources(me.damage_inflictor, L);
  const taken = damageByUnit(me.damage_taken, L, isEnemy, { otherBucket: true });
  const killedBy = countByUnit(me.killed_by, L, isEnemy, { heroesOnly: false });
  const gold = reasons(me.gold_reasons, GOLD_REASON, { alias: GOLD_ALIAS, gold: true });

  const uses = [
    ...numEntries(me.ability_uses).map(([k, count]) => {
      const s = L.source(k);
      return { key: s.key, kind: s.kind === 'item' ? 'item' : 'ability', dname: s.dname, count };
    }),
    ...numEntries(me.item_uses).map(([k, count]) => ({ key: L.item(k).key, kind: 'item', dname: L.item(k).dname, count })),
  ]
    .filter((u) => u.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const purchases = [];
  const seen = new Set();
  for (const p of Array.isArray(me.purchase_log) ? me.purchase_log : []) {
    const name = String(p?.key || '').replace(/^item_/, '');
    const it = L.items[name];
    if (!it || seen.has(name) || name.startsWith('recipe_') || it.qual === 'consumable' || num(p.time) == null) continue;
    if (!(it.cost >= 2000 || (it.created && it.cost >= 1000))) continue;
    seen.add(name);
    purchases.push({ name, dname: it.dname, t: p.time });
  }

  const hit = isObj(me.max_hero_hit) && num(me.max_hero_hit.value) ? me.max_hero_hit : null;
  const target = hit ? L.unit(hit.key) : null;
  const runeRows = numEntries(me.runes)
    .filter(([, n]) => n > 0)
    .map(([key, count]) => ({ key, label: RUNE[key] || 'Annen rune', count }))
    .sort((a, b) => b.count - a.count);
  const runeTotal = num(me.rune_pickups) ?? (runeRows.length ? sum(runeRows.map((r) => r.count)) : null);
  const at10 = (arr) => (Array.isArray(arr) && arr.length > 10 ? num(arr[10]) : null);
  const stats = {
    maxHit: hit
      ? { value: hit.value, t: num(hit.time), source: (({ key, kind, dname }) => ({ key, kind, dname }))(L.source(hit.inflictor)), target: target?.kind === 'hero' ? { name: target.name, dname: target.dname } : null }
      : null,
    stuns: num(me.stuns) != null ? Math.round(me.stuns * 10) / 10 : null,
    teamfight: num(me.teamfight_participation),
    runes: runeTotal != null ? { total: runeTotal, rows: runeRows } : null,
    buybacks: num(me.buyback_count),
    laneEfficiency: num(me.lane_efficiency_pct),
    lhAt10: at10(me.lh_t),
    dnAt10: at10(me.dn_t),
    timeDead: num(me.life_state_dead),
  };

  const types = damageTypes(takenAll);
  return {
    damageTaken: taken,
    damageTakenBy: withPct(fold(takenAll, 8)),
    damageTypes: types,
    damageDealt: damageByUnit(me.damage, L, isEnemy, { otherBucket: false }),
    damageDealtBy: withPct(fold(dealtAll, 8)),
    killedBy,
    kills: countByUnit(me.killed, L, isEnemy, { heroesOnly: true }),
    gold,
    xp: reasons(me.xp_reasons, XP_REASON),
    uses: uses.length ? uses : null,
    purchases: purchases.length ? purchases.slice(0, 10) : null,
    stats,
    insights: buildInsights({ role, duration: dur, taken, takenAll, types, killedBy, gold, stats }),
  };
}

// Adds numbers only OpenDota has (hero damage, tower damage, wards …) once the match is public,
// and the detailed Dota Plus-style breakdowns once the replay is parsed.
// data: name lookups (see makeLookup); defaults to the bundled files in data/.
export function enrichFromOpenDota(report, match, { accountId = null, heroId = null, data } = {}) {
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

  let details = null;
  try {
    details = matchDetails(me, match, { role: report.role || 1, duration: report.duration || 0, ...(data ? { data } : {}) });
  } catch (err) {
    console.error('Detaljert statistikk feilet:', err); // never lose the basic numbers over a data quirk
  }

  return {
    fetchedAt: new Date().toISOString(),
    parsed: !!details || typeof me.obs_placed === 'number' || typeof me.lane_efficiency_pct === 'number',
    heroDamage: me.hero_damage ?? null,
    towerDamage: me.tower_damage ?? null,
    healing: me.hero_healing ?? null,
    netWorth: me.net_worth ?? me.total_gold ?? null,
    obsPlaced: me.obs_placed ?? null,
    campsStacked: me.camps_stacked ?? null,
    teamRank: { heroDamage: rank('hero_damage'), towerDamage: rank('tower_damage'), netWorth: rank('net_worth') },
    good,
    bad,
    details,
  };
}
