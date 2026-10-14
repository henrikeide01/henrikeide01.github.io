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
