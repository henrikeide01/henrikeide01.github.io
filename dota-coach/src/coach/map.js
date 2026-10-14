// Rough map regions from GSI hero coordinates (x/y roughly -8000..8000, Radiant bottom-left, Dire top-right).
// The river runs along the y = -x diagonal, so (x + y) tells which half of the map you're on.

export function safeLane(team) {
  return team === 'dire' ? 'top' : 'bot';
}

export function offLane(team) {
  return team === 'dire' ? 'bot' : 'top';
}

const LANE_LABEL = { top: 'top lane', mid: 'mid', bot: 'bot lane' };

export function locate(x, y, team) {
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  const s = (x + y) / Math.SQRT2; // + = Dire half
  const d = (y - x) / Math.SQRT2; // distance from the mid-lane diagonal
  const depth = team === 'dire' ? -s : s; // + = into enemy half

  let zone;
  if (x < -4600 && y < -4100) zone = 'radiant_base';
  else if (x > 4000 && y > 3600) zone = 'dire_base';
  else if (Math.abs(d) < 1000) zone = 'mid';
  else if (x < -5200 || y > 5200) zone = 'top';
  else if (y < -5200 || x > 5200) zone = 'bot';
  else if (Math.abs(s) < 700) zone = 'river';
  else zone = 'jungle';

  const side = Math.abs(s) < 700 ? 'river' : depth < 0 ? 'own' : 'enemy';
  let label;
  if (zone.endsWith('_base')) {
    const own = (zone === 'radiant_base') === (team !== 'dire');
    label = own ? 'egen base' : 'fiendens base';
  } else if (zone === 'river') label = 'elva';
  else if (zone === 'jungle') label = side === 'own' ? 'egen jungel' : 'fiendens jungel';
  else {
    label = LANE_LABEL[zone];
    if (zone === safeLane(team)) label += ' (din safe lane)';
    else if (zone === offLane(team)) label += ' (din offlane)';
  }

  return {
    zone,
    side,
    depth: Math.round(depth),
    inOwnBase: label === 'egen base',
    inEnemyBase: label === 'fiendens base',
    label,
  };
}
