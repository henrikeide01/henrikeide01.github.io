import { ENEMY_TIPS } from '../../data/knowledge.js';
import { counterItems, counterTips } from './counters.js';

// Items against the enemy heroes, for your hero (or null before you picked) and position.
// Returns [{ item, dname, cost, why, vs, fit, score, when, owned }] with the most relevant first.
export function situationalItems(enemies, role, db, { hero = null, build = null, owned = new Set(), limit = 6 } = {}) {
  return counterItems({ enemies, hero, role, build, db, owned, limit }).map((c) => ({
    ...c,
    why: c.vs.length > 1 ? `Mot ${c.vs.map((v) => v.dname).join(', ')}. ${c.vs[0].why}` : `Mot ${c.vs[0].dname}: ${c.vs[0].why}`,
  }));
}

// One tip per enemy hero: the knowledge base first, the old hand-written tips for anything it lacks.
export function enemyTips(enemies) {
  const known = new Map(counterTips(enemies).map((t) => [t.hero, t.text]));
  return enemies.map((e) => ({ hero: e.name, text: known.get(e.name) || ENEMY_TIPS[e.name] })).filter((t) => t.text);
}
