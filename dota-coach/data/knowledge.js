// Spillkunnskap coachen bruker. Alt her er vanlig tekst/tall som du kan redigere selv.

// Timinger for patch 7.41 (sekunder på spillklokka). Sjekk disse når det kommer en ny patch.
export const TIMINGS = {
  patch: '7.41',
  bountyRune: { first: 0, every: 240 },
  powerRune: { first: 360, every: 120 },
  waterRunes: [120, 240],
  wisdomShrine: { first: 420, every: 420 },
  lotus: { first: 180, every: 180 },
  stackSecond: 53, // trekk leiren rundt xx:53–xx:55, leirer spawner hvert minutt
  neutralTiers: [
    { tier: 1, at: 0 },
    { tier: 2, at: 900 },
    { tier: 3, at: 1500 },
    { tier: 4, at: 2100 },
    { tier: 5, at: 3600 },
  ],
  tormentor: { first: 1200, respawn: 600 },
  roshan: { min: 480, max: 660 },
  aegis: 300,
  dayNight: 300,
};

// Hva du bør fokusere på i hver fase, per posisjon.
export const FOCUS = {
  strategy: {
    1: 'Kjøp startitems, og avtal med pos 5 hvem som blokkerer og puller.',
    2: 'Kjøp startitems (gjerne Bottle-plan). Midt avgjøres av last hits og runer.',
    3: 'Kjøp regen til en tøff lane. Målet ditt er nivåer og å forstyrre fiendens carry.',
    4: 'Kjøp wards og regen. Planlegg hvem du skal ganke først.',
    5: 'Kjøp observer og sentry wards og regen til carryen din. Hjelp til med kurer og blokkering.',
  },
  laning: {
    1: 'Last hits og denies. Ikke jag kills. Trekk deg bak tårnet når to fiender er på deg.',
    2: 'Vinn mid på last hits. Kontroller power runes (6:00, 8:00 …) og roter når du har rune og nivå 6.',
    3: 'Press fiendens carry, få nivåer og ikke dø. Trekk leiren når lanen presses mot deg.',
    4: 'Harass i lanen, stack leirer og roter med power rune til mid eller motsatt lane.',
    5: 'Hold carryen i live: pull, stack, ward og deward. Ikke ta last hits fra carryen.',
  },
  mid: {
    1: 'Farm effektivt: lane-bølge, så jungel, så neste bølge. Bli med i fights når nøkkelitemet ditt er ferdig.',
    2: 'Ta initiativ: roter med runer, press tårn og farm mellom gankene.',
    3: 'Lag space: initier, press motsatt side av kartet fra carryen og ta tårn.',
    4: 'Smoke-ganks, vision rundt neste objektiv og stacks til kjernene.',
    5: 'Vision og deward rundt objektiver. Hold kjernene i live, og ikke farm leirene til carryen.',
  },
  late: {
    1: 'Ha buyback-gull. Farm trygt mellom fights, og kom til fights i tide (TP klar).',
    2: 'Vær der når fightene skjer. Ikke farm alene på fiendens side uten vision.',
    3: 'Initier riktig: vent til fienden viser seg, og bruk BKB/blink smart.',
    4: 'Vision før Roshan og high ground. Smoke for å fange folk som farmer alene.',
    5: 'Ward trygt sammen med laget. Spar save-items til carryen, og kjøp Gem ved behov.',
  },
};

