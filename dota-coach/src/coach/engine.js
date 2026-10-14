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
import { nextSkillPoint, talentAdvice, neutralAdvice } from './skills.js';

export { percentileOf };

const LEVEL_ORDER = { alert: 0, warn: 1, good: 2, info: 3 };
const playingPhase = (p) => ['strategy', 'pregame', 'laning', 'mid', 'late'].includes(p);

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
    this.reset(null);
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
    this.holds = new Map();
    this.events = [];
    this.seenGsiEvents = new Set();
    this.deathClocks = [];
    this.lastDeaths = null;
    this.lastDaytime = null;
    this.roshanKilledAt = null;
    this.aegisAt = null;
    this.lhAt10 = null;
    this.clock = 0;
  }

  finishMatch(result) {
    if (!this.rec || this.rec.done) return;
    const roshan = this.roshanKills.map((r) => ({ t: r.t, ours: r.team === this.team }));
    this.finished.push(this.rec.finish({ result, roshan }));
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
    const out = { next: null, talent: null, neutral: null, typical: stats?.typical?.slice(0, 16) || [], games: stats?.games || 0 };
    if (c.gsi.abilities && c.hero?.level) {
      const cur = this.readSkills(c.gsi, stats?.abilities?.length ? new Set(stats.abilities.map((a) => a.name)) : null);
      if (c.unspent > 0 && stats) out.next = nextSkillPoint(stats, cur);
      // A talent tier that is open now (or the next one) – show the pro split ahead of time.
      const tier = [1, 2, 3, 4].find((t) => !cur.talentTiers.has(t) && c.hero.level >= [10, 15, 20, 25][t - 1] - 1);
      if (tier && stats) {
        out.talent = talentAdvice(stats, tier, { dyingALot: c.deathsSince(600) >= 3 });
        if (out.talent) out.talent.open = c.hero.level >= out.talent.level;
      }
    }
    if (c.gsi.neutralitems) {
      try {
        out.neutral = neutralAdvice({
          gsiNeutral: c.gsi.neutralitems,
          team: c.team,
          teamSlot: c.player.team_slot,
          stats,
          itemDb: c.db,
          role: c.role,
          attr: c.heroAttr,
        });
      } catch (err) {
        console.error('Nøytral-råd feilet:', err.message);
      }
    }
    // No craft choice open: show which artifacts pros use in the current tier.
    if (!out.neutral && stats?.neutrals?.length) {
      const tierNow = [60, 35, 25, 15, 0].findIndex((m) => c.clock >= m * 60);
      const tier = tierNow < 0 ? 1 : 5 - tierNow;
      const list = stats.neutrals.filter((n) => n.tier === tier).slice(0, 4);
      if (list.length) out.proNeutrals = { tier, items: list };
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
    if (c.hero && c.hero.alive === false) return 'Bruk tiden mens du er død: se hvor bølgene og fiendene er, og bestem hvor du skal når du spawner.';
    if (c.phase === 'laning') {
      return {
        1: `Bli i ${safe}. Ta small- eller medium-leiren i egen jungel hvis bølgen er pushet eller lanen er for farlig.`,
        2: 'Bli mid. Ta en leir på egen side når bølgen er pushet, og vær ved runen når den spawner.',
        3: `Hold deg i ${off}. Trekk leiren hvis bølgen presses mot tårnet ditt, og få nivåer.`,
        4: 'Roter mellom lanene, stack leirer ved :53 og ta runer.',
        5: 'Pull leiren når lanen presses mot carryen, og stack ved :53.',
      }[r];
    }

    let eta = '';
    if (c.next && c.next.remaining > c.player.gold && c.player.gpm > 0) {
      const mins = (c.next.remaining - c.player.gold) / c.player.gpm;
      eta = ` Du trenger ${c.next.remaining - c.player.gold} gull til ${c.next.dname} (ca. ${Math.max(1, Math.round(mins))} min med din GPM).`;
    }
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
    const fight = fightAdvice(c);
    this.stabiliseFight(fight);
    c.fight = fight;

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
      tips,
      timers: ['pregame', 'laning', 'mid', 'late'].includes(phase)
        ? computeTimers(this.clock, this.T, { daytime: map.daytime, roshanKilledAt: this.roshanKilledAt, aegisAt: this.aegisAt })
        : [],
      inventory: { items: inv.inventory, backpack: inv.backpack, stash: inv.stash, neutral: inv.neutral },
      build: build ? { ...build, owned: [...inv.owned] } : null,
      buildStatus: heroName ? (meta ? (build ? 'ok' : 'none') : 'loading') : null,
      next,
      situational: situationalItems(enemies, role, d.itemDb).map((s) => ({ ...s, owned: inv.owned.has(s.item) })),
      enemies: enemies.map((e) => ({ name: e.name, dname: e.dname })),
      enemyTips: enemyTips(enemies),
      perf: { ...perf, lhAt10: this.lhAt10 },
      fight,
      skills: c.skills,
      draft: { allies: draft.allies, enemies: draft.enemies, autoAllies: draft.autoAllies || [], autoEnemies: draft.autoEnemies || [], unassigned: draft.unassigned || [], team: draft.team || null, autoAt: draft.autoAt || 0 },
      // Pick suggestions while heroes are being picked (filled from the draft the app recognised on screen).
      draftHelp: ['draft', 'strategy'].includes(phase) || (!heroName && phase !== 'menu') ? d.getDraftHelp?.() || null : null,
      matchReady: false,
      updatedAt: Date.now(),
    };

    if (this.rec) {
      this.rec.update(c, state);
      if (phase === 'post') {
        const win = map.win_team;
        this.finishMatch(win === team ? 'win' : win === 'radiant' || win === 'dire' ? 'loss' : 'unknown');
      }
    }
    return state;
  }
}
