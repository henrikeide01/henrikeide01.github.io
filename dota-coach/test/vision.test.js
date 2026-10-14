// Tests for the top bar hero detector (src/vision/detect.js). No real hero art or screenshots are available
// offline, so everything here is synthetic: ~130 procedural "hero" images and fake Dota screens built from them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resize, crop, prepareTemplates, detectTopBar, learnLayout } from '../src/vision/detect.js';

// ---------------------------------------------------------------------------------------------------------------
// Synthetic data

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// Gaussian noise: a table filled once, then read in sequence.
const NOISE = (() => {
  const rand = mulberry32(99);
  const t = new Float32Array(1 << 16);
  for (let i = 0; i < t.length; i++) t[i] = Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  return t;
})();

const TW = 256;
const TH = 144;
const colour = (rand) => [rand() * 255, rand() * 255, rand() * 255];

function shape(rand) {
  return {
    kind: ['ellipse', 'rect', 'stripe', 'ring'][Math.floor(rand() * 4)],
    x: rand() * TW,
    y: rand() * TH,
    a: 12 + rand() * 55,
    b: 10 + rand() * 35,
    rot: rand() * Math.PI,
    col: colour(rand),
    alpha: 0.65 + rand() * 0.35,
    soft: 1 + rand() * 4,
  };
}

// A hero image: a smooth two-colour gradient with a wave on top, and 3-7 soft shapes.
function heroSpec(rand) {
  return {
    c0: colour(rand),
    c1: colour(rand),
    angle: rand() * 2 * Math.PI,
    wave: { fx: 0.5 + rand() * 2.5, fy: 0.5 + rand() * 2, phase: rand() * 6.28, amp: 10 + rand() * 25, col: [rand(), rand(), rand()] },
    shapes: Array.from({ length: 3 + Math.floor(rand() * 5) }, () => shape(rand)),
  };
}

// A look-alike of another hero: same background and shapes, one shape moved or recoloured, one shape added.
function lookAlike(spec, rand) {
  const s = structuredClone(spec);
  const nudge = (c) => c.map((v) => clamp255(v + (rand() - 0.5) * 30));
  s.c0 = nudge(s.c0);
  s.c1 = nudge(s.c1);
  const i = Math.floor(rand() * s.shapes.length);
  if (rand() < 0.5) {
    s.shapes[i].x += (rand() < 0.5 ? -1 : 1) * (18 + rand() * 20);
    s.shapes[i].y += (rand() < 0.5 ? -1 : 1) * (8 + rand() * 12);
  } else {
    s.shapes[i].col = colour(rand);
  }
  s.shapes.push(shape(rand));
  return s;
}

function renderHero(spec) {
  const data = new Uint8Array(TW * TH * 4);
  const ca = Math.cos(spec.angle);
  const sa = Math.sin(spec.angle);
  const shapes = spec.shapes.map((s) => ({ ...s, c: Math.cos(s.rot), s: Math.sin(s.rot) }));
  const { wave } = spec;
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      const t = Math.min(1, Math.max(0, ((x - TW / 2) * ca + (y - TH / 2) * sa) / TW + 0.5));
      const w = wave.amp * Math.sin((wave.fx * x * 2 * Math.PI) / TW + (wave.fy * y * 2 * Math.PI) / TH + wave.phase);
      const px = [0, 1, 2].map((k) => spec.c0[k] + (spec.c1[k] - spec.c0[k]) * t + w * wave.col[k]);
      for (const s of shapes) {
        const dx = x - s.x;
        const dy = y - s.y;
        const u = dx * s.c + dy * s.s;
        const v = -dx * s.s + dy * s.c;
        let d; // signed distance to the shape's edge, negative inside
        if (s.kind === 'ellipse') d = (Math.hypot(u / s.a, v / s.b) - 1) * Math.min(s.a, s.b);
        else if (s.kind === 'rect') d = Math.max(Math.abs(u) - s.a * 0.7, Math.abs(v) - s.b * 0.7);
        else if (s.kind === 'stripe') d = Math.max(Math.abs(v) - s.b / 5, Math.abs(u) - s.a * 1.5);
        else d = Math.abs(Math.hypot(u, v) - s.a) - 4;
        const cov = Math.min(1, 0.5 - d / s.soft);
        if (cov <= 0) continue;
        for (let k = 0; k < 3; k++) px[k] += (s.col[k] - px[k]) * cov * s.alpha;
      }
      const o = (y * TW + x) * 4;
      data[o] = clamp255(px[0]);
      data[o + 1] = clamp255(px[1]);
      data[o + 2] = clamp255(px[2]);
      data[o + 3] = 255;
    }
  }
  return { width: TW, height: TH, data, format: 'rgba' };
}

