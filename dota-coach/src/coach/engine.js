// Turns raw Game State Integration payloads into coaching state for the UI.
import { TIMINGS, FOCUS } from '../../data/knowledge.js';
import { RULES, expectedSkillPoints } from './rules.js';
import { readInventory, nextItem } from './items.js';
import { locate, safeLane, offLane } from './map.js';
import { computeTimers, fmtGameClock } from './timers.js';
import { situationalItems, enemyTips } from './situational.js';
import { percentileOf } from './percentile.js';
import { fightAdvice } from './fight.js';
import { MatchRecorder } from './recorder.js';
import { SPIKE_ITEMS } from '../../data/knowledge.js';
import { nextSkillPoint, talentAdvice, neutralAdvice, neutralByTier, readEquippedNeutral, neutralGearAdvice, compactSample } from './skills.js';
import { liveItemCandidates, vitalStats, LiveItemTracker } from './live-items.js';
import { snapshot, pushSnapshot, freezeDeath, buildDeathRecap } from './death.js';
import { RoutePlanner } from './routes.js';

export { percentileOf };

const LEVEL_ORDER = { alert: 0, warn: 1, good: 2, info: 3 };
const playingPhase = (p) => ['strategy', 'pregame', 'laning', 'mid', 'late'].includes(p);
const VITALS_SECS = 180; // HP/mana history kept for the live item suggestions
// Own buildings that mean "the base is under attack" when they lose HP.
// GSI names: dota_goodguys_tower3_bot, good_rax_melee_bot, bad_rax_range_top, dota_badguys_fort …
const BASE_BUILDING = /(tower3|tower4|_rax_(?:melee|range)|_fort)/;

// Tip keys must stay unique across matches and server restarts (clients remember what they have read aloud).
const BOOT_ID = Math.random().toString(36).slice(2, 7);
let tipCounter = 0;

export const PHASE_LABEL = {
  menu: 'I menyen',
  loading: 'Laster inn',
  draft: 'Hero-valg',
  strategy: 'Strategitid',
  pregame: 'Før hornet',
  laning: 'Laning (0–10 min)',
  mid: 'Midgame (10–25 min)',
  late: 'Lategame (25+ min)',
  post: 'Kampen er over',
};

export const ROLE_LABEL = { 1: 'Pos 1 – Carry', 2: 'Pos 2 – Mid', 3: 'Pos 3 – Offlane', 4: 'Pos 4 – Soft support', 5: 'Pos 5 – Hard support' };

export function phaseOf(gsi) {
  const map = gsi?.map;
  if (!map || gsi?.player?.activity === 'menu') return 'menu';
  switch (map.game_state) {
    case 'DOTA_GAMERULES_STATE_HERO_SELECTION':
      return 'draft';
    case 'DOTA_GAMERULES_STATE_STRATEGY_TIME':
    case 'DOTA_GAMERULES_STATE_TEAM_SHOWCASE':
    case 'DOTA_GAMERULES_STATE_WAIT_FOR_MAP_TO_LOAD':
      return 'strategy';
    case 'DOTA_GAMERULES_STATE_PRE_GAME':
      return 'pregame';
    case 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS': {
      const t = map.clock_time || 0;
      return t < 600 ? 'laning' : t < 1500 ? 'mid' : 'late';
    }
    case 'DOTA_GAMERULES_STATE_POST_GAME':
      return 'post';
    default:
      return 'loading';
  }
}

// Keeps tips stable between updates and decides which ones may be read aloud.
// A tip keeps the same `key` while it stays active; clients read `say` aloud once per key.
export class TipTracker {
  constructor() {
    this.active = new Map(); // id -> { key, say, since }
    this.lastSaid = new Map(); // id -> clock
  }

  process(tips, clock) {
    const now = new Map();
    const out = [];
    for (const t of tips) {
      let entry = this.active.get(t.id);
      if (!entry) {
        entry = { key: `${t.id}#${BOOT_ID}${++tipCounter}`, say: null, since: Date.now() };
        const last = this.lastSaid.get(t.id);
        const cooldown = t.cooldown ?? 60;
        if (t.say && (last === undefined || clock - last >= cooldown || clock < last)) {
          entry.say = t.say;
          this.lastSaid.set(t.id, clock);
        }
      }
      now.set(t.id, entry);
      out.push({ key: entry.key, id: t.id, level: t.level, icon: t.icon, text: t.text, say: entry.say, since: entry.since });
    }
    this.active = now;
    return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  }
}

