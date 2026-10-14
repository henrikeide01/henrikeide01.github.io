// Small SVG charts for the post-game report: a line chart with crosshair tooltip and a minimap of deaths.
import { fmtClock } from './common.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, parent) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.append(n);
  return n;
};

function niceMax(v) {
  if (v <= 0) return 10;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

const compact = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}K`.replace('.0K', 'K') : String(Math.round(v)));

// Fixed tooltip shared by all charts. Values are set with textContent.
function tooltip() {
  return document.getElementById('chart-tip');
}

function showTip(x, y, rows, title) {
  const tip = tooltip();
  if (!tip) return;
  tip.replaceChildren();
  const head = document.createElement('div');
  head.className = 'muted';
  head.textContent = title;
  tip.append(head);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'row';
    const key = document.createElement('i');
    if (r.ref) key.style.background = 'var(--muted)';
    const val = document.createElement('b');
    val.textContent = r.value;
    const name = document.createElement('span');
    name.className = 'muted';
    name.textContent = r.name;
    row.append(key, val, name);
    tip.append(row);
  }
  tip.classList.remove('hidden');
  const w = tip.offsetWidth;
  tip.style.left = `${Math.min(window.innerWidth - w - 8, x + 14)}px`;
  tip.style.top = `${y + 14}px`;
}

const hideTip = () => tooltip()?.classList.add('hidden');

// opts: { points: [[t, v]], name, ref: { name, at: (t) => value }, yFmt }
export function lineChart(container, { points, name, ref = null, yFmt = compact }) {
  container.replaceChildren();
  if (!points?.length) return;
  const W = 600;
  const H = 220;
  const m = { l: 40, r: 52, t: 10, b: 24 };
  const maxT = Math.max(60, points[points.length - 1][0]);
  const maxV = niceMax(Math.max(...points.map((p) => p[1]), ref ? ref.at(maxT) : 0) * 1.05);
  const x = (t) => m.l + (t / maxT) * (W - m.l - m.r);
  const y = (v) => H - m.b - (v / maxV) * (H - m.t - m.b);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': name });
  const grid = el('g', { class: 'grid' }, svg);
  const axis = el('g', { class: 'axis' }, svg);
  for (let i = 0; i <= 4; i++) {
    const v = (maxV / 4) * i;
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, grid);
    const t = el('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, axis);
    t.textContent = yFmt(v);
  }
  const step = maxT > 2400 ? 600 : 300;
  for (let t = 0; t <= maxT; t += step) {
    const lbl = el('text', { x: x(t), y: H - 6, 'text-anchor': 'middle' }, axis);
    lbl.textContent = `${Math.round(t / 60)}:00`;
  }

  if (ref) {
    const t0 = 30;
    // No end label here: it would collide with the series' end label, and the legend names it.
    el('line', { class: 'ref', x1: x(t0), y1: y(ref.at(t0)), x2: x(maxT), y2: y(ref.at(maxT)) }, svg);
  }

  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  el('path', { class: 'area', d: `${d}L${x(points[points.length - 1][0])},${y(0)}L${x(points[0][0])},${y(0)}Z` }, svg);
  el('path', { class: 'series', d }, svg);
  const last = points[points.length - 1];
  el('circle', { class: 'end', cx: x(last[0]), cy: y(last[1]), r: 4.5 }, svg);
  const endLbl = el('text', { class: 'lbl', x: x(last[0]) + 8, y: y(last[1]) - 6 }, svg);
  endLbl.textContent = yFmt(last[1]);

  const cross = el('line', { class: 'cross', y1: m.t, y2: H - m.b, visibility: 'hidden' }, svg);
  const hit = el('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent', tabindex: 0 }, svg);
  const nearest = (clientX) => {
    const box = svg.getBoundingClientRect();
    const t = ((clientX - box.left) / box.width * W - m.l) / (W - m.l - m.r) * maxT;
    return points.reduce((best, p) => (Math.abs(p[0] - t) < Math.abs(best[0] - t) ? p : best), points[0]);
  };
  const show = (p, cx, cy) => {
    cross.setAttribute('x1', x(p[0]));
    cross.setAttribute('x2', x(p[0]));
    cross.setAttribute('visibility', 'visible');
    const rows = [{ name, value: yFmt(p[1]) }];
    if (ref) rows.push({ name: ref.name, value: yFmt(ref.at(p[0])), ref: true });
    showTip(cx, cy, rows, fmtClock(p[0]));
  };
  hit.addEventListener('pointermove', (e) => show(nearest(e.clientX), e.clientX, e.clientY));
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    hideTip();
  });
  hit.addEventListener('focus', () => {
    const b = svg.getBoundingClientRect();
    show(last, b.right - 120, b.top + 20);
  });
  hit.addEventListener('blur', hideTip);
  container.append(svg);
}

// Deaths drawn on a simple Dota map (Radiant bottom-left, Dire top-right).
export function deathMap(container, deaths, team) {
  container.replaceChildren();
  const svg = el('svg', { viewBox: '0 0 100 100', class: 'minimap', role: 'img', 'aria-label': 'Kart over hvor du døde' });
  const P = (x, y) => [((x + 8200) / 16400) * 100, 100 - ((y + 8200) / 16400) * 100];
  const radiantOwn = team !== 'dire';
  el('rect', { x: 0, y: 0, width: 100, height: 100, rx: 4, fill: '#0e141c' }, svg);
  el('polygon', { points: '0,0 0,100 100,100', fill: radiantOwn ? 'rgba(90,166,255,0.10)' : 'rgba(240,88,78,0.08)' }, svg);
  el('polygon', { points: '0,0 100,0 100,100', fill: radiantOwn ? 'rgba(240,88,78,0.08)' : 'rgba(90,166,255,0.10)' }, svg);
  el('line', { x1: 0, y1: 0, x2: 100, y2: 100, stroke: '#2f6b9a', 'stroke-width': 1.6, opacity: 0.6 }, svg);
  const lane = { fill: 'none', stroke: '#3a4658', 'stroke-width': 1.2, 'stroke-linejoin': 'round' };
  el('polyline', { points: '10,90 10,10 90,10', ...lane }, svg);
  el('polyline', { points: '10,90 90,90 90,10', ...lane }, svg);
  el('line', { x1: 10, y1: 90, x2: 90, y2: 10, ...lane }, svg);
  el('circle', { cx: 9, cy: 91, r: 6, fill: radiantOwn ? '#1d3b5c' : '#4a1f1f' }, svg);
  el('circle', { cx: 91, cy: 9, r: 6, fill: radiantOwn ? '#4a1f1f' : '#1d3b5c' }, svg);
  const own = el('text', { class: 'zone-label', x: 22, y: 76 }, svg);
  own.textContent = 'Din side';
  const enemy = el('text', { class: 'zone-label', x: 62, y: 28 }, svg);
  enemy.textContent = 'Fiendens side';
  if (!radiantOwn) {
    own.setAttribute('x', 62);
    own.setAttribute('y', 28);
    enemy.setAttribute('x', 18);
    enemy.setAttribute('y', 76);
  }

  const placed = [];
  for (const d of deaths) {
    if (typeof d.x !== 'number' || typeof d.y !== 'number') continue;
    let [cx, cy] = P(d.x, d.y);
    // Nudge markers that would sit on top of each other so every number stays readable.
    while (placed.some(([px, py]) => Math.hypot(px - cx, py - cy) < 6)) {
      cx += 5;
      cy -= 2;
    }
    placed.push([cx, cy]);
    const g = el('g', { tabindex: 0 }, svg);
    el('circle', { class: 'death', cx, cy, r: 3.4 }, g);
    const t = el('text', { x: cx, y: cy + 1.6, 'text-anchor': 'middle', style: 'font-size:4.4px' }, g);
    t.textContent = d.n;
    const hit = el('circle', { class: 'death-hit', cx, cy, r: 7 }, g);
    const tipRows = [{ name: d.label || '', value: `Dødsfall ${d.n}` }, ...d.why.map((w) => ({ name: w, value: '•', ref: true }))];
    hit.addEventListener('pointermove', (e) => showTip(e.clientX, e.clientY, tipRows, fmtClock(d.t)));
    hit.addEventListener('pointerleave', hideTip);
    g.addEventListener('focus', () => {
      const b = g.getBoundingClientRect();
      showTip(b.right, b.top, tipRows, fmtClock(d.t));
    });
    g.addEventListener('blur', hideTip);
  }
  container.append(svg);
}

// Score per match (newest last) as thin columns with the value on the cap.
export function scoreColumns(container, rows) {
  container.replaceChildren();
  if (!rows.length) return;
  const W = 420;
  const H = 150;
  const m = { l: 8, r: 8, t: 18, b: 22 };
  const slot = (W - m.l - m.r) / rows.length;
  const bw = Math.min(24, slot * 0.6);
  const y = (v) => H - m.b - (v / 100) * (H - m.t - m.b);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Score per kamp' });
  el('line', { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0), stroke: '#1f2a38' }, svg);
  rows.forEach((r, i) => {
    const cx = m.l + slot * i + slot / 2;
    const top = y(r.score);
    const h = y(0) - top;
    el('path', { d: `M${cx - bw / 2},${y(0)}V${top + 4}Q${cx - bw / 2},${top} ${cx - bw / 2 + 4},${top}H${cx + bw / 2 - 4}Q${cx + bw / 2},${top} ${cx + bw / 2},${top + 4}V${y(0)}Z`, fill: '#3987e5', opacity: h > 0 ? 1 : 0 }, svg);
    const v = el('text', { class: 'lbl', x: cx, y: top - 5, 'text-anchor': 'middle' }, svg);
    v.textContent = `${r.score}`;
    const g = el('text', { class: 'lbl', x: cx, y: H - 6, 'text-anchor': 'middle' }, svg);
    g.textContent = r.grade;
    const hit = el('rect', { x: cx - slot / 2, y: 0, width: slot, height: H, fill: 'transparent' }, svg);
    const rowsTip = [{ name: r.result === 'win' ? 'Seier' : r.result === 'loss' ? 'Tap' : '', value: `${r.score}/100 (${r.grade})` }];
    hit.addEventListener('pointermove', (e) => showTip(e.clientX, e.clientY, rowsTip, r.hero?.dname || ''));
    hit.addEventListener('pointerleave', hideTip);
  });
  container.classList.add('chart');
  container.append(svg);
}
