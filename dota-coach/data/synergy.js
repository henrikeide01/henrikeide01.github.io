// Well-known strong hero duos, used as a small bonus when an ally is already picked (src/coach/draft.js).
// Kept short and curated on purpose: only combos that are widely known to work, not stats. Each entry gives
// both heroes (internal names as in data/heroes.json), a bonus in "percentage points" on the same scale as
// the counter score (3 = a good combo, 4 = a classic one) and a short reason in Norwegian bokmål.
// Edit freely when the patch changes.
export const SYNERGY = [
  // Big AoE disables followed by AoE damage.
  { a: 'earthshaker', b: 'enigma', bonus: 4, why: 'Echo Slam inni Black Hole' },
  { a: 'dark_seer', b: 'magnataur', bonus: 4, why: 'Vacuum + Reverse Polarity samler hele laget' },
  { a: 'dark_seer', b: 'earthshaker', bonus: 3, why: 'Vacuum samler fiendene for Echo Slam' },
  { a: 'dark_seer', b: 'enigma', bonus: 3, why: 'Vacuum + Black Hole' },
  { a: 'faceless_void', b: 'skywrath_mage', bonus: 3, why: 'Nukes inni Chronosphere' },
  { a: 'faceless_void', b: 'witch_doctor', bonus: 4, why: 'Death Ward inni Chronosphere' },
  { a: 'faceless_void', b: 'crystal_maiden', bonus: 3, why: 'Freezing Field inni Chronosphere' },
  { a: 'faceless_void', b: 'invoker', bonus: 3, why: 'Chronosphere + Invokers kombo' },
  { a: 'mars', b: 'snapfire', bonus: 3, why: 'Mortimer Kisses treffer alt inni Arena' },
  { a: 'enigma', b: 'witch_doctor', bonus: 3, why: 'Death Ward inni Black Hole' },

  // Io carries a core into fights (Tether + Relocate).
  { a: 'wisp', b: 'gyrocopter', bonus: 4, why: 'Klassisk Io-duo: Tether og Relocate' },
  { a: 'wisp', b: 'tiny', bonus: 4, why: 'Tiny kaster Io inn, Tether holder ham i live' },
  { a: 'wisp', b: 'chaos_knight', bonus: 3, why: 'Relocate inn med Chaos Knight' },
  { a: 'wisp', b: 'sven', bonus: 3, why: 'Relocate inn med en Sven i God\'s Strength' },

  // Magnus buffs and positions right-clickers.
  { a: 'magnataur', b: 'sven', bonus: 3, why: 'Reverse Polarity samler fiendene for Sven' },
  { a: 'magnataur', b: 'troll_warlord', bonus: 3, why: 'Empower og Skewer gjør Troll livsfarlig' },
  { a: 'ogre_magi', b: 'troll_warlord', bonus: 3, why: 'Bloodlust gir enda mer angrepsfart' },

  // Saves that make a low-HP hero almost unkillable.
  { a: 'dazzle', b: 'huskar', bonus: 4, why: 'Shallow Grave holder Huskar i live' },
  { a: 'oracle', b: 'huskar', bonus: 4, why: 'False Promise og Fate\'s Edict beskytter Huskar' },
  { a: 'abaddon', b: 'huskar', bonus: 3, why: 'Aphotic Shield holder Huskar i live' },

  // Armor reduction or auras for right-clickers.
  { a: 'slardar', b: 'sven', bonus: 3, why: 'Corrosive Haze tar bort rustning for Sven' },
  { a: 'vengefulspirit', b: 'drow_ranger', bonus: 3, why: 'Vengeance Aura og Swap redder Drow' },
];

// Bonus and reason for `name` together with each ally: [{ ally, bonus, why }].
export function synergiesWith(name, allyNames) {
  const out = [];
  for (const s of SYNERGY) {
    const other = s.a === name ? s.b : s.b === name ? s.a : null;
    if (other && allyNames.includes(other)) out.push({ ally: other, bonus: s.bonus, why: s.why });
  }
  return out;
}
