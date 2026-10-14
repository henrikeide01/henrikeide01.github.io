// Finds the Dota 2 install and writes the Game State Integration config file.
// Usage: npm run setup            (finds Dota automatically)
//        npm run setup -- --path "D:\SteamLibrary\steamapps\common\dota 2 beta"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, loadSettings, saveSettings } from './settings.js';

const CFG_NAME = 'gamestate_integration_dotacoach.cfg';

export function gsiConfig({ port, token }) {
  return `"Dota Coach"
{
	"uri"		"http://127.0.0.1:${port}/gsi"
	"timeout"	"5.0"
	"buffer"	"0.1"
	"throttle"	"0.25"
	"heartbeat"	"10.0"
	"data"
	{
		"buildings"	"1"
		"provider"	"1"
		"map"		"1"
		"player"	"1"
		"hero"		"1"
		"abilities"	"1"
		"items"		"1"
		"events"	"1"
		"draft"		"1"
		"wearables"	"0"
	}
	"auth"
	{
		"token"		"${token}"
	}
}
`;
}

export function parseLibraryFolders(vdf) {
  const out = [];
  for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) out.push(m[1].replace(/\\\\/g, '\\'));
  return out;
}

function steamRoots() {
  const roots = [];
  if (process.platform === 'win32') {
    for (const key of ['HKCU\\Software\\Valve\\Steam', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam']) {
      try {
        const out = execSync(`reg query "${key}" /v ${key.startsWith('HKCU') ? 'SteamPath' : 'InstallPath'}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const m = out.match(/REG_SZ\s+(.+)/);
        if (m) roots.push(m[1].trim());
      } catch {
        // key not present
      }
    }
    roots.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
  } else if (process.platform === 'darwin') {
    roots.push(path.join(os.homedir(), 'Library/Application Support/Steam'));
  } else {
    roots.push(path.join(os.homedir(), '.steam/steam'), path.join(os.homedir(), '.local/share/Steam'), path.join(os.homedir(), '.var/app/com.valvesoftware.Steam/.local/share/Steam'));
  }
  return [...new Set(roots.map((r) => path.normalize(r)))];
}

export function findDota() {
  const libraries = new Set();
  for (const root of steamRoots()) {
    if (!fs.existsSync(root)) continue;
    libraries.add(root);
    const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf');
    if (fs.existsSync(vdf)) for (const lib of parseLibraryFolders(fs.readFileSync(vdf, 'utf8'))) libraries.add(path.normalize(lib));
  }
  for (const lib of libraries) {
    const dir = path.join(lib, 'steamapps', 'common', 'dota 2 beta');
    if (fs.existsSync(path.join(dir, 'game', 'dota'))) return dir;
  }
  return null;
}

export function install({ dotaDir, port, token }) {
  const cfgDir = path.join(dotaDir, 'game', 'dota', 'cfg', 'gamestate_integration');
  fs.mkdirSync(cfgDir, { recursive: true });
  const file = path.join(cfgDir, CFG_NAME);
  fs.writeFileSync(file, gsiConfig({ port, token }));
  return file;
}

function main() {
  const args = process.argv.slice(2);
  const pathArg = args.indexOf('--path');
  const settings = loadSettings();
  if (!settings.token || settings.token === 'dotacoach-local') {
    settings.token = crypto.randomBytes(12).toString('hex');
    saveSettings(settings);
  }

  // Always keep a copy next to the app, so it can be copied by hand if needed.
  const localCopy = path.join(ROOT, 'config', CFG_NAME);
  fs.mkdirSync(path.dirname(localCopy), { recursive: true });
  fs.writeFileSync(localCopy, gsiConfig(settings));

  const dotaDir = pathArg >= 0 ? args[pathArg + 1] : findDota();
  console.log('\n=== Dota Coach – oppsett ===\n');
  if (!dotaDir || !fs.existsSync(path.join(dotaDir, 'game', 'dota'))) {
    console.log('Fant ikke Dota 2-mappen automatisk.');
    console.log('Kopier denne filen manuelt:');
    console.log(`   ${localCopy}`);
    console.log('til mappen:');
    console.log('   <Steam-bibliotek>\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration\\');
    console.log('(Lag mappen "gamestate_integration" hvis den ikke finnes.)');
    console.log('\nEller kjør:  npm run setup -- --path "D:\\SteamLibrary\\steamapps\\common\\dota 2 beta"\n');
  } else {
    const file = install({ dotaDir, port: settings.port, token: settings.token });
    console.log(`✔ Fant Dota 2: ${dotaDir}`);
    console.log(`✔ Skrev GSI-konfig: ${file}\n`);
  }
  console.log('Siste steg (bare én gang):');
  console.log('  1. Steam → Bibliotek → høyreklikk Dota 2 → Egenskaper → Generelt → Startalternativer');
  console.log('     Legg til:  -gamestateintegration');
  console.log('  2. For overlay over spillet: Dota 2 → Innstillinger → Video → Visningsmodus: "Borderless Window"');
  console.log('  3. Start Dota 2 på nytt etter oppsettet.\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
