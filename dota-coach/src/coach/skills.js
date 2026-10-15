// Skill builds, talents and neutral items: statistics from recent pro games (OpenDota explorer rows
// { a: ability_upgrades_arr, n: item_neutral, w: won }) and the live recommendation for the next point.

const TALENT_LEVELS = [10, 15, 20, 25];
const ULT_LEVELS = [6, 12, 18];
// Hero level at which the n-th ability point is earned (no points at 17, 19, 21-24).
const POINT_LEVEL = [...Array.from({ length: 16 }, (_, i) => i + 1), 18, 20, 25];
// Ultimates that do not follow 6/12/18 (pro builds also reveal these, see computeHeroSkills).
const ULT_UNLOCK = { meepo_divided_we_stand: [4, 11, 18] };
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

  // Which abilities really get points (some listed abilities are sub-spells), their max level, and the
  // earliest hero level at which pros put the k-th point into each (the 2nd earliest, so one odd row can't count).
  const maxLevel = {};
  const firstAt = {};
  for (const b of builds) {
    const c = {};
    b.order.forEach((n, i) => {
      if (!abilityNames.has(n)) return;
      c[n] = (c[n] || 0) + 1;
      ((firstAt[n] ||= [])[c[n] - 1] ||= []).push(POINT_LEVEL[i] ?? 30);
    });
    for (const [n, v] of Object.entries(c)) maxLevel[n] = Math.max(maxLevel[n] || 0, v);
  }
  const unlockOf = (n) =>
    (firstAt[n] || []).map((levels) => {
      const sorted = [...levels].sort((a, b) => a - b);
      return sorted[Math.min(1, sorted.length - 1)];
    });
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
    abilities: hero.abilities.filter((a) => maxLevel[a.name]).map((a) => ({ ...a, max: maxLevel[a.name], unlock: unlockOf(a.name) })),
    typical,
    talents,
    neutrals,
    // Compact builds for the live "what next" lookup.
    builds: builds.map((b) => b.order),
  };
}

// How many points an ultimate may have at a hero level: 6/12/18, unless the pros (or ULT_UNLOCK) show it unlocks
// earlier, like Meepo's Divided We Stand at 4/11/18.
export function ultCap(ability, level) {
  const unlock = ULT_UNLOCK[ability.name] || ULT_LEVELS.map((l, k) => Math.min(l, ability.unlock?.[k] ?? l));
  return unlock.filter((l) => level >= l).length;
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
    const cap = isUlt ? ultCap(a, lvl) : Math.floor((lvl + 1) / 2);
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
    reason = `vinner oftere: ${other.winPct} % mot ${pick.winPct} %`;
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


// ---------- Reading the GSI "neutralitems" block ----------
// The shape of this block (patch 7.38+, madstone crafting) is not verified against the real game, so the
// reader below is deliberately tolerant: it looks for our player by any identity field it can find, for choice
// lists under any key that sounds like one, and for item names in the usual fields. It never throws.

const isObj = (v) => v !== null && typeof v === 'object';
const entriesOf = (v) => (Array.isArray(v) ? v.map((x, i) => [String(i), x]) : isObj(v) ? Object.entries(v) : []);
const CHOICE_KEY = /choice|trinket|artifact|enchant|enhance|option|offer/i;
const ENCHANT_KEY = /enchant|enhance/i;
const ARTIFACT_KEY = /trinket|artifact/i;
// A container key or flag that marks an item as already taken.
const TAKEN_KEY = /select|chosen|picked|equipped|crafted|current|active/i;
const TAKEN_FLAG = ['selected', 'is_selected', 'chosen', 'is_chosen', 'picked', 'equipped', 'crafted', 'claimed'];
const NAME_FIELDS = ['item_name', 'itemname', 'item', 'name', 'item_id', 'itemid', 'item_def', 'id'];
const LEVEL_FIELDS = ['item_level', 'level', 'enchantment_level', 'lvl'];
const TIER_KEY = /^(?:tier|t)[_\s-]?(\d+)$|^(\d+)$/i;
const PLAYER_HINT = /madstone|^tiers?\b|^tier[_\s-]?\d|choice|trinket|enchant|artifact|crafting/i;
const MAX_DEPTH = 5;

const stripItem = (n) => String(n || '').replace(/^item_/, '');
const isNeutralName = (name, itemDb) => !!name && (name.startsWith('enhancement_') || !!itemDb?.get?.(name)?.tier);

// An item name from a string, a number (item id) or an object with a name field. Numbers are only trusted when
// they are a neutral artifact or an enchantment (a bare "1" could be anything).
const byDname = new WeakMap();
// "Poor Man's Shield" -> poor_mans_shield (only neutral artifacts and enchantments).
function nameFromDname(text, itemDb) {
  if (!isObj(itemDb?.items)) return null;
  let map = byDname.get(itemDb);
  if (!map) {
    map = new Map();
    for (const [name, it] of Object.entries(itemDb.items)) if (it?.dname && isNeutralName(name, itemDb)) map.set(it.dname.toLowerCase(), name);
    byDname.set(itemDb, map);
  }
  return map.get(text.toLowerCase()) || null;
}

function itemNameOf(v, itemDb, fromNameField = false) {
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s || /^(empty|none|null|undefined)$/i.test(s) || s.length > 64) return null;
    if (!/^[a-z0-9_]+$/i.test(s)) return fromNameField ? nameFromDname(s, itemDb) : null;
    const name = stripItem(s.toLowerCase());
    // Loose strings (not in a name field) must look like an item.
    if (!fromNameField && !s.startsWith('item_') && !itemDb?.get?.(name)) return null;
    return name;
  }
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    const name = itemDb?.nameById?.(v);
    return isNeutralName(name, itemDb) ? name : null;
  }
  if (isObj(v) && !Array.isArray(v)) {
    for (const f of NAME_FIELDS) {
      if (v[f] == null || isObj(v[f])) continue;
      const n = itemNameOf(v[f], itemDb, f !== 'id');
      if (n) return n;
    }
  }
  return null;
}