// 130 heroes; every 8th is a look-alike of the one before it (hero_007 ~ hero_006, hero_015 ~ hero_014, ...).
function makeHeroes(count = 130, seed = 7) {
  const rand = mulberry32(seed);
  const specs = [];
  for (let i = 0; i < count; i++) specs.push(i % 8 === 7 ? lookAlike(specs[i - 1], rand) : heroSpec(rand));
  return specs.map((s, i) => ({ name: `hero_${String(i).padStart(3, '0')}`, image: renderHero(s) }));
}

function put(scr, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= scr.width || y >= scr.height) return;
  const o = (y * scr.width + x) * 4;
  scr.data[o] = clamp255(r);
  scr.data[o + 1] = clamp255(g);
  scr.data[o + 2] = clamp255(b);
  scr.data[o + 3] = 255;
}

function fillRect(scr, x, y, w, h, col, noise = 0, rand = Math.random) {
  let ni = Math.floor(rand() * NOISE.length);
  for (let j = Math.max(0, Math.round(y)); j < Math.min(scr.height, Math.round(y + h)); j++) {
    for (let i = Math.max(0, Math.round(x)); i < Math.min(scr.width, Math.round(x + w)); i++) {
      const n = noise ? NOISE[ni++ & 0xffff] * noise : 0;
      put(scr, i, j, col[0] + n, col[1] + n, col[2] + n);
    }
  }
}

// An "8" made of thin bars (clock digits, respawn timers).
function digit(scr, x, y, w, h, col) {
  const t = Math.max(1, Math.round(h / 8));
  fillRect(scr, x, y, w, t, col);
  fillRect(scr, x, y + h / 2 - t / 2, w, t, col);
  fillRect(scr, x, y + h - t, w, t, col);
  fillRect(scr, x, y, t, h, col);
  fillRect(scr, x + w - t, y, t, h, col);
}

function bilinear(img, u, v, out) {
  const x = Math.min(img.width - 1.001, Math.max(0, u - 0.5));
  const y = Math.min(img.height - 1.001, Math.max(0, v - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const d = img.data;
  const i00 = (y0 * img.width + x0) * 4;
  const i01 = i00 + img.width * 4;
  for (let c = 0; c < 3; c++) {
    out[c] = (d[i00 + c] * (1 - fx) + d[i00 + 4 + c] * fx) * (1 - fy) + (d[i01 + c] * (1 - fx) + d[i01 + 4 + c] * fx) * fy;
  }
}

// Draws a hero image into a w x h portrait the way the game might: cropped differently (5% zoom, slightly off
// centre), scaled with supersampled bilinear filtering (not the detector's own resampler), brightness and contrast
// changed, noise added. Dead: grey, darker, and a respawn timer on top.
function drawPortrait(scr, img, x, y, w, h, rand, dead) {
  const zoom = 1.05;
  const sw = img.width / zoom;
  const sh = img.height / zoom;
  const sx = (img.width - sw) / 2 + (rand() - 0.5) * 0.02 * img.width;
  const sy = (img.height - sh) / 2 + (rand() - 0.5) * 0.02 * img.height;
  const a = 0.85 + rand() * 0.3;
  const b = (rand() - 0.5) * 24;
  const px = [0, 0, 0];
  const SS = 3;
  let ni = Math.floor(rand() * NOISE.length);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const c = [0, 0, 0];
      for (let q = 0; q < SS; q++) {
        for (let p = 0; p < SS; p++) {
          bilinear(img, sx + ((i + (p + 0.5) / SS) / w) * sw, sy + ((j + (q + 0.5) / SS) / h) * sh, px);
          for (let k = 0; k < 3; k++) c[k] += px[k] / (SS * SS);
        }
      }
      for (let k = 0; k < 3; k++) c[k] = a * (c[k] - 128) + 128 + b;
      if (dead) c.fill((0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) * 0.55);
      put(scr, x + i, y + j, c[0] + NOISE[ni++ & 0xffff] * 4, c[1] + NOISE[ni++ & 0xffff] * 4, c[2] + NOISE[ni++ & 0xffff] * 4);
    }
  }
  if (dead) {
    const dw = Math.max(3, Math.round(w * 0.13));
    const dh = Math.max(5, Math.round(h * 0.4));
    digit(scr, Math.round(x + w / 2 - dw - 1), Math.round(y + h / 2 - dh / 2), dw, dh, [215, 215, 215]);
    digit(scr, Math.round(x + w / 2 + 1), Math.round(y + h / 2 - dh / 2), dw, dh, [215, 215, 215]);
  }
}

