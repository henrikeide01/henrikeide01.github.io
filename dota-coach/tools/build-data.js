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
  };
}

const patches = read('patch.json');
const patch = patches[patches.length - 1].name;

fs.writeFileSync(path.join(root, 'data/heroes.json'), JSON.stringify({ patch, heroes }, null, 0));
fs.writeFileSync(path.join(root, 'data/items.json'), JSON.stringify({ patch, items }, null, 0));
console.log(`Skrev ${heroes.length} helter og ${Object.keys(items).length} items (patch ${patch}).`);