export class Coach {
  // deps: { itemDb, heroes (Map name -> hero), getHeroMeta(name) -> {build, benchmarks}|null, getDraft(), getSettings() }
  constructor(deps) {
    this.deps = deps;
    this.T = deps.timings || TIMINGS;
    this.finished = [];
    // A compact sample of the raw GSI neutral item data, for /api/diagnostics (the real shape is unverified).
    this.neutralDiag = null;
    this.reset(null);
  }

  // Keeps a small copy of gsi.neutralitems and the neutral item slots (at most every 5 s, and always the first
  // time the parser finds a craft choice), with what the parser made of them.
  recordNeutralSample(gsi, skills) {
    try {
      const block = gsi.neutralitems;
      const slots = Object.fromEntries(Object.entries(gsi.items || {}).filter(([k]) => /neutral|enchant|enhance/i.test(k)));
      if (block == null && !Object.keys(slots).length) return;
      const d = (this.neutralDiag ||= { updates: 0, withBlock: 0, sampledAt: 0, last: null, withChoices: null });
      d.updates++;
      if (block != null) d.withBlock++;
      const n = skills?.neutral;
      const choices = !!(n && (n.artifacts.length || n.enchantments.length));
      const now = Date.now();
      if (now - d.sampledAt < 5000 && !(choices && !d.withChoices)) return;
      d.sampledAt = now;
      const sample = {
        clock: this.clock,
        match: this.matchId,
        block: block === undefined ? '(ingen neutralitems i GSI)' : compactSample(block, 3500),
        slots: compactSample(slots, 600),
        parsed: {
          player: n ? n.source || '(rot)' : null,
          tier: n?.tier ?? null,
          madstone: n?.madstone ?? null,
          artifacts: n ? n.artifacts.map((a) => `${a.name}${a.selected ? '*' : ''}`) : [],
          enchantments: n ? n.enchantments.map((e) => `${e.name}${e.selected ? '*' : ''}`) : [],
          openTier: skills?.neutralTier?.tier ?? null,
          equipped: skills?.neutralGear ? [skills.neutralGear.artifact?.name || null, skills.neutralGear.enchantment?.name || null] : null,
          gear: skills?.neutralGear?.advice?.kind || null,
        },
      };
      d.last = sample;
      if (choices) d.withChoices = sample;
    } catch {
      /* diagnostics must never break the coach */
    }
  }

  reset(matchId) {
    // A match that was cut short (new match / back to menu) still gets analysed.
    if (this.rec && !this.rec.done && this.rec.length >= 30) this.finishMatch('unknown');
    this.matchId = matchId;
    this.rec = matchId ? new MatchRecorder(matchId) : null;
    this.roshanKills = [];
    this.aegisTeam = null;
    this.prevInventory = null;
    this.prevLevel = null;
    this.fightStable = null;
    this.fightCandidate = null;
    this.tips = new TipTracker();
    // The minimap sample survives a new match, so /api/diagnostics still shows it after the game.
    this.lastMinimap = this.router?.mem?.minimap || this.lastMinimap || null;
    this.router = new RoutePlanner();
    this.holds = new Map();
    this.events = [];
    this.seenGsiEvents = new Set();
    this.deathClocks = [];
    this.lastDeaths = null;
    this.lastDaytime = null;
    this.roshanKilledAt = null;
    this.aegisAt = null;
    this.lhAt10 = null;
    this.lastNeutral = null;
    this.offeredNeutrals = new Map(); // tier -> names the game offered (craft choices)
    this.clock = 0;
    this.vitals = []; // [{ t, hp, mana, maxMana, alive }] one per game second
    this.liveItems = new LiveItemTracker();
    this.deathSnaps = []; // the last seconds while alive (death recap input)
    this.death = null; // frozen death while the hero is dead
    this.lastAlive = null;
    this.buildingHp = new Map();
    this.baseHitAt = null;
  }

  // HP/mana once per game second while alive (rolling window).
  trackVitals(hero, playingNow) {
    if (!playingNow || !hero || typeof hero.health_percent !== 'number') return;
    const last = this.vitals[this.vitals.length - 1];
    if (last && this.clock < last.t - 5) this.vitals = []; // clock went back
    if (last && Math.floor(this.clock) <= last.t) return;
    this.vitals.push({ t: Math.floor(this.clock), hp: hero.health_percent, mana: hero.mana_percent ?? 100, maxMana: hero.max_mana ?? 0, alive: hero.alive !== false });
    while (this.vitals.length && this.clock - this.vitals[0].t > VITALS_SECS) this.vitals.shift();
  }

