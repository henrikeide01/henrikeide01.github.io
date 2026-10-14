// Plays a fake Dota 2 match against the coach server by sending GSI payloads, so you can see the
// coach work without starting the game.   npm run simulate -- --speed 15 --hero antimage --start 0
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, loadSettings } from '../src/settings.js';

export function heroIdFor(name) {
  const { heroes } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/heroes.json'), 'utf8'));
  const h = heroes.find((x) => x.name === name);
  if (!h) throw new Error(`Ukjent hero "${name}". Bruk navnet fra Dota, f.eks. antimage, juggernaut, crystal_maiden.`);
  return h.id;
}

const ITEM_PLAN = {
  // [clock to buy, item]; the simulated player buys a bit late on purpose so "afford" tips show up.
  antimage: [[-80, 'tango'], [-80, 'quelling_blade'], [-80, 'branches'], [-80, 'slippers'], [240, 'magic_wand'], [420, 'power_treads'], [930, 'bfury'], [1290, 'manta'], [1560, 'black_king_bar'], [1800, 'abyssal_blade'], [2100, 'butterfly']],
  default: [[-80, 'tango'], [-80, 'branches'], [-80, 'branches'], [-80, 'faerie_fire'], [240, 'magic_wand'], [420, 'phase_boots'], [960, 'black_king_bar'], [1500, 'blink'], [1900, 'assault']],
};
const COST = { tango: 90, quelling_blade: 100, branches: 50, slippers: 140, faerie_fire: 65, magic_wand: 460, power_treads: 1400, phase_boots: 1500, bfury: 3900, manta: 4650, abyssal_blade: 6250, butterfly: 5450, black_king_bar: 4050, blink: 2250, assault: 5125 };
const DEMO_ENEMIES = ['phantom_assassin', 'lion', 'zuus', 'riki', 'axe'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let abilityData = null;
let itemData = null;
const readData = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

// Q/W/E + ultimate with legal levels for the hero level (ultimate at 6/12/18, max level = (level+1)/2).
function fakeAbilities(hero, level, skipped) {
  abilityData ||= readData('abilities.json');
  const known = abilityData.heroes[hero]?.abilities || [];
  const names = known.length >= 4 ? [...known.slice(0, 3).map((a) => a.name), known[known.length - 1].name] : [0, 1, 2, 3].map((i) => `${hero}_ability_${i}`);
  const talents = (level >= 10 ? 1 : 0) + (level >= 15 ? 1 : 0);
  let points = Math.max(0, Math.min(level, 16) - talents - skipped);
  const ult = Math.min(points, [6, 12, 18].filter((l) => level >= l).length);
  points -= ult;
  const lv = [0, 0, 0];
  const cap = Math.min(4, Math.floor((level + 1) / 2));
  for (; points > 0; points--) {
    const i = [0, 1, 2].find((k) => lv[k] < cap);
    if (i == null) break;
    lv[i]++;
  }
  const out = {};
  [...lv, ult].forEach((l, i) => (out[`ability${i}`] = { name: names[i], level: l, can_cast: l > 0, passive: false, ability_active: true, cooldown: 0, ultimate: i === 3 }));
  return out;
}

// The neutral item craft (artifact + enchantment choices) the way GSI reports it.
function fakeNeutrals(clock) {
  if (clock < 300) return undefined;
  itemData ||= readData('items.json').items;
  const tier = clock >= 1500 ? 2 : clock >= 900 ? 1 : 0;
  const arts = Object.keys(itemData).filter((n) => itemData[n].tier === tier + 1).slice(0, 4);
  const ench = Object.keys(itemData).filter((n) => n.startsWith('enhancement_')).slice(tier * 3, tier * 3 + 4);
  const chosen = clock - [300, 900, 1500][tier] > 150;
  const choices = (list) => Object.fromEntries(list.map((n, i) => [`choice${i}`, { item_name: `item_${n}`, item_level: tier + 1, selected: chosen && i === 0 }]));
  return {
    team2: {
      player0: {
        current_madstone: chosen ? 0 : 20,
        total_madstone: 20 * (tier + 1),
        crafting_tier: tier,
        [`tier${tier}`]: { tier, trinket_choices: choices(arts), enchantment_choices: choices(ench) },
      },
    },
  };
}

export function fakePayload(s, token) {
  const { clock, hero } = s;
  const phase = s.phase;
  const t = Math.max(0, clock);
  const level = Math.min(30, Math.max(1, Math.floor(1 + t / 62)));
  const gpm = Math.round(Math.min(720, 330 + (t / 60) * 11));
  const earned = 600 + Math.round((gpm * t) / 60);
  const plan = ITEM_PLAN[hero] || ITEM_PLAN.default;
  const bought = plan.filter(([at]) => clock >= at);
  const spent = bought.reduce((sum, [, item]) => sum + (COST[item] || 0), 0);
  const gold = Math.max(0, earned - spent - s.deaths * 120);

  // Newly bought items sit in the stash for a while before the courier delivers them.
  const inv = [];
  const stash = [];
  for (const [at, item] of bought) {
    if (item === 'quelling_blade' && bought.some(([, i]) => i === 'bfury')) continue;
    if (item === 'slippers' && bought.some(([, i]) => i === 'power_treads')) continue;
    if (item === 'branches' && bought.some(([, i]) => i === 'magic_wand')) continue;
    if (item === 'tango' && clock > 300) continue;
    if (item === 'faerie_fire' && clock > 400) continue;
    (clock - at < 25 && at > 0 ? stash : inv).push(item);
  }
  const items = {};
  for (let i = 0; i < 9; i++) items[`slot${i}`] = { name: inv[i] ? `item_${inv[i]}` : 'empty' };
  for (let i = 0; i < 6; i++) items[`stash${i}`] = { name: stash[i] ? `item_${stash[i]}` : 'empty' };
  const noTp = clock > 720 && clock < 770;
  items.teleport0 = { name: noTp ? 'empty' : 'item_tpscroll', charges: 1 };
  const neutrals = fakeNeutrals(clock);
  const neutralPick = neutrals && Object.values(Object.values(neutrals.team2.player0).find((v) => v?.trinket_choices).trinket_choices).find((c) => c.selected);
  items.neutral0 = { name: neutralPick ? neutralPick.item_name : 'empty' };

  // Position: safe lane in the laning phase, jungle later, a trip into enemy jungle around 17:00.
  let pos = [4200, -6300];
  if (clock > 600) pos = clock % 120 < 60 ? [3000, -3800] : [5600, -2500];
  if (clock > 1010 && clock < 1060) pos = [1500, 3800];
  if (!s.alive) pos = [-7000, -6500];

  const hp = !s.alive ? 0 : s.lowHp ? 18 : Math.round(60 + 35 * Math.sin(clock / 23));
  // Around 7:00 the simulated player forgets to skill for a while, so the "skill X" tip shows up.
  const abilities = fakeAbilities(hero, level, clock > 420 && clock < 445 ? 1 : 0);

  const state = {
    'DRAFT': 'DOTA_GAMERULES_STATE_HERO_SELECTION',
    'STRATEGY': 'DOTA_GAMERULES_STATE_STRATEGY_TIME',
    'PRE': 'DOTA_GAMERULES_STATE_PRE_GAME',
    'GAME': 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
    'POST': 'DOTA_GAMERULES_STATE_POST_GAME',
  }[phase];

  const events = [];
  if (clock >= 1450) events.push({ event_type: 'roshan_killed', game_time: 1450 + 90, killed_by_team: 'radiant', killer_player_id: 0 });

  return {
    provider: { name: 'Dota 2', appid: 570, version: 47, timestamp: Math.floor(Date.now() / 1000) },
    map: {
      name: 'start',
      matchid: s.matchId,
      game_time: clock + 90,
      clock_time: clock,
      daytime: clock < 0 ? false : Math.floor(clock / 300) % 2 === 1,
      nightstalker_night: false,
      radiant_score: Math.floor(t / 70),
      dire_score: Math.floor(t / 80),
      game_state: state,
      paused: false,
      win_team: phase === 'POST' ? 'radiant' : 'none',
      customgamename: '',
      ward_purchase_cooldown: 0,
    },
    player: {
      steamid: '0', accountid: '0', name: 'Demo', activity: 'playing',
      kills: Math.floor(t / 240), deaths: s.deaths, assists: Math.floor(t / 200),
      last_hits: Math.floor((t / 60) * (clock < 600 ? 4.4 : 7.2)), denies: Math.floor(t / 70),
      kill_streak: 0, commands_issued: Math.floor(t * 3), kill_list: {}, team_name: 'radiant', team_slot: 0, player_slot: 0,
      gold, gold_reliable: Math.floor(gold * 0.3), gold_unreliable: gold - Math.floor(gold * 0.3),
      gold_from_hero_kills: 0, gold_from_creep_kills: 0, gold_from_income: 0, gold_from_shared: 0,
      gpm, xpm: Math.round(gpm * 1.05),
    },
    hero: phase === 'DRAFT' ? { id: 0 } : {
      xpos: pos[0], ypos: pos[1], id: s.heroId, name: `npc_dota_hero_${hero}`, level, xp: 0,
      alive: s.alive, respawn_seconds: s.alive ? 0 : s.respawn, buyback_cost: Math.round(200 + t * 1.6), buyback_cooldown: 0,
      health: hp * 20, max_health: 2000, health_percent: hp, mana: 400, max_mana: 600, mana_percent: 66,
      silenced: false, stunned: false, disarmed: false, magicimmune: false, hexed: false, muted: false, break: false,
      aghanims_scepter: false, aghanims_shard: false, smoked: clock > 1000 && clock < 1010, has_debuff: false,
      talent_1: level >= 10, talent_2: false, talent_3: level >= 15, talent_4: false, talent_5: false, talent_6: false, talent_7: false, talent_8: false,
    },
    abilities: phase === 'DRAFT' ? {} : abilities,
    items: phase === 'DRAFT' ? {} : items,
    buildings: { radiant: { dota_goodguys_tower1_bot: { health: clock > 1300 ? 0 : 1800, max_health: 1800 }, dota_goodguys_tower1_top: { health: 1800, max_health: 1800 } } },
    events,
    ...(neutrals && phase !== 'DRAFT' ? { neutralitems: neutrals } : {}),
    auth: { token },
  };
}

export async function runSimulation({ port, token, speed = 15, hero = 'antimage', start = null, enemies = DEMO_ENEMIES, log = console.log } = {}) {
  const heroId = heroIdFor(hero);
  const url = `http://127.0.0.1:${port}/gsi`;
  const send = async (s) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fakePayload(s, token)) });
    if (res.status === 401) throw new Error('Serveren avviste token. Kjør simulatoren fra samme mappe som serveren.');
  };
  const s = { phase: 'DRAFT', clock: -150, hero, heroId, deaths: 0, alive: true, respawn: 0, lowHp: false, matchId: String(7000000000 + Math.floor(Math.random() * 1e8)) };
  const tick = 250;

  if (start === null) {
    log('Simulerer hero-valg (fiendene «gjenkjennes» én etter én, som desktop-appen gjør) …');
    const post = (p, body) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
    await post('/api/draft', { reset: true, enemies: [], allies: [] });
    for (let i = 0; i < 18; i++) {
      await send(s);
      if (i % 3 === 2) await post('/api/draft/auto', { left: [], right: enemies.slice(0, Math.floor(i / 3) + 1) });
      await sleep(tick);
    }
    s.phase = 'STRATEGY';
    s.clock = -120;
    for (let i = 0; i < 12; i++) {
      await send(s);
      await sleep(tick);
    }
    s.clock = -90;
  } else {
    await fetch(`http://127.0.0.1:${port}/api/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enemies, allies: [] }) }).catch(() => {});
    s.clock = start;
  }

  const deathsAt = [510, 580, 1380];
  let respawnUntil = null;
  log(`Kamp startet (${hero}, ${speed}x fart). Avbryt med Ctrl+C.`);
  while (s.clock < 2400) {
    s.phase = s.clock < 0 ? 'PRE' : 'GAME';
    const step = (tick / 1000) * speed;
    s.lowHp = deathsAt.some((d) => s.clock > d - 12 && s.clock < d);
    const died = deathsAt.find((d) => s.clock >= d && s.clock - step < d);
    if (died !== undefined) {
      s.deaths += 1;
      s.alive = false;
      respawnUntil = s.clock + 12 + s.deaths * 6;
    }
    if (!s.alive) {
      s.respawn = Math.max(0, Math.round(respawnUntil - s.clock));
      if (s.clock >= respawnUntil) s.alive = true;
    }
    await send(s);
    if (Math.floor(s.clock / 60) !== Math.floor((s.clock + step) / 60) && s.clock >= 0) log(`  ${Math.floor((s.clock + step) / 60)}:00`);
    s.clock += step;
    await sleep(tick);
  }
  s.phase = 'POST';
  await send(s);
  log('Kampen er over (simulert).');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const arg = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
  };
  const settings = loadSettings();
  runSimulation({
    port: Number(arg('port', settings.port)),
    token: settings.token,
    speed: Number(arg('speed', 15)),
    hero: arg('hero', 'antimage'),
    start: arg('start', null) === null ? null : Number(arg('start')),
  }).catch((err) => {
    console.error(`Simuleringen stoppet: ${err.message}`);
    if (err.cause?.code === 'ECONNREFUSED') console.error('Start coachen først (start.bat / npm start).');
    process.exit(1);
  });
}
