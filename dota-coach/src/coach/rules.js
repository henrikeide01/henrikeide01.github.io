// Live coaching rules. Each rule looks at the context `c` (built in engine.js) and returns
// zero or more tips: { id, level: 'alert'|'warn'|'info'|'good', icon, text, say?, cooldown? }.
// `say` is the short sentence read aloud; `cooldown` (game seconds) stops it repeating too often.
import { nextOccurrence, fmtClock } from './timers.js';

const tip = (id, level, icon, text, extra = {}) => ({ id, level, icon, text, ...extra });
const playing = (c) => ['pregame', 'laning', 'mid', 'late'].includes(c.phase);
const inGame = (c) => ['laning', 'mid', 'late'].includes(c.phase);
const alive = (c) => c.hero?.alive !== false;
// The live route switched to a timed stop (stack, rune, shrine): its own tip says where to go, so the plain
// timing tip for the same thing is hidden. While a route exists, only the route tip reads timings aloud (when the
// player has to leave), so the same timing is never spoken twice.
const routeCovers = (c, kinds) => !!(c.route?.timing && c.route.changeWhy === 'timing' && kinds.includes(c.route.target?.kind));
const ROUTE_SAY = {
  stack: ['Gå og stack', 170],
  power: ['Gå til power-runen', 100],
  water: ['Gå til runen', 100],
  bounty: ['Ta bounty-runen', 200],
  wisdom: ['Gå til wisdom shrinen', 300],
  lotus: [null, 0],
};

// Level 1-16 gives one point each; after that points only come at 18, 20 and 25.
export function expectedSkillPoints(level) {
  if (level <= 16) return level;
  if (level <= 17) return 16;
  if (level <= 19) return 17;
  if (level <= 24) return 18;
  return 19;
}