// Situasjonsbestemte items basert på fiendens heroes.
// core = pos 1/2, off = pos 3 (faller tilbake til core), support = pos 4/5.
export const COUNTER_RULES = [
  {
    id: 'invis',
    heroes: ['riki', 'bounty_hunter', 'clinkz', 'weaver', 'nyx_assassin', 'templar_assassin', 'mirana', 'invoker', 'treant'],
    core: ['dust'],
    support: ['ward_sentry', 'dust', 'gem'],
    why: 'Usynlige helter ({heroes}). Ha alltid sentry eller dust klar.',
  },
  {
    id: 'evasion',
    heroes: ['phantom_assassin', 'windrunner', 'brewmaster'],
    core: ['monkey_king_bar', 'bloodthorn'],
    support: [],
    why: 'Evasion ({heroes}). MKB eller Bloodthorn gir true strike.',
  },
  {
    id: 'illusions',
    heroes: ['phantom_lancer', 'naga_siren', 'chaos_knight', 'terrorblade', 'meepo', 'arc_warden', 'broodmother', 'lycan', 'beastmaster', 'lone_druid', 'furion', 'visage', 'warlock', 'enigma'],
    core: ['mjollnir', 'bfury', 'radiance', 'shivas_guard'],
    off: ['shivas_guard', 'crimson_guard', 'radiance'],
    support: [],
    why: 'Illusjoner eller summons ({heroes}). AoE-skade og cleave er gull.',
  },
  {
    id: 'heal',
    heroes: ['necrolyte', 'alchemist', 'huskar', 'abaddon', 'oracle', 'omniknight', 'life_stealer', 'dazzle', 'undying', 'wisp', 'warlock', 'winter_wyvern', 'chen', 'enchantress', 'morphling'],
    core: ['skadi', 'shivas_guard'],
    off: ['spirit_vessel', 'shivas_guard'],
    support: ['spirit_vessel'],
    why: 'Mye healing og regen ({heroes}). Anti-heal kutter det.',
  },
  {
    id: 'magic',
    min: 2,
    heroes: ['lina', 'lion', 'zuus', 'skywrath_mage', 'leshrac', 'queenofpain', 'tinker', 'storm_spirit', 'puck', 'pugna', 'obsidian_destroyer', 'invoker', 'techies', 'nyx_assassin', 'death_prophet', 'ancient_apparition', 'jakiro', 'grimstroke', 'shadow_demon', 'witch_doctor', 'necrolyte', 'void_spirit', 'ember_spirit'],
    core: ['black_king_bar'],
    off: ['pipe', 'eternal_shroud', 'black_king_bar'],
    support: ['glimmer_cape'],
    why: 'Mye magisk skade ({heroes}).',
  },
  {
    id: 'physical',
    min: 2,
    heroes: ['phantom_assassin', 'ursa', 'troll_warlord', 'juggernaut', 'slark', 'faceless_void', 'sven', 'drow_ranger', 'sniper', 'medusa', 'monkey_king', 'templar_assassin', 'life_stealer', 'chaos_knight', 'luna', 'gyrocopter', 'lycan', 'terrorblade', 'kez', 'clinkz', 'weaver', 'spectre', 'antimage'],
    core: ['butterfly', 'assault'],
    off: ['blade_mail', 'heavens_halberd', 'crimson_guard', 'shivas_guard'],
    support: ['ghost', 'force_staff', 'solar_crest'],
    why: 'Fysiske right-clickers ({heroes}).',
  },
  {
    id: 'break',
    heroes: ['bristleback', 'phantom_assassin', 'spectre', 'huskar', 'slark', 'shredder', 'tidehunter', 'faceless_void', 'ursa', 'axe', 'viper'],
    core: ['silver_edge'],
    support: [],
    why: 'Sterke passive evner ({heroes}). Break fra Silver Edge skrur dem av.',
  },
  {
    id: 'mobile',
    heroes: ['storm_spirit', 'ember_spirit', 'queenofpain', 'antimage', 'puck', 'void_spirit', 'slark', 'weaver', 'kez', 'pangolier', 'morphling', 'faceless_void'],
    core: ['orchid', 'bloodthorn', 'abyssal_blade', 'sheepstick'],
    off: ['rod_of_atos', 'sheepstick'],
    support: ['rod_of_atos'],
    why: 'Mobile helter ({heroes}). Ha root, silence eller hex klart.',
  },
  {
    id: 'lockdown',
    min: 3,
    heroes: ['lion', 'shadow_shaman', 'bane', 'doom_bringer', 'legion_commander', 'batrider', 'beastmaster', 'bloodseeker', 'pudge', 'silencer', 'night_stalker', 'grimstroke', 'ogre_magi', 'dragon_knight', 'magnataur', 'enigma', 'tidehunter', 'earthshaker', 'axe', 'mars', 'skywrath_mage'],
    core: ['black_king_bar', 'sphere', 'manta'],
    off: ['black_king_bar', 'lotus_orb'],
    support: ['glimmer_cape', 'force_staff', 'lotus_orb', 'cyclone'],
    why: 'Mye disable ({heroes}). Kjøp BKB eller spell block tidlig.',
  },
];

