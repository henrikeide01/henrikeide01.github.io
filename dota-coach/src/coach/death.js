// Death recap: when the hero dies, look at the last seconds before it (HP, position, items and spells that
// were ready, the fight meter) and say what most likely went wrong, plus what to do while dead.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../settings.js';
import { SAVE_ACTIVES, SAVE_ABILITIES } from '../../data/knowledge.js';
import { fmtGameClock } from './timers.js';
import { safeLane, offLane } from './map.js';

const KEEP_SECS = 20; // how much history is kept while alive
const WINDOW = 10; // the seconds before the death the recap looks at
const CHANCE_SECS = 6; // an item or spell that was ready this close to the death counts as "not used"
const FIGHT_LABEL = { retreat: 'TREKK DEG', farm: 'FARM', neutral: 'NØYTRAL', press: 'PRESS', fight: 'KJEMP' };
const CHARGED = new Set(['magic_wand', 'magic_stick', 'holy_locket']);
const SAVE_ABILITY_SET = new Set(SAVE_ABILITIES);

const join = (list) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} og ${list[list.length - 1]}`);

// Ability display names from the bundled data (read once, lazily).
let abilityNames = null;
export function abilityDname(name) {
  if (!abilityNames) {
    abilityNames = new Map();
    try {
      const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/abilities.json'), 'utf8'));
      for (const h of Object.values(data.heroes || {})) for (const a of h.abilities || []) abilityNames.set(a.name, a.dname);
    } catch {}
  }
  return abilityNames.get(name) || null;
}

// A light copy of what matters for the recap, taken on every update while the hero is alive.
export function snapshot(c) {
  const hero = c.hero || {};
  const items = [];
  for (const k of ['slot0', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'neutral0']) {
    const it = c.gsi.items?.[k];
    if (!it?.name || it.name === 'empty') continue;
    items.push({ name: it.name.replace(/^item_/, ''), cd: Number(it.cooldown) || 0, cast: it.can_cast !== false, charges: it.charges ?? null });
  }
  const abilities = [];
  for (const a of Object.values(c.gsi.abilities || {})) {
    if (!a?.name || !(a.level > 0) || a.passive || String(a.name).startsWith('special_bonus')) continue;
    abilities.push({ name: a.name, cd: Number(a.cooldown) || 0, cast: a.can_cast !== false, ult: !!a.ultimate });
  }
  const stunned = !!(hero.stunned || hero.hexed);
  return {
    t: c.clock,
    hp: hero.health_percent ?? 100,
    loc: c.loc ? { label: c.loc.label, side: c.loc.side, depth: c.loc.depth, zone: c.loc.zone, inOwnBase: c.loc.inOwnBase, inEnemyBase: c.loc.inEnemyBase } : null,
    night: c.gsi.map?.daytime === false,
    items,
    abilities,
    tp: c.inv.tp, // null = no TP, undefined = GSI did not say
    un: c.player.gold_unreliable ?? 0,
    fight: c.fight?.level ?? null,
    stunned,
    muted: stunned || !!hero.muted, // cannot use items
    silenced: stunned || !!hero.silenced, // cannot cast spells
    tk: c.teamKills,
    ek: c.enemyKills,
  };
}

// Keeps only the last few seconds of snapshots.
export function pushSnapshot(list, snap) {
  if (list.length && snap.t < list[list.length - 1].t - 5) list.length = 0; // clock went back (new match)
  list.push(snap);
  while (list.length > 1 && (snap.t - list[0].t > KEEP_SECS || list.length > 120)) list.shift();
}

// Freezes what we knew at the moment of death. `live` is the context of the first update where the hero is dead.
export function freezeDeath(snaps, live) {
  const last = snaps[snaps.length - 1] || null;
  return {
    t: live.clock,
    snaps: snaps.slice(),
    unBefore: last?.un ?? null,
    unAfter: live.unreliable ?? null,
    tkAfter: null, // team kills a few seconds after the death (did the team trade?)
  };
}

// How the HP fell: highest HP in the window, how many seconds from "healthy" to dead, and how long it sat low.
export function hpStory(snaps, t) {
  const win = snaps.filter((s) => t - s.t <= WINDOW);
  if (!win.length) return null;
  const from = Math.max(...win.map((s) => s.hp));
  // When did the HP start to fall for good: the last time it was near the top of the window.
  const top = Math.min(from, 60) - 5;
  let startT = win[0].t;
  for (const s of win) if (s.hp >= top) startT = s.t;
  const secs = Math.max(0, Math.round(t - startT));
  let lowSince = null;
  for (let i = snaps.length - 1; i >= 0 && snaps[i].hp < 30; i--) lowSince = snaps[i].t;
  const lowFor = lowSince === null ? 0 : Math.round(t - lowSince);
  return { from, secs, burst: from >= 60 && secs <= 3, lowFor, startT };
}

// What the fight meter said before the HP started to drop (it always turns to "retreat" once the HP is low,
// so the last seconds say nothing about whether the fight was a good idea).
// Snapshots on low HP say nothing either: then there is no answer.
function fightBefore(win, hp) {
  const list = win.filter((s) => s.fight && s.fight !== 'dead' && s.hp >= 30 && (!hp || s.t <= hp.startT));
  if (!list.length) return null;
  const count = new Map();
  for (const s of list) count.set(s.fight, (count.get(s.fight) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// Items (or spells) that could have saved you: ready shortly before the death and still not used at the end.
// `blocked` = ready, but the hero was stunned/hexed/muted the whole time it could have been used.
function readyUnused(snaps, t, key, isSave, blockedBy) {
  const last = snaps[snaps.length - 1];
  const recent = snaps.filter((s) => t - s.t <= CHANCE_SECS);
  const unused = [];
  const blocked = [];
  for (const x of last?.[key] || []) {
    if (!isSave(x) || x.cd > 0) continue; // on cooldown at the end = it was used (or was not ready)
    if (CHARGED.has(x.name) && !(x.charges >= 5)) continue;
    const readyIn = recent.filter((s) => s[key].some((y) => y.name === x.name && y.cd <= 0));
    if (!readyIn.length) continue;
    if (readyIn.some((s) => !s[blockedBy] && s[key].some((y) => y.name === x.name && y.cast))) unused.push(x);
    else if (readyIn.some((s) => s[blockedBy])) blocked.push(x);
  }
  return { unused, blocked };
}

// d: frozen death (freezeDeath). live: { clock, role, team, phase, hero (GSI), player (GSI), inv, next, liveItems,
// db, teamKills, deaths, streak, baseThreat, enemyAegis, abilityName(name) }. Returns the recap shown while dead.
export function buildDeathRecap(d, live) {
  const snaps = d.snaps;
  const last = snaps[snaps.length - 1] || null;
  const win = snaps.filter((s) => d.t - s.t <= WINDOW);
  const first = win[0] || last;
  const hp = hpStory(snaps, d.t);
  const where = last?.loc
    ? { label: last.loc.label, side: last.loc.side, depth: last.loc.depth, zone: last.loc.zone, night: last.night, inEnemyBase: last.loc.inEnemyBase, inOwnBase: last.loc.inOwnBase }
    : null;
  const deep = !!where && where.side === 'enemy' && !where.inEnemyBase && (where.depth > 1500 || where.zone === 'jungle');
  const fight = fightBefore(win, hp);

  const label = (it) => (CHARGED.has(it.name) ? `${SAVE_ACTIVES[it.name]} (${it.charges} ladninger)` : SAVE_ACTIVES[it.name]);
  const dedupe = (list) => list.filter((x, i) => list.findIndex((y) => SAVE_ACTIVES[y.name] === SAVE_ACTIVES[x.name]) === i);
  const it = readyUnused(snaps, d.t, 'items', (x) => !!SAVE_ACTIVES[x.name], 'muted');
  const unused = dedupe(it.unused).map((x) => ({ name: x.name, label: label(x) }));
  const blocked = dedupe(it.blocked).map((x) => ({ name: x.name, label: label(x) }));

  const dname = (n) => live.abilityName?.(n) || abilityDname(n) || n.replace(/^[a-z]+_/, '').replace(/_/g, ' ');
  const sp = readyUnused(snaps, d.t, 'abilities', (a) => SAVE_ABILITY_SET.has(a.name) || a.ult, 'silenced');
  const save = sp.unused.find((a) => SAVE_ABILITY_SET.has(a.name));
  const ult = sp.unused.find((a) => a.ult && a !== save);

  const lost = d.unBefore != null && d.unAfter != null ? Math.max(0, d.unBefore - d.unAfter) : 0;
  const noTp = last?.tp === null && d.t >= 90;
  // Did the team get anything back? Decided once, 6 s after the death.
  if (d.tkAfter == null && live.clock - d.t >= 6) d.tkAfter = live.teamKills;
  const trade = first && d.tkAfter != null ? d.tkAfter > first.tk : null;
  const streak = live.streak || 0;

  const m = [];
  const add = (id, weight, text, say = null) => m.push({ id, weight, text, say });
  if (unused.length) {
    const what = join(unused.slice(0, 2).map((u) => u.label));
    add('unused-items', 90, `${what} var klar${unused.length > 1 ? 'e' : ''}, men ble ikke brukt. Bruk det før HP-en blir lav.`, `Du hadde ${SAVE_ACTIVES[unused[0].name]} klar`);
  } else if (blocked.length) {
    const what = join(blocked.slice(0, 2).map((u) => u.label));
    add('stunned-first', 70, `Du ble stunnet før du rakk å bruke ${what}. Bruk det tidligere, før stunnen kommer.`, `Bruk ${SAVE_ACTIVES[blocked[0].name]} tidligere`);
  }
  if (save) add('save-spell', 80, `${dname(save.name)} var klar. Bruk den til å komme deg unna.`, `${dname(save.name)} var klar`);
  if (fight === 'farm' || fight === 'retreat') add('fight-meter', 75, `Fight-meteret sa «${FIGHT_LABEL[fight]}» før fighten. Det var ikke tid for å kjempe.`, `Fight-meteret sa ${FIGHT_LABEL[fight].toLowerCase()}`);
  if (where?.inEnemyBase) add('enemy-base', 60, 'Du døde i fiendens base. Dykk bare når laget er med og fiendene ikke har buyback.', 'Ikke dykk alene');
  else if (deep && fight !== 'fight' && fight !== 'press') {
    add('deep', 72, `Du var dypt på fiendens side (${where.label})${where.night ? ' om natta' : ''} uten at fight-meteret sa kjemp.`, 'Du var for dypt på fiendens side');
  }
  if (hp && hp.lowFor >= 6) add('low-hp', 68, `Du gikk rundt på under 30 % HP i ${hp.lowFor} s før du døde. Gå ut av fighten eller heal tidligere.`, 'Gå tilbake når HP-en er lav');
  else if (hp?.burst) {
    const counter = (live.liveItems || []).find((x) => x.kind === 'counter');
    add('burst', 55, `Du gikk fra ${hp.from} % HP til 0 på ${Math.max(1, hp.secs)} s (burst). Stå lenger unna fiendene${counter ? `, eller kjøp ${counter.dname}` : ''}.`, 'Du ble bursta ned');
  }
  if (ult) add('ult-ready', 58, `Ultimaten (${dname(ult.name)}) var klar, men ble ikke brukt.`, 'Ultimaten var klar');
  if (streak >= 3) add('streak', 62, `${streak}. dødsfall på 5 minutter. Spill tryggere en stund: farm nær egne tårn og vent på laget.`, 'Mange dødsfall. Spill tryggere');
  if (trade === false && where && where.side !== 'own' && !where.inOwnBase) add('pickoff', 50, 'Laget fikk ingenting tilbake. Trolig var du alene uten vision.');
  if (noTp) add('no-tp', 40, 'Du hadde ingen TP. Ha alltid en, så kan du komme deg unna eller tilbake.', 'Kjøp TP');
  if (lost >= 250) add('gold-lost', 38, `Du mistet ${lost} upålitelig gull. Bruk gullet før du går inn i farlige områder.`);
  m.sort((a, b) => b.weight - a.weight);
  const mistakes = m.slice(0, 3).map(({ id, text, say }) => ({ id, text, say }));
  if (!mistakes.length) mistakes.push({ id: 'none', text: 'Ingen tydelig feil i dataene. Tenk over: så du fiendene på kartet før du gikk dit?', say: null });

  return {
    n: live.deaths ?? null,
    t: d.t,
    clockText: fmtGameClock(d.t),
    respawn: live.hero?.respawn_seconds ?? 0,
    where,
    hp: hp ? { from: hp.from, secs: hp.secs, burst: hp.burst, lowFor: hp.lowFor } : null,
    fight: fight ? { level: fight, label: FIGHT_LABEL[fight] } : null,
    unused,
    blocked,
    ultReady: ult ? dname(ult.name) : null,
    saveReady: save ? dname(save.name) : null,
    noTp,
    lost,
    streak,
    trade,
    mistakes,
    say: `Du døde. ${mistakes[0].say || 'Se oppsummeringen'}.`,
    whileDead: whileDead(live, where),
  };
}

// The best affordable component of `name` that is not held yet.
function bestComponent(db, name, pool, gold) {
  const comps = [...db.components(name)].filter((n) => !(pool.get(n) > 0) && db.cost(n) > 0 && db.cost(n) <= gold);
  comps.sort((a, b) => db.cost(b) - db.cost(a));
  return comps[0] || null;
}

export function whileDead(live, where) {
  const { db, inv, next, role, clock, team } = live;
  const gold = live.player?.gold ?? 0;
  const top = (live.liveItems || []).find((x) => x.afford && x.remaining > 0);

  let buy = null;
  if (next && next.remaining > 0 && gold >= next.remaining) buy = { item: next.name, dname: next.dname, text: `Kjøp ${next.dname} nå, du har råd.` };
  else if (top) buy = { item: top.item, dname: top.dname, text: `Kjøp ${top.dname} nå${top.short ? ` (${top.short.charAt(0).toLowerCase()}${top.short.slice(1)})` : ''}.` };
  else if (next && db) {
    const comp = bestComponent(db, next.name, inv.pool, gold);
    if (comp) buy = { item: comp, dname: db.dname(comp), text: `Kjøp ${db.dname(comp)} (${db.cost(comp)} g) mot ${next.dname}.` };
  }
  if (inv?.tp === null) buy = buy ? { ...buy, text: `${buy.text} Og en TP.` } : { item: 'tpscroll', dname: 'Town Portal Scroll', text: 'Kjøp en TP.' };
  if (!buy) buy = { item: null, dname: null, text: next ? `Spar til ${next.dname} (mangler ${Math.max(0, next.remaining - gold)} gull).` : 'Spar gullet til neste item.' };

  let buyback = null;
  const cost = live.hero?.buyback_cost;
  if (cost && clock >= 1200) {
    const cd = live.hero?.buyback_cooldown > 0;
    const can = gold >= cost && !cd;
    const respawn = live.hero?.respawn_seconds ?? 0;
    if (!can) buyback = { advice: 'none', text: cd ? 'Buyback er på cooldown.' : `Du har ikke råd til buyback (${cost} g).` };
    else if (live.baseThreat) buyback = { advice: 'yes', text: `Kjøp tilbake nå (${cost} g): basen din blir angrepet.` };
    else if (live.enemyAegis && respawn >= 25) buyback = { advice: 'maybe', text: `Fienden har Aegis. Kjøp tilbake (${cost} g) hvis de går mot high ground.` };
    else if (respawn >= 40 && role <= 3 && clock >= 1800) buyback = { advice: 'maybe', text: `Buyback (${cost} g) er verdt det bare hvis laget kjemper om Roshan eller et tårn nå. Ellers: spar gullet.` };
    else buyback = { advice: 'no', text: `Ikke kjøp tilbake nå. Ingenting står på spill${respawn ? `, og du spawner om ${respawn} s` : ''}.` };
  }

  let go;
  if (live.baseThreat) go = 'Forsvar basen: bli ved high ground og ta bølgen under tårnet.';
  else if (live.phase === 'laning') {
    go = {
      1: `Gå tilbake til ${safeLane(team)} lane. Spill bak creepene til du ser hvem som er i lanen.`,
      2: 'Gå tilbake mid. Ta med regen, og se etter runen.',
      3: `Gå tilbake til ${offLane(team)} lane, eller ta en leir i nærheten om lanen er tapt.`,
      4: 'Kjøp wards, og bli med i lanen som trenger hjelp.',
      5: `Kjøp wards og regen, og gå tilbake til ${safeLane(team)} lane til carryen din.`,
    }[role];
  } else if (role <= 2) go = 'TP til en lane på egen side der en bølge kommer, og farm der til laget samler seg.';
  else if (role === 3) go = 'Bli med laget, eller press en sidelane på motsatt side av der fiendene er.';
  else go = 'Kjøp wards og smoke, og gå dit kjernene dine er.';
  if (where?.side === 'enemy' && !live.baseThreat) go += ' Hold deg på egen side til du ser fiendene på kartet.';

  return { buy, buyback, go };
}
