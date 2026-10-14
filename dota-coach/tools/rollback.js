// Undo the last update (used by rollback.bat, also works when the new version doesn't start).
// Only uses Node built-ins and the updater, so it keeps working even if other files are broken.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Updater, listBackups } from '../src/updater.js';
import { loadSettings, saveSettings } from '../src/settings.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backups = listBackups(root);
if (!backups.length) {
  console.log('\n  Fant ingen backup. Det er ingenting å angre.\n');
  process.exit(0);
}
const { from, to } = new Updater({ root }).rollback();
// Don't install the version we just left again automatically.
saveSettings({ ...loadSettings(), skipVersion: from });
console.log(`\n  ✔ Satt tilbake til versjon ${to}. Start Dota Coach som vanlig.\n`);
console.log(`  Versjon ${from} blir ikke installert automatisk igjen. Nyere versjoner kommer som vanlig.\n`);
