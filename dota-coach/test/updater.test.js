import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Updater, gitBlobSha, normalize, compareVersions, safeRel, isProtected, listBackups } from '../src/updater.js';

// ---------- A fake GitHub: raw files, the commits API and the trees API ----------
let server;
let base;
const remote = { commit: 'c1', tree: 't1', files: new Map(), corrupt: new Set() };

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (p === '/api/repos/o/r/commits/main') return json(200, { sha: remote.commit, commit: { tree: { sha: remote.tree } } });
    if (p === `/api/repos/o/r/git/trees/${remote.tree}`) {
      const tree = [...remote.files].map(([rel, buf]) => ({ path: `app/${rel}`, type: 'blob', sha: gitBlobSha(buf) }));
      tree.push({ path: 'app/../evil.js', type: 'blob', sha: gitBlobSha(Buffer.from('x')) }, { path: 'other/readme.md', type: 'blob', sha: 'x' });
      return json(200, { tree, truncated: false });
    }
    let m = p.match(/^\/raw\/o\/r\/refs\/heads\/main\/app\/(.+)$/);
    if (m && remote.files.has(m[1])) return res.end(remote.files.get(m[1]));
    m = p.match(/^\/raw\/o\/r\/([^/]+)\/app\/(.+)$/);
    if (m && m[1] === remote.commit && remote.files.has(m[2])) {
      return res.end(remote.corrupt.has(m[2]) ? Buffer.from('not the right file') : remote.files.get(m[2]));
    }
    return json(404, { message: 'Not Found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const channel = () => ({ repo: 'o/r', branches: ['main'], path: 'app', apiBase: `${base}/api`, rawBase: `${base}/raw` });
const version = (v, notes = ['noe nytt']) => Buffer.from(JSON.stringify({ version: v, changes: [{ version: v, notes }] }));

function makeLocal(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dotacoach-upd-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

function setRemote(files, commit = 'c1') {
  remote.files = new Map(Object.entries(files).map(([k, v]) => [k, Buffer.isBuffer(v) ? v : Buffer.from(v)]));
  remote.commit = commit;
  remote.tree = `t-${commit}`;
  remote.corrupt = new Set();
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('helpers: versions, safe paths, line endings and protected files', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.2.0', '1.2'), 0);
  assert.equal(compareVersions('0.9', '1.0.0'), -1);
  assert.equal(safeRel('src/a.js'), 'src/a.js');
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'a//b', '', './a']) assert.equal(safeRel(bad), null, bad);
  assert.equal(gitBlobSha(normalize('a.bat', Buffer.from('echo hi\r\n'))), gitBlobSha(Buffer.from('echo hi\n')));
  assert.notEqual(gitBlobSha(normalize('a.png', Buffer.from('x\r\n'))), gitBlobSha(Buffer.from('x\n')));
  // Same algorithm as `git hash-object`.
  assert.equal(gitBlobSha(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
  for (const rel of ['settings.json', 'matches/1.json', 'cache/x.json', 'backup/a/b.js', 'node_modules/electron/x.js']) assert.ok(isProtected(rel), rel);
  assert.ok(!isProtected('src/server.js'));
});

test('check() finds a newer version and its release notes', async () => {
  setRemote({ 'version.json': version('1.3.0', ['Bedre fight-meter']), 'src/server.js': 'v2' });
  const root = makeLocal({ 'version.json': version('1.2.0'), 'src/server.js': 'v1' });
  const u = new Updater({ root, channel: channel() });
  const res = await u.check();
  assert.equal(res.available, true);
  assert.equal(res.latest, '1.3.0');
  assert.deepEqual(res.changes[0].notes, ['Bedre fight-meter']);
  setRemote({ 'version.json': version('1.2.0'), 'src/server.js': 'v1' });
  assert.equal((await u.check()).available, false);
});

test('apply() downloads only changed files, keeps user data and can be undone', async () => {
  const root = makeLocal({
    'version.json': version('1.2.0'),
    'src/server.js': 'old server',
    'data/knowledge.js': 'same\r\nfile\r\n', // CRLF locally, LF on GitHub: not a change
    'start.bat': '@echo off\r\necho old\r\n',
    'settings.json': '{"role":3}',
    'matches/9.json': '{}',
  });
  setRemote({
    'version.json': version('1.3.0'),
    'src/server.js': 'new server',
    'data/knowledge.js': 'same\nfile\n',
    'start.bat': '@echo off\necho new\n',
    'src/new-feature.js': 'export const x = 1;\n',
    'settings.json': '{"role":1}',
  });
  const knowledgeMtime = fs.statSync(path.join(root, 'data/knowledge.js')).mtimeMs;
  const u = new Updater({ root, channel: channel(), selfTest: () => ({ ok: true }) });
  const res = await u.apply({ branch: 'main' });

  assert.equal(res.from, '1.2.0');
  assert.equal(res.to, '1.3.0');
  assert.deepEqual(res.updated.sort(), ['src/new-feature.js', 'src/server.js', 'start.bat', 'version.json']);
  assert.equal(read(root, 'src/server.js'), 'new server');
  assert.equal(read(root, 'start.bat'), '@echo off\r\necho new\r\n', '.bat files get Windows line endings');
  assert.equal(fs.statSync(path.join(root, 'data/knowledge.js')).mtimeMs, knowledgeMtime, 'unchanged file not rewritten');
  assert.equal(read(root, 'settings.json'), '{"role":3}', 'settings are never overwritten');
  assert.ok(fs.existsSync(path.join(root, 'matches/9.json')));
  assert.ok(!fs.existsSync(path.join(root, '..', 'evil.js')), 'paths outside the app are ignored');
  assert.equal(res.needsInstall, false);
  assert.ok(fs.existsSync(path.join(root, '.installed.json')));

  const backups = listBackups(root);
  assert.equal(backups.length, 1);
  assert.equal(backups[0].info.from, '1.2.0');

  // Undo: old files back, the file that was added is removed again.
  const back = u.rollback();
  assert.equal(back.to, '1.2.0');
  assert.equal(back.from, '1.3.0');
  assert.equal(read(root, 'src/server.js'), 'old server');
  assert.equal(read(root, 'start.bat'), '@echo off\r\necho old\r\n');
  assert.ok(!fs.existsSync(path.join(root, 'src/new-feature.js')));
  assert.equal(JSON.parse(read(root, 'version.json')).version, '1.2.0');
});

test('files removed upstream are deleted on the next update', async () => {
  const root = makeLocal({ 'version.json': version('1.0.0'), 'src/server.js': 'a', 'src/old.js': 'old' });
  setRemote({ 'version.json': version('1.1.0'), 'src/server.js': 'a', 'src/old.js': 'old' }, 'c2');
  const u = new Updater({ root, channel: channel(), selfTest: () => ({ ok: true }) });
  await u.apply({ branch: 'main' });
  setRemote({ 'version.json': version('1.2.0'), 'src/server.js': 'b' }, 'c3');
  const res = await u.apply({ branch: 'main' });
  assert.deepEqual(res.removed, ['src/old.js']);
  assert.ok(!fs.existsSync(path.join(root, 'src/old.js')));
});

test('a broken download changes nothing', async () => {
  const root = makeLocal({ 'version.json': version('1.2.0'), 'src/server.js': 'old' });
  setRemote({ 'version.json': version('1.3.0'), 'src/server.js': 'new' }, 'c4');
  remote.corrupt.add('src/server.js');
  const u = new Updater({ root, channel: channel(), selfTest: () => ({ ok: true }) });
  await assert.rejects(u.apply({ branch: 'main' }), /ikke lastet ned riktig/);
  assert.equal(read(root, 'src/server.js'), 'old');
  assert.equal(JSON.parse(read(root, 'version.json')).version, '1.2.0');
  assert.equal(listBackups(root).length, 0);
});

test('if the new version fails its self-test, the old one is put back', async () => {
  const root = makeLocal({ 'version.json': version('1.2.0'), 'src/server.js': 'works' });
  setRemote({ 'version.json': version('1.3.0'), 'src/server.js': 'broken', 'src/extra.js': 'x' }, 'c5');
  const u = new Updater({ root, channel: channel(), selfTest: () => ({ ok: false, error: 'SyntaxError' }) });
  await assert.rejects(u.apply({ branch: 'main' }), /gamle er satt tilbake.*SyntaxError/);
  assert.equal(read(root, 'src/server.js'), 'works');
  assert.ok(!fs.existsSync(path.join(root, 'src/extra.js')));
  assert.equal(JSON.parse(read(root, 'version.json')).version, '1.2.0');
});

test('npm install is only requested when the packages change', async () => {
  const pkg = (dev) => JSON.stringify({ name: 'x', version: '1', devDependencies: dev });
  const root = makeLocal({ 'version.json': version('1.0.0'), 'src/server.js': 'a', 'package.json': pkg({ electron: '^43.0.0' }) });
  setRemote({ 'version.json': version('1.1.0'), 'src/server.js': 'a', 'package.json': JSON.stringify({ name: 'x', version: '2', devDependencies: { electron: '^43.0.0' } }) }, 'c6');
  const u = new Updater({ root, channel: channel(), selfTest: () => ({ ok: true }) });
  assert.equal((await u.apply({ branch: 'main' })).needsInstall, false);
  setRemote({ 'version.json': version('1.2.0'), 'src/server.js': 'a', 'package.json': pkg({ electron: '^44.0.0' }) }, 'c7');
  assert.equal((await u.apply({ branch: 'main' })).needsInstall, true);
  assert.ok(fs.existsSync(path.join(root, '.needs-install')));
});

test('a git checkout is left to git', async () => {
  const root = makeLocal({ 'version.json': version('1.0.0'), 'src/server.js': 'a', '.git/HEAD': 'ref' });
  setRemote({ 'version.json': version('1.1.0'), 'src/server.js': 'b' }, 'c8');
  await assert.rejects(new Updater({ root, channel: channel(), selfTest: () => ({ ok: true }) }).apply({ branch: 'main' }), /git pull/);
});