// A fake screen: dark textured "game world" with noise, a top bar with a clock in the middle and 5 + 5 portrait
// slots (with health and mana bars) left and right of it. slots: 10 hero images or null (empty), left side first.
// scale: portrait height / screen height. Returns the screen (rgba) and the slot rectangles.
function makeScreen(W, H, { slots, scale = 0.033, gapFrac = 0.07, clockFrac = 1.5, dead = -1, seed = 1 }) {
  const rand = mulberry32(seed);
  const scr = { width: W, height: H, data: new Uint8Array(W * H * 4), format: 'rgba' };
  // Game world: a coarse grid of dark random colours, interpolated, plus noise. Blobs about portrait-sized, which
  // makes it a hard background for a detector of smooth images.
  const cell = Math.max(16, Math.round(H / 30));
  const gw = Math.ceil(W / cell) + 2;
  const gh = Math.ceil(H / cell) + 2;
  const grid = Array.from({ length: gw * gh }, () => {
    const base = 20 + rand() * 50;
    return [base * (0.7 + rand() * 0.6), base * (0.8 + rand() * 0.5), base * (0.5 + rand() * 0.5)];
  });
  let ni = Math.floor(rand() * NOISE.length);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y / cell);
    const fy = y / cell - y0;
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x / cell);
      const fx = x / cell - x0;
      const [a, b, c, d] = [grid[y0 * gw + x0], grid[y0 * gw + x0 + 1], grid[(y0 + 1) * gw + x0], grid[(y0 + 1) * gw + x0 + 1]];
      const o = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) {
        scr.data[o + k] = clamp255((a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (c[k] * (1 - fx) + d[k] * fx) * fy + NOISE[ni++ & 0xffff] * 6);
      }
      scr.data[o + 3] = 255;
    }
  }

  const ph = Math.round(scale * H);
  const pw = Math.round((ph * 16) / 9);
  const gap = Math.max(2, Math.round(gapFrac * pw));
  const pitch = pw + gap;
  const clockW = Math.round(clockFrac * pw);
  const cx = W / 2;
  const top = Math.max(1, Math.round(0.002 * H));
  const barH = Math.round(ph * 1.45);
  const barHalf = clockW / 2 + 5 * pitch + gap * 3;
  fillRect(scr, cx - barHalf, 0, barHalf * 2, barH, [24, 28, 34], 3, rand);
  fillRect(scr, cx - clockW / 2, 0, clockW, barH * 1.3, [44, 48, 58], 3, rand);
  const dh = Math.round(ph * 0.45);
  const dw = Math.max(3, Math.round(dh * 0.55));
  for (let i = 0; i < 4; i++) digit(scr, Math.round(cx - 2 * (dw + 2) + i * (dw + 2) + (i > 1 ? 3 : 0)), Math.round(barH * 0.75), dw, dh, [230, 230, 220]);
  fillRect(scr, cx - ph * 0.2, top, ph * 0.4, ph * 0.4, [230, 200, 80]); // day/night sun

  const rects = [];
  for (let k = 0; k < 10; k++) {
    const left = k < 5;
    const slot = k % 5;
    const x = Math.round(left ? cx - clockW / 2 - (5 - slot) * pitch : cx + clockW / 2 + gap + slot * pitch);
    rects.push({ x, y: top, w: pw, h: ph, side: left ? 'left' : 'right', slot });
    const hp = Math.max(2, Math.round(ph * 0.09));
    fillRect(scr, x, top + ph + 1, pw, hp, [40, 170, 60]);
    fillRect(scr, x, top + ph + 2 + hp, pw, Math.max(2, Math.round(ph * 0.07)), [50, 90, 200]);
    if (slots[k]) drawPortrait(scr, slots[k], x, top, pw, ph, rand, k === dead);
    else fillRect(scr, x, top, pw, ph, [16, 18, 22], 2, rand);
  }
  return { screen: scr, rects };
}

