// "Fight meter": should you look for fights right now, or farm and wait for your next power spike?
// Returns a score from -100 (stay away from fights) to +100 (fight now), with the reasons behind it.
import { powerCurve, CURVE_STRENGTH, KEY_ACTIVES } from '../../data/knowledge.js';

export const FIGHT_LEVELS = [
  { min: 35, level: 'fight', label: 'KJEMP', icon: '⚔️', headline: 'Godt tidspunkt å kjempe. Se etter fights eller en gank.' },
  { min: 12, level: 'press', label: 'PRESS', icon: '🔥', headline: 'Ta initiativ: press tårn, ta objektiver og bli med når laget går.' },
  { min: -12, level: 'neutral', label: 'NØYTRAL', icon: '⚖️', headline: 'Farm, men vær klar til å bli med i fights.' },
  { min: -35, level: 'farm', label: 'FARM', icon: '🌾', headline: 'Farm og chill. Unngå fights til du er sterkere.' },
  { min: -Infinity, level: 'retreat', label: 'TREKK DEG', icon: '🛑', headline: 'Ikke kjemp nå. Trekk deg til trygg farm.' },
];

export const levelFor = (score) => FIGHT_LEVELS.find((l) => score >= l.min);

const phaseKey = (clock) => (clock < 600 ? 'laning' : clock < 1500 ? 'mid' : 'late');
const PHASE_TEXT = { laning: 'tidlig', mid: 'i midgame', late: 'sent i kampen' };
const CURVE_TEXT = { early: 'early-game', mid: 'midgame', late: 'late-game' };

// Strength of a hero right now (-1..1). Late-game heroes catch up as their core items get done.
export function heroStrength(name, clock, coreItemsOwned = 0) {
  const curve = powerCurve(name);
  let s = CURVE_STRENGTH[curve][phaseKey(clock)];
  if (curve === 'late') s = Math.min(1, s + 0.35 * coreItemsOwned);
  return s;
}

function ultimate(abilities) {
  return Object.values(abilities || {}).find((a) => a && a.ultimate && a.level > 0) || null;
}

// c: coach context (see engine.js)
export function fightAdvice(c) {
  if (!['laning', 'mid', 'late'].includes(c.phase) || !c.heroKey) return null;
  const reasons = [];
  const add = (delta, text) => {
    if (delta) reasons.push({ delta: Math.round(delta), text });
  };
  const hero = c.hero;

  if (hero.alive === false) {
    return { score: 0, level: 'dead', label: 'DØD', icon: '⏳', headline: 'Planlegg neste fight mens du venter på respawn.', reasons: [] };
  }

  // 1. Where your hero is on its power curve.
  const phase = phaseKey(c.clock);
  const own = heroStrength(c.heroKey, c.clock, c.coreOwned);
  const curve = powerCurve(c.heroKey);
  if (Math.abs(own) >= 0.3) {
    add(own * 15, own > 0 ? `${c.heroName} er sterk ${PHASE_TEXT[phase]}` : `${c.heroName} er en ${CURVE_TEXT[curve]}-hero og svak ${PHASE_TEXT[phase]}`);
  }

  // 2. Your team vs the enemy team in this phase (needs the draft).
  if (c.enemyKeys.length >= 3) {
    const theirs = c.enemyKeys.reduce((s, n) => s + heroStrength(n, c.clock), 0) / c.enemyKeys.length;
    // Without your teammates in the draft, only half-trust the comparison (it is just you vs. them).
    const known = c.allyKeys.length >= 2;
    const mine = known ? (own + c.allyKeys.reduce((s, n) => s + heroStrength(n, c.clock), 0)) / (1 + c.allyKeys.length) : own;
    const diff = mine - theirs;
    if (Math.abs(diff) >= 0.2) {
      add(diff * (known ? 25 : 12), diff > 0 ? 'Laget ditt er sterkere enn fienden i denne fasen' : 'Fiendelaget er sterkt i denne fasen');
    }
  }

  // 3. Fresh power spikes.
  const spike = c.recentEvent('spike-item', 180);
  if (spike) add(25, `Nytt powerspike: ${spike.data.dname}`);
  if (c.recentEvent('level6', 120)) add(15, 'Nivå 6: ultimaten er klar');

  // 4. Ultimate and key items on cooldown.
  const ult = ultimate(c.gsi.abilities);
  if (ult && hero.level >= 6) {
    if (ult.cooldown > 15) add(-20, `Ultimaten er på cooldown (${Math.round(ult.cooldown)} s)`);
    else if (ult.cooldown <= 0 && ult.can_cast !== false) add(8, 'Ultimaten er klar');
  }
  let itemCd = 0;
  for (let i = 0; i < 6; i++) {
    const slot = c.gsi.items?.[`slot${i}`];
    const name = slot?.name?.replace('item_', '');
    if (name && KEY_ACTIVES[name] && slot.cooldown > 5 && itemCd > -25) {
      itemCd -= 15;
      add(-15, `${KEY_ACTIVES[name]} er på cooldown (${Math.round(slot.cooldown)} s)`);
    }
  }

  // 5. HP and mana.
  const hp = hero.health_percent ?? 100;
  if (hp < 30) add(-40, `Lav HP (${hp} %)`);
  else if (hp < 55) add(-15, `Bare ${hp} % HP`);
  if (hero.max_mana > 200 && hero.mana_percent < 20) add(-12, 'Lite mana');

  // 6. About to finish an important item.
  if (c.next && c.next.core && c.next.remaining > 0) {
    const missing = c.next.remaining - c.player.gold;
    const secs = c.player.gpm > 0 ? (missing / c.player.gpm) * 60 : Infinity;
    if (missing <= 0) add(-10, `Kjøp ${c.next.dname} før du kjemper`);
    else if (secs <= 90) add(-15, `Bare ${missing} gull til ${c.next.dname}. Farm den ferdig først`);
  }

  // 7. Who is ahead, Aegis, recent deaths, buyback.
  const diff = c.teamKills - c.enemyKills;
  if (Math.abs(diff) >= 3) add(Math.max(-15, Math.min(15, diff * 1.5)), diff > 0 ? `Laget ditt leder ${c.teamKills}–${c.enemyKills} i kills` : `Laget ditt ligger under ${c.teamKills}–${c.enemyKills} i kills`);
  if (c.aegisTeam && c.clock - c.roshanKilledAt < 300) {
    add(c.aegisTeam === c.team ? 20 : -15, c.aegisTeam === c.team ? 'Laget ditt har Aegis. Press nå!' : 'Fienden har Aegis');
  }
  if (c.deathsSince(300) >= 2) add(-10, 'Du har dødd mye de siste minuttene');
  if (c.clock >= 1500 && c.role <= 3 && hero.buyback_cost && c.player.gold < hero.buyback_cost) add(-10, 'Du har ikke buyback-gull');

  const score = Math.max(-100, Math.min(100, reasons.reduce((s, r) => s + r.delta, 0)));
  const lvl = levelFor(score);
  reasons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { score, level: lvl.level, label: lvl.label, icon: lvl.icon, headline: lvl.headline, reasons: reasons.slice(0, 5) };
}
