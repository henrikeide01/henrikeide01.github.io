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
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

export const DEFAULT_CHANNEL = {
  repo: 'henrikeide01/henrikeide01.github.io',
  branches: ['claude/dota-coach', 'main'],
  path: 'dota-coach',
  apiBase: 'https://api.github.com',
  rawBase: 'https://raw.githubusercontent.com',
  codeloadBase: 'https://codeload.github.com',
};

// Never touched by an update: the user's own data, downloaded packages and the updater's own state.
const PROTECTED = [/^settings\.json$/, /^overlay-window\.json$/, /^overlay-map-window\.json$/, /^\.installed\.json$/, /^\.needs-install$/, /^(matches|cache|backup|debug|node_modules|\.update)\//, /(^|\/)\.git\//];
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
    if (insideGit(this.root)) throw new Error('Denne mappen er en git-kopi. Bruk «git pull» for å oppdatere.');
    this.busy = true;
    try {
      const target = branch || (await this.check()).branch || this.channel.branches[0];
      onProgress({ step: 'Finner nyeste versjon …' });
      // Preferred: one archive download (no API rate limit). Fallback: the API + single files.
      const fromVersion = this.localVersion().version;
      let snap;
      try {
        snap = await this.snapshotFromArchive(target, onProgress);
        // Right after a release the archive can still be the old one; the API always has the newest.
        if (compareVersions(this.snapshotVersion(snap), fromVersion) <= 0) snap = await this.snapshotFromApi(target, onProgress);
      } catch (err) {
        this.log(`(Arkiv-nedlasting feilet: ${err.message}. Prøver fil for fil.)`);
        snap = await this.snapshotFromApi(target, onProgress);
      }
      if (compareVersions(this.snapshotVersion(snap), fromVersion) <= 0) {
        throw new Error('Den nye versjonen er ikke helt klar hos GitHub ennå. Prøv igjen om noen minutter.');
      }
      const { remote, downloads, commit } = snap;
      const manifest = readJson(path.join(this.root, '.installed.json'), null);
      const upstreamLower = new Set([...remote.keys()].map((r) => r.toLowerCase()));
      const removed = manifest
        ? Object.keys(manifest.files || {}).filter((rel) => !upstreamLower.has(rel.toLowerCase()) && safeRel(rel) && !isProtected(rel) && fs.existsSync(path.join(this.root, rel)))
        : [];

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
        this.undoFailed(backupDir, this.snapshotVersion(snap), err.message);
        throw new Error(`Kunne ikke skrive filene (${err.message}). Den gamle versjonen er satt tilbake.`);
      }

      onProgress({ step: 'Tester den nye versjonen …' });
      const test = this.selfTest();
      if (!test.ok) {
        this.undoFailed(backupDir, this.snapshotVersion(snap), test.error);
        throw new Error(`Den nye versjonen startet ikke riktig, så den gamle er satt tilbake. (${test.error})`);
      }
      fs.rmSync(path.join(this.root, '.update', 'failed.json'), { force: true });

      fs.writeFileSync(path.join(this.root, '.installed.json'), JSON.stringify({ version: this.localVersion().version, commit, branch: target, files: Object.fromEntries(remote) }));
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

  // The version inside a downloaded snapshot (version.json is either new, or unchanged = ours).
  snapshotVersion(snap) {
    const v = snap.downloads.find((d) => d.rel === 'version.json');
    if (!v) return this.localVersion().version;
    try {
      return JSON.parse(v.buf.toString('utf8')).version;
    } catch {
      return '0.0.0';
    }
  }

  undoFailed(backupDir, version, error) {
    restoreBackup(this.root, backupDir);
    fs.rmSync(backupDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(this.root, '.update'), { recursive: true });
    fs.writeFileSync(path.join(this.root, '.update', 'failed.json'), JSON.stringify({ version, error, at: new Date().toISOString() }));
  }

  // A version that failed to install is not retried automatically (a newer one is).
  failedVersion() {
    return readJson(path.join(this.root, '.update', 'failed.json'), null)?.version || null;
  }

  // Files of the app (rel -> git blob sha) and which of them differ from what we have locally.
  localSha(rel) {
    try {
      return gitBlobSha(normalize(rel, fs.readFileSync(path.join(this.root, rel))));
    } catch {
      return null; // missing locally
    }
  }

  appEntry(fullPath) {
    const prefix = `${this.channel.path}/`;
    if (!fullPath.startsWith(prefix)) return null;
    const rel = safeRel(fullPath.slice(prefix.length));
    return rel && !isProtected(rel) ? rel : null;
  }

  checkSnapshot(remote) {
    if (!remote.has('version.json') || !remote.has('src/server.js')) throw new Error('Fant ikke appen på GitHub.');
  }

  // The whole branch as one .tar.gz from codeload.github.com (not limited like the API).
  async snapshotFromArchive(branch, onProgress) {
    const { codeloadBase, repo } = this.channel;
    onProgress({ step: 'Laster ned …' });
    const gz = await this.getBuffer(`${codeloadBase}/${repo}/tar.gz/refs/heads/${branch}`);
    const { entries, comment } = parseTar(zlib.gunzipSync(gz));
    const remote = new Map();
    const downloads = [];
    for (const e of entries) {
      if (e.type !== 'file') continue;
      // Strip the top folder GitHub adds ("<repo>-<branch>/").
      const rel = this.appEntry(e.path.slice(e.path.indexOf('/') + 1));
      if (!rel) continue;
      const buf = normalize(rel, e.data);
      const sha = gitBlobSha(buf);
      remote.set(rel, sha);
      if (this.localSha(rel) !== sha) downloads.push({ rel, buf });
    }
    this.checkSnapshot(remote);
    onProgress({ step: 'Laster ned', done: downloads.length, total: downloads.length });
    return { remote, downloads, commit: /^[0-9a-f]{40}$/.test(comment || '') ? comment : null };
  }

  // Fallback: list the files with the GitHub API, then fetch only the changed ones (verified by hash).
  async snapshotFromApi(branch, onProgress) {
    const { repo, apiBase } = this.channel;
    const commit = await this.getJson(`${apiBase}/repos/${repo}/commits/${encodeURIComponent(branch)}`);
    const tree = await this.getJson(`${apiBase}/repos/${repo}/git/trees/${commit.commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error('Repoet er for stort til å oppdatere fil for fil.');
    const remote = new Map();
    for (const e of tree.tree || []) {
      if (e.type !== 'blob') continue;
      const rel = this.appEntry(e.path);
      if (rel) remote.set(rel, e.sha);
    }
    this.checkSnapshot(remote);
    const changed = [...remote].filter(([rel, sha]) => this.localSha(rel) !== sha);
    let done = 0;
    const downloads = await pool(changed, 4, async ([rel, sha]) => {
      const buf = await this.getBuffer(this.rawUrl(commit.sha, rel));
      if (gitBlobSha(buf) !== sha) throw new Error(`Filen ${rel} ble ikke lastet ned riktig. Prøv igjen.`);
      onProgress({ step: 'Laster ned', done: ++done, total: changed.length });
      return { rel, buf };
    });
    return { remote, downloads, commit: commit.sha };
  }

  // Puts back the most recent backup (undoes the last update).
  rollback() {
    if (this.busy) throw new Error('En oppdatering pågår. Vent til den er ferdig.');
    const latest = listBackups(this.root)[0];
    if (!latest) throw new Error('Fant ingen backup å gå tilbake til.');
    const from = this.localVersion().version;
    const info = restoreBackup(this.root, latest.dir);
    fs.rmSync(latest.dir, { recursive: true, force: true });
    return { from, to: info.from };
  }
}

// Minimal reader for the (ustar/pax) tar files GitHub produces. Returns files, folders and the
// global "comment" header, which holds the commit id.
export function parseTar(buf) {
  const entries = [];
  let comment = null;
  let nextPath = null;
  const str = (start, len) => buf.toString('utf8', start, start + len).replace(/\0[\s\S]*$/, '');
  const pax = (data) => {
    const out = {};
    let i = 0;
    while (i < data.length) {
      const sp = data.indexOf(0x20, i);
      const len = parseInt(data.toString('utf8', i, sp), 10);
      if (!len || sp < 0) break;
      const rec = data.toString('utf8', sp + 1, i + len - 1);
      const eq = rec.indexOf('=');
      out[rec.slice(0, eq)] = rec.slice(eq + 1);
      i += len;
    }
    return out;
  };
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(str(off + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 0x30);
    const prefix = str(off + 345, 155);
    const name = str(off, 100);
    const data = buf.subarray(off + 512, off + 512 + size);
    if (data.length < size) throw new Error('Arkivet er ufullstendig.');
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'g') {
      comment = pax(data).comment ?? comment;
      continue;
    }
    if (type === 'x') {
      nextPath = pax(data).path ?? null;
      continue;
    }
    if (type === 'L') {
      nextPath = data.toString('utf8').replace(/\0[\s\S]*$/, '');
      continue;
    }
    const full = nextPath || (prefix ? `${prefix}/${name}` : name);
    nextPath = null;
    if (type === '0' || type === '\0' || type === '7') entries.push({ path: full, type: 'file', data: Buffer.from(data) });
    else if (type === '5') entries.push({ path: full, type: 'dir' });
  }
  return { entries, comment };
}

// The app folder, or any folder above it, is a git checkout (e.g. a clone of the whole repo).
export function insideGit(root) {
  for (let d = path.resolve(root); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    if (path.dirname(d) === d) return false;
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