function toBgra(img) {
  const data = new Uint8Array(img.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = img.data[i + 2];
    data[i + 2] = img.data[i];
  }
  return { ...img, data, format: 'bgra' };
}

// ---------------------------------------------------------------------------------------------------------------
// Shared fixtures

const heroes = makeHeroes();
const names = heroes.map((h) => h.name);
const t0 = performance.now();
const templates = prepareTemplates(heroes);
const prepareMs = Math.round(performance.now() - t0);

// 10 different heroes for one match; with a look-alike pair (e.g. hero_014 + hero_015) in it when pair is set.
function pickHeroes(seed, pair = false) {
  const rand = mulberry32(seed);
  const pick = [];
  if (pair) {
    const p = 8 * Math.floor(rand() * 16) + 6;
    pick.push(p, p + 1);
  }
  while (pick.length < 10) {
    const i = Math.floor(rand() * heroes.length);
    if (!pick.includes(i)) pick.push(i);
  }
  return pick.sort(() => rand() - 0.5);
}

// The detection must name exactly the expected heroes (null = empty slot), each on its side and in its slot,
// listed left to right.
function assertHeroes(result, expected, label) {
  const want = [];
  expected.forEach((i, k) => {
    if (i != null) want.push({ name: names[i], side: k < 5 ? 'left' : 'right', slot: k % 5 });
  });
  const got = result.heroes.map((h) => ({ name: h.name, side: h.side, slot: h.slot }));
  assert.deepEqual(got, want, `${label}: got ${JSON.stringify(got)}`);
  const xs = result.heroes.map((h) => h.x);
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b), `${label}: heroes not listed left to right`);
}

// In-game screens at every supported shape; portrait heights between the searched sizes on purpose.
const SCREENS = [
  { W: 1280, H: 720, scale: 0.034 },
  { W: 1920, H: 1080, scale: 0.033 },
  { W: 2560, H: 1440, scale: 0.0315 },
  { W: 1920, H: 1200, scale: 0.0355 },
  { W: 2560, H: 1080, scale: 0.032 },
  { W: 3440, H: 1440, scale: 0.0375 },
];
const inGame = SCREENS.map((s, n) => {
  const pick = pickHeroes(100 + n, n % 2 === 0);
  const dead = (n * 3 + 2) % 10;
  return { ...s, pick, dead, ...makeScreen(s.W, s.H, { slots: pick.map((i) => heroes[i].image), scale: s.scale, dead, seed: 200 + n }) };
});
const fullResults = new Map();

// ---------------------------------------------------------------------------------------------------------------
// Tests

test('crop keeps the pixels and the format', () => {
  const img = { width: 4, height: 3, data: new Uint8Array(48).map((_, i) => i), format: 'bgra' };
  const c = crop(img, 1, 1, 2, 2);
  assert.equal(c.width, 2);
  assert.equal(c.height, 2);
  assert.equal(c.format, 'bgra');
  assert.deepEqual([...c.data.subarray(0, 4)], [20, 21, 22, 23]); // pixel (1, 1)
  assert.deepEqual([...c.data.subarray(12, 16)], [40, 41, 42, 43]); // pixel (2, 2)
  const clipped = crop(img, 3, 2, 5, 5);
  assert.equal(clipped.width, 1);
  assert.equal(clipped.height, 1);
});