const levelOf = (v) => {
  if (!isObj(v)) return null;
  for (const f of LEVEL_FIELDS) {
    const n = Number(v[f]);
    if (Number.isFinite(n) && n >= 0 && n <= 10) return n;
  }
  return null;
};
const takenFlag = (v) => isObj(v) && TAKEN_FLAG.some((f) => v[f] === true || v[f] === 1 || v[f] === '1' || v[f] === 'true');

// Every choice item below `node`: [{ name, level, selected, hint: 'artifact'|'enchantment'|null }].
function collectChoices(node, itemDb, ctx = { inChoice: false, hint: null, taken: false }, depth = 0, out = []) {
  if (depth > MAX_DEPTH) return out;
  for (const [k, v] of entriesOf(node)) {
    if (TIER_KEY.test(k) && !ctx.inChoice && depth > 0) continue; // another tier: handled on its own
    const choiceKey = CHOICE_KEY.test(k);
    if (!ctx.inChoice && !choiceKey) {
      // Not a choice list yet: look one level deeper (e.g. a wrapper object), never into plain values.
      if (isObj(v) && !TIER_KEY.test(k)) collectChoices(v, itemDb, ctx, depth + 1, out);
      continue;
    }
    const hint = ENCHANT_KEY.test(k) ? 'enchantment' : ARTIFACT_KEY.test(k) ? 'artifact' : ctx.hint;
    const taken = ctx.taken || (choiceKey && TAKEN_KEY.test(k) && !/choices|options/i.test(k));
    const name = itemNameOf(v, itemDb, choiceKey && !isObj(v));
    if (name) {
      out.push({ name, level: levelOf(v), selected: taken || takenFlag(v), hint });
      continue;
    }
    if (isObj(v)) collectChoices(v, itemDb, { inChoice: true, hint, taken }, depth + 1, out);
  }
  return out;
}

// Choices -> { artifacts, enchantments } without duplicates (a selected copy wins).
function splitChoices(list, itemDb) {
  const arts = new Map();
  const ench = new Map();
  for (const c of list) {
    const isEnch = c.name.startsWith('enhancement_') || (c.hint === 'enchantment' && !itemDb?.get?.(c.name)?.tier);
    const map = isEnch ? ench : arts;
    const prev = map.get(c.name);
    if (!prev) map.set(c.name, { ...c });
    else {
      prev.selected ||= c.selected;
      prev.level ??= c.level;
    }
  }
  return { artifacts: [...arts.values()], enchantments: [...ench.values()] };
}

const looksLikePlayer = (v) => isObj(v) && !Array.isArray(v) && Object.keys(v).some((k) => PLAYER_HINT.test(k));
const numField = (v, re) => {
  if (!isObj(v)) return null;
  for (const [k, x] of Object.entries(v)) if (re.test(k) && x !== '' && x != null && Number.isFinite(Number(x))) return Number(x);
  return null;
};