// Korte tips mot enkelte fiendehelter.
export const ENEMY_TIPS = {
  antimage: 'Anti-Mage: spill aggressivt tidlig, før Battle Fury og Manta er ferdige.',
  axe: 'Axe: ikke stå i gruppe rundt ham med lav HP. Culling Blade dreper under ~25 %.',
  broodmother: 'Broodmother: ta med AoE og Quelling Blade, og kjemp utenfor webbene hennes.',
  bristleback: 'Bristleback: skad ham forfra, og bruk Silver Edge eller Spirit Vessel.',
  huskar: 'Huskar: bruk anti-heal (Spirit Vessel) og fysisk skade, og unngå lange fights mot ham.',
  legion_commander: 'Legion Commander: Linken’s, Lotus Orb eller Eul’s stopper Duel.',
  lycan: 'Lycan: han pusher fort. Ha TP klar og forsvar tårnene.',
  medusa: 'Medusa: avslutt før hun har 3–4 items, og bruk mana burn (Diffusal) mot skjoldet.',
  meepo: 'Meepo: én død Meepo dreper alle. AoE-stun og burst virker godt.',
  necrolyte: 'Necrophos: ikke kjemp på lav HP nær ham (Reaper’s Scythe). Kjøp anti-heal.',
  phantom_assassin: 'Phantom Assassin: MKB mot evasion, Ghost Scepter til supports og armor mot crits.',
  phantom_lancer: 'Phantom Lancer: AoE (Mjollnir, Shiva’s) og drep ham tidlig, før illusjonshæren kommer.',
  riki: 'Riki: sentry og dust i lanen og når laget kjemper.',
  sniper: 'Sniper: dykk ham med blink eller smoke. Han er skjør på nært hold.',
  spectre: 'Spectre: vinn tidlig. Hun blir sterkere jo lenger kampen varer.',
  tinker: 'Tinker: press tidlig, deward ham og hold Blade Mail eller BKB klar.',
  furion: 'Nature’s Prophet: ha TP klar, han pusher sidelanes fra hele kartet.',
  slark: 'Slark: lockdown som går gjennom Dark Pact, og ikke gi ham lange fights.',
  storm_spirit: 'Storm Spirit: Orchid, Bloodthorn eller hex, og la ham hoppe inn først.',
  templar_assassin: 'Templar Assassin: dust mot Meld, og AoE eller DoT for å bryte Refraction.',
  ursa: 'Ursa: hold avstand, og bruk Ghost eller Force Staff mot Enrage.',
  weaver: 'Weaver: sentry, dust og Gem, og lockdown som stopper Time Lapse-timing.',
  clinkz: 'Clinkz: dust og sentry. Han jakter ensomme supports.',
  troll_warlord: 'Troll Warlord: disarm, ghost og kiting. Ikke kjemp mot ham mens Battle Trance er aktiv.',
  faceless_void: 'Faceless Void: ikke stå samlet når han har Chronosphere klar.',
  enigma: 'Enigma: spre dere i fights, og hold BKB klar mot Black Hole.',
  morphling: 'Morphling: burst ham når han er i agility-form, og bruk hex eller silence.',
  alchemist: 'Alchemist: ganke ham tidlig i jungelen. Han tar pengene sine fra farming.',
};

// Når helten er på sitt sterkeste. early = sterk tidlig og faller av, late = trenger farm/items, resten = mid.
export const POWER_CURVE = {
  early: [
    'bloodseeker', 'huskar', 'viper', 'venomancer', 'night_stalker', 'razor', 'batrider', 'broodmother', 'beastmaster', 'lycan',
    'ursa', 'bounty_hunter', 'lion', 'shadow_shaman', 'bane', 'witch_doctor', 'pugna', 'undying', 'clinkz', 'queenofpain',
    'lina', 'spirit_breaker', 'tusk', 'mirana', 'jakiro', 'skywrath_mage', 'ogre_magi', 'hoodwink', 'marci', 'dazzle',
    'nyx_assassin', 'elder_titan', 'earth_spirit', 'riki', 'snapfire', 'troll_warlord',
  ],
  late: [
    'antimage', 'spectre', 'medusa', 'naga_siren', 'terrorblade', 'phantom_lancer', 'faceless_void', 'morphling', 'arc_warden',
    'tinker', 'invoker', 'storm_spirit', 'obsidian_destroyer', 'weaver', 'muerta', 'slark', 'alchemist', 'gyrocopter',
    'sniper', 'drow_ranger', 'luna', 'enchantress', 'wisp', 'kez',
  ],
};

