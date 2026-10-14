import { COUNTER_RULES, ENEMY_TIPS } from '../../data/knowledge.js';

// enemies: [{name, dname}], role: 1-5. Returns [{item, dname, why}] with the most relevant first.
export function situationalItems(enemies, role, db) {
  const names = new Set(enemies.map((e) => e.name));
  const dnames = new Map(enemies.map((e) => [e.name, e.dname]));
  const out = [];
  const seen = new Set();
  for (const rule of COUNTER_RULES) {
    const hits = rule.heroes.filter((h) => names.has(h));
    if (hits.length < (rule.min || 1)) continue;
    const list = role >= 4 ? rule.support : role === 3 ? rule.off || rule.core : rule.core;
    const why = rule.why.replace('{heroes}', hits.map((h) => dnames.get(h) || h).join(', '));
    for (const item of list.slice(0, 2)) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push({ item, dname: db.dname(item), cost: db.cost(item), why, rule: rule.id, weight: hits.length });
    }
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 6);
}

export function enemyTips(enemies) {
  return enemies.filter((e) => ENEMY_TIPS[e.name]).map((e) => ({ hero: e.name, text: ENEMY_TIPS[e.name] }));
}
