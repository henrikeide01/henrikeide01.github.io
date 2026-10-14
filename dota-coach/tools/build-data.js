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
    ...((it.tier || name.startsWith('enhancement_')) && Array.isArray(it.attrib)
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

const patches = read('patch.json');
const patch = patches[patches.length - 1].name;

fs.writeFileSync(path.join(root, 'data/heroes.json'), JSON.stringify({ patch, heroes }, null, 0));
fs.writeFileSync(path.join(root, 'data/items.json'), JSON.stringify({ patch, items }, null, 0));
fs.writeFileSync(path.join(root, 'data/abilities.json'), JSON.stringify({ patch, heroes: heroAbilities, ids }, null, 0));
console.log(`Skrev ${heroes.length} helter, ${Object.keys(items).length} items og ${Object.keys(ids).length} evner/talenter (patch ${patch}).`);
