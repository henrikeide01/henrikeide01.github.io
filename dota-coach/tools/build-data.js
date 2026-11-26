// Generates the bundled offline data in data/ from the `dotaconstants` npm package.
// Usage:  npm i --no-save dotaconstants && npm run build-data
//    or:  node tools/build-data.js /path/to/dotaconstants/build
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.resolve(process.argv[2] || path.join(root, 'node_modules/dotaconstants/build'));
const read = (f) => JSON.parse(fs.readFileSync(path.join(src, f), 'utf8'));

const heroes = Object.values(read('heroes.json'))
  .map((h) => ({
    id: h.id,
    name: h.name.replace('npc_dota_hero_', ''),
    dname: h.localized_name,
    attr: h.primary_attr,
    attack: h.attack_type,
    roles: h.roles,
  }))
  .sort((a, b) => a.dname.localeCompare(b.dname));

const items = {};
for (const [name, it] of Object.entries(read('items.json'))) {
  if (name.startsWith('recipe_')) continue;
  items[name] = {
    id: it.id,
    dname: it.dname,
    cost: it.cost || 0,
    ...(it.qual ? { qual: it.qual } : {}),
    ...(it.tier ? { tier: it.tier } : {}),
    ...(it.created ? { created: true } : {}),
    ...(Array.isArray(it.components) && it.components.some(Boolean)
      ? { comp: it.components.filter(Boolean) }
      : {}),
    // Stats of neutral artifacts and enchantments, used to recommend them.
    // (kept for every item here; dropped again below for items that are not neutral after the patch notes)
    ...(Array.isArray(it.attrib)
      ? { attrib: it.attrib.map((a) => ({ key: a.key, display: a.display, value: a.value })).filter((a) => a.key) }
      : {}),
  };
}

// Abilities and talents per hero, with the ability ids used in OpenDota's ability_upgrades_arr.
const abilityInfo = read('abilities.json');
const abilityIds = read('ability_ids.json');
const idOf = {};
for (const [id, n] of Object.entries(abilityIds)) idOf[n] = Number(id);
// "+{s:bonus_x}s Blink Cooldown" -> "-Blink Cooldown" style names (the values are not in the data).
const talentName = (dname) =>
  String(dname || '')
    .replace(/([+-]?)\{s:[^}]+\}(%|s)?\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
const heroAbilities = {};
const ids = {};
for (const [hero, info] of Object.entries(read('hero_abilities.json'))) {
  const short = hero.replace('npc_dota_hero_', '');
  const abilities = (info.abilities || [])
    .filter((n) => n && n !== 'generic_hidden' && abilityInfo[n] && !abilityInfo[n].is_innate && abilityInfo[n].behavior !== 'Hidden' && abilityInfo[n].dname)
    .map((n) => ({ name: n, dname: abilityInfo[n].dname }));
  const talents = (info.talents || []).map((t) => ({ name: t.name, tier: t.level, dname: talentName(abilityInfo[t.name]?.dname) || t.name }));
  for (const n of [...abilities.map((a) => a.name), ...talents.map((t) => t.name)]) if (idOf[n]) ids[idOf[n]] = n;
  heroAbilities[short] = { abilities, talents };
}

// Display name, damage type and owning hero of every ability that can show up as a damage source in
// OpenDota's parsed match data (damage_inflictor, damage_inflictor_received, ability_uses). Includes
// hidden/innate hero abilities and neutral creep / Roshan abilities; seasonal event abilities are skipped.
const DMG_TYPE = { Magical: 'magical', Physical: 'physical', Pure: 'pure' };
const heroNames = heroes.map((h) => h.name).sort((a, b) => b.length - a.length);
const ownerByPrefix = (n) => heroNames.find((h) => n.startsWith(`${h}_`)) || null;
const abilityOwner = {};
for (const [hero, info] of Object.entries(read('hero_abilities.json'))) {
  for (const n of info.abilities || []) if (n && n !== 'generic_hidden') abilityOwner[n] = hero.replace('npc_dota_hero_', '');
}
const EVENT = /^(greevil_|frostivus|cny20|seasonal_|roshan_halloween|throw_|special_bonus)/;
const abilityMeta = {};
for (const [n, a] of Object.entries(abilityInfo).sort(([x], [y]) => x.localeCompare(y))) {
  if (!a?.dname || EVENT.test(n)) continue;
  const dmg = DMG_TYPE[a.dmg_type] || null;
  const hero = abilityOwner[n] || ownerByPrefix(n);
  if (!abilityOwner[n] && !dmg) continue; // not a hero ability and deals no typed damage
  abilityMeta[n] = { dname: a.dname, ...(dmg ? { dmg } : {}), ...(hero ? { hero } : {}) };
}

const patches = read('patch.json');
const patch = patches[patches.length - 1].name;

// The patch notes of this patch fix what the item data lacks: neutral tiers (dotaconstants 10.9.0 dropped the
// field), items removed or cycled out, and tier changes. Tiers missing in the data come from the previous
// bundled data (--prev <items.json>, default the current data/items.json).
const prevArg = process.argv.indexOf('--prev');
const prevFile = prevArg > 0 ? process.argv[prevArg + 1] : path.join(root, 'data/items.json');
let prevItems = {};
try {
  prevItems = JSON.parse(fs.readFileSync(prevFile, 'utf8')).items || {};
} catch {}
let notes = {};
try {
  notes = read('patchnotes.json')[patch.replace('.', '_')]?.items || {};
} catch {}
let removedCount = 0;
const keepAttrib = (name, it) => it.tier || name.startsWith('enhancement_');
for (const [name, it] of Object.entries(items)) {
  if (!it.tier && prevItems[name]?.tier) it.tier = prevItems[name].tier;
  const text = [].concat(notes[name] || []).join(' / ');
  if (/Item removed from the game|Item Cycled Out/i.test(text)) {
    it.removed = true;
    delete it.tier;
    removedCount++;
    continue;
  }
  const changed = /Tier changed from \d to (\d)/i.exec(text);
  const added = /(?:New|Returning|Reworked into) Tier (\d) Artifact/i.exec(text);
  if (changed && !name.startsWith('enhancement_')) it.tier = Number(changed[1]);
  else if (added) {
    it.tier = Number(added[1]);
    it.cost = 0;
    delete it.comp;
    delete it.created;
  }
}

for (const [name, it] of Object.entries(items)) if (!keepAttrib(name, it)) delete it.attrib;

fs.writeFileSync(path.join(root, 'data/heroes.json'), JSON.stringify({ patch, heroes }, null, 0));
fs.writeFileSync(path.join(root, 'data/items.json'), JSON.stringify({ patch, items }, null, 0));
fs.writeFileSync(path.join(root, 'data/abilities.json'), JSON.stringify({ patch, heroes: heroAbilities, ids }, null, 0));
fs.writeFileSync(path.join(root, 'data/ability-info.json'), JSON.stringify({ patch, abilities: abilityMeta }, null, 0));
console.log(
  `Skrev ${heroes.length} helter, ${Object.keys(items).length} items (${Object.values(items).filter((i) => i.tier).length} nøytrale, ${removedCount} fjernet i patchen), ${Object.keys(ids).length} evner/talenter og ${Object.keys(abilityMeta).length} skadekilder (patch ${patch}).`,
);