export function powerCurve(heroName) {
  if (POWER_CURVE.early.includes(heroName)) return 'early';
  if (POWER_CURVE.late.includes(heroName)) return 'late';
  return 'mid';
}

// Hvor sterk en kurve er i hver fase (−1 svak … +1 sterk).
export const CURVE_STRENGTH = {
  early: { laning: 1, mid: 0.4, late: -0.6 },
  mid: { laning: 0, mid: 0.8, late: 0.1 },
  late: { laning: -0.8, mid: -0.2, late: 1 },
};

// Items som nesten alltid er en stor powerspike, uansett hero.
export const SPIKE_ITEMS = [
  'black_king_bar', 'blink', 'bfury', 'manta', 'desolator', 'radiance', 'ultimate_scepter', 'echo_sabre', 'maelstrom',
  'mjollnir', 'orchid', 'bloodthorn', 'sange_and_yasha', 'kaya_and_sange', 'yasha_and_kaya', 'diffusal_blade', 'skadi',
  'butterfly', 'satanic', 'greater_crit', 'abyssal_blade', 'sheepstick', 'refresher', 'octarine_core', 'shivas_guard',
  'assault', 'heart', 'silver_edge', 'monkey_king_bar', 'aghanims_shard', 'hand_of_midas', 'mask_of_madness', 'armlet',
  'pipe', 'crimson_guard', 'vanguard', 'force_staff', 'glimmer_cape', 'aether_lens', 'gungir', 'harpoon', 'angels_demise',
  'disperser', 'overwhelming_blink', 'swift_blink', 'arcane_blink', 'bottle', 'falcon_blade', 'witch_blade', 'phylactery',
];

// Aktive items der det er dumt å starte en fight mens de står på cooldown.
export const KEY_ACTIVES = {
  black_king_bar: 'BKB',
  blink: 'Blink',
  overwhelming_blink: 'Blink',
  swift_blink: 'Blink',
  arcane_blink: 'Blink',
  refresher: 'Refresher',
  sheepstick: 'Hex',
  bloodthorn: 'Bloodthorn',
  orchid: 'Orchid',
  manta: 'Manta',
  glimmer_cape: 'Glimmer',
  force_staff: 'Force Staff',
  lotus_orb: 'Lotus Orb',
  aeon_disk: 'Aeon Disk',
};

// ---------------- Live item suggestions and the death recap ----------------

// Heroes with a lot of magic burst from the laning phase on. Two or more → Infused Raindrops early.
export const MAGIC_NUKERS = [
  'lina', 'lion', 'zuus', 'skywrath_mage', 'leshrac', 'tinker', 'pugna', 'queenofpain', 'puck', 'storm_spirit', 'death_prophet',
  'jakiro', 'witch_doctor', 'shadow_shaman', 'nyx_assassin', 'necrolyte', 'void_spirit', 'ember_spirit', 'earth_spirit',
  'grimstroke', 'disruptor', 'hoodwink', 'snapfire', 'invoker', 'obsidian_destroyer', 'ancient_apparition', 'dark_willow',
  'muerta', 'techies', 'crystal_maiden', 'shadow_demon', 'bane', 'ogre_magi', 'keeper_of_the_light', 'dark_seer',
];

// Heroes that cast spells all the time (Magic Stick/Wand fills up fast against them).
export const SPELL_SPAMMERS = [
  'batrider', 'bristleback', 'zuus', 'skywrath_mage', 'storm_spirit', 'ogre_magi', 'shredder', 'weaver', 'venomancer', 'leshrac',
  'queenofpain', 'puck', 'tinker', 'invoker', 'techies', 'death_prophet', 'ember_spirit', 'earth_spirit', 'jakiro', 'disruptor',
  'pugna', 'lina', 'silencer', 'necrolyte', 'nyx_assassin', 'sand_king', 'void_spirit', 'pangolier', 'dark_seer', 'abaddon',
  'windrunner', 'templar_assassin', 'snapfire', 'hoodwink', 'dark_willow', 'witch_doctor', 'mirana', 'keeper_of_the_light',
];

