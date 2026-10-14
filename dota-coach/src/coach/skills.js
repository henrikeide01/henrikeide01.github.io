// Skill builds, talents and neutral items: statistics from recent pro games (OpenDota explorer rows
// { a: ability_upgrades_arr, n: item_neutral, w: won }) and the live recommendation for the next point.

const TALENT_LEVELS = [10, 15, 20, 25];
const ULT_LEVELS = [6, 12, 18];
const DEFENSIVE = /health|hp|armor|magic res|regen|evasion|status res|lifesteal|barrier|slow res/i;

// Ability points available at a hero level (no points at 17, 19, 21-24, 26+).
export function pointsAt(level) {
  if (level <= 16) return level;
  if (level <= 17) return 16;
  if (level <= 19) return 17;
  if (level <= 24) return 18;
  return 19;
}

// rows -> stats that are cached per hero.
// hero: { abilities: [{name, dname}], talents: [{name, dname, tier}] } from data/abilities.json
export function computeHeroSkills(rows, hero, ids, itemDb) {
  const abilityNames = new Set(hero.abilities.map((a) => a.name));
  const talentTier = new Map(hero.talents.map((t) => [t.name, t.tier]));
  const builds = [];
  const neutral = new Map();
  let neutralGames = 0;

  for (const r of rows || []) {
    const order = (Array.isArray(r.a) ? r.a : [])
      .map((id) => ids[id])
      .filter((n) => n && (abilityNames.has(n) || talentTier.has(n)));
    if (order.length >= 6) builds.push({ order, win: !!r.w });
    const item = r.n ? itemDb.nameById(r.n) : null;
    if (item && itemDb.get(item)?.tier) {
      neutralGames++;
      const e = neutral.get(item) || { picks: 0, wins: 0 };
      e.picks++;
      if (r.w) e.wins++;
      neutral.set(item, e);
    }
  }

  // Which abilities really get points (some listed abilities are sub-spells), and their max level.
  const maxLevel = {};
  for (const b of builds) {
    const c = {};
    for (const n of b.order) if (abilityNames.has(n)) c[n] = (c[n] || 0) + 1;
    for (const [n, v] of Object.entries(c)) maxLevel[n] = Math.max(maxLevel[n] || 0, v);
  }
  const dname = Object.fromEntries([...hero.abilities, ...hero.talents].map((x) => [x.name, x.dname]));

  // A typical order: follow the most common next step among builds sharing the prefix.
  const typical = [];
  let pool = builds;
  for (let i = 0; i < 18 && pool.length; i++) {
    const counts = new Map();
    for (const b of pool) if (b.order[i]) counts.set(b.order[i], (counts.get(b.order[i]) || 0) + 1);
    if (!counts.size) break;
    const [best, n] = [...counts].sort((x, y) => y[1] - x[1])[0];
    typical.push({ name: best, dname: dname[best] || best, pct: Math.round((n / pool.length) * 100), talent: talentTier.has(best) });
    const narrowed = pool.filter((b) => b.order[i] === best);
    pool = narrowed.length >= 10 ? narrowed : pool;
  }

  const talents = TALENT_LEVELS.map((level, i) => {
    const tier = i + 1;
    const options = hero.talents
      .filter((t) => t.tier === tier)
      .map((t) => {
        const taken = builds.filter((b) => b.order.includes(t.name));
        return { name: t.name, dname: t.dname, picks: taken.length, wins: taken.filter((b) => b.win).length };
      });
    const total = options.reduce((s, o) => s + o.picks, 0);
    for (const o of options) {
      o.pct = total ? Math.round((o.picks / total) * 100) : null;
      o.winPct = o.picks >= 5 ? Math.round((o.wins / o.picks) * 100) : null;
    }
    return { tier, level, options };
  });

  const neutrals = [...neutral]
    .map(([name, e]) => ({
      name,
      dname: itemDb.dname(name),
      tier: itemDb.get(name)?.tier || null,
      picks: e.picks,
      pct: Math.round((e.picks / Math.max(1, neutralGames)) * 100),
      winPct: e.picks >= 5 ? Math.round((e.wins / e.picks) * 100) : null,
    }))
    .sort((a, b) => b.picks - a.picks);

  return {
    games: builds.length,
    abilities: hero.abilities.filter((a) => maxLevel[a.name]).map((a) => ({ ...a, max: maxLevel[a.name] })),
    typical,
    talents,
    neutrals,
    // Compact builds for the live "what next" lookup.
    builds: builds.map((b) => b.order),
  };
}