const OUR_SIDE = { radiant: /^(team[_\s-]?2|radiant|goodguys|good_guys)$/i, dire: /^(team[_\s-]?3|dire|badguys|bad_guys)$/i };
const ANY_SIDE = /^(team[_\s-]?\d|radiant|dire|goodguys|badguys|good_guys|bad_guys)$/i;

// A node that holds one player's crafting state itself (madstone count, tier keys or choice lists).
const isPlayerNode = (v) => isObj(v) && !Array.isArray(v) && Object.keys(v).some((k) => !/^\d+$/.test(k) && PLAYER_HINT.test(k));

// The player objects in a container: keys like player0 / p3 / 3, else anything that looks like a player.
function playersIn(container) {
  const objs = entriesOf(container).filter(([, v]) => isObj(v) && !Array.isArray(v));
  const keyed = objs.filter(([k]) => /player/i.test(k) || /^p?[_\s-]?\d+$/i.test(k));
  if (keyed.length) return keyed;
  return objs.filter(([k, v]) => looksLikePlayer(v) && !TIER_KEY.test(k) && !CHOICE_KEY.test(k) && !/crafting|tiers?$/i.test(k));
}

function matchesIdentity(v, who) {
  if (!isObj(v)) return false;
  const eq = (a, b) => a != null && b != null && a !== '' && String(a) === String(b);
  const ids = [v.steamid, v.steam_id, v.accountid, v.account_id];
  if (ids.some((x) => eq(x, who.steamid) || eq(x, who.accountid))) return true;
  if (eq(v.team_slot ?? v.teamslot, who.teamSlot)) return true;
  if (eq(v.player_slot ?? v.playerslot ?? v.slot, who.playerSlot)) return true;
  return !!who.name && eq(v.name ?? v.player_name, who.name);
}

function pickPlayer(container, who, team, path) {
  // The container is the player itself (e.g. the block for one player without player keys).
  if (isPlayerNode(container) && !Object.keys(container).some((k) => /player/i.test(k))) return { node: container, path };
  const players = playersIn(container);
  if (!players.length) return null;
  const byId = players.find(([, v]) => matchesIdentity(v, who));
  if (byId) return { node: byId[1], path: `${path}.${byId[0]}` };
  const keys = [who.teamSlot, who.playerSlot, who.teamSlot != null && team === 'dire' ? Number(who.teamSlot) + 5 : null].filter((x) => x != null && x !== '');
  for (const slot of keys) {
    const hit = players.find(([k]) => k.replace(/^\D+/, '') === String(slot));
    if (hit) return { node: hit[1], path: `${path}.${hit[0]}` };
  }
  if (players.length === 1) return { node: players[0][1], path: `${path}.${players[0][0]}` };
  return null; // several players and no way to tell which one is us: better nothing than a teammate's choice
}

// Where our player sits in the block: { node, path } or null.
export function locateNeutralPlayer(block, team, who = {}) {
  try {
    if (!isObj(block)) return null;
    const sides = entriesOf(block).filter(([k, v]) => ANY_SIDE.test(k) && isObj(v));
    if (sides.length) {
      const ours = sides.find(([k]) => OUR_SIDE[team === 'dire' ? 'dire' : 'radiant'].test(k));
      if (ours) return pickPlayer(ours[1], who, team, ours[0]);
      // Only the other side is there: only take a player that is clearly us.
      for (const [k, side] of sides) {
        const hit = playersIn(side).find(([, v]) => matchesIdentity(v, { steamid: who.steamid, accountid: who.accountid }));
        if (hit) return { node: hit[1], path: `${k}.${hit[0]}` };
      }
      return null;
    }
    return pickPlayer(block, who, team, '');
  } catch {
    return null;
  }
}

export function findMyNeutral(gsiNeutral, team, teamSlot, who = {}) {
  return locateNeutralPlayer(gsiNeutral, team, { ...who, teamSlot: teamSlot ?? who.teamSlot })?.node || null;
}

