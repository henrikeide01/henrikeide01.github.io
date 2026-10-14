// Small OpenDota client with a disk cache, so the app keeps working offline and stays far below the rate limit.
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://api.opendota.com/api';
const HOUR = 3600 * 1000;

export const TTL = {
  heroStats: 6 * HOUR,
  hero: 24 * HOUR,
  constants: 7 * 24 * HOUR,
};

const safeName = (p) => p.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_');

export class OpenDota {
  // fixturesDir: read canned responses from disk instead of the network (tests / offline demo)
  constructor({ cacheDir, apiKey = '', fixturesDir = null, minGapMs = 1100 } = {}) {
    this.cacheDir = cacheDir;
    this.apiKey = apiKey;
    this.fixturesDir = fixturesDir;
    this.minGapMs = minGapMs;
    this.inflight = new Map();
    this.chain = Promise.resolve();
    this.lastRequestAt = 0;
    this.online = null;
    this.lastError = null;
    if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });
  }

  readCache(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  // Requests run one at a time with a gap between them (OpenDota allows ~60/min without a key).
  throttled(fn) {
    const run = this.chain.then(async () => {
      const wait = this.lastRequestAt + this.minGapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
      return fn();
    });
    this.chain = run.catch(() => {});
    return run;
  }

  async request(p) {
    const url = new URL(BASE + p);
    if (this.apiKey) url.searchParams.set('api_key', this.apiKey);
    const res = await fetch(url, { headers: { 'User-Agent': 'dota-coach/1.0' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`OpenDota ${res.status} for ${p}`);
    return res.json();
  }

  async get(p, ttl) {
    if (this.fixturesDir) {
      const file = path.join(this.fixturesDir, `${safeName(p)}.json`);
      if (!fs.existsSync(file)) throw new Error(`Ingen fixture for ${p}`);
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    const file = path.join(this.cacheDir, `${safeName(p)}.json`);
    const cached = this.readCache(file);
    if (cached && Date.now() - cached.fetchedAt < ttl) return cached.data;

    if (this.inflight.has(p)) return this.inflight.get(p);
    const job = this.throttled(() => this.request(p))
      .then((data) => {
        this.online = true;
        this.lastError = null;
        fs.writeFileSync(file, JSON.stringify({ fetchedAt: Date.now(), data }));
        return data;
      })
      .catch((err) => {
        this.online = false;
        this.lastError = err.message;
        if (cached) return cached.data; // stale data beats no data
        throw err;
      })
      .finally(() => this.inflight.delete(p));
    this.inflight.set(p, job);
    return job;
  }

  heroStats() {
    return this.get('/heroStats', TTL.heroStats);
  }

  itemPopularity(heroId) {
    return this.get(`/heroes/${heroId}/itemPopularity`, TTL.hero);
  }

  matchups(heroId) {
    return this.get(`/heroes/${heroId}/matchups`, TTL.hero);
  }

  benchmarks(heroId) {
    return this.get(`/benchmarks?hero_id=${heroId}`, TTL.hero);
  }

  items() {
    return this.get('/constants/items', TTL.constants);
  }

  match(matchId) {
    return this.get(`/matches/${matchId}`, 5 * 60 * 1000);
  }

  // Ask OpenDota to parse the replay (gives wards, stacks, lane data …). Best effort.
  requestParse(matchId) {
    if (this.fixturesDir) return Promise.resolve(null);
    return this.throttled(async () => {
      const url = new URL(`${BASE}/request/${matchId}`);
      if (this.apiKey) url.searchParams.set('api_key', this.apiKey);
      const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(20000) });
      return res.ok ? res.json() : null;
    }).catch(() => null);
  }
}

// Convert OpenDota /constants/items to the compact format used in data/items.json.
export function compactItems(raw) {
  const items = {};
  for (const [name, it] of Object.entries(raw || {})) {
    if (name.startsWith('recipe_') || !it || typeof it.id !== 'number') continue;
    items[name] = {
      id: it.id,
      dname: it.dname || name,
      cost: it.cost || 0,
      ...(it.qual ? { qual: it.qual } : {}),
      ...(it.tier ? { tier: it.tier } : {}),
      ...(it.created ? { created: true } : {}),
      ...(Array.isArray(it.components) && it.components.some(Boolean) ? { comp: it.components.filter(Boolean) } : {}),
    };
  }
  return items;
}
