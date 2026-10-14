// Writes FAKE OpenDota responses (deterministic, but invented numbers) for tests and offline UI work.
// Usage: node tools/make-fixtures.js <dir>   then start the server with DOTACOACH_FIXTURES=<dir>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../src/settings.js';
import { positionsFor } from '../data/positions.js';

function hash(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967295;
}

const BUILDS = {
  1: {
    start: ['tango', 'quelling_blade', 'branches', 'slippers', 'circlet', 'faerie_fire'],
    early: ['magic_wand', 'power_treads', 'wraith_band', 'phase_boots', 'ring_of_basilius'],
    mid: ['bfury', 'manta', 'black_king_bar', 'mask_of_madness', 'maelstrom', 'desolator'],
    late: ['butterfly', 'abyssal_blade', 'skadi', 'satanic', 'greater_crit', 'monkey_king_bar'],
  },
  2: {
    start: ['tango', 'branches', 'faerie_fire', 'circlet', 'mantle', 'flask'],
    early: ['bottle', 'magic_wand', 'power_treads', 'null_talisman'],
    mid: ['black_king_bar', 'blink', 'kaya_and_sange', 'orchid', 'desolator'],
    late: ['sheepstick', 'octarine_core', 'ultimate_scepter', 'shivas_guard', 'refresher'],
  },
  3: {
    start: ['tango', 'quelling_blade', 'flask', 'branches', 'gauntlets'],
    early: ['phase_boots', 'magic_wand', 'vanguard', 'bracer'],
    mid: ['blink', 'black_king_bar', 'pipe', 'crimson_guard', 'blade_mail'],
    late: ['assault', 'shivas_guard', 'heart', 'refresher', 'overwhelming_blink'],
  },
  4: {
    start: ['tango', 'flask', 'ward_observer', 'ward_sentry', 'branches', 'blood_grenade', 'clarity'],
    early: ['arcane_boots', 'tranquil_boots', 'magic_wand', 'wind_lace'],
    mid: ['glimmer_cape', 'force_staff', 'aether_lens', 'ghost', 'solar_crest'],
    late: ['aeon_disk', 'sheepstick', 'ultimate_scepter', 'lotus_orb'],
  },
};
BUILDS[5] = BUILDS[4];

const MEDIAN = { 1: [560, 600, 6.8], 2: [540, 640, 6.0], 3: [470, 560, 3.6], 4: [330, 430, 1.4], 5: [290, 380, 1.0] };
const SPREAD = [[0.1, 0.62], [0.2, 0.72], [0.3, 0.82], [0.4, 0.91], [0.5, 1], [0.6, 1.08], [0.7, 1.17], [0.8, 1.28], [0.9, 1.45], [0.95, 1.6], [0.99, 1.9]];

export const PARSED_MATCH_ID = '424242';

export function makeFixtures(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const { heroes } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/heroes.json'), 'utf8'));
  const { items } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/items.json'), 'utf8'));
  const write = (name, data) => fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data));

  write(
    'heroStats',
    heroes.map((h) => {
      const row = { id: h.id, name: `npc_dota_hero_${h.name}`, localized_name: h.dname, primary_attr: h.attr, attack_type: h.attack, roles: h.roles };
      for (let b = 1; b <= 8; b++) {
        const picks = Math.round(8000 + hash(`${h.name}p${b}`) * 60000);
        row[`${b}_pick`] = picks;
        row[`${b}_win`] = Math.round(picks * (0.45 + hash(`${h.name}w${b}`) * 0.1));
      }
      return row;
    }),
  );

  for (const h of heroes) {
    const pos = positionsFor(h)[0];
    const plan = BUILDS[pos];
    const pop = {};
    for (const [bucket, list] of Object.entries(plan)) {
      pop[`${bucket}_game_items`] = Object.fromEntries(
        list.filter((n) => items[n]).map((n, i) => [items[n].id, Math.round((1000 - i * 120) * (0.85 + hash(h.name + n) * 0.3))]),
      );
    }
    write(`heroes_${h.id}_itemPopularity`, pop);

    write(
      `heroes_${h.id}_matchups`,
      heroes
        .filter((o) => o.id !== h.id)
        .map((o) => {
          const games = Math.round(20 + hash(`${h.name}g${o.name}`) * 200);
          return { hero_id: o.id, games_played: games, wins: Math.round(games * (0.38 + hash(`${h.name}v${o.name}`) * 0.24)) };
        }),
    );

    const [gpm, xpm, lh] = MEDIAN[pos];
    const pts = (m) => SPREAD.map(([percentile, f]) => ({ percentile, value: Math.round(m * f * 100) / 100 }));
    write(`benchmarks_hero_id_${h.id}`, { hero_id: h.id, result: { gold_per_min: pts(gpm), xp_per_min: pts(xpm), last_hits_per_min: pts(lh) } });
  }

  // A parsed match (Juggernaut, match id 424242) with the Dota Plus-style fields: damage taken/dealt per
  // hero and ability, gold/XP sources, runes … Used by the server test's finished match and for UI work.
  fs.copyFileSync(path.join(ROOT, 'test/fixtures/parsed-match.json'), path.join(dir, `matches_${PARSED_MATCH_ID}.json`));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dir = process.argv[2];
  if (!dir) throw new Error('Bruk: node tools/make-fixtures.js <mappe>');
  makeFixtures(path.resolve(dir));
  console.log(`Skrev testdata til ${dir}`);
}
