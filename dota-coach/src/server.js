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
import { analyzeMatch, enrichFromOpenDota, trends } from './coach/analysis.js';
import { computeHeroSkills } from './coach/skills.js';
import { gsiConfig, install as installGsiConfig } from './setup.js';
import { Updater, listBackups, compareVersions } from './updater.js';

const maxVersion = (a, b) => (!a ? b || null : !b ? a : compareVersions(a, b) >= 0 ? a : b);
import { positionsFor } from '../data/positions.js';

const PUBLIC = path.join(ROOT, 'public');
const MATCHES = path.join(ROOT, 'matches');
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

// The last errors, so «Kopier diagnose» can include them.
const recentErrors = [];
if (!console.error.dotaCoachWrapped) {
  const original = console.error;
  console.error = (...args) => {
    recentErrors.push({ at: new Date().toISOString(), text: args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ').slice(0, 600) });
    if (recentErrors.length > 30) recentErrors.shift();
    original(...args);
  };
  console.error.dotaCoachWrapped = true;
}

export async function startServer(opts = {}) {
  let settings = loadSettings();
  let port = Number(opts.port ?? settings.port);
  const host = opts.lan ? '0.0.0.0' : '127.0.0.1';
  const log = opts.quiet ? () => {} : (...a) => console.log(...a);

  // ---------- Static data (bundled, refreshed from OpenDota when online) ----------
  const bundledHeroes = readJson('data/heroes.json');
  const heroes = new Map(bundledHeroes.heroes.map((h) => [h.name, h]));
  const bundledItems = readJson('data/items.json');
  const abilityData = readJson('data/abilities.json');
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
      const [pop, bench, skillRows] = await Promise.allSettled([od.itemPopularity(hero.id), od.benchmarks(hero.id), od.heroSkillRows(hero.id)]);
      const abilities = abilityData.heroes[name];
      const meta = {
        build: pop.status === 'fulfilled' ? buildFromPopularity(pop.value, itemDb) : null,
        benchmarks: bench.status === 'fulfilled' ? bench.value?.result || null : null,
        skills: skillRows.status === 'fulfilled' && abilities ? computeHeroSkills(skillRows.value, abilities, abilityData.ids, itemDb) : null,
      };
      // Offline? Use what we got, but try again in a minute.
      if (!meta.build || !meta.benchmarks || !meta.skills) meta.retryAt = Date.now() + 60000;
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
  // The draft = heroes entered by hand + heroes the desktop app recognised on screen (overlay/vision.cjs).
  let manual = { allies: [], enemies: [], bans: [], savedAt: 0 };
  let auto = { radiant: [], dire: [], at: 0 };
  let blocked = new Set(); // recognised heroes the user removed by hand
  let draft = { allies: [], enemies: [], bans: [], savedAt: 0, autoAllies: [], autoEnemies: [], unassigned: [], team: null, ownHero: null, autoAt: 0 };
  let draftHelp = null; // pick suggestions for the current draft, shown in the overlay
  let vision = {};
  let visionCommand = {};
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
    getDraftHelp: () => draftHelp,
    abilityData,
    getSettings: () => settings,
  });

  // ---------- Post-game analysis and match history ----------
  const matchesDir = opts.matchesDir || MATCHES;
  fs.mkdirSync(matchesDir, { recursive: true });
  const reportFile = (id) => path.join(matchesDir, `${String(id).replace(/[^0-9a-z_-]/gi, '')}.json`);

  function listReports() {
    const out = [];
    for (const f of fs.readdirSync(matchesDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(matchesDir, f), 'utf8')));
      } catch {
        // skip broken files
      }
    }
    return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  const summary = (r) => ({
    matchId: r.matchId,
    date: r.date,
    duration: r.duration,
    result: r.result,
    hero: r.hero,
    role: r.role,
    score: r.score,
    grade: r.grade,
    kda: [r.stats.kills, r.stats.deaths, r.stats.assists],
    gpm: r.stats.gpm,
  });

  async function enrich(report, rec) {
    try {
      const match = await od.match(report.matchId);
      const extra = enrichFromOpenDota(report, match, { accountId: rec?.accountId ?? report.accountId, heroId: rec?.heroId ?? report.heroId });
      if (!extra) return false;
      report.opendota = extra;
      fs.writeFileSync(reportFile(report.matchId), JSON.stringify(report));
      broadcast('report', summary(report));
      return extra.parsed;
    } catch {
      return false;
    }
  }

  async function handleFinished(rec) {
    try {
      const meta = heroMeta.get(rec.hero?.name) || (await loadHeroMeta(rec.hero?.name).catch(() => null));
      const report = analyzeMatch(rec, { meta, itemDb, heroes });
      report.accountId = rec.accountId;
      report.heroId = rec.heroId;
      fs.writeFileSync(reportFile(report.matchId), JSON.stringify(report));
      log(`✔ Kampanalyse klar: ${report.hero?.dname} – karakter ${report.grade} (${report.score}/100)`);
      broadcast('report', summary(report));
      opts.onReport?.(summary(report));
      // OpenDota needs a few minutes before the match is available (only for public match data).
      if (!od.fixturesDir) od.requestParse(report.matchId);
      for (const delay of od.fixturesDir ? [500] : [3, 8, 20].map((m) => m * 60 * 1000)) {
        setTimeout(async () => {
          const r = (() => {
            try {
              return JSON.parse(fs.readFileSync(reportFile(report.matchId), 'utf8'));
            } catch {
              return null;
            }
          })();
          if (r && !r.opendota?.parsed) await enrich(r, rec);
        }, delay).unref();
      }
    } catch (err) {
      console.error('Kampanalysen feilet:', err);
    }
  }

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
    for (const rec of coach.popFinished()) handleFinished(rec);
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
      // A new match started: forget a draft that was entered or recognised for an older game.
      if (lastMatchId && Date.now() - manual.savedAt > 10 * 60 * 1000) manual = { allies: [], enemies: [], bans: [], savedAt: 0 };
      if (lastMatchId && Date.now() - auto.at > 3 * 60 * 1000) {
        auto = { radiant: [], dire: [], at: 0 };
        blocked = new Set();
      }
      lastMatchId = matchId;
    }
    if (updateDraft()) refreshDraftHelp();
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

  // Saves our settings without losing a skipVersion written by tools/rollback.js meanwhile.
  function persistSettings() {
    const disk = loadSettings();
    settings = { ...disk, ...publicSettings(settings), skipVersion: maxVersion(settings.skipVersion, disk.skipVersion) };
    saveSettings(settings);
  }

  // ---------- Self-update ----------
  const updater = new Updater({ root: opts.root || ROOT, channel: opts.updateChannel || null, log });
  const appVersion = () => updater.localVersion().version;
  let update = { state: 'idle', current: appVersion(), available: false, checkedAt: null };
  const setUpdate = (patchObj) => {
    update = { ...update, ...patchObj };
    broadcast('update', update);
  };
  const inGameNow = () => Date.now() - lastGsiAt < 60000 && state && !['menu', 'post'].includes(state.phase);

  async function checkForUpdate() {
    if (update.state === 'downloading' || update.state === 'restarting') return update;
    setUpdate({ state: 'checking' });
    try {
      const res = await updater.check();
      setUpdate({ state: 'idle', ...res, error: null, checkedAt: Date.now() });
    } catch (err) {
      setUpdate({ state: 'idle', error: err.message, checkedAt: Date.now() });
    }
    return update;
  }

  const canRestart = () => !!opts.onRestart || !!process.env.DOTACOACH_LAUNCHER;

  function restart() {
    if (!canRestart()) {
      // Started some other way (npm start, demo): nothing would start us again, so don't exit.
      setUpdate({ state: 'installed' });
      log('  Start Dota Coach på nytt for å bruke den nye versjonen.');
      return;
    }
    setUpdate({ state: 'restarting' });
    setTimeout(() => {
      if (opts.onRestart) opts.onRestart();
      else process.exit(75); // start.bat starts the server again on exit code 75
    }, 600);
  }

  // Not a version the user backed out of, and not one that already failed to install.
  function wantsAutoInstall(version) {
    const skip = maxVersion(settings.skipVersion, loadSettings().skipVersion);
    return compareVersions(version, skip || '0') > 0 && version !== updater.failedVersion();
  }

  async function installUpdate() {
    if (update.state === 'downloading') throw new Error('En oppdatering pågår allerede.');
    setUpdate({ state: 'downloading', progress: null, error: null });
    try {
      const res = await updater.apply({ branch: update.branch, onProgress: (p) => setUpdate({ progress: p }) });
      log(`✔ Oppdatert til versjon ${res.to}. Starter på nytt …`);
      setUpdate({ installed: res });
      if (res.to !== res.from) restart();
      else setUpdate({ state: 'idle', available: false });
      return res;
    } catch (err) {
      setUpdate({ state: 'idle', error: err.message, progress: null });
      throw err;
    }
  }

  function status() {
    return {
      version: appVersion(),
      canRestart: canRestart(),
      gsiConnected: Date.now() - lastGsiAt < 35000,
      lastGsiAt,
      everConnected: lastGsiAt > 0,
      opendota: { online: od.online, lastError: od.lastError, fixtures: !!od.fixturesDir },
      patch: bundledHeroes.patch,
      settings: publicSettings(settings),
      tokenIsDefault: settings.token === 'dotacoach-local',
      vision: { active: Date.now() - (vision.reportedAt || 0) < 15000, found: vision.found ?? null, debugFile: vision.debugFile || null, error: vision.error || null },
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

  const ownHeroName = () => (lastGsi?.hero?.name ? lastGsi.hero.name.replace('npc_dota_hero_', '') : null);
  const myTeam = () => {
    const t = lastGsi?.player?.team_name;
    if (t === 'radiant' || t === 'dire') return t;
    const own = ownHeroName();
    if (own && auto.radiant.includes(own)) return 'radiant';
    if (own && auto.dire.includes(own)) return 'dire';
    return null;
  };

  // Recomputes the effective draft (manual + recognised); returns true when it changed.
  function updateDraft() {
    const own = ownHeroName();
    const team = myTeam();
    const autoAllies = team ? auto[team] : [];
    const autoEnemies = team ? auto[team === 'radiant' ? 'dire' : 'radiant'] : [];
    const ok = (n) => heroes.has(n) && !blocked.has(n);
    const enemies = [...new Set([...manual.enemies, ...autoEnemies.filter((n) => !manual.allies.includes(n))])].filter(ok).slice(0, 5);
    const allies = [...new Set([...manual.allies, ...autoAllies])].filter((n) => ok(n) && n !== own && !enemies.includes(n)).slice(0, 4);
    const next = {
      allies,
      enemies,
      bans: manual.bans,
      savedAt: manual.savedAt,
      autoAllies: allies.filter((n) => !manual.allies.includes(n)),
      autoEnemies: enemies.filter((n) => !manual.enemies.includes(n)),
      unassigned: team ? [] : [...new Set([...auto.radiant, ...auto.dire])].filter(ok),
      team,
      ownHero: own,
      autoAt: auto.at,
    };
    const changed = JSON.stringify(next) !== JSON.stringify(draft);
    draft = next;
    return changed;
  }

  let helpSeq = 0;
  async function refreshDraftHelp() {
    const seq = ++helpSeq;
    try {
      const res = await draftSuggestions(settings.role, settings.bracket);
      if (seq !== helpSeq) return;
      draftHelp = { picks: res.picks.slice(0, 6), avoid: (res.avoid || []).slice(0, 3), hasStats: res.hasStats, hasMatchups: res.hasMatchups, enemies: draft.enemies, allies: draft.allies };
      recompute();
    } catch (err) {
      log(`Draft-forslag feilet: ${err.message}`);
    }
  }

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

    if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
      return send(res, 403, { error: 'Ikke tillatt' });
    }

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
      const sk = meta?.skills;
      return send(res, 200, {
        hero: heroes.get(name),
        build: meta?.build || null,
        benchmarks: meta?.benchmarks || null,
        skills: sk ? { games: sk.games, typical: sk.typical, talents: sk.talents, neutrals: sk.neutrals.slice(0, 15) } : null,
        error: meta?.build ? null : od.lastError,
      });
    }

    if (p === '/api/matches' && req.method === 'GET') {
      const reports = listReports();
      return send(res, 200, { matches: reports.map(summary), trends: trends(reports) });
    }
    const matchRoute = p.match(/^\/api\/matches\/([0-9a-z_-]+)(\/opendota)?$/i);
    if (matchRoute) {
      let report;
      try {
        report = JSON.parse(fs.readFileSync(reportFile(matchRoute[1]), 'utf8'));
      } catch {
        return send(res, 404, { error: 'Fant ikke kampen' });
      }
      if (matchRoute[2] && req.method === 'POST') {
        const ok = await enrich(report, null);
        return send(res, 200, { report, found: !!report.opendota, parsed: ok });
      }
      if (req.method === 'DELETE') {
        fs.unlinkSync(reportFile(matchRoute[1]));
        return send(res, 200, { ok: true });
      }
      return send(res, 200, report);
    }

    if (p === '/api/draft' && req.method === 'GET') return send(res, 200, draft);
    if (p === '/api/draft' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.reset) {
        auto = { radiant: [], dire: [], at: 0 };
        blocked = new Set();
      }
      // Heroes the user removed stay out even if the screen still shows them (wrong recognition).
      for (const n of cleanNames(body.removed, 10)) blocked.add(n);
      // Recognised heroes stay "automatic"; only what the user added is stored as manual.
      const recognised = new Set([...draft.autoAllies, ...draft.autoEnemies]);
      const allies = cleanNames(body.allies, 4);
      const enemies = cleanNames(body.enemies, 5);
      manual = {
        allies: allies.filter((n) => !recognised.has(n) || draft.autoEnemies.includes(n)),
        enemies: enemies.filter((n) => !recognised.has(n) || draft.autoAllies.includes(n)),
        bans: cleanNames(body.bans, 10),
        savedAt: Date.now(),
      };
      for (const n of [...allies, ...enemies]) blocked.delete(n);
      updateDraft();
      const role = Number(body.role) || settings.role;
      const bracket = Number(body.bracket) || settings.bracket;
      const suggestions = await draftSuggestions(role, bracket);
      refreshDraftHelp();
      return send(res, 200, { draft, suggestions });
    }
    // Heroes the desktop app recognised on screen: { left: [...], right: [...] } (Radiant left, Dire right).
    if (p === '/api/draft/auto' && req.method === 'POST') {
      const body = await readBody(req);
      auto = { radiant: cleanNames(body.left, 5), dire: cleanNames(body.right, 5), at: Date.now() };
      if (updateDraft()) {
        log(`  Gjenkjente helter: ${auto.radiant.join(', ') || '-'} | ${auto.dire.join(', ') || '-'}`);
        refreshDraftHelp();
        recompute();
      }
      return send(res, 200, { ok: true, draft });
    }
    if (p === '/api/vision/status' && req.method === 'POST') {
      vision = { ...(await readBody(req)), reportedAt: Date.now() };
      const command = visionCommand;
      visionCommand = {};
      return send(res, 200, { ok: true, command });
    }
    if (p === '/api/vision/debug' && req.method === 'POST') {
      visionCommand = { saveDebug: true };
      return send(res, 200, { ok: true, active: Date.now() - (vision.reportedAt || 0) < 15000 });
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
    if (p === '/api/update' && req.method === 'GET') {
      return send(res, 200, { ...update, current: appVersion(), backups: listBackups(updater.root).map((b) => ({ name: b.name, from: b.info.from })), changes: update.changes, log: updater.localVersion().changes || [] });
    }
    if (p === '/api/update/check' && req.method === 'POST') return send(res, 200, await checkForUpdate());
    if (p === '/api/update/apply' && req.method === 'POST') {
      try {
        if (!update.available) await checkForUpdate();
        if (!update.available) return send(res, 200, { ok: false, error: 'Du har allerede nyeste versjon.' });
        const result = await installUpdate();
        return send(res, 200, { ok: true, result });
      } catch (err) {
        return send(res, 200, { ok: false, error: err.message });
      }
    }
    if (p === '/api/update/rollback' && req.method === 'POST') {
      if (updater.busy || ['downloading', 'restarting'].includes(update.state)) return send(res, 200, { ok: false, error: 'En oppdatering pågår. Vent litt.' });
      try {
        const r = updater.rollback();
        // Don't install the version we just left (or anything older) again automatically.
        settings = { ...settings, skipVersion: maxVersion(settings.skipVersion, r.from) };
        persistSettings();
        log(`↩ Rullet tilbake til versjon ${r.to}. Starter på nytt …`);
        restart();
        return send(res, 200, { ok: true, to: r.to });
      } catch (err) {
        return send(res, 200, { ok: false, error: err.message });
      }
    }
    if (p === '/api/diagnostics') {
      const reports = listReports().slice(0, 5);
      return send(res, 200, {
        app: appVersion(),
        patch: bundledHeroes.patch,
        platform: `${process.platform} ${process.arch}`,
        node: process.version,
        electron: process.versions.electron || null,
        settings: publicSettings(settings),
        gsi: { connected: Date.now() - lastGsiAt < 35000, everConnected: lastGsiAt > 0, phase: state?.phase || null },
        opendota: { online: od.online, lastError: od.lastError },
        update: { available: update.available, latest: update.latest || null, error: update.error || null },
        errors: recentErrors.slice(-15),
        vision,
        draft: { team: draft.team, allies: draft.allies, enemies: draft.enemies, autoAllies: draft.autoAllies, autoEnemies: draft.autoEnemies, unassigned: draft.unassigned },
        matches: reports.map((r) => ({
          hero: r.hero?.name,
          role: r.role,
          result: r.result,
          duration: r.duration,
          score: r.score,
          categories: Object.fromEntries(r.categories.map((c) => [c.id, c.score])),
          tags: r.tags,
          stats: { kda: [r.stats.kills, r.stats.deaths, r.stats.assists], lhAt10: r.stats.lhAt10, gpm: r.stats.gpm, kp: r.stats.kp },
        })),
      });
    }

    if (p === '/api/settings' && req.method === 'POST') {
      settings = applyPublicSettings(settings, await readBody(req));
      persistSettings();
      refreshDraftHelp();
      recompute();
      broadcast('status', status());
      return send(res, 200, publicSettings(settings));
    }

    if (req.method !== 'GET') return send(res, 405, { error: 'Metoden er ikke støttet' });
    if (p.startsWith('/api/')) return send(res, 404, { error: 'Ukjent API-adresse' });

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
  if (!opts.noWarmup) loadHeroStats().catch((err) => log(`(Meta fra OpenDota er ikke tilgjengelig akkurat nå: ${err.message})`));
  if (!opts.noWarmup) od.items()
    .then((raw) => {
      const items = compactItems(raw);
      if (Object.keys(items).length > 100) itemDb = new ItemDb({ ...bundledItems.items, ...items });
    })
    .catch(() => {});

  const url = `http://localhost:${port}`;
  log(`\n  Dota Coach ${appVersion()} kjører på ${url}`);
  log(`  Overlay (kompakt):   ${url}/overlay.html`);
  if (opts.lan) {
    for (const ifs of Object.values(os.networkInterfaces())) {
      for (const i of ifs || []) if (i.family === 'IPv4' && !i.internal) log(`  På mobil/nettbrett:  http://${i.address}:${port}`);
    }
  }
  log('\n  Venter på data fra Dota 2 … (start en kamp, eller kjør "npm run simulate" for en demo)\n');

  // Keep the GSI config in the Dota folder current: new versions can ask Dota for more data.
  if (settings.dotaDir && !opts.noWarmup) {
    try {
      const file = path.join(settings.dotaDir, 'game', 'dota', 'cfg', 'gamestate_integration', 'gamestate_integration_dotacoach.cfg');
      if (fs.existsSync(path.join(settings.dotaDir, 'game', 'dota')) && (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== gsiConfig(settings))) {
        installGsiConfig({ dotaDir: settings.dotaDir, port: settings.port, token: settings.token });
        log('  Oppdaterte GSI-oppsettet i Dota-mappen (mer data til coachen). Start Dota på nytt hvis det kjører.');
      }
    } catch (err) {
      log(`  (Klarte ikke å oppdatere GSI-oppsettet: ${err.message})`);
    }
  }

  // Look for updates at start-up (and install them straight away if allowed and no game is running),
  // then every three hours.
  let updateTimer = null;
  if (!opts.noUpdate && !od.fixturesDir) {
    // Wait > one GSI heartbeat (10 s) so we know whether a game is running before installing anything.
    setTimeout(async () => {
      await checkForUpdate();
      if (update.available && settings.autoUpdate !== false && canRestart() && wantsAutoInstall(update.latest) && !inGameNow()) {
        log(`  Ny versjon ${update.latest} funnet – installerer …`);
        installUpdate().catch((err) => log(`  Oppdateringen feilet: ${err.message}`));
      } else if (update.available) {
        log(`  Ny versjon ${update.latest} er klar. Trykk «Oppdater» i appen.`);
      }
    }, 12000).unref();
    updateTimer = setInterval(checkForUpdate, 3 * 3600 * 1000);
    updateTimer.unref();
  }

  const close = () => {
    clearInterval(updateTimer);
    clearInterval(pingTimer);
    for (const res of clients) res.end();
    return new Promise((r) => server.close(r));
  };
  return { server, port, url, close, handleGsi, getState: () => state, updater, checkForUpdate };
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
