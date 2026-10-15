// "Kjøp nå": item suggestions that adapt during the match. Recomputed on every update from what we know
// live (HP/mana history, the enemy draft, gold, role, game time). `liveItemCandidates` is pure; the
// `LiveItemTracker` adds hysteresis so suggestions do not flicker in and out.
import { COUNTER_RULES, MAGIC_NUKERS, SPELL_SPAMMERS } from '../../data/knowledge.js';
import { situationalItems } from './situational.js';

const heroList = (id) => COUNTER_RULES.find((r) => r.id === id)?.heroes || [];
const INVIS = heroList('invis');
const PHYSICAL = heroList('physical');
const LOCKDOWN = heroList('lockdown');
const HEALERS = heroList('heal');

const HP_REGEN = ['tango', 'tango_single', 'flask', 'faerie_fire', 'famango', 'great_famango', 'bottle', 'royal_jelly'];
const MANA_REGEN = ['clarity', 'enchanted_mango', 'bottle', 'soul_ring', 'arcane_boots', 'guardian_greaves', 'famango', 'great_famango', 'royal_jelly'];
const DETECTION = ['ward_sentry', 'ward_dispenser', 'dust', 'gem'];
const MAGIC_DEFENSE = ['black_king_bar', 'pipe', 'eternal_shroud', 'glimmer_cape', 'mage_slayer', 'cloak', 'sphere', 'lotus_orb'];
const ARMOR_DEFENSE = ['blade_mail', 'crimson_guard', 'heavens_halberd', 'shivas_guard', 'assault', 'butterfly', 'ghost', 'solar_crest', 'force_staff', 'ethereal_blade'];
const DISABLE_DEFENSE = ['black_king_bar', 'sphere', 'lotus_orb', 'glimmer_cape', 'force_staff', 'hurricane_pike', 'cyclone', 'wind_waker', 'manta'];

// Higher-level items that make a suggestion pointless ("outgrown"), on top of owning the item or what it builds into.
const OUTGROWN = {
  infused_raindrop: [...MAGIC_DEFENSE],
  magic_stick: ['magic_wand', 'holy_locket'],
  clarity: ['bottle', 'arcane_boots', 'guardian_greaves', 'soul_ring'],
  enchanted_mango: ['bottle', 'arcane_boots', 'guardian_greaves', 'soul_ring'],
};

