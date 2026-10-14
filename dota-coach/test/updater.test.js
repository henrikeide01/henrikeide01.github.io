import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { Updater, gitBlobSha, normalize, compareVersions, safeRel, isProtected, listBackups, parseTar } from '../src/updater.js';

// Builds a GitHub-style .tar.gz: a pax global header with the commit id, a top folder, then the files.
function tarGz(files, { commit = 'a'.repeat(40), top = 'repo-main' } = {}) {
  const blocks = [];
  const header = (name, size, type) => {
    const h = Buffer.alloc(512);
    const long = name.length > 100;
    h.write(long ? name.slice(-100) : name, 0);
    h.write('0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(size.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h.write(type, 156);
    h.write('ustar\0' + '00', 257);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  };
  const add = (name, data, type = '0') => {
    blocks.push(header(name, data.length, type), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  };
  const paxRecord = (k, v) => {
    const body = ` ${k}=${v}\n`;
    let len = body.length + 1;
    while (`${len}${body}`.length !== len) len++;
    return Buffer.from(`${len}${body}`);
  };
  add('pax_global_header', paxRecord('comment', commit), 'g');
  add(`${top}/`, Buffer.alloc(0), '5');
  for (const [rel, content] of files) {
    const name = `${top}/${rel}`;
    if (name.length > 100) add('PaxHeader', paxRecord('path', name), 'x');
    add(name, Buffer.isBuffer(content) ? content : Buffer.from(content));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

// ---------- A fake GitHub: raw files, the commits API and the trees API ----------
let server;
let base;
const remote = { commit: 'c1', tree: 't1', files: new Map(), corrupt: new Set(), archive: false, archiveHits: 0, apiHits: 0 };

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (p === '/codeload/o/r/tar.gz/refs/heads/main') {
      if (!remote.archive) return json(404, {});
      remote.archiveHits++;
      res.writeHead(200, { 'Content-Type': 'application/x-gzip' });
      return res.end(tarGz([...remote.files].map(([rel, buf]) => [`app/${rel}`, buf]).concat([['other/site.html', '<html>'], ['app/../evil.js', 'x']])));
    }
    if (p === '/api/repos/o/r/commits/main') {
      remote.apiHits++;
      return json(200, { sha: remote.commit, commit: { tree: { sha: remote.tree } } });
    }
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

const channel = () => ({ repo: 'o/r', branches: ['main'], path: 'app', apiBase: `${base}/api`, rawBase: `${base}/raw`, codeloadBase: `${base}/codeload` });
const version = (v, notes = ['noe nytt']) => Buffer.from(JSON.stringify({ version: v, changes: [{ version: v, notes }] }));

function makeLocal(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dotacoach-upd-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

function setRemote(files, commit = 'c1', { archive = false } = {}) {
  remote.files = new Map(Object.entries(files).map(([k, v]) => [k, Buffer.isBuffer(v) ? v : Buffer.from(v)]));
  remote.commit = commit;
  remote.tree = `t-${commit}`;
  remote.corrupt = new Set();
  remote.archive = archive;
  remote.archiveHits = 0;
  remote.apiHits = 0;
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

test('the tar reader handles GitHub archives (pax headers, long paths, folders)', () => {
  const longRel = `${'deep/'.repeat(25)}file.js`;
  const { entries, comment } = parseTar(zlib.gunzipSync(tarGz([['a.txt', 'hei'], [longRel, 'lang sti']], { commit: 'b'.repeat(40) })));
  assert.equal(comment, 'b'.repeat(40));
  const files = entries.filter((e) => e.type === 'file');
  assert.deepEqual(files.map((e) => e.path), ['repo-main/a.txt', `repo-main/${longRel}`]);
  assert.equal(files[1].data.toString(), 'lang sti');
});

test('updates come from the archive when it is available (no API calls)', async () => {
  const root = makeLocal({ 'version.json': version('1.2.0'), 'src/server.js': 'old', 'start.bat': '@echo off\r\n', 'settings.json': '{"mine":1}' });
  setRemote({ 'version.json': version('1.3.0'), 'src/server.js': 'new', 'start.bat': '@echo off\n', 'settings.json': '{}', 'src/added.js': 'x' }, 'c9', { archive: true });
  const u = new Updater({ root, channel: channel(), selfTest: () => ({ ok: true }) });
  const res = await u.apply({ branch: 'main' });
  assert.equal(remote.archiveHits, 1);
  assert.equal(remote.apiHits, 0);
  assert.deepEqual(res.updated.sort(), ['src/added.js', 'src/server.js', 'version.json']);
  assert.equal(read(root, 'src/server.js'), 'new');
  assert.equal(read(root, 'settings.json'), '{"mine":1}');
  assert.ok(!fs.existsSync(path.join(root, '..', 'evil.js')));
  assert.equal(JSON.parse(read(root, '.installed.json')).commit, 'a'.repeat(40));
});

test('if the archive is unavailable the API is used instead', async () => {
  const root = makeLocal({ 'version.json': version('1.2.0'), 'src/server.js': 'old' });
  setRemote({ 'version.json': version('1.3.0'), 'src/server.js': 'new' }, 'c10', { archive: false });
  const u = new Updater({ root, channel: channel(), selfTest: () => ({ ok: true }) });
  await u.apply({ branch: 'main' });
  assert.equal(remote.apiHits, 1);
  assert.equal(read(root, 'src/server.js'), 'new');
});
