// Builds data/matchups.json (hero-vs-hero results from public ranked matches, per bracket) from per-hero
// OpenDota explorer answers. Fetch them with `node tools/build-matchups.js --fetch <dir>` (about 15 minutes,
// one explorer query per hero, ~7 days of matches), then `node tools/build-matchups.js <dir>` writes the file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicMatchupSql } from '../src/coach/matchups.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const heroes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/heroes.json'), 'utf8'));
const args = process.argv.slice(2);
const fetchMode = args[0] === '--fetch';
const dir = fetchMode ? args[1] : args[0];
if (!dir) {
  console.error('Bruk: node tools/build-matchups.js [--fetch] <mappe>');
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });
const explorer = async (sql) => {
  const res = await fetch(`https://api.opendota.com/api/explorer?sql=${encodeURIComponent(sql)}`, { signal: AbortSignal.timeout(120000) });
  const j = await res.json();
  if (!res.ok || j.err || !Array.isArray(j.rows)) throw new Error(j.err || `HTTP ${res.status}`);
  return j.rows;
};

if (fetchMode) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // One fixed range of matches for every hero, so the two sides of each matchup agree.
  let range;
  try {
    range = JSON.parse(fs.readFileSync(path.join(dir, 'range.json'), 'utf8'));
  } catch {
    const [top] = await explorer('SELECT max(match_id) AS mx FROM public_matches');
    const [t] = await explorer(`SELECT min(start_time) AS t0, max(start_time) AS t1 FROM public_matches WHERE match_id > ${top.mx} - 9000000 AND match_id <= ${top.mx}`);
    range = { maxId: String(top.mx), from: new Date(t.t0 * 1000).toISOString(), to: new Date(t.t1 * 1000).toISOString() };
    fs.writeFileSync(path.join(dir, 'range.json'), JSON.stringify(range));
  }
  for (const h of heroes.heroes) {
    const f = path.join(dir, `${h.id}.json`);
    if (fs.existsSync(f)) continue;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const rows = await explorer(publicMatchupSql(h.id, Number(range.span) || 9000000, range.maxId));
        fs.writeFileSync(f, JSON.stringify(rows.map((r) => [Number(r.b), Number(r.hero_id), Number(r.games), Number(r.wins)])));
        console.log(h.name, rows.length);
        break;
      } catch (err) {
        console.log(h.name, 'forsøk', attempt, 'feilet:', err.message);
        await sleep(5000 * attempt);
      }
    }
    await sleep(1500);
  }
  process.exit(0);
}

// Every hero's answer gives its row (its games and wins against each opponent); the matrix is built from them.
const ids = heroes.heroes.map((h) => h.id).sort((a, b) => a - b);
const N = ids.length;
const pos = new Map(ids.map((id, i) => [id, i]));
const brackets = {};
const bracket = (b) => (brackets[b] ||= { t: ids.map(() => [0, 0]), g: new Array(N * N).fill(0), w: new Array(N * N).fill(0) });
let missing = 0;
for (const id of ids) {
  const f = path.join(dir, `${id}.json`);
  if (!fs.existsSync(f)) {
    missing++;
    console.warn('Mangler', id);
    continue;
  }
  const i = pos.get(id);
  for (const [b, opp, games, wins] of JSON.parse(fs.readFileSync(f, 'utf8'))) {
    if (!(b >= 1 && b <= 8)) continue;
    const d = bracket(b);
    if (opp === 0) d.t[i] = [games, wins];
    else if (pos.has(opp) && opp !== id) {
      d.g[i * N + pos.get(opp)] = games;
      d.w[i * N + pos.get(opp)] = wins;
    }
  }
}
let range = {};
try {
  range = JSON.parse(fs.readFileSync(path.join(dir, 'range.json'), 'utf8'));
} catch {}
let total = 0;
for (const d of Object.values(brackets)) {
  d.matches = Math.round(d.t.reduce((s, x) => s + x[0], 0) / 10);
  total += d.matches;
}
const out = {
  source: 'OpenDota public_matches (rankede kamper)',
  patch: heroes.patch,
  from: range.from || null,
  to: range.to || null,
  matches: total,
  heroes: ids,
  brackets,
};
fs.writeFileSync(path.join(ROOT, 'data/matchups.json'), JSON.stringify(out));
console.log(`Skrev data/matchups.json: ${total} kamper, ${Object.keys(brackets).length} ranker, ${missing} heroer mangler.`);