// Items with an active that can save your life. Name → short label used in the death recap.
export const SAVE_ACTIVES = {
  black_king_bar: 'BKB',
  glimmer_cape: 'Glimmer Cape',
  force_staff: 'Force Staff',
  hurricane_pike: 'Hurricane Pike',
  blink: 'Blink Dagger',
  overwhelming_blink: 'Blink Dagger',
  swift_blink: 'Blink Dagger',
  arcane_blink: 'Blink Dagger',
  ghost: 'Ghost Scepter',
  ethereal_blade: 'Ethereal Blade',
  cyclone: 'Eul’s',
  wind_waker: 'Wind Waker',
  manta: 'Manta Style',
  satanic: 'Satanic',
  lotus_orb: 'Lotus Orb',
  invis_sword: 'Shadow Blade',
  silver_edge: 'Silver Edge',
  mekansm: 'Mekansm',
  guardian_greaves: 'Guardian Greaves',
  pipe: 'Pipe',
  crimson_guard: 'Crimson Guard',
  sheepstick: 'Hex',
  orchid: 'Orchid',
  bloodthorn: 'Bloodthorn',
  abyssal_blade: 'Abyssal Blade',
  heavens_halberd: 'Halberd',
  solar_crest: 'Solar Crest',
  disperser: 'Disperser',
  harpoon: 'Harpoon',
  blade_mail: 'Blade Mail',
  eternal_shroud: 'Eternal Shroud',
  boots_of_bearing: 'Boots of Bearing',
  holy_locket: 'Holy Locket',
  magic_wand: 'Magic Wand',
  magic_stick: 'Magic Stick',
  faerie_fire: 'Faerie Fire',
};

// Abilities that save you (escape, invulnerability, dispel, heal). Only these count as "a defensive spell was ready".
export const SAVE_ABILITIES = [
  'antimage_blink', 'queenofpain_blink', 'puck_phase_shift', 'puck_ethereal_jaunt', 'slark_dark_pact', 'slark_pounce', 'slark_shadow_dance',
  'weaver_shukuchi', 'weaver_time_lapse', 'storm_spirit_ball_lightning', 'ember_spirit_activate_fire_remnant', 'faceless_void_time_walk',
  'morphling_waveform', 'riki_tricks_of_the_trade', 'juggernaut_blade_fury', 'life_stealer_rage', 'omniknight_martyr', 'omniknight_guardian_angel',
  'dazzle_shallow_grave', 'abaddon_borrowed_time', 'abaddon_aphotic_shield', 'oracle_false_promise', 'oracle_fates_edict', 'mirana_leap',
  'sandking_burrowstrike', 'void_spirit_dissimilate', 'void_spirit_astral_step', 'pangolier_shield_crash', 'pangolier_gyroshell',
  'windrunner_windrun', 'nyx_assassin_spiked_carapace', 'templar_assassin_refraction', 'templar_assassin_meld', 'phantom_lancer_doppelwalk',
  'naga_siren_mirror_image', 'terrorblade_conjure_image', 'terrorblade_sunder', 'bounty_hunter_wind_walk', 'clinkz_wind_walk',
  'earth_spirit_rolling_boulder', 'tusk_snowball', 'magnataur_skewer', 'phoenix_icarus_dive', 'spectre_haunt', 'meepo_poof',
  'furion_teleportation', 'wisp_relocate', 'hoodwink_scurry', 'marci_companion_run', 'chen_hand_of_god', 'troll_warlord_battle_trance',
  'ursa_enrage', 'arc_warden_magnetic_field', 'shadow_demon_disruption', 'winter_wyvern_cold_embrace', 'legion_commander_press_the_attack',
  'necrolyte_ghost_shroud', 'pugna_decrepify', 'monkey_king_tree_dance', 'kez_grappling_claw', 'dark_willow_shadow_realm',
  'invoker_ghost_walk', 'spirit_breaker_charge_of_darkness', 'batrider_firefly', 'bristleback_bristleback',
];
