// Self-updater: pulls new versions of the app straight from GitHub, file by file.
//
// - Only files that changed are downloaded (compared by git blob hash), from an exact commit so the
//   CDN can't hand out a half-updated mix, and every download is verified against the git hash.
// - Files that are replaced or removed are first copied to backup/<time>/, so an update can be undone.
// - After writing, a self-test runs the new code in a separate process; if it fails, the backup is
//   restored automatically.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const DEFAULT_CHANNEL = {
  repo: 'henrikeide01/henrikeide01.github.io',
  branches: ['claude/dota-coach', 'main'],
  path: 'dota-coach',
  apiBase: 'https://api.github.com',
  rawBase: 'https://raw.githubusercontent.com',
};

// Never touched by an update: the user's own data, downloaded packages and the updater's own state.
const PROTECTED = [/^settings\.json$/, /^overlay-window\.json$/, /^\.installed\.json$/, /^\.needs-install$/, /^(matches|cache|backup|node_modules|\.update)\//, /(^|\/)\.git\//];
const TEXT_EXT = new Set(['.js', '.cjs', '.mjs', '.json', '.html', '.css', '.md', '.bat', '.cmd', '.txt', '.cfg', '.svg', '']);
const CRLF_EXT = new Set(['.bat', '.cmd']);
const KEEP_BACKUPS = 3;

export const isProtected = (rel) => PROTECTED.some((re) => re.test(rel));
const isText = (rel) => TEXT_EXT.has(path.extname(rel).toLowerCase()) || path.basename(rel).startsWith('.git');

// Git stores text files with LF line endings; local copies may have CRLF (Windows / zip download).
export function normalize(rel, buf) {
  if (!isText(rel)) return buf;
  return Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

export function gitBlobSha(buf) {
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

// "1.10.0" > "1.9.3"
export function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// Safe relative path inside the app folder (no "..", no absolute paths, forward slashes).
export function safeRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
  const clean = rel.replace(/\\/g, '/');
  if (clean.startsWith('/') || /^[a-z]:/i.test(clean)) return null;
  const parts = clean.split('/');
  if (parts.some((p) => p === '..' || p === '' || p === '.')) return null;
  return parts.join('/');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export class Updater {
  // root: the app folder. channel: overrides DEFAULT_CHANNEL (from update.json). fetchImpl: for tests.
  constructor({ root, channel = null, fetchImpl = fetch, log = () => {}, selfTest = null } = {}) {
    this.root = root;
    this.channel = { ...DEFAULT_CHANNEL, ...readJson(path.join(root, 'update.json'), {}), ...(channel || {}) };
    this.fetch = fetchImpl;
    this.log = log;
    this.selfTest = selfTest || (() => defaultSelfTest(root));
    this.busy = false;
  }

  localVersion() {
    return readJson(path.join(this.root, 'version.json'), { version: '0.0.0', changes: [] });
  }

  async getJson(url, { allow404 = false } = {}) {
    const res = await this.fetch(url, { headers: { 'User-Agent': 'dota-coach-updater', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) {
      const limited = res.status === 403 || res.status === 429;
      throw new Error(limited ? 'GitHub sier at vi har spurt for ofte. Prøv igjen om en time.' : `GitHub svarte ${res.status}`);
    }
    return res.json();
  }

  async getBuffer(url) {
    const res = await this.fetch(url, { headers: { 'User-Agent': 'dota-coach-updater' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Nedlasting feilet (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  rawUrl(ref, rel) {
    const { rawBase, repo, path: sub } = this.channel;
    return `${rawBase}/${repo}/${ref}/${sub}/${rel}`.replace(/(?<!:)\/\/+/g, '/');
  }

  // Which branch has the newest version, and what changed since ours.
  async check() {
    const local = this.localVersion();
    let best = null;
    let lastError = null;
    for (const branch of this.channel.branches) {
      try {
        // `?t=` gets past the CDN cache so a fresh release shows up straight away.
        const remote = await this.getJson(`${this.rawUrl(`refs/heads/${branch}`, 'version.json')}?t=${Date.now()}`, { allow404: true });
        if (remote && (!best || compareVersions(remote.version, best.remote.version) > 0)) best = { branch, remote };
      } catch (err) {
        lastError = err;
      }
    }
    if (!best) {
      if (lastError) throw lastError;
      return { current: local.version, latest: null, available: false };
    }
    const newer = (best.remote.changes || []).filter((c) => compareVersions(c.version, local.version) > 0);
    return {
      current: local.version,
      latest: best.remote.version,
      branch: best.branch,
      available: compareVersions(best.remote.version, local.version) > 0,
      changes: newer.length ? newer : [{ version: best.remote.version, notes: best.remote.notes || [] }],
    };
  }

  // Downloads and installs the newest version. onProgress({ step, done, total })
  async apply({ branch, onProgress = () => {} } = {}) {
    if (this.busy) throw new Error('En oppdatering pågår allerede.');
    if (fs.existsSync(path.join(this.root, '.git'))) throw new Error('Denne mappen er en git-kopi. Bruk «git pull» for å oppdatere.');
    this.busy = true;
    try {
      const { repo, apiBase, path: sub } = this.channel;
      const target = branch || (await this.check()).branch || this.channel.branches[0];
      onProgress({ step: 'Finner nyeste versjon …' });
      const commit = await this.getJson(`${apiBase}/repos/${repo}/commits/${encodeURIComponent(target)}`);
      const tree = await this.getJson(`${apiBase}/repos/${repo}/git/trees/${commit.commit.tree.sha}?recursive=1`);
      if (tree.truncated) throw new Error('Repoet er for stort til å oppdatere fil for fil.');

      const prefix = `${sub}/`;
      const remote = new Map();
      for (const e of tree.tree || []) {
        if (e.type !== 'blob' || !e.path.startsWith(prefix)) continue;
        const rel = safeRel(e.path.slice(prefix.length));
        if (!rel || isProtected(rel)) continue;
        remote.set(rel, e.sha);
      }
      if (!remote.has('version.json') || !remote.has('src/server.js')) throw new Error('Fant ikke appen på GitHub.');

      // What differs from what we have?
      const changed = [];
      for (const [rel, sha] of remote) {
        const file = path.join(this.root, rel);
        let local = null;
        try {
          local = gitBlobSha(normalize(rel, fs.readFileSync(file)));
        } catch {
          // missing locally
        }
        if (local !== sha) changed.push({ rel, sha });
      }
      const manifest = readJson(path.join(this.root, '.installed.json'), null);
      const removed = manifest ? Object.keys(manifest.files || {}).filter((rel) => !remote.has(rel) && safeRel(rel) && !isProtected(rel) && fs.existsSync(path.join(this.root, rel))) : [];

      // Download everything first (nothing is written until all files are verified).
      let done = 0;
      const downloads = await pool(changed, 4, async ({ rel, sha }) => {
        const buf = await this.getBuffer(this.rawUrl(commit.sha, rel));
        if (gitBlobSha(buf) !== sha) throw new Error(`Filen ${rel} ble ikke lastet ned riktig. Prøv igjen.`);
        onProgress({ step: 'Laster ned', done: ++done, total: changed.length });
        return { rel, buf };
      });

      const fromVersion = this.localVersion().version;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupDir = path.join(this.root, 'backup', `${stamp}_v${fromVersion}`);
      const touched = [...downloads.map((d) => d.rel), ...removed];
      const backedUp = [];
      for (const rel of touched) {
        const file = path.join(this.root, rel);
        if (!fs.existsSync(file)) continue;
        const dest = path.join(backupDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(file, dest);
        backedUp.push(rel);
      }
      const created = downloads.map((d) => d.rel).filter((rel) => !backedUp.includes(rel));
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(path.join(backupDir, 'backup.json'), JSON.stringify({ from: fromVersion, files: backedUp, created, manifest }, null, 1));

      onProgress({ step: 'Installerer …' });
      try {
        for (const { rel, buf } of downloads) {
          const file = path.join(this.root, rel);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const data = CRLF_EXT.has(path.extname(rel).toLowerCase()) ? Buffer.from(buf.toString('utf8').replace(/\r?\n/g, '\r\n')) : buf;
          const tmp = `${file}.update-tmp`;
          fs.writeFileSync(tmp, data);
          fs.renameSync(tmp, file);
        }
        for (const rel of removed) fs.rmSync(path.join(this.root, rel), { force: true });
      } catch (err) {
        restoreBackup(this.root, backupDir);
        throw new Error(`Kunne ikke skrive filene (${err.message}). Den gamle versjonen er satt tilbake.`);
      }

      onProgress({ step: 'Tester den nye versjonen …' });
      const test = this.selfTest();
      if (!test.ok) {
        restoreBackup(this.root, backupDir);
        throw new Error(`Den nye versjonen startet ikke riktig, så den gamle er satt tilbake. (${test.error})`);
      }

      fs.writeFileSync(path.join(this.root, '.installed.json'), JSON.stringify({ version: this.localVersion().version, commit: commit.sha, branch: target, files: Object.fromEntries(remote) }));
      const needsInstall = depsChanged(backupDir, this.root);
      if (needsInstall) fs.writeFileSync(path.join(this.root, '.needs-install'), 'npm install\n');
      pruneBackups(this.root);
      const to = this.localVersion().version;
      this.log(`Oppdatert fra ${fromVersion} til ${to} (${downloads.length} filer endret, ${removed.length} fjernet).`);
      return { from: fromVersion, to, updated: downloads.map((d) => d.rel), removed, backupDir, needsInstall };
    } finally {
      this.busy = false;
    }
  }

  // Puts back the most recent backup (undoes the last update).
  rollback() {
    const latest = listBackups(this.root)[0];
    if (!latest) throw new Error('Fant ingen backup å gå tilbake til.');
    const from = this.localVersion().version;
    const info = restoreBackup(this.root, latest.dir);
    fs.rmSync(latest.dir, { recursive: true, force: true });
    return { from, to: info.from };
  }
}

export function listBackups(root) {
  const dir = path.join(root, 'backup');
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((name) => ({ name, dir: path.join(dir, name), info: readJson(path.join(dir, name, 'backup.json'), null) }))
    .filter((b) => b.info)
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function restoreBackup(root, backupDir) {
  const info = readJson(path.join(backupDir, 'backup.json'), null);
  if (!info) throw new Error('Backupen er ødelagt.');
  for (const rel of info.files || []) {
    const ok = safeRel(rel);
    if (!ok) continue;
    const dest = path.join(root, ok);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(backupDir, ok), dest);
  }
  for (const rel of info.created || []) {
    const ok = safeRel(rel);
    if (ok) fs.rmSync(path.join(root, ok), { force: true });
  }
  if (info.manifest) fs.writeFileSync(path.join(root, '.installed.json'), JSON.stringify(info.manifest));
  else fs.rmSync(path.join(root, '.installed.json'), { force: true });
  return info;
}

// Only a change in the npm packages needs «npm install» (not e.g. a new version number).
function depsChanged(backupDir, root) {
  const deps = (file) => {
    const pj = readJson(file, null);
    return pj ? JSON.stringify([pj.dependencies || {}, pj.devDependencies || {}, pj.optionalDependencies || {}]) : null;
  };
  const before = deps(path.join(backupDir, 'package.json'));
  if (before === null) return false; // package.json was not replaced
  return before !== deps(path.join(root, 'package.json'));
}

function pruneBackups(root) {
  for (const old of listBackups(root).slice(KEEP_BACKUPS)) fs.rmSync(old.dir, { recursive: true, force: true });
}

// Starts the freshly written code in a separate Node process and checks that it works.
export function defaultSelfTest(root) {
  const res = spawnSync(process.execPath, [path.join(root, 'src', 'selftest.js')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  if (res.status === 0) return { ok: true };
  const out = `${res.stderr || ''}${res.stdout || ''}`.trim().split('\n').slice(-3).join(' ');
  return { ok: false, error: out || res.error?.message || `kode ${res.status}` };
}
