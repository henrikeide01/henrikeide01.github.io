// Countdown timers for map objectives, based on the in-game clock.

export function nextOccurrence(clock, first, every) {
  if (clock <= first) return first;
  return first + Math.ceil((clock - first) / every) * every;
}

export function fmtClock(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtGameClock(sec) {
  const sign = sec < 0 ? '-' : '';
  return sign + fmtClock(Math.abs(sec));
}

// extra: { daytime, roshanKilledAt, aegisAt, tormentorKilledAt }
export function computeTimers(clock, T, extra = {}) {
  const timers = [];
  const add = (id, label, at, more = {}) => timers.push({ id, label, at, in: Math.max(0, at - clock), ...more });

  add('bounty', 'Bounty', nextOccurrence(clock, T.bountyRune.first, T.bountyRune.every));

  const water = T.waterRunes.find((t) => t >= clock);
  if (water !== undefined && water < T.powerRune.first) add('power', 'Water rune', water);
  else add('power', 'Power rune', nextOccurrence(clock, T.powerRune.first, T.powerRune.every));

  add('wisdom', 'Wisdom', nextOccurrence(clock, T.wisdomShrine.first, T.wisdomShrine.every));
  add('lotus', 'Lotus', nextOccurrence(clock, T.lotus.first, T.lotus.every));

  if (clock >= 0) {
    const sec = ((clock % 60) + 60) % 60;
    const stackAt = clock - sec + (sec <= T.stackSecond ? T.stackSecond : 60 + T.stackSecond);
    add('stack', 'Stack', stackAt);
  }

  const tier = T.neutralTiers.find((t) => t.at > clock);
  if (tier) add('neutral', `Neutral T${tier.tier}`, tier.at);

  if (extra.tormentorKilledAt != null) {
    add('tormentor', 'Tormentor', extra.tormentorKilledAt + T.tormentor.respawn);
  } else if (clock < T.tormentor.first) {
    add('tormentor', 'Tormentor', T.tormentor.first);
  }

  if (extra.roshanKilledAt != null) {
    const min = extra.roshanKilledAt + T.roshan.min;
    const max = extra.roshanKilledAt + T.roshan.max;
    if (clock < max) {
      add('roshan', clock < min ? 'Roshan (tidligst)' : 'Roshan (senest)', clock < min ? min : max, {
        window: [min, max],
      });
    }
  }
  if (extra.aegisAt != null && clock < extra.aegisAt + T.aegis) {
    add('aegis', 'Aegis utløper', extra.aegisAt + T.aegis);
  }

  if (clock >= 0 && typeof extra.daytime === 'boolean') {
    add('daynight', extra.daytime ? 'Natt om' : 'Dag om', nextOccurrence(clock + 1, 0, T.dayNight));
  }

  return timers;
}
