// Records what happens in a match (one sample every 10 game seconds plus events) for the post-game analysis.

const PLAYING = ['pregame', 'laning', 'mid', 'late'];

export class MatchRecorder {
  constructor(matchId) {
    this.matchId = matchId;
    this.startedAt = new Date().toISOString();
    this.samples = [];
    this.deaths = [];
    this.kaEvents = [];
    this.items = [];
    this.spikes = [];
    this.levels = [];
    this.tipCounts = {};
    this.prev = null;
    this.prevHeld = null;
    this.prevTipKeys = new Set();
    this.lastSampleT = -Infinity;
    this.lhAt10 = null;
    this.done = false;
    this.info = {};
  }

  get length() {
    return this.samples.length;
  }

  update(c, state) {
    if (this.done || !PLAYING.includes(c.phase) || !c.heroKey) return;
    this.info = {
      hero: { name: c.heroKey, dname: c.heroName },
      role: c.role,
      team: c.team,
      enemies: c.enemyKeys,
      allies: c.allyKeys,
      core: c.coreItems,
      accountId: c.player.accountid ? Number(c.player.accountid) : null,
      heroId: c.hero.id ?? null,
    };

    const s = {
      t: Math.round(c.clock),
      gold: c.player.gold ?? 0,
      un: c.player.gold_unreliable ?? 0,
      gpm: c.player.gpm ?? 0,
      xpm: c.player.xpm ?? 0,
      lh: c.player.last_hits ?? 0,
      dn: c.player.denies ?? 0,
      k: c.player.kills ?? 0,
      d: c.player.deaths ?? 0,
      a: c.player.assists ?? 0,
      lvl: c.hero.level ?? 1,
      alive: c.hero.alive !== false,
      hp: c.hero.health_percent ?? 100,
      x: c.hero.xpos ?? null,
      y: c.hero.ypos ?? null,
      side: c.loc?.side ?? null,
      depth: c.loc?.depth ?? 0,
      base: !!c.loc?.inOwnBase,
      label: c.loc?.label ?? '',
      fight: state.fight?.level ?? null,
      fs: state.fight?.score ?? null,
      tp: c.inv.tp !== null,
      stash: c.inv.stash.length,
      unspent: c.unspent,
      tk: c.teamKills,
      ek: c.enemyKills,
      bb: c.hero.buyback_cost ?? 0,
      night: c.gsi.map?.daytime === false,
    };

    const p = this.prev;
    if (p && s.d > p.d) {
      this.deaths.push({
        t: s.t,
        x: p.x,
        y: p.y,
        label: p.label,
        side: p.side,
        depth: p.depth,
        hp: p.hp,
        lost: Math.max(0, p.un - s.un),
        fight: p.fight,
        night: p.night,
        hadTp: p.tp,
        noBuyback: s.t >= 1500 && p.gold < p.bb,
      });
    }
    if (p && (s.k > p.k || s.a > p.a)) this.kaEvents.push({ t: s.t, kills: s.k - p.k, assists: s.a - p.a, fight: p.fight });
    if (p && s.lvl >= 6 && p.lvl < 6) this.levels.push({ t: s.t, level: 6 });

    // Items that appear in the inventory/stash for the first time = bought or completed now.
    const held = new Set(c.inv.held);
    if (this.prevHeld) {
      for (const n of held) {
        if (this.prevHeld.has(n) || this.items.some((i) => i.name === n)) continue;
        if (c.db.isConsumable?.(n) || c.db.cost(n) < 400) continue;
        this.items.push({ name: n, dname: c.db.dname(n), t: s.t, cost: c.db.cost(n), core: c.coreItems.includes(n) });
      }
    }
    this.prevHeld = held;

    const spike = c.recentEvent('spike-item', 1);
    if (spike && !this.spikes.some((x) => x.name === spike.data.name)) this.spikes.push({ t: s.t, name: spike.data.name, dname: spike.data.dname });

    const keys = new Set(state.tips.map((t) => t.key));
    for (const t of state.tips) if (!this.prevTipKeys.has(t.key)) this.tipCounts[t.id.replace(/-\d+$/, '')] = (this.tipCounts[t.id.replace(/-\d+$/, '')] || 0) + 1;
    this.prevTipKeys = keys;

    if (this.lhAt10 === null && s.t >= 600) this.lhAt10 = s.lh;
    if (s.t - this.lastSampleT >= 10) {
      this.samples.push(s);
      this.lastSampleT = s.t;
    }
    this.prev = s;
  }

  finish({ result = 'unknown', roshan = [] } = {}) {
    this.done = true;
    if (this.prev && this.samples[this.samples.length - 1] !== this.prev) this.samples.push(this.prev);
    return {
      matchId: this.matchId,
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      result,
      duration: this.prev?.t ?? 0,
      ...this.info,
      lhAt10: this.lhAt10,
      samples: this.samples,
      deaths: this.deaths,
      kaEvents: this.kaEvents,
      items: this.items,
      spikes: this.spikes,
      levels: this.levels,
      roshan,
      tipCounts: this.tipCounts,
    };
  }
}