const countsOf = (order, k) => {
  const c = {};
  for (let i = 0; i < k && i < order.length; i++) c[order[i]] = (c[order[i]] || 0) + 1;
  return c;
};

// What to put the next point into.
// current: { level, levels: {abilityName: lvl}, talentTiers: Set(tier), ultimates: Set(names) }
export function nextSkillPoint(stats, current) {
  if (!stats?.games) return null;
  const lvl = current.level || 1;
  const talentOf = new Map(stats.talents.flatMap((t) => t.options.map((o) => [o.name, t.tier])));
  const dname = Object.fromEntries([...stats.abilities, ...stats.talents.flatMap((t) => t.options)].map((x) => [x.name, x.dname]));

  // What may legally be skilled right now.
  const legal = new Set();
  for (const a of stats.abilities) {
    const have = current.levels[a.name] || 0;
    const isUlt = current.ultimates.has(a.name);
    const cap = isUlt ? ULT_LEVELS.filter((l) => lvl >= l).length : Math.floor((lvl + 1) / 2);
    if (have < Math.min(a.max, cap)) legal.add(a.name);
  }
  for (const t of stats.talents) {
    if (lvl >= t.level && !current.talentTiers.has(t.tier)) for (const o of t.options) legal.add(o.name);
  }
  if (!legal.size) return null;

  // 1) Builds that are in exactly the same state as the player: what did they do next?
  const spent = Object.values(current.levels).reduce((s, v) => s + v, 0) + current.talentTiers.size;
  const same = (order) => {
    const c = countsOf(order, spent);
    for (const a of stats.abilities) if ((c[a.name] || 0) !== (current.levels[a.name] || 0)) return false;
    for (const t of stats.talents) {
      const took = t.options.some((o) => c[o.name]);
      if (took !== current.talentTiers.has(t.tier)) return false;
    }
    return true;
  };
  let pool = stats.builds.filter((o) => o.length > spent && same(o));
  const exact = pool.length >= 8;
  const votes = new Map();
  if (exact) {
    for (const o of pool) if (legal.has(o[spent])) votes.set(o[spent], (votes.get(o[spent]) || 0) + 1);
  } else {
    // 2) Otherwise: which legal option did most players already have more points in by now?
    pool = stats.builds.filter((o) => o.length > spent);
    for (const o of pool) {
      const c = countsOf(o, spent + 1);
      for (const n of legal) {
        const have = talentOf.has(n) ? (current.talentTiers.has(talentOf.get(n)) ? 1 : 0) : current.levels[n] || 0;
        if ((c[n] || 0) > have) votes.set(n, (votes.get(n) || 0) + 1);
      }
    }
  }
  if (!votes.size) return null;
  const ranked = [...votes].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, dname: dname[name] || name, pct: Math.round((n / pool.length) * 100) }));
  const best = ranked[0];
  const talent = talentOf.has(best.name);
  return {
    ...best,
    talent,
    toLevel: talent ? null : (current.levels[best.name] || 0) + 1,
    exact,
    sample: pool.length,
    alternatives: ranked.slice(1, 3),
  };
}

// Talent choice for a tier, with a hint that fits the game (e.g. defensive talent when dying a lot).
export function talentAdvice(stats, tier, { dyingALot = false } = {}) {
  const t = stats?.talents?.find((x) => x.tier === tier);
  if (!t || t.options.length < 2) return null;
  const [a, b] = t.options;
  let pick = (a.pct ?? 0) >= (b.pct ?? 0) ? a : b;
  let reason = pick.pct != null ? `${pick.pct} % av pro-spillerne velger denne` : 'mest brukt';
  const other = pick === a ? b : a;
  // Clearly better results with the less popular one (enough games on both): prefer it.
  if (pick.winPct != null && other.winPct != null && other.picks >= 20 && other.winPct - pick.winPct >= 5) {
    reason = `vinner oftere (${other.winPct} % mot ${pick.winPct} %)`;
    pick = other;
  }
  let hint = null;
  const def = t.options.find((o) => DEFENSIVE.test(o.dname));
  if (dyingALot && def && def !== pick) hint = `Du dør mye denne kampen. ${def.dname} kan gjøre deg tøffere.`;
  return { tier, level: t.level, options: t.options, pick: pick.name, reason, hint };
}

// ---------- Neutral items ----------

