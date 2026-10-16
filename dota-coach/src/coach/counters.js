// Counters from the knowledge base in data/counters.js: which items answer the enemy heroes (filtered to what
// your hero and position really buy), and which heroes are good picks against them. Every suggestion carries
// the reason, per enemy, so the player can see why it is there.
import { HERO_COUNTERS } from '../../data/counters.js';

export const counterInfo = (name, kb = HERO_COUNTERS) => kb[name] || null;

// How a hero deals its damage as a core: from the knowledge base, else guessed from the OpenDota roles.
export function heroStyle(hero, kb = HERO_COUNTERS) {
  const known = kb[hero?.name]?.style;
  if (known) return known;
  const roles = hero?.roles || [];
  const carry = roles.includes('Carry');
  const nuker = roles.includes('Nuker');
  if (nuker && (hero.attr === 'int' || !carry)) return 'spell';
  if (carry) return 'attack';
  return 'hybrid';
}

// Which `who` tags of the knowledge base describe the player: position first, then the hero's style.
export function buyerKinds(role, hero, kb = HERO_COUNTERS) {
  const r = Number(role) || 0;
  if (r >= 4) return new Set(['support']);
  if (r === 3) return new Set(['offlane']);
  const style = hero ? heroStyle(hero, kb) : r === 1 ? 'attack' : 'hybrid';
  return new Set(style === 'attack' ? ['carry'] : style === 'spell' ? ['caster'] : ['carry', 'caster']);
}

const KIND_TEXT = { carry: 'en right-click-kjerne', caster: 'en spell-kjerne', offlane: 'en offlaner', support: 'en support' };

// What an item does against enemies. Owning an item with the same job makes the others unnecessary
// (Bloodthorn already gives true strike, so MKB is not needed for that).
const JOBS = {
  monkey_king_bar: ['truestrike'],
  bloodthorn: ['truestrike', 'silence'],
  orchid: ['silence'],
  spirit_vessel: ['antiheal'],
  skadi: ['antiheal'],
  crellas_crozier: ['antiheal'],
  dust: ['detect'],
  ward_sentry: ['detect'],
  gem: ['detect', 'sentrydetect'],
  sheepstick: ['hex'],
  rod_of_atos: ['root'],
  gungir: ['root'],
  ghost: ['physimmune'],
  ethereal_blade: ['physimmune'],
};
// Gem replaces Dust and sentries; Dust does not replace a Gem.
const COVERS = { gem: ['dust', 'ward_sentry'], bloodthorn: ['monkey_king_bar', 'orchid'], gungir: ['rod_of_atos'], crellas_crozier: ['ghost'], ethereal_blade: ['ghost'] };

// True when an owned item already does this item's job.
export function coveredByOwned(item, owned) {
  for (const o of owned) if ((COVERS[o] || []).includes(item)) return true;
  const jobs = JOBS[item];
  if (!jobs || ['dust', 'ward_sentry', 'gem'].includes(item)) return false;
  const have = new Set([...owned].flatMap((o) => (o === item ? [] : JOBS[o] || [])));
  return jobs.every((j) => have.has(j));
}

// The first answers in an enemy's list are the standard ones; later ones count a little less.
const RANK_WEIGHT = [1, 0.85, 0.72, 0.62, 0.54, 0.48, 0.43];