test('resize averages areas, handles bgra and mild enlarging', () => {
  // 4x4 bgra image, each 2x2 block one colour: shrinking to 2x2 must give the block colours as rgba.
  const blocks = [
    [10, 20, 30],
    [40, 50, 60],
    [70, 80, 90],
    [200, 150, 100],
  ];
  const data = new Uint8Array(64);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const [r, g, b] = blocks[(y >> 1) * 2 + (x >> 1)];
      data.set([b, g, r, 255], (y * 4 + x) * 4);
    }
  }
  const small = resize({ width: 4, height: 4, data, format: 'bgra' }, 2, 2);
  assert.equal(small.format, 'rgba');
  for (let i = 0; i < 4; i++) assert.deepEqual([...small.data.subarray(i * 4, i * 4 + 4)], [...blocks[i], 255]);
  // Shrinking by a non-integer factor keeps the average.
  const odd = resize({ width: 4, height: 4, data, format: 'bgra' }, 3, 1);
  assert.equal(odd.width, 3);
  const mean = (c) => (blocks[0][c] + blocks[1][c] + blocks[2][c] + blocks[3][c]) / 4;
  const got = [0, 1, 2].map((c) => (odd.data[c] + odd.data[4 + c] + odd.data[8 + c]) / 3);
  [0, 1, 2].forEach((c) => assert.ok(Math.abs(got[c] - mean(c)) < 1.5, `channel ${c}: ${got[c]} vs ${mean(c)}`));
  // Enlarging 2x2 -> 3x3 interpolates between the corners.
  const big = resize(small, 3, 3);
  assert.deepEqual([...big.data.subarray(0, 3)], blocks[0]);
  const centre = big.data.subarray(16, 19);
  [0, 1, 2].forEach((c) => assert.ok(Math.abs(centre[c] - mean(c)) <= 1));
});

test('templates are prepared for every hero', () => {
  console.log(`# prepareTemplates: ${heroes.length} heroes in ${prepareMs} ms`);
  assert.equal(templates.count, heroes.length);
  assert.deepEqual(templates.names, names);
  assert.ok(Math.abs(templates.aspect - 16 / 9) < 1e-9);
  assert.throws(() => prepareTemplates([]));
  assert.throws(() => detectTopBar(inGame[0].screen, {}), /prepareTemplates/);
});

for (const s of inGame) {
  test(`in game ${s.W}x${s.H}: all 10 heroes, sides and order (one dead)`, () => {
    const r = detectTopBar(s.screen, templates);
    console.log(`# full search ${s.W}x${s.H}: ${r.ms} ms, scores ${r.heroes.map((h) => h.score).join(' ')}`);
    assertHeroes(r, s.pick, `${s.W}x${s.H}`);
    assert.equal(r.searched, 'full');
    assert.ok(Math.abs(r.scale - s.scale * 1.05) < 0.004, `scale ${r.scale}`); // boxes cover the 5% zoomed art
    assert.ok(r.ms < 4000, `full search took ${r.ms} ms`);
    fullResults.set(`${s.W}x${s.H}`, r);
  });
}

test('an empty top bar gives no heroes', () => {
  for (const [W, H] of [
    [1920, 1080],
    [3440, 1440],
  ]) {
    const { screen } = makeScreen(W, H, { slots: Array(10).fill(null), seed: 300 + W });
    const r = detectTopBar(screen, templates);
    console.log(`# empty bar ${W}x${H}: ${r.ms} ms`);
    assert.deepEqual(r.heroes, [], `${W}x${H}: ${JSON.stringify(r.heroes)}`);
  }
});