// How much each enchantment stat helps a role. Keys come from data/items.json (attrib.key).
const ENCHANT_WEIGHTS = {
  core: { attack_speed: 3, bonus_attack_speed: 3, bonus_damage: 3, base_attack_damage: 2, bat_reduce: 3, primary_stat: 3, primary_stat_universal: 3, attack_lifesteal: 2, health_bonus: 2, max_health: 2, bonus_health: 2, armor: 2, bonus_armor: 2, evasion: 2, status_resistance: 2, attack_range: 1, bonus_attack_range: 1, movement_speed: 1, movespeed: 1, movespeed_pct: 1, bonus_gpm: 2 },
  caster: { spell_amp: 3, cooldown_reduction: 3, max_mana: 2, bonus_mana: 2, mana_regen: 2, bonus_mana_regen: 2, cast_range_bonus: 2, bonus_cast_range: 2, spell_lifesteal: 2, health_bonus: 2, magic_res: 1, primary_stat: 2, intelligence_pct: 2, manacost_reduction: 2, debuff_amp: 2, cast_speed: 1 },
  offlane: { health_bonus: 3, max_health: 3, bonus_health: 3, armor: 3, bonus_armor: 3, magic_res: 2, magic_resist: 2, health_regen: 2, bonus_hp_regen: 2, max_health_regen: 2, slow_resist: 2, status_resistance: 2, knockback_resist: 1, cooldown_reduction: 2, attack_speed: 1 },
  support: { movement_speed: 2, movespeed: 2, movespeed_pct: 2, health_bonus: 3, bonus_health: 3, armor: 2, bonus_armor: 2, mana_regen: 2, bonus_mana_regen: 2, max_mana: 1, bonus_mana: 1, cast_range_bonus: 2, bonus_cast_range: 2, magic_res: 2, magic_resist: 2, heal_amp: 2, cooldown_reduction: 2, bonus_xpm: 2, item_potency: 1 },
};

export function enchantProfile(role, attr) {
  if (role >= 4) return 'support';
  if (role === 3) return 'offlane';
  return attr === 'int' ? 'caster' : 'core';
}

// Neutral artifacts name their stats differently; map them onto the enchantment keys above.
const ARTIFACT_KEYS = {
  bonus_damage: 'bonus_damage', base_damage: 'bonus_damage', bonus_damage_pct: 'bonus_damage',
  attack_speed: 'attack_speed', aspd: 'attack_speed', bonus_attack_speed: 'attack_speed',
  bonus_health: 'health_bonus', hp_regen: 'health_regen', bonus_health_regen: 'health_regen', aura_health_regen: 'health_regen',
  armor: 'armor', bonus_armor: 'armor', ally_armor: 'armor', evasion: 'evasion', lifesteal: 'attack_lifesteal',
  bonus_mana: 'max_mana', mana: 'max_mana', bonus_mana_regen: 'mana_regen', mana_regen: 'mana_regen', mp_regen: 'mana_regen',
  spell_amp: 'spell_amp', cast_range: 'cast_range_bonus', manacost_reduction: 'manacost_reduction',
  magic_resistance: 'magic_res', bonus_magic_resistance: 'magic_res', magic_resist: 'magic_res',
  movespeed_pct: 'movement_speed', bonus_movespeed: 'movement_speed', move_speed: 'movement_speed', passive_movement_bonus: 'movement_speed',
  slow_resist: 'slow_resist', max_slow_res: 'slow_resist', bonus_all_stats: 'primary_stat', primary_attribute: 'primary_stat',
};
const STAT_ATTR = { bonus_agility: 'agi', bonus_strength: 'str', bonus_intellect: 'int', bonus_int: 'int', intelligence_pct: 'int' };

// How well an artifact's stats fit the role and hero (used when pros give no data for the choices).
export function artifactScore(item, profile, attr) {
  const w = ENCHANT_WEIGHTS[profile];
  let score = 0;
  for (const a of item?.attrib || []) {
    const v = Number(String(a.value ?? '').split(' / ').pop());
    if (!v) continue;
    if (STAT_ATTR[a.key]) score += STAT_ATTR[a.key] === attr ? 3 : attr === 'all' ? 2 : 1;
    else score += (w[ARTIFACT_KEYS[a.key]] || 0) * (v < 0 ? -1 : 1);
  }
  return score;
}

// The value of a stat at an enchantment level ("0 / 10 / 13 / 16" at level 2 -> "10"); the last one without a level.
const valueAt = (a, level) => {
  const values = String(a.value ?? '').split(' / ');
  return level > 0 && values[level - 1] != null ? values[level - 1] : values[values.length - 1];
};

