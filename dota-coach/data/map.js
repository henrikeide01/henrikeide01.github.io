// Schematic Dota 2 map in GSI world coordinates (hero.xpos / hero.ypos).
//
// ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
// │ ALL POSITIONS HERE ARE APPROXIMATE (zone level, roughly ±500 units).                         │
// │ There is no official map data in Game State Integration, so this is a hand-made schematic    │
// │ of the current map (7.33+: the bigger map, two Roshan pits that switch with day/night,       │
// │ Tormentors, Lotus Pools, Wisdom Shrines). The coach only ever reasons about zones: a lane    │
// │ segment, a jungle area, a rune spot. It never claims pixel-exact camp positions.             │
// │ Everything lives in this one file so it can be corrected later (e.g. from the `minimap`      │
// │ sample in /api/diagnostics, or by standing on a spot in a lobby and reading hero.xpos/ypos). │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
//
// Orientation: Radiant bottom-left, Dire top-right, x to the right, y up, both roughly -8300..8300.
// The river runs along the y = -x diagonal, so (x + y) > 0 is the Dire half (same as src/coach/map.js).
// Points are [x, y]. Lanes run from the Radiant base to the Dire base.

export const BOUNDS = { min: -8300, max: 8300 };

export const FOUNTAINS = {
  radiant: [-7150, -6650],
  dire: [7100, 6550],
};

export const ANCIENTS = {
  radiant: [-5900, -5400],
  dire: [5550, 5000],
};

// Base areas (polygons). Keep them in line with locate() in src/coach/map.js.
export const BASES = {
  radiant: [[-8300, -8300], [-8300, -4100], [-5300, -4100], [-4600, -4800], [-4600, -8300]],
  dire: [[8300, 8300], [8300, 3600], [4700, 3600], [4000, 4300], [4000, 8300]],
};

export const LANES = {
  top: [[-6650, -4200], [-6450, 3600], [-6050, 5850], [-3600, 6150], [3800, 5750]],
  mid: [[-4400, -3900], [-1550, -1400], [520, 650], [4000, 3500]],
  bot: [[-4000, -6350], [3600, -6300], [5950, -6050], [6300, -3600], [6350, 3300]],
};

// Where the two waves meet in an even lane during the laning phase (a bit toward the safe-lane team's T1).
export const LANE_MEET = {
  top: [-5450, 6000], // Dire safe lane
  mid: [-450, -350],
  bot: [5500, -6100], // Radiant safe lane
};

// River centre line (from the top lane to the bot lane) and its rough width.
export const RIVER = {
  width: 900,
  line: [[-6450, 4500], [-4400, 3000], [-1700, 1200], [-300, -200], [1200, -1250], [3300, -2900], [6300, -4300]],
};

// Towers, named like the GSI `buildings` keys.
export const TOWERS = {
  dota_goodguys_tower1_top: { team: 'radiant', lane: 'top', tier: 1, pos: [-6250, 1830] },
  dota_goodguys_tower2_top: { team: 'radiant', lane: 'top', tier: 2, pos: [-6150, -870] },
  dota_goodguys_tower3_top: { team: 'radiant', lane: 'top', tier: 3, pos: [-6600, -3550] },
  dota_goodguys_tower1_mid: { team: 'radiant', lane: 'mid', tier: 1, pos: [-1550, -1400] },
  dota_goodguys_tower2_mid: { team: 'radiant', lane: 'mid', tier: 2, pos: [-3550, -2780] },
  dota_goodguys_tower3_mid: { team: 'radiant', lane: 'mid', tier: 3, pos: [-4650, -4050] },
  dota_goodguys_tower1_bot: { team: 'radiant', lane: 'bot', tier: 1, pos: [4900, -6100] },
  dota_goodguys_tower2_bot: { team: 'radiant', lane: 'bot', tier: 2, pos: [-350, -6250] },
  dota_goodguys_tower3_bot: { team: 'radiant', lane: 'bot', tier: 3, pos: [-3950, -6100] },
  dota_goodguys_tower4_top: { team: 'radiant', lane: 'base', tier: 4, pos: [-5700, -4850] },
  dota_goodguys_tower4_bot: { team: 'radiant', lane: 'base', tier: 4, pos: [-5400, -5150] },
  dota_badguys_tower1_top: { team: 'dire', lane: 'top', tier: 1, pos: [-4700, 6000] },
  dota_badguys_tower2_top: { team: 'dire', lane: 'top', tier: 2, pos: [0, 6050] },
  dota_badguys_tower3_top: { team: 'dire', lane: 'top', tier: 3, pos: [3550, 5800] },
  dota_badguys_tower1_mid: { team: 'dire', lane: 'mid', tier: 1, pos: [520, 650] },
  dota_badguys_tower2_mid: { team: 'dire', lane: 'mid', tier: 2, pos: [2550, 2100] },
  dota_badguys_tower3_mid: { team: 'dire', lane: 'mid', tier: 3, pos: [4250, 3750] },
  dota_badguys_tower1_bot: { team: 'dire', lane: 'bot', tier: 1, pos: [6250, -1650] },
  dota_badguys_tower2_bot: { team: 'dire', lane: 'bot', tier: 2, pos: [6300, 400] },
  dota_badguys_tower3_bot: { team: 'dire', lane: 'bot', tier: 3, pos: [6300, 3000] },
  dota_badguys_tower4_top: { team: 'dire', lane: 'base', tier: 4, pos: [4950, 4600] },
  dota_badguys_tower4_bot: { team: 'dire', lane: 'base', tier: 4, pos: [5300, 4300] },
};

