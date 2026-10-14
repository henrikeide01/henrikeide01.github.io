// Item database helpers, build extraction from OpenDota item popularity, and "what to buy next".

const EXTRA_CONSUMABLES = ['ward_dispenser', 'tango_single', 'aegis', 'cheese', 'refresher_shard', 'madstone_bundle', 'royal_jelly', 'famango', 'great_famango', 'greater_famango', 'roshans_banner'];

export const BOOT_UPGRADES = new Set([
  'power_treads', 'phase_boots', 'arcane_boots', 'tranquil_boots', 'boots_of_bearing',
  'guardian_greaves', 'travel_boots', 'travel_boots_2',
]);

// Cheap components that are still worth recommending on their own.
const USEFUL_COMPONENTS = new Set([
  'boots', 'magic_stick', 'blink', 'quelling_blade', 'orb_of_venom', 'blight_stone', 'infused_raindrop',
  'wind_lace', 'ring_of_basilius', 'orb_of_frost', 'gem', 'shadow_amulet', 'fluffy_hat',
]);

export class ItemDb {
  constructor(items) {
    this.items = items;
    this.byId = new Map();
    for (const [name, it] of Object.entries(items)) this.byId.set(it.id, name);
  }

  static strip(name) {
    return name && name.startsWith('item_') ? name.slice(5) : name;
  }

  get(name) {
    return this.items[ItemDb.strip(name)];
  }

  nameById(id) {
    return this.byId.get(Number(id));
  }

  dname(name) {
    const it = this.get(name);
    return it ? it.dname : ItemDb.strip(name);
  }

  cost(name) {
    return this.get(name)?.cost || 0;
  }

  isConsumable(name) {
    const it = this.get(name);
    return !!it && ((it.qual || '').startsWith('consumable') || EXTRA_CONSUMABLES.includes(ItemDb.strip(name)));
  }

  isNeutral(name) {
    return !!this.get(name)?.tier;
  }

  isRecommendable(name) {
    const it = this.get(name);
    if (!it || it.tier || it.cost <= 0 || this.isConsumable(name)) return false;
    return it.created || USEFUL_COMPONENTS.has(ItemDb.strip(name)) || it.qual !== 'component';
  }

  // All items `name` is built from, recursively.
  components(name, out = new Set()) {
    for (const c of this.get(name)?.comp || []) {
      out.add(c);
      this.components(c, out);
    }
    return out;
  }

  // Gold still needed for `name`, counting raw components already held in `pool` (Map name -> count).
  remainingCost(name, pool) {
    const left = new Map(pool);
    const take = (n) => {
      const c = left.get(n) || 0;
      if (c > 0) {
        left.set(n, c - 1);
        return true;
      }
      return false;
    };
    const need = (n, top) => {
      if (!top && take(n)) return 0;
      const it = this.get(n);
      if (!it) return 0;
      const comps = it.comp || [];
      if (!comps.length) return it.cost;
      const compCost = comps.reduce((s, c) => s + this.cost(c), 0);
      const recipe = Math.max(0, it.cost - compCost);
      return recipe + comps.reduce((s, c) => s + need(c, false), 0);
    };
    return need(ItemDb.strip(name), true);
  }
}

const SLOT_KEYS = ['slot0', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7', 'slot8'];
const STASH_KEYS = ['stash0', 'stash1', 'stash2', 'stash3', 'stash4', 'stash5'];

const itemName = (slot) => (slot && slot.name && slot.name !== 'empty' ? ItemDb.strip(slot.name) : null);

// Summarise the GSI `items` block.
export function readInventory(gsiItems, db) {
  const items = gsiItems || {};
  const inventory = SLOT_KEYS.slice(0, 6).map((k) => itemName(items[k])).filter(Boolean);
  const backpack = SLOT_KEYS.slice(6).map((k) => itemName(items[k])).filter(Boolean);
  const stash = STASH_KEYS.map((k) => itemName(items[k])).filter(Boolean);
  const tp = items.teleport0 ? itemName(items.teleport0) : undefined; // undefined = GSI did not send the slot
  const neutral = itemName(items.neutral0);
  const held = [...inventory, ...backpack, ...stash];

  const pool = new Map();
  for (const n of held) pool.set(n, (pool.get(n) || 0) + 1);

  // Everything we "have", including what our items were built from (owning Treads means owning Boots).
  const owned = new Set(held);
  for (const n of held) db.components(n, owned);
  const hasBootUpgrade = held.some((n) => BOOT_UPGRADES.has(n));
  const wards = held.filter((n) => n === 'ward_observer' || n === 'ward_dispenser').length;

  return { inventory, backpack, stash, tp, neutral, held, pool, owned, hasBootUpgrade, wards };
}

function sortedEntries(obj, db) {
  return Object.entries(obj || {})
    .map(([id, count]) => ({ name: db.nameById(id), count: Number(count) }))
    .filter((x) => x.name)
    .sort((a, b) => b.count - a.count);
}

// Turn OpenDota /heroes/{id}/itemPopularity into a readable build.
export function buildFromPopularity(pop, db) {
  if (!pop) return null;
  const seen = new Set();
  let bootTaken = false;
  const decorate = (x, max) => ({ name: x.name, dname: db.dname(x.name), cost: db.cost(x.name), pop: max ? Math.round((x.count / max) * 100) : 0 });

  const pick = (list, n, minCost) => {
    const max = list[0]?.count || 1;
    const out = [];
    for (const x of list) {
      if (out.length >= n) break;
      if (seen.has(x.name) || !db.isRecommendable(x.name)) continue;
      if (db.cost(x.name) < minCost) continue;
      if (BOOT_UPGRADES.has(x.name)) {
        if (bootTaken) continue;
        bootTaken = true;
      }
      seen.add(x.name);
      out.push(decorate(x, max));
    }
    return out;
  };

  const startList = sortedEntries(pop.start_game_items, db).filter((x) => !db.isNeutral(x.name));
  const startMax = startList[0]?.count || 1;
  return {
    start: startList.slice(0, 8).map((x) => decorate(x, startMax)),
    early: pick(sortedEntries(pop.early_game_items, db), 5, 0),
    mid: pick(sortedEntries(pop.mid_game_items, db), 6, 1000),
    late: pick(sortedEntries(pop.late_game_items, db), 6, 2000),
  };
}

// The first item in the build that the player does not own yet.
export function nextItem(build, inv, clock) {
  if (!build) return null;
  // Early items only matter in the laning phase, and not once the player has moved on to bigger items.
  const movedOn = [...build.mid, ...build.late].some((it) => inv.owned.has(it.name));
  const early = clock < 600 && !movedOn ? build.early.slice(0, 4) : [];
  const seq = [...early, ...build.mid.slice(0, 5), ...build.late.slice(0, 5)];
  for (const it of seq) {
    if (inv.owned.has(it.name)) continue;
    if (BOOT_UPGRADES.has(it.name) && inv.hasBootUpgrade) continue;
    return it;
  }
  return null;
}
