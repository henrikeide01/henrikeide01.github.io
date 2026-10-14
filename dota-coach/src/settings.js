import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'settings.json');

export const DEFAULTS = {
  port: 3355,
  role: 1, // 1-5
  bracket: 5, // 1 Herald … 8 Immortal
  token: 'dotacoach-local', // must match "auth.token" in the Dota GSI cfg
  voice: '', // name of the speech-synthesis voice (empty = automatic)
  ttsRate: 1.05,
  opendotaApiKey: '',
};

const PUBLIC_KEYS = ['role', 'bracket', 'voice', 'ttsRate'];

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  fs.writeFileSync(FILE, JSON.stringify(settings, null, 2));
}

// Only the fields the browser is allowed to see/change.
export function publicSettings(s) {
  return Object.fromEntries(PUBLIC_KEYS.map((k) => [k, s[k]]));
}

export function applyPublicSettings(s, patch) {
  const out = { ...s };
  if (patch.role !== undefined) out.role = Math.min(5, Math.max(1, Number(patch.role) || 1));
  if (patch.bracket !== undefined) out.bracket = Math.min(8, Math.max(1, Number(patch.bracket) || 5));
  if (typeof patch.voice === 'string') out.voice = patch.voice.slice(0, 200);
  if (patch.ttsRate !== undefined) out.ttsRate = Math.min(2, Math.max(0.5, Number(patch.ttsRate) || 1));
  return out;
}
