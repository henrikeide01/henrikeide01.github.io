// Prepares a new release: bumps version.json and adds the release notes shown in the app.
// Usage: node tools/release.js 1.3.0 "Første endring" "Andre endring"
//    or: node tools/release.js patch "Fikset …"      (patch | minor | major bumps the current version)
// Then run the tests, commit and push to the update branch (see CLAUDE.md). Users get it automatically.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions } from '../src/updater.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'version.json');
const current = JSON.parse(fs.readFileSync(file, 'utf8'));
const [which, ...notes] = process.argv.slice(2);
if (!which || !notes.length) {
  console.error('Bruk: node tools/release.js <versjon|patch|minor|major> "Hva er nytt" ["Mer nytt" …]');
  process.exit(1);
}

let next = which;
if (['patch', 'minor', 'major'].includes(which)) {
  const [a, b, c] = current.version.split('.').map(Number);
  next = which === 'major' ? `${a + 1}.0.0` : which === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}
if (!/^\d+\.\d+\.\d+$/.test(next) || compareVersions(next, current.version) <= 0) {
  console.error(`Ny versjon må være høyere enn ${current.version} (fikk «${next}»).`);
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
const out = { version: next, date, changes: [{ version: next, date, notes }, ...(current.changes || [])].slice(0, 30) };
fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
const pkg = path.join(root, 'package.json');
const pj = JSON.parse(fs.readFileSync(pkg, 'utf8'));
if (pj.version !== next) {
  pj.version = next;
  fs.writeFileSync(pkg, `${JSON.stringify(pj, null, 2)}\n`);
}
console.log(`Versjon ${current.version} → ${next}\n${notes.map((n) => `  • ${n}`).join('\n')}`);