  // Remembers when a tier-3/4 tower, barracks or the Ancient last lost HP (GSI sends your own buildings).
  trackBase(gsi, team) {
    const own = gsi.buildings?.[team];
    if (!own || typeof own !== 'object') return;
    for (const [k, b] of Object.entries(own)) {
      if (!BASE_BUILDING.test(k) || typeof b?.health !== 'number') continue;
      const prev = this.buildingHp.get(k);
      if (prev !== undefined && b.health < prev) this.baseHitAt = this.clock;
      this.buildingHp.set(k, b.health);
    }
  }

  // Live "buy now" suggestions (with hysteresis) and the death recap; both go into c and the state.
  trackLive(c) {
    const playingNow = ['pregame', 'laning', 'mid', 'late'].includes(c.phase) && !!c.heroKey;
    this.trackVitals(c.hero, playingNow);
    c.liveItems = [];
    try {
      const cands = playingNow
        ? liveItemCandidates({
            clock: c.clock,
            phase: c.phase,
            role: c.role,
            heroAttr: c.heroAttr,
            inv: c.inv,
            gold: c.player.gold ?? 0,
            enemies: c.enemies,
            vitals: vitalStats(this.vitals, c.clock),
            deathsRecent: c.deathsSince(300),
            db: c.db,
            active: this.liveItems.shown(),
          })
        : [];
      c.liveItems = this.liveItems.update(cands, { clock: c.clock, inv: c.inv, gold: c.player.gold ?? 0, db: c.db, playing: playingNow });
    } catch (err) {
      console.error('Live-items feilet:', err.message);
    }

    c.deathRecap = null;
    const alive = c.hero?.alive !== false;
    if (!playingNow || !['laning', 'mid', 'late'].includes(c.phase)) {
      this.death = null;
      this.lastAlive = playingNow ? alive : null;
      if (playingNow && alive) pushSnapshot(this.deathSnaps, snapshot(c));
      return;
    }
    if (alive) {
      this.death = null;
      pushSnapshot(this.deathSnaps, snapshot(c));
    } else if (this.lastAlive === true && !this.death && this.deathSnaps.length) {
      this.death = freezeDeath(this.deathSnaps, { clock: c.clock, unreliable: c.player.gold_unreliable });
      this.deathSnaps = [];
    }
    this.lastAlive = alive;
    if (!this.death) return;
    // The gold loss may arrive a moment after the death.
    if (this.death.unAfter === this.death.unBefore && c.clock - this.death.t <= 2) this.death.unAfter = c.player.gold_unreliable ?? this.death.unAfter;
    try {
      c.deathRecap = buildDeathRecap(this.death, {
        clock: c.clock,
        role: c.role,
        team: c.team,
        phase: c.phase,
        hero: c.hero,
        player: c.player,
        inv: c.inv,
        next: c.next,
        liveItems: c.liveItems,
        db: c.db,
        teamKills: c.teamKills,
        deaths: c.player.deaths ?? null,
        streak: c.deathsSince(300),
        baseThreat: this.baseHitAt !== null && c.clock - this.baseHitAt <= 20 && c.clock >= this.baseHitAt,
        enemyAegis: !!(c.aegisTeam && c.aegisTeam !== c.team && c.roshanKilledAt != null && c.clock - c.roshanKilledAt < 300),
      });
    } catch (err) {
      console.error('Dødsoppsummering feilet:', err.message);
    }
  }

  finishMatch(result) {
    if (!this.rec || this.rec.done) return;
    const roshan = this.roshanKills.map((r) => ({ t: r.t, ours: r.team === this.team }));
    this.finished.push(this.rec.finish({ result, roshan }));
  }

  // What the optional GSI minimap block looked like (for /api/diagnostics).
  minimapDiagnostics() {
    return this.router?.mem?.minimap || this.lastMinimap || { received: false };
  }

  // Matches that ended since the last call (for the post-game analysis).
  popFinished() {
    const out = this.finished;
    this.finished = [];
    return out;
  }

  held(id, cond, secs) {
    if (!cond) {
      this.holds.delete(id);
      return false;
    }
    if (!this.holds.has(id)) this.holds.set(id, this.clock);
    return this.clock - this.holds.get(id) >= secs;
  }