// The most common db tier of the artifacts in a choice list (the surest way to know the tier).
function artifactTier(artifacts, itemDb) {
  const count = new Map();
  for (const a of artifacts) {
    const t = itemDb?.get?.(a.name)?.tier;
    if (t) count.set(t, (count.get(t) || 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// The tiers in a player's block: [{ tier (1-5, or null), artifacts, enchantments }].
export function readNeutralTiers(me, itemDb) {
  if (!isObj(me)) return [];
  let tierEntries = [];
  const scan = (node, depth) => {
    for (const [k, v] of entriesOf(node)) {
      if (!isObj(v)) continue;
      const m = TIER_KEY.exec(k);
      if (m) tierEntries.push({ idx: Number(m[1] ?? m[2]), node: v });
      else if (/^tiers?$|crafting|neutral/i.test(k) && depth < 2) scan(v, depth + 1);
    }
  };
  scan(me, 0);
  tierEntries = tierEntries.filter((t) => t.idx <= 10);
  // Game data counts tiers from 0 (tier0 = tier 1) unless a 5 shows up without a 0.
  const idx = tierEntries.map((t) => t.idx);
  const oneBased = idx.includes(5) && !idx.includes(0);
  const groups = tierEntries.map((t) => {
    const numTier = Number(t.node.tier);
    const fromField = Number.isFinite(numTier) && t.node.tier !== '' && t.node.tier != null ? numTier : null;
    // A tier that is just a list (tier0: ['item_a', 'item_b']) is a choice list itself.
    const choices = splitChoices(collectChoices(t.node, itemDb, { inChoice: Array.isArray(t.node), hint: null, taken: false }, 1), itemDb);
    const guess = (fromField ?? t.idx) + (oneBased ? 0 : 1);
    return { tier: artifactTier(choices.artifacts, itemDb) || (guess >= 1 && guess <= 5 ? guess : null), ...choices };
  });
  // Choice lists straight on the player (no tier keys).
  const loose = splitChoices(collectChoices(me, itemDb), itemDb);
  if (loose.artifacts.length || loose.enchantments.length) {
    const ct = numField(me, /^crafting_tier$|^current_tier$|^tier$/i);
    groups.push({ tier: artifactTier(loose.artifacts, itemDb) || (ct != null && ct >= 0 && ct <= 4 ? ct + 1 : null), ...loose });
  }
  return groups.filter((g) => g.artifacts.length || g.enchantments.length);
}

const enchantLevelFor = (tier) => Math.min(4, Math.max(1, (tier || 2) - 1));
const PROFILE_REASON = { core: 'gir mest skade og overlevelse for en kjerne', caster: 'gir mest til en spell-caster', offlane: 'gjør deg tøffest som offlaner', support: 'gir mest til en support (fart, liv og mana)' };

// GSI "neutralitems" block for this player -> the choices for the tier being crafted, ranked. Never throws.
// who: { playerSlot, steamid, accountid, name } from the GSI player block; clockTier: the tier open by the clock.
export function neutralAdvice({ gsiNeutral, team, teamSlot, who = {}, stats, itemDb, role, attr, clockTier = null }) {
  try {
    const found = locateNeutralPlayer(gsiNeutral, team, { ...who, teamSlot: teamSlot ?? who.teamSlot });
    if (!found) return null;
    const me = found.node;
    const groups = readNeutralTiers(me, itemDb);
    if (!groups.length) return null;
    // The craft in progress: the highest tier with an open choice, else the highest tier at all.
    const rank = (g) => g.tier ?? clockTier ?? 0;
    const pending = groups.filter((g) => !(g.artifacts.some((a) => a.selected) && (!g.enchantments.length || g.enchantments.some((e) => e.selected))));
    const g = [...(pending.length ? pending : groups)].sort((a, b) => rank(b) - rank(a))[0];
    const tierNo = g.tier ?? clockTier ?? null;
    // Everything chosen for an older tier: the craft is done, so the tier that is open now matters instead.
    if (!pending.length && tierNo != null && clockTier != null && tierNo < clockTier) return null;
    const pro = new Map((stats?.neutrals || []).map((n) => [n.name, n]));
    const profile = enchantProfile(role, attr);
    const lvl = (c) => c.level ?? enchantLevelFor(tierNo);

    const artifacts = g.artifacts
      .map((c) => {
        const p = pro.get(c.name);
        const it = itemDb.get(c.name);
        return { name: c.name, dname: itemDb.dname(c.name), selected: !!c.selected, pct: p?.pct ?? null, winPct: p?.winPct ?? null, score: artifactScore(it, profile, attr), stats: stat(it, c.level ?? 0) };
      })
      // Pro pick rate first; the stat fit decides between items pros don't use.
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.score - a.score);
    const enchantments = g.enchantments
      .map((c) => {
        const it = itemDb.get(c.name);
        return { name: c.name, dname: itemDb.dname(c.name), selected: !!c.selected, score: enchantScore(it, profile, lvl(c)), stats: stat(it, lvl(c)) };
      })
      .sort((a, b) => b.score - a.score);

    const haveData = artifacts.some((a) => a.pct != null);
    const fits = artifacts[0] && (haveData || artifacts[0].score > 0);
    // The madstones we have now (not a total, maximum or cost).
    const madstone = numField(me, /^current_madstones?$/i) ?? numField(me, /^madstones?$|current.*madstone|madstone.*(count|current|have|owned)/i) ?? numField(me, /^(?!.*(total|max|need|cost|req|next)).*madstone/i);
    return {
      tier: tierNo,
      madstone,
      source: found.path || null,
      artifacts,
      enchantments,
      pickArtifact: fits ? artifacts[0].name : null,
      pickEnchantment: enchantments[0]?.score > 0 ? enchantments[0].name : null,
      artifactReason: haveData
        ? 'mest brukt av pro-spillere på denne helten'
        : fits
          ? 'pro-spillerne har ikke disse i sluttbuilden, så den er valgt etter hva statsene gir rollen og helten din'
          : 'ingen pro-data for disse, velg etter behov',
      enchantmentReason: PROFILE_REASON[profile],
    };
  } catch {
    return null;
  }
}

// Without a craft choice from the game (or without pro data): the artifacts of the current tier that fit the
// hero best (pro pick rate first, then the stats), and the enchantments for the role.
export function neutralByTier({ tier, stats, itemDb, role, attr }) {
  try {
    const profile = enchantProfile(role, attr);
    const pro = new Map((stats?.neutrals || []).map((n) => [n.name, n]));
    const artifacts = Object.entries(itemDb.items)
      .filter(([name, it]) => it.tier === tier && !name.startsWith('enhancement_') && !name.startsWith('recipe_'))
      .map(([name, it]) => ({ name, dname: it.dname || name, pct: pro.get(name)?.pct ?? null, winPct: pro.get(name)?.winPct ?? null, score: artifactScore(it, profile, attr), stats: stat(it) }))
      .filter((a) => a.pct != null || a.score > 0)
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.score - a.score)
      .slice(0, 4);
    const level = enchantLevelFor(tier);
    const enchantments = Object.entries(itemDb.items)
      .filter(([name]) => name.startsWith('enhancement_'))
      .map(([name, it]) => ({ name, dname: it.dname || name, score: enchantScore(it, profile, level), stats: stat(it, level) }))
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (!artifacts.length && !enchantments.length) return null;
    return {
      tier,
      items: artifacts,
      enchantments,
      source: artifacts.some((a) => a.pct != null) ? 'pro' : 'stats',
      enchantmentReason: PROFILE_REASON[profile],
    };
  } catch {
    return null;
  }
}

// ---------- What is equipped ----------

// The neutral slot(s) from the GSI `items` block: items.neutral0 (artifact), maybe neutral1 (enchantment), or
// an enchantment named inside the neutral0 object. `seen` says whether GSI sent a neutral slot at all.
export function readEquippedNeutral(gsiItems, itemDb) {
  const out = { artifact: null, enchantment: null, seen: false };
  try {
    if (!isObj(gsiItems)) return out;
    for (const [k, v] of Object.entries(gsiItems)) {
      if (!/neutral|enchant|enhance/i.test(k)) continue;
      out.seen = true;
      const names = [];
      const main = itemNameOf(v, itemDb, true);
      if (main) names.push(main);
      // A nested enchantment (e.g. { name: 'item_x', enhancement: 'item_enhancement_y' }).
      if (isObj(v)) for (const [f, x] of Object.entries(v)) if (/enchant|enhance/i.test(f)) names.push(itemNameOf(x, itemDb, true));
      for (const n of names) {
        if (!n) continue;
        if (n.startsWith('enhancement_') || (/enchant|enhance/i.test(k) && !itemDb?.get?.(n)?.tier)) out.enchantment ||= { name: n, dname: itemDb.dname(n), level: levelOf(v) };
        else out.artifact ||= { name: n, dname: itemDb.dname(n), tier: itemDb.get(n)?.tier || null };
      }
    }
  } catch {
    /* tolerant: return what we have */
  }
  return out;
}

// Is what we carry still right for the tier that is open?
//   upgrade: the artifact is from an older tier;  empty: nothing in the slot although a tier has been open a while;
//   worse-artifact / worse-enchantment: clearly worse than the recommendation for this tier.
// rec: neutralByTier() for `tier`. sinceOpen: seconds since `tier` opened.
export function neutralGearAdvice({ equipped, tier, sinceOpen = 0, clock = 0, rec, stats, itemDb, role, attr }) {
  try {
    if (!equipped?.seen || !tier) return null;
    const a = equipped.artifact;
    const names = (list) => (list || []).filter((x) => x.name !== a?.name && x.name !== equipped.enchantment?.name).slice(0, 2).map((x) => x.dname);
    const suggest = names(rec?.items);
    const ench = names(rec?.enchantments);
    const pick = suggest.length ? ` Se etter ${suggest.join(' eller ')}${ench.length ? `, med ${ench[0]}` : ''}.` : '';
    if (!a) {
      if (clock < 600) return null;
      return { kind: 'empty', tier, text: `Du har ikke noe nøytralt item. Rydd nøytrale leirer for madstone og craft et tier ${tier}-item.${pick}`, say: 'Craft et nøytralt item' };
    }
    if (a.tier && a.tier < tier && sinceOpen >= 60) {
      return {
        kind: 'upgrade',
        tier,
        have: a.name,
        haveTier: a.tier,
        text: `Tier ${tier} er åpen, men du har fortsatt ${a.dname} (tier ${a.tier}). Samle madstone og craft et nytt nøytralt item.${pick}`,
        say: `Oppgrader nøytralt item til tier ${tier}`,
      };
    }
    const profile = enchantProfile(role, attr);
    if (a.tier === tier && rec?.items?.length && rec.items[0].name !== a.name && suggest.length) {
      const top = rec.items[0];
      const p = (stats?.neutrals || []).find((n) => n.name === a.name);
      const mine = p?.pct ?? null;
      const myScore = artifactScore(itemDb.get(a.name), profile, attr);
      const worse = top.pct != null ? top.pct >= 20 && (mine ?? 0) + 15 <= top.pct && (mine ?? 0) < 10 : myScore <= 0 && top.score >= 4;
      if (worse) {
        return {
          kind: 'worse-artifact',
          tier,
          have: a.name,
          better: top.name,
          text: `${a.dname} passer dårlig for helten din${top.pct != null ? ` (${top.pct} % av pro-spillerne tar ${top.dname})` : ''}. Neste gang du crafter: ta ${suggest.join(' eller ')} hvis du får valget.`,
        };
      }
    }
    const e = equipped.enchantment;
    const best = rec?.enchantments?.[0];
    if (e && best && best.name !== e.name) {
      const mine = enchantScore(itemDb.get(e.name), profile, e.level ?? enchantLevelFor(tier));
      if (mine <= 0 && best.score >= 4) {
        return { kind: 'worse-enchantment', tier, have: e.name, better: best.name, text: `Fortryllelsen ${e.dname} gir lite til rollen din. Neste gang: ta ${best.dname}${best.stats ? ` (${best.stats})` : ''}.` };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ---------- Diagnostics ----------

// A small copy of an unknown GSI block: limited depth, keys per object, array length and string length, so the
// real shape can be read from «Kopier diagnose» without flooding it.
export function compactSample(value, maxChars = 4000) {
  const shrink = (v, depth, keys) => {
    if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.length > 48 ? `${v.slice(0, 45)}…` : v;
    if (typeof v !== 'object') return String(v).slice(0, 20);
    if (depth <= 0) return Array.isArray(v) ? `[${v.length}]` : `{${Object.keys(v).length} nøkler}`;
    if (Array.isArray(v)) {
      const out = v.slice(0, keys).map((x) => shrink(x, depth - 1, keys));
      if (v.length > keys) out.push(`…+${v.length - keys}`);
      return out;
    }
    const out = {};
    const all = Object.keys(v);
    for (const k of all.slice(0, keys)) out[k] = shrink(v[k], depth - 1, keys);
    if (all.length > keys) out['…'] = `+${all.length - keys} nøkler`;
    return out;
  };
  try {
    for (const [depth, keys] of [[7, 24], [6, 12], [5, 8], [4, 6], [3, 4], [2, 3]]) {
      const s = shrink(value, depth, keys);
      if (JSON.stringify(s).length <= maxChars) return s;
    }
    return { tooBig: true, keys: isObj(value) ? Object.keys(value).slice(0, 10) : typeof value };
  } catch {
    return null;
  }
}
