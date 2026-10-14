// Dota Coach server: receives Dota 2 Game State Integration (GSI) data, runs the coach
// and pushes the result to the dashboard / overlay over Server-Sent Events.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { ROOT, loadSettings, saveSettings, publicSettings, applyPublicSettings } from './settings.js';
import { OpenDota, compactItems } from './opendota.js';
import { Coach, ROLE_LABEL } from './coach/engine.js';
import { ItemDb, buildFromPopularity } from './coach/items.js';
import { tierList, suggestHeroes, BRACKETS } from './coach/draft.js';
import { situationalItems, enemyTips } from './coach/situational.js';
import { positionsFor } from '../data/positions.js';

const PUBLIC = path.join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

export async function startServer(opts = {}) {
  let settings = loadSettings();
  let port = Number(opts.port ?? settings.port);
  const host = opts.lan ? '0.0.0.0' : '127.0.0.1';
  const log = opts.quiet ? () => {} : (...a) => console.log(...a);

  // ---------- Static data (bundled, refreshed from OpenDota when online) ----------
  const bundledHeroes = readJson('data/heroes.json');
  const heroes = new Map(bundledHeroes.heroes.map((h) => [h.name, h]));
  const bundledItems = readJson('data/items.json');
  let itemDb = new ItemDb(bundledItems.items);

  const od = new OpenDota({
    cacheDir: path.join(ROOT, 'cache'),
    apiKey: settings.opendotaApiKey,
    fixturesDir: opts.fixturesDir || process.env.DOTACOACH_FIXTURES || null,
  });

  const stats = new Map(); // hero name -> heroStats row
  async function loadHeroStats() {
    const rows = await od.heroStats();
    for (const r of rows) {
      const name = String(r.name || '').replace('npc_dota_hero_', '');
      if (!name) continue;
      stats.set(name, r);
      if (!heroes.has(name)) {
        heroes.set(name, { id: r.id, name, dname: r.localized_name, attr: r.primary_attr, attack: r.attack_type, roles: r.roles || [] });
      }
    }
    return stats;
  }

  const heroMeta = new Map(); // name -> { build, benchmarks }
  const heroMetaPending = new Map();
  function loadHeroMeta(name) {
    if (heroMeta.has(name)) return Promise.resolve(heroMeta.get(name));
    if (heroMetaPending.has(name)) return heroMetaPending.get(name);
    const hero = heroes.get(name);
    if (!hero) return Promise.resolve(null);
    const job = (async () => {
      const [pop, bench] = await Promise.allSettled([od.itemPopularity(hero.id), od.benchmarks(hero.id)]);
      const meta = {
        build: pop.status === 'fulfilled' ? buildFromPopularity(pop.value, itemDb) : null,
        benchmarks: bench.status === 'fulfilled' ? bench.value?.result || null : null,
      };
      // Offline? Use what we got, but try again in a minute.
      if (!meta.build || !meta.benchmarks) meta.retryAt = Date.now() + 60000;
      heroMeta.set(name, meta);
      return meta;
    })().finally(() => heroMetaPending.delete(name));
    heroMetaPending.set(name, job);
    return job;
  }

  const matchupCache = new Map(); // enemy name -> rows
  async function loadMatchups(names) {
    await Promise.all(
      names.map(async (n) => {
        if (matchupCache.has(n) || !heroes.has(n)) return;
        try {
          matchupCache.set(n, await od.matchups(heroes.get(n).id));
        } catch (err) {
          log(`Klarte ikke å hente matchups for ${n}: ${err.message}`);
        }
      }),
    );
    return matchupCache;
  }

  // ---------- Live state ----------
  let draft = { allies: [], enemies: [], bans: [], savedAt: 0 };
  let lastGsi = null;
  let lastGsiAt = 0;
  let lastMatchId = null;
  let state = null;

  const coach = new Coach({
    get itemDb() {
      return itemDb; // may be swapped for fresher data from OpenDota
    },
    heroes,
    getHeroMeta: (name) => {
      const cached = heroMeta.get(name);
      if (cached && !(cached.retryAt && Date.now() > cached.retryAt)) return cached;
      if (cached) heroMeta.delete(name);
      loadHeroMeta(name)
        .then(() => recompute())
        .catch(() => {});
      return cached || null;
    },
    getDraft: () => draft,
    getSettings: () => settings,
  });

  function idleState() {
    return { phase: 'menu', phaseLabel: lastGsiAt ? 'I menyen' : 'Venter på Dota 2', role: settings.role, roleLabel: ROLE_LABEL[settings.role], tips: [], timers: [], updatedAt: Date.now() };
  }

  function recompute() {
    if (!lastGsi) return;
    try {
      state = coach.update(lastGsi);
    } catch (err) {
      console.error('Coach-feil:', err);
      return;
    }
    broadcast('state', state);
  }

  function handleGsi(payload) {
    if (settings.token && payload?.auth?.token !== settings.token) {
      // `npm run setup` may have written a new token while the server was running.
      const fresh = loadSettings();
      if (fresh.token === settings.token || payload?.auth?.token !== fresh.token) return false;
      settings = { ...settings, token: fresh.token };
    }
    const first = !lastGsiAt;
    lastGsi = payload;
    lastGsiAt = Date.now();
    if (first) log('✔ Mottok data fra Dota 2. Coachen er koblet til!');

    const matchId = payload?.map?.matchid;
    if (matchId && matchId !== lastMatchId) {
      // A new match started: forget a draft that was entered for an older game.
      if (lastMatchId && Date.now() - draft.savedAt > 10 * 60 * 1000) draft = { allies: [], enemies: [], bans: [], savedAt: 0 };
      lastMatchId = matchId;
    }
    recompute();
    return true;
  }

  // ---------- Server-Sent Events ----------
  const spokenKeys = new Set();
  const clients = new Set();
  const pending = new Map();
  let flushTimer = null;
  function broadcast(event, data) {
    pending.set(event, data);
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      for (const [ev, d] of pending) {
        const msg = `event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`;
        for (const res of clients) res.write(msg);
      }
      pending.clear();
    }, 150);
  }
  const pingTimer = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
    broadcast('status', status());
  }, 5000);
  pingTimer.unref();

  function status() {
    return {
      gsiConnected: Date.now() - lastGsiAt < 35000,
      lastGsiAt,
      everConnected: lastGsiAt > 0,
      opendota: { online: od.online, lastError: od.lastError, fixtures: !!od.fixturesDir },
      patch: bundledHeroes.patch,
      settings: publicSettings(settings),
      tokenIsDefault: settings.token === 'dotacoach-local',
    };
  }

  // ---------- HTTP ----------
  const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 2e6) {
          reject(new Error('for stor'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });

  const heroList = () =>
    [...heroes.values()]
      .map((h) => ({ id: h.id, name: h.name, dname: h.dname, attr: h.attr, roles: h.roles, positions: positionsFor(h) }))
      .sort((a, b) => a.dname.localeCompare(b.dname));

  const cleanNames = (arr, max) => (Array.isArray(arr) ? [...new Set(arr)].filter((n) => typeof n === 'string' && heroes.has(n)).slice(0, max) : []);

  async function draftSuggestions(role, bracket) {
    await loadHeroStats().catch(() => {});
    await loadMatchups(draft.enemies);
    const toHero = (n) => heroes.get(n);
    const enemies = draft.enemies.map(toHero);
    const res = suggestHeroes({
      heroes: [...heroes.values()],
      stats,
      matchups: matchupCache,
      allies: draft.allies.map(toHero),
      enemies,
      bans: draft.bans.map(toHero),
      role,
      bracket,
    });
    return {
      ...res,
      hasStats: stats.size > 0,
      hasMatchups: draft.enemies.some((n) => matchupCache.has(n)),
      situational: situationalItems(enemies, role, itemDb),
      enemyTips: enemyTips(enemies),
    };
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (req.method === 'POST' && (p === '/gsi' || p === '/')) {
      const body = await readBody(req);
      const ok = handleGsi(body);
      return send(res, ok ? 200 : 401, ok ? 'ok' : 'feil token', 'text/plain');
    }

    if (p === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`event: status\ndata: ${JSON.stringify(status())}\n\n`);
      res.write(`event: state\ndata: ${JSON.stringify(state || idleState())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (p === '/api/status') return send(res, 200, status());
    if (p === '/api/state') return send(res, 200, state || idleState());
    if (p === '/api/heroes') return send(res, 200, { patch: bundledHeroes.patch, brackets: BRACKETS, heroes: heroList() });

    if (p === '/api/meta') {
      const bracket = Number(url.searchParams.get('bracket')) || settings.bracket;
      const role = Number(url.searchParams.get('role')) || 0;
      try {
        await loadHeroStats();
      } catch (err) {
        return send(res, 503, { error: `Fikk ikke hentet meta fra OpenDota (${err.message}). Sjekk internett og prøv igjen.` });
      }
      return send(res, 200, { bracket, role, rows: tierList([...heroes.values()], stats, { bracket, role }) });
    }

    const heroMatch = p.match(/^\/api\/hero\/([a-z0-9_]+)$/);
    if (heroMatch) {
      const name = heroMatch[1];
      if (!heroes.has(name)) return send(res, 404, { error: 'Ukjent hero' });
      const meta = await loadHeroMeta(name).catch(() => null);
      return send(res, 200, { hero: heroes.get(name), build: meta?.build || null, benchmarks: meta?.benchmarks || null, error: meta?.build ? null : od.lastError });
    }

    if (p === '/api/draft' && req.method === 'GET') return send(res, 200, draft);
    if (p === '/api/draft' && req.method === 'POST') {
      const body = await readBody(req);
      draft = { allies: cleanNames(body.allies, 4), enemies: cleanNames(body.enemies, 5), bans: cleanNames(body.bans, 10), savedAt: Date.now() };
      const role = Number(body.role) || settings.role;
      const bracket = Number(body.bracket) || settings.bracket;
      const suggestions = await draftSuggestions(role, bracket);
      recompute();
      return send(res, 200, { draft, suggestions });
    }

    // Several windows (dashboard, overlay, phone) may have speech on; only the first one to claim a tip reads it.
    if (p === '/api/claim-speech' && req.method === 'POST') {
      const { key } = await readBody(req);
      const ok = typeof key === 'string' && !spokenKeys.has(key);
      if (ok) {
        spokenKeys.add(key);
        if (spokenKeys.size > 500) spokenKeys.delete(spokenKeys.values().next().value);
      }
      return send(res, 200, { ok });
    }

    if (p === '/api/settings' && req.method === 'GET') return send(res, 200, publicSettings(settings));
    if (p === '/api/settings' && req.method === 'POST') {
      settings = applyPublicSettings(settings, await readBody(req));
      saveSettings(settings);
      recompute();
      broadcast('status', status());
      return send(res, 200, publicSettings(settings));
    }

    if (req.method !== 'GET') return send(res, 405, { error: 'Metoden er ikke støttet' });

    // Static files
    const rel = p === '/' ? '/index.html' : decodeURIComponent(p);
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Nei', 'text/plain');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Fant ikke siden', 'text/plain; charset=utf-8');
      send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
    });
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: err.message });
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  port = server.address().port;

  // Warm up: hero stats for the draft/meta pages and fresh item data for the current patch.
  loadHeroStats().catch((err) => log(`(Meta fra OpenDota er ikke tilgjengelig akkurat nå: ${err.message})`));
  od.items()
    .then((raw) => {
      const items = compactItems(raw);
      if (Object.keys(items).length > 100) itemDb = new ItemDb({ ...bundledItems.items, ...items });
    })
    .catch(() => {});

  const url = `http://localhost:${port}`;
  log(`\n  Dota Coach kjører på ${url}`);
  log(`  Overlay (kompakt):   ${url}/overlay.html`);
  if (opts.lan) {
    for (const ifs of Object.values(os.networkInterfaces())) {
      for (const i of ifs || []) if (i.family === 'IPv4' && !i.internal) log(`  På mobil/nettbrett:  http://${i.address}:${port}`);
    }
  }
  log('\n  Venter på data fra Dota 2 … (start en kamp, eller kjør "npm run simulate" for en demo)\n');

  const close = () => {
    clearInterval(pingTimer);
    for (const res of clients) res.end();
    return new Promise((r) => server.close(r));
  };
  return { server, port, url, close, handleGsi, getState: () => state };
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const portArg = args.indexOf('--port');
  startServer({ lan: args.includes('--lan'), port: portArg >= 0 ? args[portArg + 1] : undefined })
    .then(({ url }) => {
      if (args.includes('--open')) openBrowser(url);
    })
    .catch((err) => {
      if (err.code === 'EADDRINUSE') {
        console.error('\n  Porten er allerede i bruk. Kjører Dota Coach allerede i et annet vindu?\n');
      } else {
        console.error(err);
      }
      process.exit(1);
    });
}