  pushEvent(type, data = {}) {
    this.events.push({ type, clock: this.clock, data });
    if (this.events.length > 200) this.events.shift();
  }

  recentEvent(type, secs) {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (this.clock - e.clock > secs) return null;
      if (e.type === type) return e;
    }
    return null;
  }

  trackHistory(gsi, phase) {
    const map = gsi.map || {};
    const player = gsi.player || {};
    const playingNow = ['pregame', 'laning', 'mid', 'late'].includes(phase);

    if (typeof player.deaths === 'number') {
      if (this.lastDeaths !== null && player.deaths > this.lastDeaths) {
        this.deathClocks.push(this.clock);
        this.pushEvent('death');
      }
      this.lastDeaths = player.deaths;
    }
    if (typeof map.daytime === 'boolean') {
      if (playingNow && this.lastDaytime !== null && map.daytime !== this.lastDaytime) this.pushEvent('daynight', { daytime: map.daytime });
      this.lastDaytime = map.daytime;
    }
    if (this.lhAt10 === null && this.clock >= 600 && typeof player.last_hits === 'number') this.lhAt10 = player.last_hits;

    // GSI "events" (Roshan, Aegis …) use game_time; convert to the in-game clock.
    const offset = (map.game_time ?? 0) - (map.clock_time ?? 0);
    for (const ev of Array.isArray(gsi.events) ? gsi.events : []) {
      const k = `${ev.event_type}@${ev.game_time}`;
      if (this.seenGsiEvents.has(k)) continue;
      this.seenGsiEvents.add(k);
      const at = typeof ev.game_time === 'number' ? ev.game_time - offset : this.clock;
      if (ev.event_type === 'roshan_killed') {
        this.roshanKilledAt = at;
        this.aegisTeam = ev.killed_by_team === 'radiant' || ev.killed_by_team === 'dire' ? ev.killed_by_team : null;
        this.roshanKills.push({ t: at, team: this.aegisTeam });
      }
      if (ev.event_type === 'aegis_picked_up') this.aegisAt = at;
    }
  }

  // Power spikes: a core item lands in the inventory, or the hero hits level 6.
  trackSpikes(c) {
    const inv = c.inv.inventory;
    if (this.prevInventory) {
      for (const n of inv) {
        if (this.prevInventory.includes(n)) continue;
        if ((c.coreItems.includes(n) || SPIKE_ITEMS.includes(n)) && c.db.cost(n) >= 1000) {
          this.pushEvent('spike-item', { name: n, dname: c.db.dname(n) });
        }
      }
    }
    this.prevInventory = inv;
    const lvl = c.hero.level;
    if (typeof lvl === 'number') {
      if (this.prevLevel !== null && this.prevLevel < 6 && lvl >= 6) this.pushEvent('level6');
      this.prevLevel = lvl;
    }
  }

  // Only report a new fight level after it has held for a few seconds (no flip-flopping).
  stabiliseFight(fight) {
    if (!fight || fight.level === 'dead') {
      this.fightCandidate = null;
      return;
    }
    if (fight.level === this.fightStable) {
      this.fightCandidate = null;
      return;
    }
    if (!this.fightCandidate || this.fightCandidate.level !== fight.level) this.fightCandidate = { level: fight.level, since: this.clock };
    if (this.clock - this.fightCandidate.since >= 8 || this.fightStable === null) {
      const from = this.fightStable;
      this.fightStable = fight.level;
      this.fightCandidate = null;
      if (from !== null) this.pushEvent('fight-shift', { from, to: fight.level });
    }
  }

  // Ability levels and talents as GSI reports them. `skillable` (names that really take points, e.g. from
  // pro builds) keeps innate abilities and sub-spells such as "Release" out of the count.
  readSkills(gsi, skillable) {
    const hero = gsi.hero || {};
    const levels = {};
    const ultimates = new Set();
    for (const a of Object.values(gsi.abilities || {})) {
      const name = String(a?.name || '');
      if (!name || typeof a.level !== 'number' || name.startsWith('special_bonus')) continue;
      if (skillable && !skillable.has(name)) continue;
      levels[name] = a.level;
      if (a.ultimate) ultimates.add(name);
    }
    // talent_1/talent_2 are the two choices at level 10, talent_3/4 at 15, and so on.
    const talentTiers = new Set();
    for (let i = 1; i <= 8; i++) if (hero[`talent_${i}`]) talentTiers.add(Math.ceil(i / 2));
    return { level: hero.level || 0, levels, ultimates, talentTiers };
  }

  unspentPoints(gsi, skillable) {
    const hero = gsi.hero;
    if (!hero?.level || !gsi.abilities) return 0;
    const cur = this.readSkills(gsi, skillable);
    const used = Object.values(cur.levels).reduce((s, v) => s + v, 0) + cur.talentTiers.size;
    return Math.max(0, expectedSkillPoints(hero.level) - used);
  }

  // Next ability/talent, the talent choice when one is open, and the neutral item craft.
  skillAdvice(c, stats) {
    const out = { next: null, talent: null, neutral: null, typical: stats?.typical?.slice(0, 16) || [], games: stats?.games || 0, unspent: c.unspent, spent: null };
    if (c.gsi.abilities && c.hero?.level) {
      const cur = this.readSkills(c.gsi, stats?.abilities?.length ? new Set(stats.abilities.map((a) => a.name)) : null);
      out.spent = Object.values(cur.levels).reduce((sum, v) => sum + v, 0) + cur.talentTiers.size;
      if (c.unspent > 0 && stats) out.next = nextSkillPoint(stats, cur);
      const dyingALot = c.deathsSince(600) >= 3;
      // The talent tier the next point goes into, else one that is open now (or the next one): show its pro split.
      const nextTier = out.next?.talent ? stats.talents.find((t) => t.options.some((o) => o.name === out.next.name))?.tier : null;
      const tier = nextTier || [1, 2, 3, 4].find((t) => !cur.talentTiers.has(t) && c.hero.level >= [10, 15, 20, 25][t - 1] - 1);
      if (tier && stats) {
        out.talent = talentAdvice(stats, tier, { dyingALot });
        if (out.talent) out.talent.open = c.hero.level >= out.talent.level;
      }
      // One answer for "which talent": the talent advice (it also weighs win rates and the game) decides.
      if (out.next?.talent && out.talent && out.talent.pick !== out.next.name) {
        const opt = out.talent.options.find((o) => o.name === out.talent.pick);
        const was = { name: out.next.name, dname: out.next.dname, pct: out.next.pct };
        out.next = { ...out.next, name: opt.name, dname: opt.dname, pct: opt.pct ?? out.next.pct, alternatives: [was], reason: out.talent.reason };
      } else if (out.next?.talent && out.talent) out.next.reason = out.talent.reason;
    }
    // Neutral items. The tier open by the clock, unless the game shows a craft for a higher one.
    const inGameNow = ['laning', 'mid', 'late'].includes(c.phase);
    const open = [...(this.T.neutralTiers || [])].reverse().find((t) => c.clock >= t.at) || { tier: 1, at: 0 };
    if (c.gsi.neutralitems != null) {
      try {
        out.neutral = neutralAdvice({
          gsiNeutral: c.gsi.neutralitems,
          team: c.team,
          teamSlot: c.player.team_slot,
          who: { playerSlot: c.player.player_slot, steamid: c.player.steamid, accountid: c.player.accountid, name: c.player.name },
          stats,
          itemDb: c.db,
          role: c.role,
          attr: c.heroAttr,
          clockTier: open.tier,
        });
      } catch (err) {
        console.error('Nøytral-råd feilet:', err.message);
      }
    }
    // A payload without the block (or an unreadable one) right after a good one: keep the last choice a few seconds.
    if (out.neutral) {
      this.lastNeutral = { clock: c.clock, advice: out.neutral };
      if (out.neutral.tier != null) {
        const names = [...(out.neutral.artifacts || []), ...(out.neutral.enchantments || [])].map((x) => x.name);
        this.offeredNeutrals.set(out.neutral.tier, new Set([...(this.offeredNeutrals.get(out.neutral.tier) || []), ...names]));
      }
    }
    else if (c.gsi.neutralitems == null && this.lastNeutral && c.clock - this.lastNeutral.clock >= 0 && c.clock - this.lastNeutral.clock <= 10) out.neutral = this.lastNeutral.advice;
    if (inGameNow) {
      const tier = Math.max(open.tier, Math.min(5, out.neutral?.tier || 0));
      out.neutralTier = { tier, since: tier === open.tier ? Math.max(0, c.clock - open.at) : 0 };
      // The best artifacts and enchantments for the tier that is open now (pro pick rates when OpenDota has them,
      // otherwise by what the stats give this hero and role). Shown when the game offers no craft choice.
      out.proNeutrals = neutralByTier({ tier, stats, itemDb: c.db, role: c.role, attr: c.heroAttr });
      // What is equipped, and whether it should be upgraded or is clearly worse than the recommendation.
      const equipped = readEquippedNeutral(c.gsi.items, c.db);
      // What he wears now counts as chosen, even if the game's block has no "selected" flag.
      if (out.neutral && equipped.seen) {
        for (const x of out.neutral.artifacts || []) if (x.name === equipped.artifact?.name) x.selected = true;
        for (const x of out.neutral.enchantments || []) if (x.name === equipped.enchantment?.name) x.selected = true;
      }
      if (equipped.seen) {
        out.neutralGear = {
          artifact: equipped.artifact,
          enchantment: equipped.enchantment,
          advice: neutralGearAdvice({ equipped, tier, sinceOpen: out.neutralTier.since, clock: c.clock, rec: out.proNeutrals, stats, itemDb: c.db, role: c.role, attr: c.heroAttr, offered: this.offeredNeutrals.get(tier) }),
        };
      }
    }
    return out;
  }

  farmAdvice(c) {
    const safe = `${safeLane(c.team)} lane`;
    const off = `${offLane(c.team)} lane`;
    const r = c.role;
    if (['draft', 'strategy', 'pregame'].includes(c.phase)) {
      return {
        1: `Du skal i ${safe} (safe lane) sammen med pos 5.`,
        2: 'Du skal mid. Kjøp gjerne Bottle tidlig.',
        3: `Du skal i ${off} (offlane) sammen med pos 4.`,
        4: `Start i ${off} med offlaneren, eller roter tidlig til mid.`,
        5: `Start i ${safe} med carryen din.`,
      }[r];
    }
    if (!['laning', 'mid', 'late'].includes(c.phase)) return null;
    // The live route decides where to go; the text says the same thing as the arrow on the minimap.
    const route = c.route?.target ? c.route : null;
    const plan = route ? `Ruten nå: ${route.steps.map((s) => s.label).join(' → ')}.` : '';
    if (c.hero && c.hero.alive === false) {
      return `Bruk tiden mens du er død: se hvor bølgene og fiendene er.${route ? ` Når du spawner: ${route.steps.map((s) => s.label).join(' → ')}.` : ''}`;
    }
    if (c.phase === 'laning') {
      const base = {
        1: `Bli i ${safe}. Ta small- eller medium-leiren i egen jungel hvis bølgen er pushet eller lanen er for farlig.`,
        2: 'Bli mid. Ta en leir på egen side når bølgen er pushet, og vær ved runen når den spawner.',
        3: `Hold deg i ${off}. Trekk leiren hvis bølgen presses mot tårnet ditt, og få nivåer.`,
        4: 'Roter mellom lanene, stack leirer ved :53 og ta runer.',
        5: 'Pull leiren når lanen presses mot carryen, og stack ved :53.',
      }[r];
      return route && route.target.kind !== 'lane' ? `${plan} ${route.reason}` : `${base}${plan ? ` ${plan}` : ''}`;
    }

    let eta = '';
    if (c.next && c.next.remaining > c.player.gold && c.player.gpm > 0) {
      const mins = (c.next.remaining - c.player.gold) / c.player.gpm;
      eta = ` Du trenger ${c.next.remaining - c.player.gold} gull til ${c.next.dname} (ca. ${Math.max(1, Math.round(mins))} min med din GPM).`;
    }
    if (route) return `${plan} ${route.reason}${r <= 3 ? eta : ''}`;
    const lostSafeT1 = c.towerDown(1, safeLane(c.team));
    if (r === 1 || r === 2) {
      const lane = lostSafeT1 ? `${safe}-bølgen ved T2-tårnet` : `${safe}-bølgen`;
      const base = c.phase === 'late'
        ? 'Farm bølgene som kommer til egne tårn, og jungelen på egen side. Ikke farm alene i fiendens jungel uten vision.'
        : `Farm-rute: ${lane}, så egen jungel (stack en leir på veien), så neste bølge som nærmer seg.`;
      return base + eta;
    }
    if (r === 3) return `Lag space: press ${off} og motsatt side av kartet fra carryen. Ta leirene i offlane-jungelen mellom fightene.${eta}`;
    return 'Ikke ta farm fra kjernene. Ta bølger ingen andre rekker, stack leirer og plasser vision foran laget.';
  }

  update(gsi) {
    const d = this.deps;
    const settings = d.getSettings();
    const map = gsi.map || {};
    const matchId = map.matchid || null;
    if (matchId && matchId !== this.matchId) this.reset(matchId);

    const phase = phaseOf(gsi);
    if (phase === 'menu' && this.rec && !this.rec.done && this.rec.length >= 30) this.finishMatch('unknown');
    this.clock = typeof map.clock_time === 'number' ? map.clock_time : 0;
    this.trackHistory(gsi, phase);

    const hero = gsi.hero || {};
    const player = gsi.player || {};
    const heroName = hero.name ? hero.name.replace('npc_dota_hero_', '') : null;
    const heroInfo = heroName ? d.heroes.get(heroName) : null;
    const role = Number(settings.role) || 1;
    const team = player.team_name === 'dire' ? 'dire' : 'radiant';
    const meta = heroName ? d.getHeroMeta(heroName) : null;
    const inv = readInventory(gsi.items, d.itemDb);
    const build = meta?.build || null;

    // The items that make this hero strong: the most popular mid/late-game items.
    const coreItems = build ? [...build.mid.slice(0, 3), ...build.late.slice(0, 3)].map((x) => x.name) : [];
    let next = nextItem(build, inv, this.clock);
    if (next) next = { ...next, remaining: d.itemDb.remainingCost(next.name, inv.pool), core: coreItems.includes(next.name) || SPIKE_ITEMS.includes(next.name) };

    const draft = d.getDraft();
    const enemies = draft.enemies.map((n) => d.heroes.get(n)).filter(Boolean);
    const radiant = team === 'radiant';
    this.team = team;

    const perf = {};
    if (meta?.benchmarks && this.clock >= 600) {
      perf.gpmPct = percentileOf(meta.benchmarks.gold_per_min, player.gpm);
      perf.xpmPct = percentileOf(meta.benchmarks.xp_per_min, player.xpm);
      perf.lhPct = percentileOf(meta.benchmarks.last_hits_per_min, player.last_hits / (this.clock / 60));
    }

    const ownBuildings = gsi.buildings?.[team];
    const prefix = team === 'dire' ? 'dota_badguys' : 'dota_goodguys';
    const c = {
      gsi,
      phase,
      clock: this.clock,
      role,
      team,
      hero,
      player,
      heroName: heroInfo?.dname || heroName || 'helten din',
      heroKey: heroName,
      inv,
      build,
      next,
      coreItems,
      coreOwned: coreItems.filter((n) => inv.owned.has(n)).length,
      enemyKeys: enemies.map((e) => e.name),
      enemies: enemies.map((e) => ({ name: e.name, dname: e.dname })),
      allyKeys: draft.allies.filter((n) => n !== heroName && d.heroes.has(n)),
      teamKills: (radiant ? map.radiant_score : map.dire_score) ?? 0,
      enemyKills: (radiant ? map.dire_score : map.radiant_score) ?? 0,
      aegisTeam: this.aegisTeam,
      loc: locate(hero.xpos, hero.ypos, team),
      T: this.T,
      db: d.itemDb,
      perf,
      unspent: this.unspentPoints(gsi, meta?.skills?.abilities?.length ? new Set(meta.skills.abilities.map((a) => a.name)) : null),
      heroAttr: heroInfo?.attr || null,
      roshanKilledAt: this.roshanKilledAt,
      lhAt10: this.lhAt10,
      held: (id, cond, secs) => this.held(id, cond, secs),
      recentEvent: (type, secs) => this.recentEvent(type, secs),
      deathsSince: (secs) => this.deathClocks.filter((t) => this.clock - t <= secs).length,
      towerDown: (tier, lane) => {
        if (!ownBuildings) return false;
        const b = ownBuildings[`${prefix}_tower${tier}_${lane}`];
        return !b || b.health <= 0;
      },
    };

    if (['laning', 'mid', 'late'].includes(phase) && heroName) this.trackSpikes(c);
    c.skills = heroName && playingPhase(phase) ? this.skillAdvice(c, meta?.skills || null) : null;
    this.recordNeutralSample(gsi, c.skills);
    const fight = fightAdvice(c);
    this.stabiliseFight(fight);
    c.fight = fight;
    this.trackBase(gsi, team);
    this.trackLive(c);
    c.fightLevel = this.fightStable || fight?.level || null;
    c.route = null;
    if (playingPhase(phase) && heroName) {
      try {
        c.route = this.router.update(c);
      } catch (err) {
        console.error('Ruteplanleggeren feilet:', err.message);
      }
    }

    const raw = [];
    for (const rule of RULES) {
      try {
        const r = rule(c);
        if (r) raw.push(...(Array.isArray(r) ? r : [r]));
      } catch (err) {
        console.error(`Regel ${rule.name} feilet:`, err.message);
      }
    }
    const tips = this.tips.process(raw, this.clock);

    const focusPhase = ['laning', 'mid', 'late', 'strategy'].includes(phase) ? phase : phase === 'pregame' ? 'strategy' : null;

    const state = {
      phase,
      phaseLabel: PHASE_LABEL[phase],
      matchId,
      clock: this.clock,
      clockText: fmtGameClock(this.clock),
      daytime: map.daytime ?? null,
      paused: !!map.paused,
      team,
      score: { radiant: map.radiant_score ?? null, dire: map.dire_score ?? null },
      role,
      roleLabel: ROLE_LABEL[role],
      hero: heroName
        ? {
            name: heroName,
            dname: heroInfo?.dname || heroName,
            level: hero.level,
            alive: hero.alive !== false,
            respawn: hero.respawn_seconds || 0,
            hpPct: hero.health_percent,
            manaPct: hero.mana_percent,
            buybackCost: hero.buyback_cost,
          }
        : null,
      player: {
        kills: player.kills ?? 0,
        deaths: player.deaths ?? 0,
        assists: player.assists ?? 0,
        lastHits: player.last_hits ?? 0,
        denies: player.denies ?? 0,
        gold: player.gold ?? 0,
        unreliable: player.gold_unreliable ?? 0,
        gpm: player.gpm ?? 0,
        xpm: player.xpm ?? 0,
      },
      location: c.loc ? { label: c.loc.label, side: c.loc.side } : null,
      focus: focusPhase ? FOCUS[focusPhase][role] : null,
      farm: this.farmAdvice(c),
      route: c.route,
      tips,
      timers: ['pregame', 'laning', 'mid', 'late'].includes(phase)
        ? computeTimers(this.clock, this.T, { daytime: map.daytime, roshanKilledAt: this.roshanKilledAt, aegisAt: this.aegisAt })
        : [],
      inventory: { items: inv.inventory, backpack: inv.backpack, stash: inv.stash, neutral: inv.neutral },
      build: build ? { ...build, owned: [...inv.owned] } : null,
      buildStatus: heroName ? (meta ? (build ? 'ok' : 'none') : 'loading') : null,
      skillsStatus: heroName ? (meta ? (meta.skills ? (meta.skills.games ? 'ok' : 'none') : meta.skillsError ? 'error' : 'loading') : 'loading') : null,
      skillsError: meta?.skillsError || null,
      next,
      situational: situationalItems(enemies, role, d.itemDb).map((s) => ({ ...s, owned: inv.owned.has(s.item) })),
      liveItems: c.liveItems,
      deathRecap: c.deathRecap,
      enemies: enemies.map((e) => ({ name: e.name, dname: e.dname })),
      enemyTips: enemyTips(enemies),
      perf: { ...perf, lhAt10: this.lhAt10 },
      fight,
      skills: c.skills,
      draft: {
        allies: draft.allies,
        enemies: draft.enemies,
        bans: draft.bans || [],
        autoAllies: draft.autoAllies || [],
        autoEnemies: draft.autoEnemies || [],
        unassigned: draft.unassigned || [],
        team: draft.team || null,
        autoAt: draft.autoAt || 0,
        rev: draft.rev || 0,
      },
      // Pick suggestions while heroes are being picked (filled from the draft the app recognised on screen).
      draftHelp: ['draft', 'strategy'].includes(phase) || (!heroName && phase !== 'menu') ? d.getDraftHelp?.() || null : null,
      matchReady: false,
      updatedAt: Date.now(),
    };

    if (this.rec) {
      this.rec.update(c, state);
      // The post-game report keeps what the recap said about each death.
      const rd = this.rec.deaths[this.rec.deaths.length - 1];
      if (c.deathRecap && rd && !rd.mistakes && Math.abs(rd.t - c.deathRecap.t) <= 3) rd.mistakes = c.deathRecap.mistakes.map((m) => m.id);
      if (phase === 'post') {
        const win = map.win_team;
        this.finishMatch(win === team ? 'win' : win === 'radiant' || win === 'dire' ? 'loss' : 'unknown');
      }
    }
    return state;
  }
}