// Jungle areas (several camps each). `r` is a rough radius; `pull` is the side facing the lane, where a pull or a
// quick camp between waves happens. `kind`: safe = safe-lane jungle, ancients = the inner jungle with the ancient
// camps, triangle = the jungle on the offlane side.
export const JUNGLE = [
  { id: 'r_safe', team: 'radiant', kind: 'safe', label: 'safe-jungelen', pos: [1000, -4100], r: 1400, pull: [1900, -5200] },
  { id: 'r_ancients', team: 'radiant', kind: 'ancients', label: 'ancient-leirene', pos: [-1100, -3700], r: 1000 },
  { id: 'r_triangle', team: 'radiant', kind: 'triangle', label: 'offlane-jungelen (triangelen)', pos: [-3900, -200], r: 1300, pull: [-5200, 400] },
  { id: 'd_safe', team: 'dire', kind: 'safe', label: 'safe-jungelen', pos: [-1000, 4100], r: 1400, pull: [-1900, 5200] },
  { id: 'd_ancients', team: 'dire', kind: 'ancients', label: 'ancient-leirene', pos: [1100, 3700], r: 1000 },
  { id: 'd_triangle', team: 'dire', kind: 'triangle', label: 'offlane-jungelen (triangelen)', pos: [3900, 200], r: 1300, pull: [5200, -400] },
];

// Rune spots and other points of interest. `side`: which half of the map ('river' for both).
export const RUNES = [
  { id: 'power_top', kind: 'power', side: 'river', label: 'power-runen (topp)', pos: [-1700, 1200] },
  { id: 'power_bot', kind: 'power', side: 'river', label: 'power-runen (bunn)', pos: [1200, -1250] },
  { id: 'bounty_r_top', kind: 'bounty', side: 'radiant', label: 'bounty-runen i offlane-jungelen', pos: [-4300, 350] },
  { id: 'bounty_r_bot', kind: 'bounty', side: 'radiant', label: 'bounty-runen i safe-jungelen', pos: [1250, -4300] },
  { id: 'bounty_d_bot', kind: 'bounty', side: 'dire', label: 'bounty-runen i offlane-jungelen', pos: [4300, -350] },
  { id: 'bounty_d_top', kind: 'bounty', side: 'dire', label: 'bounty-runen i safe-jungelen', pos: [-1250, 4300] },
  { id: 'wisdom_r', kind: 'wisdom', side: 'radiant', label: 'wisdom-shrinen', pos: [-7500, -600] },
  { id: 'wisdom_d', kind: 'wisdom', side: 'dire', label: 'wisdom-shrinen', pos: [7500, 600] },
  { id: 'lotus_top', kind: 'lotus', side: 'river', label: 'lotus-poolen (topp)', pos: [-5300, 3900] },
  { id: 'lotus_bot', kind: 'lotus', side: 'river', label: 'lotus-poolen (bunn)', pos: [5300, -3900] },
];

export const OUTPOSTS = [
  { id: 'outpost_top', label: 'outposten (topp)', pos: [-2700, 4200] },
  { id: 'outpost_bot', label: 'outposten (bunn)', pos: [2700, -4200] },
];

export const TORMENTORS = [
  { id: 'tormentor_top', label: 'Tormentor (topp)', pos: [-7100, 6700] },
  { id: 'tormentor_bot', label: 'Tormentor (bunn)', pos: [7000, -6800] },
];

// Roshan switches pit with day and night since 7.33. Which pit belongs to which is a best guess; flip `day` if wrong.
export const ROSHAN = {
  pits: { top: [-3300, 2800], bot: [3400, -2850] },
  day: 'bot',
  night: 'top',
};

export const CREEP_SPEED = 325; // lane creep move speed
export const WAVE_EVERY = 30; // a new wave leaves each barracks every 30 s
export const HERO_SPEED = 310; // rough hero move speed used for ETAs

// Everything the UI needs to draw the schematic, as one JSON-friendly object (served at /api/map).
export const MAP = {
  note: 'Skjematisk kart. Posisjonene er omtrentlige (sone-nivå).',
  bounds: BOUNDS,
  fountains: FOUNTAINS,
  ancients: ANCIENTS,
  bases: BASES,
  lanes: LANES,
  river: RIVER,
  towers: TOWERS,
  jungle: JUNGLE,
  runes: RUNES,
  outposts: OUTPOSTS,
  tormentors: TORMENTORS,
  roshan: ROSHAN,
};