const names = (list, enemies) => enemies.filter((e) => list.includes(e.name));
// Short hero list for the compact overlay row: "Lina, Lion +1".
const short = (list) => (list.length <= 2 ? list.map((e) => e.dname).join(', ') : `${list.slice(0, 2).map((e) => e.dname).join(', ')} +${list.length - 2}`);
const join = (list) => {
  const n = list.map((e) => e.dname);
  return n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} og ${n[n.length - 1]}`;
};

// Speaks for the whole HP/mana window: how much of the recent time the hero spent low, and how often it dropped low.
export function vitalStats(vitals, clock, { window = 150 } = {}) {
  const s = vitals.filter((v) => clock - v.t <= window && clock >= v.t && v.alive);
  const n = s.length;
  const share = (fn) => (n ? s.filter(fn).length / n : 0);
  let episodes = 0;
  for (let i = 0; i < n; i++) if (s[i].hp < 30 && (i === 0 || s[i - 1].hp >= 30)) episodes++;
  const mana = s.filter((v) => v.maxMana > 150);
  return {
    samples: n,
    lowHpShare: share((v) => v.hp < 35),
    lowHpEpisodes: episodes,
    lowManaShare: mana.length ? mana.filter((v) => v.mana < 25).length / mana.length : 0,
    manaSamples: mana.length,
  };
}

// x: { clock, phase, role, heroAttr, inv, gold, enemies: [{name,dname}], vitals (vitalStats), deathsRecent, db }
// Returns [{ item, priority, reason, kind, until?, alt? }] (not yet filtered for owned items).
export function liveItemCandidates(x) {
  if (!['pregame', 'laning', 'mid', 'late'].includes(x.phase)) return [];
  const { clock, role, inv, enemies = [], vitals = {} } = x;
  const out = [];
  const add = (item, priority, reason, kind, short, extra = {}) => out.push({ item, priority: Math.min(95, priority), reason, kind, short, ...extra });
  const holds = (list) => inv.held.some((n) => list.includes(n));
  const owns = (list) => list.some((n) => inv.owned.has(n));
  const dying = (x.deathsRecent || 0) >= 2;
  const enoughData = (vitals.samples || 0) >= 15;
  // Suggestions on screen now: their thresholds are lower, so they do not drop out on the border (hysteresis).
  const active = x.active || new Set();
  const on = (list) => list.some((n) => active.has(n));

  // 1. Often low on HP in the laning phase, and nothing to heal with.
  if (clock < 900 && enoughData && !holds(HP_REGEN)) {
    const was = on(['flask', 'bottle']);
    const often = vitals.lowHpShare >= (was ? 0.2 : 0.3) || vitals.lowHpEpisodes >= (was ? 1 : 2);
    if (often) {
      const severe = vitals.lowHpShare >= 0.45 || vitals.lowHpEpisodes >= 3;
      const why = 'Du er ofte på lav HP og har ingen regen.';
      if (role === 2 && clock < 720 && !inv.owned.has('bottle')) add('bottle', severe ? 82 : 72, `${why} Bottle fylles på med runer og holder deg i lanen.`, 'regen', 'Ofte lav HP', { until: 720, alt: ['flask'] });
      else add('flask', severe ? 82 : 72, `${why} En Healing Salve gjør at du slipper å gå tilbake.`, 'regen', 'Ofte lav HP', { until: 900, alt: clock < 480 ? ['tango'] : [] });
    }
  }

  // 2. Often out of mana, and nothing that gives mana back.
  if (clock < 1500 && (vitals.manaSamples || 0) >= 15 && vitals.lowManaShare >= (on(['bottle', 'soul_ring', 'arcane_boots', 'clarity', 'enchanted_mango']) ? 0.25 : 0.35) && !holds(MANA_REGEN) && !owns(['arcane_boots', 'guardian_greaves', 'soul_ring', 'bottle'])) {
    const severe = vitals.lowManaShare >= 0.5;
    const why = 'Du går ofte tom for mana.';
    if (role === 2 && clock < 600) add('bottle', severe ? 80 : 70, `${why} Bottle gir mana og HP hele lanefasen.`, 'mana', 'Ofte tom for mana', { until: 720 });
    else if (x.heroAttr === 'str' && role <= 3 && clock < 1200) add('soul_ring', severe ? 78 : 68, `${why} Soul Ring gir mana når du trenger den, og passer styrkehelter.`, 'mana', 'Ofte tom for mana', { until: 1200 });
    else if ((role >= 4 || x.heroAttr === 'int') && !inv.hasBootUpgrade && clock < 1200) add('arcane_boots', severe ? 78 : 68, `${why} Arcane Boots gir mana til deg og laget.`, 'mana', 'Ofte tom for mana', { until: 1200 });
    else if (clock < 600) add('clarity', severe ? 80 : 70, `${why} Clarity er billig mana (ikke bruk den mens du tar skade).`, 'mana', 'Ofte tom for mana', { until: 600, alt: ['enchanted_mango'] });
    else if (clock < 1200) add('enchanted_mango', 60, `${why} Enchanted Mango gir mana med en gang.`, 'mana', 'Ofte tom for mana', { until: 1200 });
  }

  // 3. Magic burst laners: Infused Raindrops early, real magic defence later.
  const nukers = names(MAGIC_NUKERS, enemies);
  if (nukers.length >= 2) {
    if (clock < 900 && !owns(MAGIC_DEFENSE)) {
      let p = nukers.length >= 3 ? 85 : 70;
      if (enoughData && vitals.lowHpShare >= 0.3) p += 8;
      add('infused_raindrop', p, `${join(nukers)} har mye magisk burst. Raindrops tar av magisk skade tidlig (bare verdt det før ca. 15 min).`, 'counter', `Magisk burst: ${short(nukers)}`, { until: 900 });
    }
    if (clock >= 720 && clock < 2400 && !owns(MAGIC_DEFENSE.filter((n) => n !== 'cloak'))) {
      const item = role >= 4 ? 'glimmer_cape' : role === 3 ? 'pipe' : 'black_king_bar';
      const what = { glimmer_cape: 'Glimmer Cape gir magisk resistens og redder deg eller en kjerne', pipe: 'Pipe beskytter hele laget mot magisk skade', black_king_bar: 'BKB gjør deg immun mot magi i fights' }[item];
      add(item, (nukers.length >= 3 ? 68 : 58) + (dying ? 15 : 0), `${join(nukers)} har mye magisk skade. ${what}.`, 'counter', `Magisk skade: ${short(nukers)}`, { until: 2400 });
    }
  }

  // 4. Spell spammers: Magic Stick early, Wand once the stick is there.
  const spam = names(SPELL_SPAMMERS, enemies);
  if (spam.length && clock < 1200) {
    const p = spam.length >= 2 ? 64 : 54;
    if (!inv.owned.has('magic_stick')) add('magic_stick', p, `${join(spam.slice(0, 3))} bruker evner hele tiden. Magic Stick lader seg fort og gir gratis HP og mana.`, 'counter', `Spammer evner: ${short(spam)}`, { until: 1200 });
    else if (!inv.owned.has('magic_wand') && !inv.owned.has('holy_locket') && clock < 900) add('magic_wand', p - 10, 'Gjør Magic Stick om til Magic Wand: flere ladninger og stats.', 'counter', `Spammer evner: ${short(spam)}`, { until: 900 });
  }

  // 5. Invisible heroes: sentries for supports, Dust for cores.
  const invis = names(INVIS, enemies);
  if (invis.length && !holds(DETECTION)) {
    if (role >= 4) add('ward_sentry', 76, `${join(invis)} kan bli usynlig. Ha alltid sentry wards på deg.`, 'vision', `Usynlige: ${short(invis)}`);
    else if (clock >= 240) add('dust', 58, `${join(invis)} kan bli usynlig. Dust i inventaret avslører dem i fights.`, 'counter', `Usynlige: ${short(invis)}`);
  }

  // 6. Heavy physical damage: armour and saves.
  const phys = names(PHYSICAL, enemies);
  if (phys.length >= 2 && clock >= 600 && !owns(ARMOR_DEFENSE)) {
    let item = null;
    if (role >= 4) item = clock < 1800 ? 'ghost' : 'force_staff';
    else if (role === 3) item = clock < 1500 ? 'blade_mail' : 'crimson_guard';
    else if (clock >= 1500) item = x.heroAttr === 'agi' ? 'butterfly' : 'assault';
    else if (role === 2 && x.heroAttr === 'int') item = 'ghost';
    const what = { ghost: 'Ghost Scepter stopper right-click i kritiske sekunder', force_staff: 'Force Staff tar deg ut av fights', blade_mail: 'Blade Mail straffer dem som slår deg', crimson_guard: 'Crimson Guard blokkerer skade for hele laget', butterfly: 'Butterfly gir evasion mot right-click', assault: 'Assault Cuirass gir mye armor' }[item];
    if (item) add(item, 55 + (dying ? 15 : 0), `${join(phys.slice(0, 3))} gjør mye fysisk skade. ${what}.`, 'counter', `Fysisk skade: ${short(phys)}`);
  }

  // 7. A lot of disables: BKB / Lotus / Glimmer / Force.
  const lock = names(LOCKDOWN, enemies);
  if (lock.length >= 3 && clock >= 900 && clock < 2700 && !owns(DISABLE_DEFENSE)) {
    const item = role >= 4 ? 'glimmer_cape' : role === 3 ? 'lotus_orb' : 'black_king_bar';
    add(item, 60 + (dying ? 15 : 0), `${join(lock.slice(0, 3))} har mye disable. ${item === 'black_king_bar' ? 'BKB' : item === 'lotus_orb' ? 'Lotus Orb' : 'Glimmer Cape'} hjelper deg å overleve stunnene.`, 'counter', `Mye disable: ${short(lock)}`);
  }

  // 8. Healing enemies: anti-heal for supports and the offlaner.
  const heal = names(HEALERS, enemies);
  if (heal.length && role >= 3 && clock >= 600 && clock < 2400 && !inv.owned.has('spirit_vessel')) {
    add('spirit_vessel', 50, `${join(heal.slice(0, 3))} healer mye. Spirit Vessel kutter healingen.`, 'counter', `Healing: ${short(heal)}`);
  }

  // 9. Supports: vision and smoke.
  if (role >= 4 && clock >= 120) {
    if (!inv.wards) add('ward_observer', 66, 'Du har ingen observer wards. Vision redder liv og finner kills.', 'vision', 'Ingen observers');
    if (role === 5 && !holds(DETECTION)) add('ward_sentry', 46, 'Sentry wards: deward fiendens wards og beskytt leirene.', 'vision', 'Deward');
    if (role === 4 && clock >= 360 && clock < 2400 && !inv.held.includes('smoke_of_deceit')) add('smoke_of_deceit', 40, 'Smoke of Deceit til ganks rundt runer og leirer.', 'vision', 'Smoke-ganks');
  }

  // 10. Other counters from the draft (evasion, illusions, break, mobility), once they start to matter.
  if (clock >= 900 && enemies.length && x.db) {
    for (const s of situationalItems(enemies, role, x.db)) {
      if (!['evasion', 'illusions', 'break', 'mobile'].includes(s.rule)) continue;
      if (x.db.cost(s.item) > 3000 && clock < 1200) continue;
      add(s.item, 42, s.why, 'counter', { evasion: 'Evasion', illusions: 'Illusjoner', break: 'Sterke passiver', mobile: 'Mobile helter' }[s.rule]);
    }
  }

  // One entry per item: the highest priority wins.
  const best = new Map();
  for (const c of out) if (!best.has(c.item) || best.get(c.item).priority < c.priority) best.set(c.item, c);
  return [...best.values()];
}

// Owned, or replaced by something better.
export function isOutgrown(item, inv) {
  if (inv.held.includes(item)) return true;
  if (item === 'ward_observer') return inv.wards > 0;
  if (item === 'arcane_boots' && inv.hasBootUpgrade) return true;
  if (inv.owned.has(item)) return true; // held, or a component of something held
  return (OUTGROWN[item] || []).some((n) => inv.owned.has(n));
}

const ENTER_SECS = 4; // a suggestion must hold this long (game seconds) before it shows
const EXIT_SECS = 30; // and stays this long after the reason went away (no flicker)
const PEAK_SECS = 60; // a priority that went down is shown at its peak this long

// Keeps suggestions stable between updates.
export class LiveItemTracker {
  constructor() {
    this.entries = new Map(); // item -> { cand, firstSeen, lastSeen, shownAt, peak, peakAt }
    this.lastClock = null;
  }

  // Items on screen now (liveItemCandidates uses lower thresholds for them).
  shown() {
    return new Set([...this.entries].filter(([, e]) => e.shownAt !== null).map(([item]) => item));
  }

  // ctx: { clock, inv, gold, db, playing }
  update(cands, ctx) {
    const { clock, inv, db } = ctx;
    if (this.lastClock !== null && clock < this.lastClock - 5) this.entries.clear(); // clock went back: new match
    this.lastClock = clock;
    if (!ctx.playing) {
      this.entries.clear();
      return [];
    }
    for (const c of cands) {
      if (isOutgrown(c.item, inv)) continue;
      const e = this.entries.get(c.item);
      if (e) {
        e.cand = c;
        e.lastSeen = clock;
        // The shown priority only goes down after a while, so the order does not jump around.
        if (c.priority >= e.peak || clock - e.peakAt > PEAK_SECS) {
          e.peak = c.priority;
          e.peakAt = clock;
        }
      } else this.entries.set(c.item, { cand: c, firstSeen: clock, lastSeen: clock, shownAt: null, peak: c.priority, peakAt: clock });
    }
    const out = [];
    for (const [item, e] of this.entries) {
      const gone = clock - e.lastSeen > (e.shownAt === null ? 0 : EXIT_SECS);
      if (gone || isOutgrown(item, inv) || (e.cand.until != null && clock >= e.cand.until)) {
        this.entries.delete(item);
        continue;
      }
      if (e.shownAt === null && clock - e.firstSeen >= (e.cand.priority >= 80 ? 2 : ENTER_SECS)) e.shownAt = clock;
      if (e.shownAt === null) continue;
      const c = e.cand;
      const remaining = db.remainingCost(item, inv.pool);
      const gold = ctx.gold || 0;
      const missing = Math.max(0, remaining - gold);
      out.push({
        id: item,
        item,
        dname: db.dname(item),
        cost: db.cost(item),
        remaining,
        afford: missing === 0,
        missing,
        goldText: remaining === 0 ? 'Gratis' : missing === 0 ? 'Du har råd nå' : `Mangler ${missing} gull`,
        reason: c.reason,
        short: c.short || '',
        priority: e.peak,
        kind: c.kind,
        alt: (c.alt || []).filter((a) => !isOutgrown(a, inv)).map((a) => ({ item: a, dname: db.dname(a), cost: db.cost(a) })),
        since: e.shownAt,
      });
    }
    return out.sort((a, b) => b.priority - a.priority || a.since - b.since || a.item.localeCompare(b.item)).slice(0, 5);
  }
}