test('draft screen with 3 + 2 picks finds exactly those, in their slots', () => {
  const pick = pickHeroes(400);
  const cases = [
    { W: 1920, H: 1080, slots: [1, 2, 4, 5, 8], scale: 0.05 },
    { W: 2560, H: 1440, slots: [0, 3, 4, 7, 9], scale: 0.052 },
  ];
  for (const c of cases) {
    const expected = Array(10).fill(null);
    c.slots.forEach((k, j) => (expected[k] = pick[j]));
    const { screen } = makeScreen(c.W, c.H, {
      slots: expected.map((i) => (i == null ? null : heroes[i].image)),
      scale: c.scale,
      gapFrac: 0.12,
      clockFrac: 2.2,
      seed: 500 + c.W,
    });
    const r = detectTopBar(screen, templates);
    console.log(`# draft ${c.W}x${c.H}: ${r.ms} ms`);
    assertHeroes(r, expected, `draft ${c.W}x${c.H}`);
  }
});

test('a single early pick is found without a row to check against', () => {
  const expected = Array(10).fill(null);
  expected[7] = 42;
  const { screen } = makeScreen(1920, 1080, { slots: expected.map((i) => (i == null ? null : heroes[i].image)), scale: 0.05, seed: 600 });
  const r = detectTopBar(screen, templates);
  assert.equal(r.heroes.length, 1, JSON.stringify(r.heroes));
  assert.equal(r.heroes[0].name, names[42]);
  assert.equal(r.heroes[0].side, 'right');
});

test('bgra input gives the same answer', () => {
  const s = inGame[1];
  const r = detectTopBar(toBgra(s.screen), templates);
  assertHeroes(r, s.pick, 'bgra');
});

test('learnLayout + layout path: same answer, fast, empty slots reported', () => {
  for (const s of [inGame[1], inGame[5]]) {
    const key = `${s.W}x${s.H}`;
    const full = fullResults.get(key) || detectTopBar(s.screen, templates);
    const layout = learnLayout(full);
    assert.ok(layout, `${key}: no layout learned`);
    assert.equal(layout.slots.length, 10);
    assert.deepEqual(
      layout.slots.map((sl) => `${sl.side}${sl.slot}`),
      ['left0', 'left1', 'left2', 'left3', 'left4', 'right0', 'right1', 'right2', 'right3', 'right4'],
    );

    // Same frame: same heroes, through the fast path.
    const again = detectTopBar(s.screen, templates, { layout });
    assert.equal(again.searched, 'layout');
    assertHeroes(again, s.pick, `${key} layout`);
    assert.deepEqual(again.missing, []);

    // A later frame: new noise, another hero dead, one hero gone (disconnected/empty slot), bgra.
    const slots = s.pick.map((i) => heroes[i].image);
    slots[6] = null;
    const next = makeScreen(s.W, s.H, { slots, scale: s.scale, dead: (s.dead + 5) % 10, seed: 700 + s.W });
    const times = [];
    let r;
    for (let i = 0; i < 3; i++) {
      r = detectTopBar(toBgra(next.screen), templates, { layout });
      times.push(r.ms);
    }
    console.log(`# layout path ${key}: ${times.join(', ')} ms (full search was ${full.ms} ms)`);
    const expected = [...s.pick];
    expected[6] = null;
    assert.equal(r.searched, 'layout');
    assertHeroes(r, expected, `${key} next frame`);
    assert.deepEqual(r.missing, [{ side: 'right', slot: 1 }]);
    assert.ok(Math.min(...times) < 500, `layout path took ${times} ms`);
  }
});

test('a layout is only used for its own resolution, and only learned from a good detection', () => {
  const s = inGame[1];
  const layout = learnLayout(fullResults.get('1920x1080') || detectTopBar(s.screen, templates));
  const other = inGame[3]; // 1920x1200
  const r = detectTopBar(other.screen, templates, { layout });
  assert.equal(r.searched, 'full');
  assertHeroes(r, other.pick, 'fallback');

  // A stale layout (all slots empty) falls back to a full search.
  const { screen } = makeScreen(1920, 1080, { slots: Array(10).fill(null), seed: 800 });
  assert.equal(detectTopBar(screen, templates, { layout }).searched, 'full');
  assert.equal(detectTopBar(screen, templates, { layout, fallback: false }).searched, 'layout');

  const few = { ...fullResults.get('1920x1080'), heroes: fullResults.get('1920x1080').heroes.slice(0, 7) };
  assert.equal(learnLayout(few), null);
  assert.equal(learnLayout({ heroes: [] }), null);
});