export function enchantScore(item, profile, level = 0) {
  const w = ENCHANT_WEIGHTS[profile];
  let score = 0;
  for (const a of item?.attrib || []) {
    const v = Number(valueAt(a, level));
    if (v === 0) continue;
    // A stat that is negative here (e.g. "-4 Armor") is a cost, not a bonus.
    score += (w[a.key] || 0) * (v < 0 ? -1 : 1);
  }
  // Negative side effects.
  if ((item?.attrib || []).some((a) => a.key === 'cost_increase' || a.key === 'incoming_damage')) score -= 1;
  return score;
}

// "+ {value}% Magic Resistance" with "0 / 10 / 13 / 16" at level 2 -> "+10% Magic Resistance".
const stat = (item, level = 0) =>
  (item?.attrib || [])
    .filter((a) => a.display)
    .map((a) => {
      const v = valueAt(a, level);
      if (Number(v) === 0) return null;
      const text = a.display.replace(/^([+-]) /, '$1');
      // "-{value} Armor" with "-4": keep one minus.
      return (String(v).startsWith('-') ? text.replace(/^[+-]/, '') : text).replace('{value}', v);
    })
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');

// GSI "neutralitems" block for this player -> the choices for the tier being crafted, ranked.
export function neutralAdvice({ gsiNeutral, team, teamSlot, stats, itemDb, role, attr }) {
  const me = findMyNeutral(gsiNeutral, team, teamSlot);
  if (!me) return null;
  const tierKey = Object.keys(me)
    .filter((k) => /^tier\d$/.test(k) && Object.keys(me[k]?.trinket_choices || {}).length)
    .sort()
    .pop();
  if (!tierKey) return null;
  const t = me[tierKey];
  const tierNo = Number(tierKey.slice(4)) + 1; // GSI counts tiers from 0
  const pro = new Map((stats?.neutrals || []).map((n) => [n.name, n]));
  const profile = enchantProfile(role, attr);
  const strip = (n) => String(n || '').replace(/^item_/, '');

  const artifacts = Object.values(t.trinket_choices || {})
    .map((c) => {
      const name = strip(c.item_name);
      const p = pro.get(name);
      return { name, dname: itemDb.dname(name), selected: !!c.selected, pct: p?.pct ?? null, winPct: p?.winPct ?? null, score: artifactScore(itemDb.get(name), profile, attr), stats: stat(itemDb.get(name), c.item_level) };
    })
    // Pro pick rate first; the stat fit decides between items pros don't use.
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.score - a.score);
  const enchantments = Object.values(t.enchantment_choices || {})
    .map((c) => {
      const name = strip(c.item_name);
      return { name, dname: itemDb.dname(name), selected: !!c.selected, score: enchantScore(itemDb.get(name), profile, c.item_level), stats: stat(itemDb.get(name), c.item_level) };
    })
    .sort((a, b) => b.score - a.score);

  const haveData = artifacts.some((a) => a.pct != null);
  const fits = artifacts[0] && (haveData || artifacts[0].score > 0);
  return {
    tier: tierNo,
    madstone: me.current_madstone ?? null,
    artifacts,
    enchantments,
    pickArtifact: fits ? artifacts[0].name : null,
    pickEnchantment: enchantments[0]?.score > 0 ? enchantments[0].name : null,
    artifactReason: haveData
      ? 'mest brukt av pro-spillere på denne helten'
      : fits
        ? 'pro-spillerne har ikke disse i sluttbuilden, så den er valgt etter hva statsene gir rollen og helten din'
        : 'ingen pro-data for disse, velg etter behov',
    enchantmentReason: { core: 'gir mest skade og overlevelse for en kjerne', caster: 'gir mest til en spell-caster', offlane: 'gjør deg tøffest som offlaner', support: 'gir mest til en support (fart, liv og mana)' }[profile],
  };
}

export function findMyNeutral(gsiNeutral, team, teamSlot) {
  if (!gsiNeutral) return null;
  const side = gsiNeutral[team === 'dire' ? 'team3' : 'team2'] || {};
  const players = Object.entries(side).filter(([k, v]) => /^player\d+$/.test(k) && v && typeof v === 'object');
  if (!players.length) return null;
  if (players.length === 1) return players[0][1];
  return side[`player${teamSlot}`] || players[0][1];
}
