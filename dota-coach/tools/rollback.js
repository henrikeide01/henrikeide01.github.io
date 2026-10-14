// Undo the last update (used by rollback.bat, also works when the new version doesn't start).
// Only uses Node built-ins and the updater, so it keeps working even if other files are broken.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Updater, listBackups, compareVersions } from '../src/updater.js';
import { loadSettings, saveSettings } from '../src/settings.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const settings = loadSettings();

// If Dota Coach is running (e.g. in the tray), let it do the rollback and restart itself;
// changing the files underneath a running app would not take effect.
try {
  const res = await fetch(`http://127.0.0.1:${settings.port}/api/update/rollback`, { method: 'POST', signal: AbortSignal.timeout(4000) });
  const body = await res.json();
  if (body.ok) {
    console.log(`\n  ✔ Dota Coach går tilbake til versjon ${body.to} og starter på nytt.\n`);
    process.exit(0);
  }
  console.log(`\n  ${body.error}\n`);
  process.exit(0);
} catch {
  // not running: do it here
}

if (!listBackups(root).length) {
  console.log('\n  Fant ingen backup. Det er ingenting å angre.\n');
  process.exit(0);
}
const { from, to } = new Updater({ root }).rollback();
// Don't install the version we just left (or anything older) again automatically.
const skip = settings.skipVersion && compareVersions(settings.skipVersion, from) > 0 ? settings.skipVersion : from;
saveSettings({ ...settings, skipVersion: skip });
console.log(`\n  ✔ Satt tilbake til versjon ${to}. Start Dota Coach som vanlig.\n`);
console.log(`  Versjon ${from} blir ikke installert automatisk igjen. Nyere versjoner kommer som vanlig.\n`);