export const RULES = [
  // ---------------- Before the horn ----------------
  function startItems(c) {
    if (!['strategy', 'pregame'].includes(c.phase) || !c.build?.start?.length) return;
    if (c.inv.held.length >= 4) return;
    const list = c.build.start.slice(0, 6).map((x) => x.dname).join(', ');
    return tip('start-items', 'info', '🛒', `Populære startitems for ${c.heroName}: ${list}.`);
  },
  function startWards(c) {
    if (!['strategy', 'pregame'].includes(c.phase) || c.role < 4 || c.inv.wards > 0) return;
    return tip('start-wards', 'warn', '👁️', 'Kjøp observer- og sentry-wards før hornet.', { say: 'Husk wards' });
  },
  function firstBounty(c) {
    if (c.phase !== 'pregame' || c.clock < -45) return;
    const who = c.role >= 4 ? 'Ta bounty-runen på din side av kartet.' : 'Hjelp supportene med å sikre runene.';
    return tip('first-bounty', 'info', '🪙', `Bounty runes spawner ved 0:00. ${who}`, c.role >= 4 ? { say: 'Bounty runes ved null null' } : {});
  },

  // ---------------- Survival ----------------
  function lowHp(c) {
    if (!playing(c) || !alive(c) || !c.hero.max_health) return;
    const hp = c.hero.health_percent;
    if (hp > 25) return;
    const where = c.loc?.side === 'enemy' ? ' Du er på fiendens side, så kom deg ut nå!' : '';
    return tip('low-hp', 'alert', '❤️', `Lav HP (${hp} %)! Trekk deg tilbake eller heal.${where}`, {
      say: 'Lav HP, trekk deg tilbake',
      cooldown: 30,
    });
  },
  function deathStreak(c) {
    if (!inGame(c)) return;
    const n = c.deathsSince(300);
    if (n < 2 || c.deathsSince(150) < 1) return;
    return tip('death-streak', 'warn', '💀', `${n} dødsfall de siste 5 minuttene. Spill tryggere: hold deg nær egne tårn, se på minikartet og kjøp observer- og sentry-wards.`, {
      say: 'Mange dødsfall. Spill tryggere',
      cooldown: 240,
    });
  },
  function deepInEnemyTerritory(c) {
    if (!inGame(c) || !alive(c) || c.clock < 600 || !c.loc) return;
    const deep = c.loc.side === 'enemy' && c.loc.depth > 2500 && !c.loc.inEnemyBase;
    if (!c.held('deep', deep, 6)) return;
    return tip('deep', 'warn', '⚠️', `Du er dypt inne på fiendens side (${c.loc.label}). Bli bare der hvis laget ditt ser fiendene på kartet.`, {
      say: 'Du er dypt på fiendens side',
      cooldown: 150,
    });
  },
  function buyback(c) {
    if (!inGame(c) || !alive(c) || c.clock < 1500 || c.role > 3) return;
    const cost = c.hero.buyback_cost;
    if (!cost || c.player.gold >= cost) return;
    return tip('buyback', 'warn', '💰', `Du har ikke råd til buyback (mangler ${cost - c.player.gold} gull). Ikke ta unødvendige sjanser.`, {
      say: 'Spar til buyback',
      cooldown: 300,
    });
  },
  function dead(c) {
    if (!playing(c) || alive(c)) return;
    let text = `Død, ${c.hero.respawn_seconds || 0} s til respawn.`;
    const bb = c.hero.buyback_cost;
    if (c.clock >= 1200 && bb) {
      text += c.player.gold >= bb ? ` Du har råd til buyback (${bb} g).` : ` Buyback koster ${bb} g, du mangler ${bb - c.player.gold} g.`;
    }
    text += ' Se på kartet og planlegg hvor du skal spawne inn.';
    return tip('dead', 'info', '⏳', text);
  },

  // ---------------- Items ----------------
  function noTp(c) {
    // The hold must see the condition turn false, or it never resets after the first time.
    if (!c.held('no-tp', inGame(c) && c.clock >= 90 && c.inv.tp === null, 5)) return;
    return tip('no-tp', 'warn', '🌀', 'Du har ingen TP Scroll! Kjøp en (100 gull). Den redder liv og tårn.', { say: 'Kjøp TP scroll', cooldown: 120 });
  },
  function stash(c) {
    if (!playing(c) || !alive(c)) return;
    const has = c.inv.stash.length > 0;
    if (!c.held('stash', has, 12)) return;
    const names = c.inv.stash.map((n) => c.db.dname(n)).join(', ');
    return tip('stash', 'warn', '📦', `Items i stashen: ${names}. Send dem med kureren!`, { say: 'Send kureren', cooldown: 90 });
  },
  function afford(c) {
    if (!playing(c) || !c.next || c.next.remaining <= 0) return;
    if (c.player.gold < c.next.remaining) return;
    const how = alive(c) ? 'Kjøp den nå og send den med kureren.' : 'Kjøp den nå mens du er død.';
    return tip(`afford-${c.next.name}`, 'good', '🛒', `Du har råd til ${c.next.dname}! ${how}`, { say: `Du har råd til ${c.next.dname}`, cooldown: 600 });
  },
  function unreliableGold(c) {
    if (!inGame(c) || !alive(c)) return;
    const u = c.player.gold_unreliable || 0;
    const canAfford = c.next && c.player.gold >= c.next.remaining;
    if (!c.held('unreliable', u >= 1200 && !canAfford, 20)) return;
    const target = c.next ? `komponenter til ${c.next.dname}` : 'noe nyttig';
    return tip('unreliable', 'info', '🪙', `Du har ${u} upålitelig gull. Mye av det forsvinner hvis du dør, så kjøp ${target}.`, { say: 'Bruk gullet ditt', cooldown: 240 });
  },
  function unspentSkillPoints(c) {
    const next = c.skills?.next;
    // The player gets a few seconds to skill on their own (longer without a recommendation). The hold resets
    // as soon as the points are spent, so every level-up gets the same grace time.
    if (!c.held('unspent', playing(c) && c.unspent >= 1, next ? 4 : 10)) return;
    const n = c.unspent;
    if (next) {
      const what = next.talent ? `talentet «${next.dname}»` : `${next.dname} (nivå ${next.toLevel})`;
      const why = next.talent && next.reason ? ` – ${next.reason}` : next.pct ? ` – ${next.pct} % av pro-spillerne gjør det her` : '';
      return tip('unspent', 'warn', '⬆️', `Skill ${what}${why}.${n > 1 ? ` Du har ${n} ubrukte poeng.` : ''}`, {
        say: `Skill ${next.talent ? 'talent' : next.dname}`,
        cooldown: 90,
      });
    }
    return tip('unspent', 'warn', '⬆️', `Du har ${n} ubrukt${n > 1 ? 'e' : ''} ferdighetspoeng!`, { say: 'Husk å skille opp', cooldown: 90 });
  },
  function talentChoice(c) {
    const t = c.skills?.talent;
    // When the next point is a talent, the unspent tip already names it; this only adds the split and the hint.
    if (!playing(c) || !t?.open || c.unspent < 1 || (c.skills.next && !c.skills.next.talent)) return;
    const pick = t.options.find((o) => o.name === t.pick);
    if (!pick) return;
    const split = t.options.map((o) => `${o.dname}${o.pct != null ? ` ${o.pct} %` : ''}`).join(' / ');
    if (c.skills.next?.talent) return t.hint ? tip(`talent-${t.tier}`, 'info', '🌟', `Talent nivå ${t.level}: pro-fordeling ${split}. ${t.hint}`) : undefined;
    return tip(`talent-${t.tier}`, 'info', '🌟', `Talent nivå ${t.level}: ta «${pick.dname}» – ${t.reason}. Pro-fordeling: ${split}.${t.hint ? ` ${t.hint}` : ''}`);
  },
  function neutralCraft(c) {
    const n = c.skills?.neutral;
    if (!inGame(c) || !n || (!n.artifacts.length && !n.enchantments.length)) return;
    if (n.artifacts.some((a) => a.selected) && n.enchantments.some((e) => e.selected)) return;
    const a = n.artifacts.find((x) => x.name === n.pickArtifact);
    const e = n.enchantments.find((x) => x.name === n.pickEnchantment);
    const parts = [];
    if (a && !n.artifacts.some((x) => x.selected)) parts.push(`artefakt: ${a.dname}${a.pct != null ? ` (${a.pct} % av pro-spillerne)` : ''}`);
    if (e && !n.enchantments.some((x) => x.selected)) parts.push(`fortryllelse: ${e.dname}${e.stats ? ` (${e.stats})` : ''}`);
    if (!parts.length) return;
    return tip(`neutral-${n.tier}`, 'info', '💎', `Nøytralt item tier ${n.tier} – velg ${parts.join(' og ')}.`, { say: 'Velg nøytralt item', cooldown: 600 });
  },
  function supportWards(c) {
    if (!inGame(c) || c.role < 4 || !alive(c) || c.clock < 120) return;
    if (!c.held('no-wards', c.inv.wards === 0, 90)) return;
    return tip('no-wards', 'info', '👁️', 'Du har ingen observer wards. Kjøp når shoppen har dem på lager. Vision vinner kamper.', { say: 'Kjøp wards', cooldown: 300 });
  },
  function lowMana(c) {
    if (!inGame(c) || !alive(c) || c.clock < 60 || !(c.hero.max_mana > 150)) return;
    if (c.hero.mana_percent > 12) return;
    return tip('low-mana', 'info', '💧', 'Lite mana. Bruk Clarity eller en Healing Lotus, eller gå tilbake før neste fight.');
  },
  function smoked(c) {
    if (!c.hero?.smoked) return;
    return tip('smoked', 'info', '🌫️', 'Du er smoket. Gå sammen med laget, og ikke angrip før alle er klare.');
  },

  // ---------------- Power spikes / when to fight ----------------
  function itemSpike(c) {
    const ev = c.recentEvent('spike-item', 20);
    if (!ev || !inGame(c)) return;
    return tip(`spike-${ev.data.name}`, 'good', '⚡', `${ev.data.dname} er ferdig. Det er et powerspike, så se etter fights eller press et tårn med laget nå.`, {
      say: `${ev.data.dname} ferdig. Nå er du sterk`,
      cooldown: 0,
    });
  },
  function levelSix(c) {
    if (!c.recentEvent('level6', 20) || !inGame(c)) return;
    const what = c.role >= 4 || c.role === 2 ? 'Se etter en gank sammen med laget.' : 'Bruk den når fienden står dårlig.';
    return tip('level6', 'good', '⭐', `Nivå 6: ultimaten er klar. ${what}`, { say: 'Nivå seks. Ultimaten er klar', cooldown: 0 });
  },
  function fightShift(c) {
    const ev = c.recentEvent('fight-shift', 12);
    if (!ev || !inGame(c) || !c.fight) return;
    const why = c.fight.reasons[0] ? ` (${c.fight.reasons[0].text.charAt(0).toLowerCase()}${c.fight.reasons[0].text.slice(1)})` : '';
    const says = {
      fight: 'Godt tidspunkt å kjempe',
      press: 'Ta initiativ og press',
      farm: 'Farm og vent på neste powerspike',
      retreat: 'Ikke kjemp nå. Trekk deg',
    };
    const level = { fight: 'good', press: 'good', neutral: 'info', farm: 'warn', retreat: 'alert' }[ev.data.to];
    return tip(`fight-${ev.data.to}`, level, c.fight.icon, `${c.fight.label}: ${c.fight.headline}${why}`, {
      say: says[ev.data.to],
      cooldown: 45,
    });
  },

  // ---------------- Map timings ----------------
  function routeTiming(c) {
    const r = c.route;
    if (!inGame(c) || !alive(c) || !routeCovers(c, Object.keys(ROUTE_SAY))) return;
    const [say, cooldown] = ROUTE_SAY[r.target.kind];
    return tip(`route-${r.target.kind}`, 'info', '🧭', `${r.target.label}: ${r.reason}`, say ? { say, cooldown } : {});
  },
  function powerRune(c) {
    if (!inGame(c) || !alive(c) || (c.role !== 2 && c.role !== 4) || routeCovers(c, ['power', 'water'])) return;
    const T = c.T.powerRune;
    const t = nextOccurrence(c.clock, T.first, T.every);
    const s = Math.round(t - c.clock);
    if (s <= 0 || s > 20) return;
    const what = c.role === 2 ? 'Ta kontroll over runen og bruk den til en gank.' : 'Hjelp mid med runen, eller ta den og roter.';
    return tip(`power-${t}`, 'info', '✨', `Power rune om ${s} s. ${what}`, c.route ? {} : { say: 'Power rune snart' });
  },
  function waterRune(c) {
    if (!inGame(c) || c.role !== 2 || routeCovers(c, ['power', 'water'])) return;
    const t = c.T.waterRunes.find((w) => w > c.clock && w - c.clock <= 15);
    if (!t) return;
    return tip(`water-${t}`, 'info', '💧', `Water rune om ${Math.round(t - c.clock)} s. Den fyller på HP og mana.`);
  },
  function bountyRune(c) {
    if (!inGame(c) || !alive(c) || routeCovers(c, ['bounty'])) return;
    if (c.role < 4 && c.clock > 600) return;
    const T = c.T.bountyRune;
    const t = nextOccurrence(c.clock, T.first, T.every);
    const s = Math.round(t - c.clock);
    if (t <= 0 || s <= 0 || s > 20) return;
    const what = c.role >= 4 ? 'Ta den nærmeste.' : 'Supportene bør ta dem.';
    return tip(`bounty-${t}`, 'info', '🪙', `Bounty runes om ${s} s. ${what}`, c.role >= 4 && !c.route ? { say: 'Bounty rune snart' } : {});
  },
  function wisdomShrine(c) {
    if (!inGame(c) || (c.role !== 3 && c.role !== 4) || routeCovers(c, ['wisdom'])) return;
    const T = c.T.wisdomShrine;
    const t = nextOccurrence(c.clock, T.first, T.every);
    const s = Math.round(t - c.clock);
    if (s <= 0 || s > 25) return;
    return tip(`wisdom-${t}`, 'info', '📘', `Wisdom shrine aktiveres om ${s} s (offlane-jungelen). Gratis XP, ikke la fienden ta den.`, c.route ? {} : { say: 'Wisdom shrine snart' });
  },
  function lotusPool(c) {
    if (!inGame(c) || c.role < 4 || c.clock > 2100) return;
    const T = c.T.lotus;
    const t = nextOccurrence(c.clock, T.first, T.every);
    const s = Math.round(t - c.clock);
    if (s <= 0 || s > 15) return;
    return tip(`lotus-${t}`, 'info', '🪷', `Lotus pool gir en ny Healing Lotus om ${s} s.`);
  },
  function stackCamps(c) {
    if (!inGame(c) || !alive(c) || c.clock < 120 || c.clock > 1800) return;
    const sec = Math.floor(c.clock % 60);
    if (sec < 38 || sec > c.T.stackSecond) return;
    if (c.role >= 4 && c.hero.health_percent > 40) {
      if (routeCovers(c, ['stack'])) return;
      return tip('stack', 'info', '🧺', `Stack-tid: trekk leiren ved :53–:55 (om ${c.T.stackSecond - sec} s).`, c.route ? {} : { say: 'Stack-tid', cooldown: 170 });
    }
    if (c.role === 1 && c.clock > 600 && c.loc?.zone === 'jungle' && c.loc.side === 'own') {
      return tip('stack-core', 'info', '🧺', 'Tips: trekk leiren ved siden av ved :53 mens du farmer, så får du en ekstra stack.');
    }
  },
  function neutralTier(c) {
    if (!inGame(c)) return;
    const tier = c.T.neutralTiers.find((t) => t.tier > 1 && c.clock >= t.at && c.clock < t.at + 60);
    if (!tier) return;
    return tip(`neutral-${tier.tier}`, 'info', '🪨', `Tier ${tier.tier} neutral items er tilgjengelige nå. Rydd leirer for Madstone og craft et nytt item.`, {
      say: `Tier ${tier.tier} neutral items er klare`,
    });
  },
  function tormentor(c) {
    if (!inGame(c)) return;
    const first = c.T.tormentor.first;
    if (c.clock < first - 30 || c.clock > first + 45) return;
    const when = c.clock < first ? `om ${Math.round(first - c.clock)} s` : 'nå';
    return tip('tormentor', 'info', '🛡️', `Tormentor spawner ${when}. Den gir Aghanim's Shard (eller gull) til laget. Ta den med 2–3 helter.`, {
      say: c.role === 1 ? undefined : 'Tormentor spawner snart',
    });
  },
  function roshan(c) {
    if (!inGame(c) || c.roshanKilledAt == null) return;
    const min = c.roshanKilledAt + c.T.roshan.min;
    const max = c.roshanKilledAt + c.T.roshan.max;
    if (c.clock - c.roshanKilledAt < 30) {
      return tip(`rosh-dead-${c.roshanKilledAt}`, 'info', '🐲', `Roshan døde ${fmtClock(c.roshanKilledAt)}. Han kan komme tilbake mellom ${fmtClock(min)} og ${fmtClock(max)}.`);
    }
    if (c.clock >= min - 30 && c.clock <= min + 30) {
      return tip(`rosh-up-${c.roshanKilledAt}`, 'info', '🐲', `Roshan kan være tilbake fra ${fmtClock(min)} (senest ${fmtClock(max)}). Ward pit-en før laget går dit.`, {
        say: 'Roshan kan være tilbake snart',
      });
    }
  },
  function dayNight(c) {
    const ev = c.recentEvent('daynight', 15);
    if (!ev || !inGame(c)) return;
    return ev.data.daytime
      ? tip(`day-${ev.clock}`, 'info', '☀️', 'Det er dag: mer vision. Godt tidspunkt for å presse lanes og ta objektiver.')
      : tip(`night-${ev.clock}`, 'info', '🌙', 'Det er natt: mindre vision. Bra tid for smoke-ganks. Farm forsiktig på fiendens side.');
  },

  // ---------------- Farm ----------------
  function farmPace(c) {
    if (!inGame(c) || c.role > 3 || c.clock < 300 || c.clock > 720) return;
    const rate = { 1: 7, 2: 6.2, 3: 3.8 }[c.role];
    const expected = (rate * Math.max(0, c.clock - 30)) / 60;
    const behind = c.player.last_hits < expected * 0.7;
    if (!c.held('pace', behind, 30)) return;
    return tip('farm-pace', 'warn', '🌾', `Du ligger bak på last hits (${c.player.last_hits}, målet er ca. ${Math.round(expected)}). Fokuser på siste slag, og bruk evner på bølgen hvis lanen er tøff.`, {
      say: 'Fokuser på last hits',
      cooldown: 300,
    });
  },
  function gpmBenchmark(c) {
    if (!inGame(c) || c.role > 3 || c.clock < 900 || c.perf.gpmPct == null) return;
    const p = Math.round(c.perf.gpmPct * 100);
    if (c.perf.gpmPct < 0.3) {
      return tip('gpm-low', 'info', '📉', `GPM ${c.player.gpm} er lavt for ${c.heroName} (bedre enn ${p} % av spillerne). Hold et farm-mønster: bølge, jungel, bølge, og ikke stå stille.`);
    }
    if (c.perf.gpmPct > 0.75) {
      return tip('gpm-high', 'good', '📈', `Sterk farm! GPM ${c.player.gpm} er bedre enn ${p} % av ${c.heroName}-spillerne. Bruk forspranget til å presse tårn og ta Roshan med laget.`);
    }
  },
  function postGame(c) {
    if (c.phase !== 'post') return;
    const win = c.gsi.map?.win_team;
    const result = win === c.team ? 'Seier, bra spilt!' : win && win !== 'none' ? 'Tap. Neste blir bedre.' : 'Kampen er over.';
    const parts = [`${c.player.deaths ?? 0} dødsfall`];
    if (c.lhAt10 != null && c.role <= 3) parts.push(`${c.lhAt10} last hits ved 10:00 (godt mål: ${{ 1: 65, 2: 55, 3: 35 }[c.role]})`);
    if (c.player.gpm) parts.push(`GPM ${c.player.gpm}`);
    return tip('post-game', win === c.team ? 'good' : 'info', '🏁', `${result} Oppsummering: ${parts.join(', ')}. Tenk over dødsfallene: hadde du vision, og visste du hvor fiendene var?`);
  },
  function idleInBase(c) {
    if (!inGame(c) || !alive(c) || c.clock < 600 || !c.loc) return;
    if (!c.held('in-base', c.loc.inOwnBase, 35)) return;
    return tip('in-base', 'info', '🏠', 'Du har stått i basen lenge. Kom deg ut og farm eller press. Tid er gull.', { say: 'Kom deg ut av basen', cooldown: 180 });
  },
];
