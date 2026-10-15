// Live route minimap (dashboard card and overlay). The static map is drawn once (per team); every GSI update only
// moves the hero dot, the path and the stop markers with attribute changes, so it stays smooth at 4 updates/s.
import { esc, fmtClock } from './common.js';

const NS = 'http://www.w3.org/2000/svg';
let mapPromise = null;
let mountCount = 0;

// The schematic map (data/map.js) comes from the server once.
export function loadMap() {
  mapPromise ||= fetch('/api/map')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((m) => {
      if (!m) mapPromise = null; // try again on the next update
      return m;
    });
  return mapPromise;
}

const RUNE_TIMER = { power: 'power', bounty: 'bounty', wisdom: 'wisdom', lotus: 'lotus' };
const KIND_CLASS = { retreat: 'danger', tower: 'push', tormentor: 'push', roshan: 'push', stack: 'timed', power: 'timed', water: 'timed', bounty: 'timed', wisdom: 'timed', lotus: 'timed' };

function el(doc, tag, attrs = {}, parent) {
  const e = doc.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

function setAttr(e, k, v) {
  const s = String(v);
  if (e.getAttribute(k) !== s) e.setAttribute(k, s);
}

function title(doc, parent, text) {
  el(doc, 'title', {}, parent).textContent = text;
}

// compact: the small overlay version (bigger markers relative to the map, no tooltips needed).
export function mountRouteMap(container, { compact = false } = {}) {
  const doc = container.ownerDocument;
  const id = `rm${++mountCount}`;
  const k = compact ? 1.5 : 1;
  container.classList.add('rmap-wrap');
  const svg = el(doc, 'svg', { viewBox: '0 0 100 100', class: `rmap${compact ? ' compact' : ''}`, role: 'img', 'aria-label': 'Minikart med ruten din' });
  container.replaceChildren(svg);
  const statics = el(doc, 'g', {}, svg);
  const dyn = el(doc, 'g', {}, svg);

  let map = null;
  let builtFor = null;
  let P = null;
  let towers = new Map();
  let runes = [];
  let pits = {};
  let last = null;

  // Dynamic layer: waves, stop line, path, stops, target, hero.
  const defs = el(doc, 'defs', {}, dyn);
  const marker = el(doc, 'marker', { id: `${id}-arrow`, viewBox: '0 0 10 10', refX: 5, refY: 5, markerWidth: 3.2, markerHeight: 3.2, orient: 'auto-start-reverse' }, defs);
  const arrowhead = el(doc, 'path', { d: 'M0,0 L10,5 L0,10 z', class: 'rm-arrowhead' }, marker);
  const waveLayer = el(doc, 'g', { class: 'rm-waves' }, dyn);
  const stopLine = el(doc, 'polyline', { class: 'rm-stopline', points: '' }, dyn);
  const pathBg = el(doc, 'polyline', { class: 'rm-path-bg', points: '' }, dyn);
  const path = el(doc, 'polyline', { class: 'rm-path', points: '', 'marker-end': `url(#${id}-arrow)` }, dyn);
  const stops = [];
  for (let i = 0; i < 4; i++) {
    const g = el(doc, 'g', { class: `rm-stop${i === 0 ? ' first' : ''}`, style: 'display:none' }, dyn);
    if (i === 0) el(doc, 'circle', { class: 'rm-pulse', r: 4.2 * k }, g);
    el(doc, 'circle', { class: 'rm-stop-dot', r: (i === 0 ? 2.8 : 2.3) * k }, g);
    const t = el(doc, 'text', { 'text-anchor': 'middle', y: (i === 0 ? 1.1 : 0.95) * k, style: `font-size:${(i === 0 ? 3.2 : 2.8) * k}px` }, g);
    t.textContent = String(i + 1);
    stops.push(g);
  }
  const hero = el(doc, 'g', { class: 'rm-hero' }, dyn);
  el(doc, 'circle', { class: 'rm-hero-halo', r: 4.4 * k }, hero);
  el(doc, 'circle', { class: 'rm-hero-dot', r: 2 * k }, hero);
  const waves = new Map();

  function buildStatic(team) {
    statics.replaceChildren();
    towers = new Map();
    runes = [];
    pits = {};
    const { min, max } = map.bounds;
    const span = max - min;
    P = (x, y) => [+(((x - min) / span) * 100).toFixed(2), +(100 - ((y - min) / span) * 100).toFixed(2)];
    const pts = (list) => list.map(([x, y]) => P(x, y).join(',')).join(' ');
    const own = team === 'dire' ? 'dire' : 'radiant';
    const side = (t) => (t === own ? 'own' : 'enemy');

    el(doc, 'rect', { x: 0, y: 0, width: 100, height: 100, rx: 3, class: 'rm-bg' }, statics);
    el(doc, 'polygon', { points: '0,0 0,100 100,100', class: `rm-half ${side('radiant')}` }, statics);
    el(doc, 'polygon', { points: '0,0 100,0 100,100', class: `rm-half ${side('dire')}` }, statics);
    for (const [t, poly] of Object.entries(map.bases)) el(doc, 'polygon', { points: pts(poly), class: `rm-base ${side(t)}` }, statics);
    el(doc, 'polyline', { points: pts(map.river.line), class: 'rm-river', 'stroke-width': ((map.river.width / span) * 100).toFixed(2) }, statics);
    for (const line of Object.values(map.lanes)) el(doc, 'polyline', { points: pts(line), class: 'rm-lane' }, statics);
    for (const a of map.jungle) {
      const [cx, cy] = P(...a.pos);
      const c = el(doc, 'circle', { cx, cy, r: ((a.r / span) * 100).toFixed(2), class: `rm-jungle ${side(a.team)}` }, statics);
      title(doc, c, `${a.team === own ? 'Egen' : 'Fiendens'} ${a.label} (omtrentlig)`);
    }
    for (const [t, p] of Object.entries(map.fountains)) {
      const [cx, cy] = P(...p);
      el(doc, 'circle', { cx, cy, r: 2.6, class: `rm-fountain ${side(t)}` }, statics);
    }
    for (const [t, p] of Object.entries(map.ancients)) {
      const [cx, cy] = P(...p);
      el(doc, 'rect', { x: cx - 1.8, y: cy - 1.8, width: 3.6, height: 3.6, rx: 0.8, class: `rm-ancient ${side(t)}`, transform: `rotate(45 ${cx} ${cy})` }, statics);
    }
    for (const [pit, p] of Object.entries(map.roshan.pits)) {
      const [cx, cy] = P(...p);
      const g = el(doc, 'g', { class: 'rm-rosh' }, statics);
      el(doc, 'circle', { cx, cy, r: 2.3 * k }, g);
      const t = el(doc, 'text', { x: cx, y: cy + 1 * k, 'text-anchor': 'middle', style: `font-size:${2.7 * k}px` }, g);
      t.textContent = 'R';
      title(doc, g, `Roshan-pit (${pit === 'top' ? 'topp' : 'bunn'}): ${map.roshan.day === pit ? 'dag' : 'natt'}`);
      pits[pit] = g;
    }
    for (const tm of map.tormentors) {
      const [cx, cy] = P(...tm.pos);
      const g = el(doc, 'g', { class: 'rm-torm' }, statics);
      el(doc, 'rect', { x: cx - 1.7 * k, y: cy - 1.7 * k, width: 3.4 * k, height: 3.4 * k, rx: 0.6 }, g);
      const t = el(doc, 'text', { x: cx, y: cy + 0.95 * k, 'text-anchor': 'middle', style: `font-size:${2.5 * k}px` }, g);
      t.textContent = 'T';
      title(doc, g, tm.label);
    }
    for (const o of map.outposts) {
      const [cx, cy] = P(...o.pos);
      title(doc, el(doc, 'circle', { cx, cy, r: 1.1, class: 'rm-outpost' }, statics), o.label);
    }
    for (const r of map.runes) {
      if (r.kind === 'bounty' && r.side !== own) continue; // only your own bounty runes matter
      const [cx, cy] = P(...r.pos);
      const g = el(doc, 'g', { class: `rm-rune ${r.kind}` }, statics);
      const ring = el(doc, 'circle', { cx, cy, r: 3 * k, class: 'rm-ring', pathLength: 100, transform: `rotate(-90 ${cx} ${cy})` }, g);
      el(doc, 'circle', { cx, cy, r: (r.kind === 'lotus' ? 1.1 : 1.4) * k, class: 'rm-rune-dot' }, g);
      title(doc, g, r.label);
      runes.push({ kind: r.kind, ring });
    }
    for (const [name, t] of Object.entries(map.towers)) {
      const [cx, cy] = P(...t.pos);
      const s = (t.tier === 4 ? 1.6 : 2) * (compact ? 1.25 : 1);
      const r = el(doc, 'rect', { x: cx - s / 2, y: cy - s / 2, width: s, height: s, rx: 0.4, class: `rm-tower ${side(t.team)}` }, statics);
      title(doc, r, `${t.team === own ? 'Eget' : 'Fiendens'} T${t.tier}-tårn${t.lane !== 'base' ? ` (${t.lane})` : ''}`);
      towers.set(name, r);
    }
    builtFor = own;
    last = null;
  }

  function placeStops(route) {
    const steps = route?.steps || [];
    stops.forEach((g, i) => {
      const s = steps[i];
      if (!s) return setAttr(g, 'style', 'display:none');
      const [x, y] = P(s.x, s.y);
      setAttr(g, 'style', '');
      setAttr(g, 'transform', `translate(${x} ${y})`);
      setAttr(g, 'class', `rm-stop${i === 0 ? ' first' : ''} ${KIND_CLASS[s.kind] || ''}`);
    });
    setAttr(stopLine, 'points', steps.length > 1 ? steps.map((s) => P(s.x, s.y).join(',')).join(' ') : '');
  }

  function placeWaves(list = []) {
    for (const w of list) {
      let g = waves.get(w.lane);
      if (!g) {
        g = el(doc, 'g', { class: 'rm-wave' }, waveLayer);
        el(doc, 'rect', { class: 'rm-wave-meet', x: -1.3 * k, y: -1.3 * k, width: 2.6 * k, height: 2.6 * k, transform: 'rotate(45)' }, g);
        el(doc, 'circle', { class: 'rm-wave-inc', r: 0.9 * k }, g);
        title(doc, g, 'Bølge (estimat)');
        waves.set(w.lane, g);
      }
      const [mx, my] = P(w.x, w.y);
      const [nx, ny] = P(w.nx, w.ny);
      setAttr(g.children[0], 'transform', `translate(${mx} ${my}) rotate(45)`);
      setAttr(g.children[1], 'cx', nx);
      setAttr(g.children[1], 'cy', ny);
      g.children[1].style.display = Math.hypot(mx - nx, my - ny) < 1.5 ? 'none' : '';
      setAttr(g, 'class', `rm-wave ${w.source === 'minimap' ? 'seen' : ''}`);
    }
  }

  return async function update(state) {
    const route = state?.route;
    if (!map) {
      map = await loadMap();
      if (!map) return;
    }
    const team = state?.team === 'dire' ? 'dire' : 'radiant';
    if (builtFor !== team) buildStatic(team);

    // Towers that are down (GSI buildings) turn grey.
    const deadKey = (route?.deadTowers || []).join(',');
    if (!last || last.dead !== deadKey) {
      const dead = new Set(route?.deadTowers || []);
      for (const [name, r] of towers) r.classList.toggle('dead', dead.has(name));
    }

    // Rune spots get a ring that fills up during the last 30 s.
    const timers = new Map((state?.timers || []).map((t) => [t.id, t]));
    for (const r of runes) {
      const t = timers.get(RUNE_TIMER[r.kind]);
      const soon = t && t.in <= 30;
      r.ring.classList.toggle('soon', !!soon);
      setAttr(r.ring, 'stroke-dasharray', soon ? `${Math.round((1 - t.in / 30) * 100)} 100` : '0 100');
    }
    const active = state?.daytime === false ? map.roshan.night : map.roshan.day;
    for (const [pit, g] of Object.entries(pits)) g.classList.toggle('active', pit === active);

    placeWaves(route?.waves);
    if (!route?.target) {
      setAttr(path, 'points', '');
      setAttr(pathBg, 'points', '');
      hero.style.display = route?.from ? '' : 'none';
      placeStops(null);
    } else {
      const pts = route.path.map((p) => P(p.x, p.y).join(',')).join(' ');
      setAttr(path, 'points', pts);
      setAttr(pathBg, 'points', pts);
      setAttr(path, 'class', `rm-path ${KIND_CLASS[route.target.kind] || ''}`);
      setAttr(arrowhead, 'class', `rm-arrowhead ${KIND_CLASS[route.target.kind] || ''}`);
      placeStops(route);
    }
    if (route?.from) {
      const [x, y] = P(route.from.x, route.from.y);
      hero.style.display = '';
      hero.style.transform = `translate(${x}px, ${y}px)`;
      setAttr(hero, 'class', `rm-hero${route.respawn ? ' dead' : ''}`);
    } else hero.style.display = 'none';
    last = { dead: deadKey };
  };
}

// The list of stops under (or next to) the map.
export function stepsHtml(route, { compact = false, clock = 0 } = {}) {
  if (!route?.target) return `<div class="rm-empty">${compact ? 'Ingen rute ennå.' : 'Ruten vises når kampen er i gang.'}</div>`;
  const when = (s) => (s.at != null ? ` <span class="rm-at">${s.at <= clock ? 'nå' : fmtClock(s.at)}</span>` : '');
  const t = route.target;
  const steps = route.steps || [];
  if (compact) {
    return `<div class="rm-head ${KIND_CLASS[t.kind] || ''}"><b>${esc(route.headline || t.label)}</b>${when(t)}</div>
      <div class="rm-why">${esc(route.reason || '')}</div>
      ${steps
        .slice(1, 3)
        .map((s, i) => `<div class="rm-next"><span class="rm-n">${i + 2}</span><span>${esc(s.label)}${when(s)}</span></div>`)
        .join('')}`;
  }
  return `<ol class="rm-steps">${steps
    .map(
      (s, i) => `<li class="${i === 0 ? 'first' : ''} ${KIND_CLASS[s.kind] || ''}"><span class="rm-n">${i + 1}</span><div><div class="rm-label">${esc(i === 0 ? route.headline || s.label : s.label)}${when(s)}</div><div class="rm-why">${esc(s.why || '')}</div></div></li>`,
    )
    .join('')}</ol>`;
}