// enemies: [{name, dname}]. hero: your hero object (or null in the draft before you picked), role 1–5,
// build: buildFromPopularity() output of your hero (items its pro players buy), db: ItemDb, owned: Set.
// Returns [{ item, dname, cost, score, when, vs: [{hero, dname, why}], fit: {kind, text, inBuild}, owned }]
// best first. Items your hero/position does not buy are left out, unless your hero's pro players buy them.
export function counterItems({ enemies = [], hero = null, role = 0, build = null, db, owned = new Set(), limit = 8, kb = HERO_COUNTERS } = {}) {
  const kinds = buyerKinds(role, hero, kb);
  const buildItems = new Set(build ? [...(build.early || []), ...(build.mid || []), ...(build.late || [])].map((x) => x.name) : []);
  const rows = new Map();
  for (const e of enemies.filter(Boolean)) {
    const info = kb[e.name];
    if (!info) continue;
    info.items.forEach((it, i) => {
      if (!db?.get(it.item)) return;
      const who = it.who || ['any'];
      const kind = who.includes('any') ? 'any' : who.find((w) => kinds.has(w));
      const inBuild = buildItems.has(it.item);
      if (!kind && !inBuild) return;
      let row = rows.get(it.item);
      if (!row) {
        row = { item: it.item, dname: db.dname(it.item), cost: db.cost(it.item), score: 0, when: it.when || 'any', vs: [], kind: kind || null, inBuild };
        rows.set(it.item, row);
      }
      if (row.vs.some((v) => v.hero === e.name)) return;
      row.score += RANK_WEIGHT[i] ?? 0.4;
      row.vs.push({ hero: e.name, dname: e.dname || e.name, why: it.why });
      if (!row.kind && kind) row.kind = kind;
    });
  }
  const heroName = hero?.dname || null;
  const out = [];
  for (const r of rows.values()) {
    const isOwned = owned.has(r.item) || coveredByOwned(r.item, owned);
    const fitText = r.inBuild && heroName ? `Pro-spillere på ${heroName} kjøper den` : r.kind && r.kind !== 'any' ? `Passer ${KIND_TEXT[r.kind]}` : 'Passer alle roller';
    out.push({
      item: r.item,
      dname: r.dname,
      cost: r.cost,
      score: Math.round((r.score + (r.inBuild ? 0.25 : 0)) * 100) / 100,
      when: r.when,
      vs: r.vs,
      fit: { kind: r.kind, inBuild: r.inBuild, text: fitText },
      owned: isOwned,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.cost - b.cost || a.item.localeCompare(b.item)).slice(0, limit);
}

// Per enemy: the tip, what it brings, the best items (for you) and the heroes that counter it.
export function enemyBreakdown({ enemies = [], hero = null, role = 0, build = null, db, owned = new Set(), kb = HERO_COUNTERS, heroes = null } = {}) {
  return enemies.filter(Boolean).map((e) => {
    const info = kb[e.name];
    if (!info) return { hero: e.name, dname: e.dname, tip: null, threats: [], items: [], counters: [] };
    const items = counterItems({ enemies: [e], hero, role, build, db, owned, limit: 3, kb }).map((x) => ({ item: x.item, dname: x.dname, cost: x.cost, why: x.vs[0]?.why || '', owned: x.owned, fit: x.fit.text }));
    const counters = (info.counters || []).slice(0, 4).map((c) => ({ hero: c.hero, dname: heroes?.get?.(c.hero)?.dname || c.hero, why: c.why }));
    return { hero: e.name, dname: e.dname, tip: info.tip || null, threats: info.threats || [], items, counters };
  });
}

// The draft side: enemies `candidate` is a known counter to, and enemies that are known counters to it.
export function knownMatchups(candidate, enemies = [], kb = HERO_COUNTERS) {
  const good = [];
  const bad = [];
  for (const e of enemies.filter(Boolean)) {
    const vs = (kb[e.name]?.counters || []).find((c) => c.hero === candidate.name);
    if (vs) good.push({ name: e.name, dname: e.dname, why: vs.why });
    const by = (kb[candidate.name]?.counters || []).find((c) => c.hero === e.name);
    if (by) bad.push({ name: e.name, dname: e.dname, why: by.why });
  }
  return { good, bad };
}

// Enemy heroes that have a threat tag (for the live rules: invis, evasion, heal …).
export function withThreat(enemies, tag, kb = HERO_COUNTERS) {
  return enemies.filter((e) => (kb[e.name]?.threats || []).includes(tag));
}

// Short tips for the enemies (one per hero).
export function counterTips(enemies, kb = HERO_COUNTERS) {
  return enemies.filter((e) => kb[e.name]?.tip).map((e) => ({ hero: e.name, text: kb[e.name].tip }));
}
