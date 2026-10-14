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

// The default game world: a coarse grid of dark random colours, interpolated, plus noise. Blobs about
// portrait-sized, which makes it a hard background for a detector of smooth images.
function darkWorld(scr, rand) {
  const { width: W, height: H } = scr;
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
}

// A bright, busy game world (snow map, spell effects, a crowded team fight): bright saturated colour cells with
// hard edges, smooth blobs, thin lines and strong noise. Only the top 15% of the screen is drawn busy (the
// detector never looks lower); the rest stays a flat mid grey.
function brightWorld(scr, rand) {
  const { width: W, height: H } = scr;
  const yMax = Math.min(H, Math.ceil(H * 0.15));
  fillRect(scr, 0, 0, W, H, [128, 128, 128]);
  const cell = Math.max(6, Math.round(H / 70));
  for (let y = 0; y < yMax; y += cell) {
    for (let x = 0; x < W; x += cell) {
      const c = [70 + rand() * 185, 70 + rand() * 185, 70 + rand() * 185];
      fillRect(scr, x, y, cell, cell, c, 14, rand);
    }
  }
  const area = W * yMax;
  const count = Math.round(area / (H * H * 0.002));
  for (let i = 0; i < count; i++) {
    const s = shape(rand);
    const cx = rand() * W;
    const cy = rand() * yMax;
    const sz = H * (0.01 + rand() * 0.05);
    const col = [120 + rand() * 135, 120 + rand() * 135, 120 + rand() * 135];
    const ca = Math.cos(s.rot);
    const sa = Math.sin(s.rot);
    for (let y = Math.max(0, Math.floor(cy - sz)); y < Math.min(yMax, Math.ceil(cy + sz)); y++) {
      for (let x = Math.max(0, Math.floor(cx - sz)); x < Math.min(W, Math.ceil(cx + sz)); x++) {
        const u = ((x - cx) * ca + (y - cy) * sa) / sz;
        const v = (-(x - cx) * sa + (y - cy) * ca) / sz;
        const inside = s.kind === 'stripe' ? Math.abs(v) < 0.08 : s.kind === 'rect' ? Math.max(Math.abs(u), Math.abs(v) * 1.6) < 0.8 : u * u + v * v * 2 < 0.8;
        if (inside) put(scr, x, y, col[0], col[1], col[2]);
      }
    }
  }
}

// Standard JPEG quantisation tables (luma, chroma).
const JPEG_Y = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56,
  68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const JPEG_C = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, ...Array(36).fill(99)];
const DCT = Float64Array.from({ length: 64 }, (_, i) => {
  const [u, x] = [i >> 3, i & 7];
  return (u ? Math.sqrt(2 / 8) : Math.sqrt(1 / 8)) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
});

// 8x8 DCT, quantise with table q, inverse DCT, for every block of a w x h plane (in place).
function quantiseBlocks(plane, w, h, q) {
  const blk = new Float64Array(64);
  const tmp = new Float64Array(64);
  for (let by = 0; by < h; by += 8) {
    for (let bx = 0; bx < w; bx += 8) {
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) blk[j * 8 + i] = plane[Math.min(h - 1, by + j) * w + Math.min(w - 1, bx + i)] - 128;
      // Forward: rows then columns.
      for (let j = 0; j < 8; j++) for (let u = 0; u < 8; u++) {
        let s = 0;
        for (let x = 0; x < 8; x++) s += DCT[u * 8 + x] * blk[j * 8 + x];
        tmp[j * 8 + u] = s;
      }
      for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
        let s = 0;
        for (let y = 0; y < 8; y++) s += DCT[v * 8 + y] * tmp[y * 8 + u];
        blk[v * 8 + u] = Math.round(s / q[v * 8 + u]) * q[v * 8 + u];
      }
      // Inverse.
      for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) {
        let s = 0;
        for (let u = 0; u < 8; u++) s += DCT[u * 8 + x] * blk[v * 8 + u];
        tmp[v * 8 + x] = s;
      }
      for (let y = 0; y < 8 && by + y < h; y++) for (let x = 0; x < 8 && bx + x < w; x++) {
        let s = 0;
        for (let v = 0; v < 8; v++) s += DCT[v * 8 + y] * tmp[v * 8 + x];
        plane[(by + y) * w + bx + x] = s + 128;
      }
    }
  }
}

// JPEG-like compression of the top rows [0, yMax) of an rgba screen at the given quality (1..100): YCbCr, chroma
// averaged over 2x2 pixels (4:2:0), 8x8 DCT blocks quantised with the standard tables. Blocky, with ringing.
function jpegify(scr, yMax, quality) {
  const W = scr.width;
  const H = Math.min(scr.height, yMax);
  const f = quality < 50 ? 5000 / quality : 200 - 2 * quality;
  const table = (t) => t.map((v) => Math.max(1, Math.floor((v * f + 50) / 100)));
  const Y = new Float64Array(W * H);
  const cw = Math.ceil(W / 2);
  const ch = Math.ceil(H / 2);
  const Cb = new Float64Array(cw * ch);
  const Cr = new Float64Array(cw * ch);
  const cn = new Float64Array(cw * ch);
  const d = scr.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const [R, G, B] = [d[o], d[o + 1], d[o + 2]];
      Y[y * W + x] = 0.299 * R + 0.587 * G + 0.114 * B;
      const c = (y >> 1) * cw + (x >> 1);
      Cb[c] += 128 - 0.168736 * R - 0.331264 * G + 0.5 * B;
      Cr[c] += 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
      cn[c]++;
    }
  }
  for (let i = 0; i < cn.length; i++) {
    Cb[i] /= cn[i];
    Cr[i] /= cn[i];
  }
  quantiseBlocks(Y, W, H, table(JPEG_Y));
  quantiseBlocks(Cb, cw, ch, table(JPEG_C));
  quantiseBlocks(Cr, cw, ch, table(JPEG_C));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const c = (y >> 1) * cw + (x >> 1);
      const [l, cb, cr] = [Y[y * W + x], Cb[c] - 128, Cr[c] - 128];
      d[o] = clamp255(Math.round(l + 1.402 * cr));
      d[o + 1] = clamp255(Math.round(l - 0.344136 * cb - 0.714136 * cr));
      d[o + 2] = clamp255(Math.round(l + 1.772 * cb));
    }
  }
}

// A fake screen: dark textured "game world" with noise, a top bar with a clock in the middle and 5 + 5 portrait
// slots (with health and mana bars) left and right of it. slots: 10 hero images or null (empty), left side first.
// scale: portrait height / screen height. dead: the slot (0..9) of a dead hero, or a list of them. Returns the
// screen (rgba) and the slot rectangles.
// Harder variants (all off by default; they draw from their own random sequence, so a screen with none of them is
// the same as before they existed):
//   top: y of the portraits as a fraction of the height (the HUD sits lower, game world above it)
//   titleBar: px of a light window title bar at the very top (windowed mode); the HUD starts below it
//   yJitter: every portrait shifted down by 0..yJitter px, independently
//   frame: px of HUD frame drawn over the edge of every portrait, with a dark line around it
//   background: 'dark' (default) or 'bright' (bright, saturated and busy)
//   jpeg: JPEG quality (e.g. 35): the top of the screen gets 8x8 DCT blocks and 4:2:0 chroma
//   extras: [{ image, x, y, h }] hero art drawn outside the bar (x, y: top left as fractions of the screen; h: px)
function makeScreen(W, H, opts) {
  const { slots, scale = 0.033, gapFrac = 0.07, clockFrac = 1.5, dead = -1, seed = 1 } = opts;
  const { top: topFrac, titleBar = 0, yJitter = 0, frame = 0, background = 'dark', jpeg = 0, extras = [] } = opts;
  const rand = mulberry32(seed);
  const rand2 = mulberry32(seed ^ 0x5bd1e995);
  const isDead = (k) => (Array.isArray(dead) ? dead.includes(k) : k === dead);
  const scr = { width: W, height: H, data: new Uint8Array(W * H * 4), format: 'rgba' };
  if (background === 'bright') brightWorld(scr, rand);
  else darkWorld(scr, rand);
  if (titleBar) {
    // Windowed mode: a light title bar with dark "text" and window buttons.
    fillRect(scr, 0, 0, W, titleBar, [236, 236, 240], 1, rand2);
    for (let x = 12; x < W * 0.3; x += 9 + Math.round(rand2() * 6)) fillRect(scr, x, titleBar * 0.3, 6, titleBar * 0.4, [40, 40, 40]);
    for (let i = 1; i <= 3; i++) fillRect(scr, W - i * titleBar * 1.6, titleBar * 0.25, titleBar * 0.5, titleBar * 0.5, [90, 90, 90]);
  }
  for (const e of extras) {
    const ew = Math.round((e.h * 16) / 9);
    drawPortrait(scr, e.image, Math.round(e.x * W), Math.round(e.y * H), ew, Math.round(e.h), rand2, false);
  }

  const ph = Math.round(scale * H);
  const pw = Math.round((ph * 16) / 9);
  const gap = Math.max(2, Math.round(gapFrac * pw));
  const pitch = pw + gap;
  const clockW = Math.round(clockFrac * pw);
  const cx = W / 2;
  const inset = Math.max(1, Math.round(0.002 * H));
  const top = topFrac != null ? Math.round(topFrac * H) : titleBar + inset;
  const barY = top - inset;
  const barH = Math.round(ph * 1.45);
  const barHalf = clockW / 2 + 5 * pitch + gap * 3;
  fillRect(scr, cx - barHalf, barY, barHalf * 2, barH, [24, 28, 34], 3, rand);
  fillRect(scr, cx - clockW / 2, barY, clockW, barH * 1.3, [44, 48, 58], 3, rand);
  const dh = Math.round(ph * 0.45);
  const dw = Math.max(3, Math.round(dh * 0.55));
  for (let i = 0; i < 4; i++) digit(scr, Math.round(cx - 2 * (dw + 2) + i * (dw + 2) + (i > 1 ? 3 : 0)), Math.round(barY + barH * 0.75), dw, dh, [230, 230, 220]);
  fillRect(scr, cx - ph * 0.2, top, ph * 0.4, ph * 0.4, [230, 200, 80]); // day/night sun

  const rects = [];
  for (let k = 0; k < 10; k++) {
    const left = k < 5;
    const slot = k % 5;
    const x = Math.round(left ? cx - clockW / 2 - (5 - slot) * pitch : cx + clockW / 2 + gap + slot * pitch);
    const y = top + (yJitter ? Math.floor(rand2() * (yJitter + 1)) : 0);
    rects.push({ x, y, w: pw, h: ph, side: left ? 'left' : 'right', slot });
    const hp = Math.max(2, Math.round(ph * 0.09));
    fillRect(scr, x, y + ph + 1, pw, hp, [40, 170, 60]);
    fillRect(scr, x, y + ph + 2 + hp, pw, Math.max(2, Math.round(ph * 0.07)), [50, 90, 200]);
    if (slots[k]) drawPortrait(scr, slots[k], x, y, pw, ph, rand, isDead(k));
    else fillRect(scr, x, y, pw, ph, [16, 18, 22], 2, rand);
    if (frame) {
      // HUD frame: a bevelled gold-ish border over the outer `frame` px of the portrait, a dark line around it.
      const col = [150 + rand2() * 30, 120 + rand2() * 20, 60];
      fillRect(scr, x - 1, y - 1, pw + 2, 1, [8, 8, 10]);
      fillRect(scr, x - 1, y + ph, pw + 2, 1, [8, 8, 10]);
      fillRect(scr, x - 1, y - 1, 1, ph + 2, [8, 8, 10]);
      fillRect(scr, x + pw, y - 1, 1, ph + 2, [8, 8, 10]);
      fillRect(scr, x, y, pw, frame, col, 6, rand2);
      fillRect(scr, x, y + ph - frame, pw, frame, col.map((v) => v * 0.6), 6, rand2);
      fillRect(scr, x, y, frame, ph, col, 6, rand2);
      fillRect(scr, x + pw - frame, y, frame, ph, col.map((v) => v * 0.6), 6, rand2);
    }
  }
  if (jpeg) jpegify(scr, Math.min(H, Math.ceil((H * 0.16) / 16) * 16), jpeg);
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

test('templates are prepared for every hero', (t) => {
  t.diagnostic(`prepareTemplates: ${heroes.length} heroes in ${prepareMs} ms`);
  assert.equal(templates.count, heroes.length);
  assert.deepEqual(templates.names, names);
  assert.ok(Math.abs(templates.aspect - 16 / 9) < 1e-9);
  assert.throws(() => prepareTemplates([]));
  assert.throws(() => detectTopBar(inGame[0].screen, {}), /prepareTemplates/);
});

for (const s of inGame) {
  test(`in game ${s.W}x${s.H}: all 10 heroes, sides and order (one dead)`, (t) => {
    const r = detectTopBar(s.screen, templates);
    t.diagnostic(`full search ${s.W}x${s.H}: ${r.ms} ms, scores ${r.heroes.map((h) => h.score).join(' ')}`);
    assertHeroes(r, s.pick, `${s.W}x${s.H}`);
    assert.equal(r.searched, 'full');
    assert.ok(Math.abs(r.scale - s.scale * 1.05) < 0.004, `scale ${r.scale}`); // boxes cover the 5% zoomed art
    assert.ok(r.ms < 4000, `full search took ${r.ms} ms`);
    fullResults.set(`${s.W}x${s.H}`, r);
  });
}

test('an empty top bar gives no heroes', (t) => {
  for (const [W, H] of [
    [1920, 1080],
    [3440, 1440],
  ]) {
    const { screen } = makeScreen(W, H, { slots: Array(10).fill(null), seed: 300 + W });
    const r = detectTopBar(screen, templates);
    t.diagnostic(`empty bar ${W}x${H}: ${r.ms} ms`);
    assert.deepEqual(r.heroes, [], `${W}x${H}: ${JSON.stringify(r.heroes)}`);
  }
});

test('draft screen with 3 + 2 picks finds exactly those, in their slots', (t) => {
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
    t.diagnostic(`draft ${c.W}x${c.H}: ${r.ms} ms`);
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

test('learnLayout + layout path: same answer, fast, empty slots reported', (t) => {
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
    t.diagnostic(`layout path ${key}: ${times.join(', ')} ms (full search was ${full.ms} ms)`);
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

// ---------------------------------------------------------------------------------------------------------------
// Harder cases: things real screenshots may do that the screens above do not

const imgs = (pick) => pick.map((i) => (i == null ? null : heroes[i].image));
const sides = (r) => r.heroes.map((h) => `${h.side}:${h.name}`);

// In-game screens made harder one way at a time, then all at once. All but the last have dead heroes.
const HARD = [
  { label: 'portraits 0-3 px apart vertically', W: 1920, H: 1080, o: { yJitter: 3 }, dead: [2] },
  { label: 'HUD 1% down from the top', W: 1920, H: 1080, o: { top: 0.01 }, dead: [6] },
  { label: 'windowed, title bar above the HUD', W: 1280, H: 720, o: { titleBar: 30 }, dead: [0] },
  { label: '3 px HUD frame on every portrait', W: 2560, H: 1440, o: { frame: 3 }, dead: [4, 7] },
  { label: 'JPEG quality 35', W: 1920, H: 1080, o: { jpeg: 35 }, dead: [9] },
  { label: 'ultrawide, frames, 0-2 px offsets', W: 3440, H: 1440, o: { frame: 2, yJitter: 2, scale: 0.031 }, dead: [5] },
  { label: 'tiny 720p portraits (18 px)', W: 1280, H: 720, o: { scale: 0.025 }, dead: [3] },
  { label: 'bright busy background', W: 1920, H: 1080, o: { background: 'bright' }, dead: [8] },
  { label: 'bright busy ultrawide', W: 3440, H: 1440, o: { background: 'bright' }, dead: [1] },
  { label: 'all of it at once', W: 1920, H: 1080, o: { frame: 2, jpeg: 40, yJitter: 2, background: 'bright', top: 0.01 }, dead: [3] },
  { label: 'all of it at 720p (live heroes only)', W: 1280, H: 720, o: { scale: 0.03, frame: 1, jpeg: 40, yJitter: 2, background: 'bright' }, dead: [] },
];
for (const [n, c] of HARD.entries()) {
  test(`hard, ${c.W}x${c.H}: ${c.label}`, (t) => {
    const pick = pickHeroes(1100 + n);
    const { screen } = makeScreen(c.W, c.H, { slots: imgs(pick), scale: 0.033, ...c.o, dead: c.dead, seed: 1200 + n });
    const r = detectTopBar(screen, templates);
    t.diagnostic(`${c.label}: ${r.ms} ms, scores ${r.heroes.map((h) => h.score).join(' ')}`);
    assertHeroes(r, pick, c.label);
    assert.ok(r.ms < 4000, `full search took ${r.ms} ms`);
  });
}

test('three dead heroes at once under a HUD frame, JPEG or shifted portraits', (t) => {
  [{ frame: 2 }, { jpeg: 35 }, { yJitter: 3 }].forEach((o, n) => {
    const pick = pickHeroes(1300 + n);
    const dead = [1, 5, 8].map((k) => (k + n) % 10);
    const { screen } = makeScreen(1920, 1080, { slots: imgs(pick), ...o, dead, seed: 1310 + n });
    const r = detectTopBar(screen, templates);
    const deadScores = r.heroes.filter((h) => dead.includes((h.side === 'left' ? 0 : 5) + h.slot)).map((h) => h.score);
    t.diagnostic(`${JSON.stringify(o)}: dead heroes scored ${deadScores.join(' ')}`);
    assertHeroes(r, pick, `three dead, ${JSON.stringify(o)}`);
  });
});

test('look-alikes: five look-alike pairs on one screen, and look-alikes without their twin', (t) => {
  const rand = mulberry32(1400);
  const pairs = [6, 22, 38, 54, 86].flatMap((p) => [p, p + 1]).sort(() => rand() - 0.5); // 8m+7 looks like 8m+6
  const single = [7, 14, 23, 30, 47, 54, 63, 70, 95, 102]; // one of a pair each, the other one not on screen
  for (const [label, pick] of [['pairs', pairs], ['without twin', single]]) {
    const { screen } = makeScreen(1920, 1080, { slots: imgs(pick), seed: 1401 + pick[0] });
    const r = detectTopBar(screen, templates);
    t.diagnostic(`${label}: smallest margin ${Math.min(...r.heroes.map((h) => h.margin))}`);
    assertHeroes(r, pick, label);
  }
});

test('hero art outside the bar and busy or compressed backgrounds add no heroes', () => {
  // A full bar on a bright busy background, with the art of a hero not in the match just below the bar.
  const pick = pickHeroes(1500);
  const other = heroes.findIndex((_, i) => !pick.includes(i));
  const extras = [{ image: heroes[other].image, x: 0.36, y: 0.055, h: 45 }];
  const a = makeScreen(1920, 1080, { slots: imgs(pick), background: 'bright', extras, seed: 1501 });
  assertHeroes(detectTopBar(a.screen, templates), pick, 'bright, hero art below the bar');
  // Empty bars.
  [{ background: 'bright', jpeg: 40 }, { jpeg: 30, frame: 2 }, { titleBar: 30, background: 'bright' }].forEach((o, n) => {
    const { screen } = makeScreen(n === 2 ? 1280 : 1920, n === 2 ? 720 : 1080, { slots: Array(10).fill(null), ...o, seed: 1510 + n });
    const r = detectTopBar(screen, templates);
    assert.deepEqual(r.heroes, [], `${JSON.stringify(o)}: ${JSON.stringify(r.heroes)}`);
  });
});

test('hero selection: big portraits lower in the band', (t) => {
  const draft = { scale: 0.05, top: 0.04, gapFrac: 0.12, clockFrac: 2.2 };
  // All ten picked, 16:10, portraits from 4.5% to 9.5% of the height.
  const pick = pickHeroes(1600);
  const all = detectTopBar(makeScreen(1920, 1200, { slots: imgs(pick), ...draft, top: 0.045, seed: 1601 }).screen, templates);
  assertHeroes(all, pick, 'draft, all picked');
  // 3 + 2 picks.
  const five = Array(10).fill(null);
  [0, 2, 4, 6, 8].forEach((k, j) => (five[k] = pick[j]));
  assertHeroes(detectTopBar(makeScreen(2560, 1440, { slots: imgs(five), ...draft, seed: 1602 }).screen, templates), five, 'draft, 3 + 2');
  // The first two picks (no row to check against yet): the right heroes on the right sides. Their slots are a guess.
  [
    [1920, 1080, 1, 7],
    [1280, 720, 4, 6],
    [2560, 1440, 2, 3],
  ].forEach(([W, H, ka, kb], n) => {
    const two = Array(10).fill(null);
    two[ka] = pick[5 + n];
    two[kb] = pick[8 - n];
    const r = detectTopBar(makeScreen(W, H, { slots: imgs(two), ...draft, seed: 1610 + n }).screen, templates);
    t.diagnostic(`two picks ${W}x${H}: ${r.ms} ms`);
    const want = [ka, kb].sort((a, b) => a - b).map((k) => `${k < 5 ? 'left' : 'right'}:${names[two[k]]}`);
    assert.deepEqual(sides(r), want, `two picks ${W}x${H}`);
  });
});

test('heroes missing from the template set are not reported as other heroes', () => {
  // Heroes 120..129 are unknown (a hero newer than the app's data): one alive, one dead on each screen.
  const known = prepareTemplates(heroes.slice(0, 120));
  [{}, { background: 'bright', frame: 2 }].forEach((o, n) => {
    const rand = mulberry32(1700 + n);
    const pick = [];
    while (pick.length < 10) {
      const i = Math.floor(rand() * 120);
      if (!pick.includes(i)) pick.push(i);
    }
    const slots = imgs(pick);
    slots[3] = heroes[121 + n].image;
    slots[8] = heroes[126 + n].image;
    const { screen } = makeScreen(1920, 1080, { slots, ...o, dead: [8, 0], seed: 1710 + n });
    const expected = pick.map((i, k) => (k === 3 || k === 8 ? null : i));
    const r = detectTopBar(screen, known);
    assertHeroes(r, expected, `unknown heroes ${JSON.stringify(o)}`);
    const layout = learnLayout(r);
    assert.ok(layout, 'layout from 8 known heroes');
    const again = detectTopBar(screen, known, { layout });
    assertHeroes(again, expected, `unknown heroes, layout ${JSON.stringify(o)}`);
    assert.deepEqual(again.missing, [
      { side: 'left', slot: 3 },
      { side: 'right', slot: 3 },
    ]);
  });
});

test('learnLayout: needs 8 confident heroes, fills in the rest, drops a hero off the spacing', () => {
  const s = inGame[1];
  const full = fullResults.get('1920x1080') || detectTopBar(s.screen, templates);
  const ref = learnLayout(full);
  assert.ok(ref);
  // The slots sit on the drawn portraits (the boxes cover the 5% zoomed art around the same centre).
  for (const sl of ref.slots) {
    const r = s.rects[(sl.side === 'left' ? 0 : 5) + sl.slot];
    assert.ok(Math.abs(sl.x + sl.w / 2 - (r.x + r.w / 2)) <= 1.5 && Math.abs(sl.y + sl.h / 2 - (r.y + r.h / 2)) <= 1.5, JSON.stringify([sl, r]));
  }
  const near = (layout, tol, label) => {
    assert.ok(layout, `${label}: no layout`);
    layout.slots.forEach((sl, i) => {
      const r = ref.slots[i];
      const d = Math.max(Math.abs(sl.x - r.x), Math.abs(sl.y - r.y), Math.abs(sl.w - r.w), Math.abs(sl.h - r.h));
      assert.ok(d <= tol, `${label}: slot ${sl.side}${sl.slot} ${JSON.stringify(sl)} vs ${JSON.stringify(r)}`);
    });
  };
  const strong = { ...full, heroes: full.heroes.map((h) => ({ ...h, score: 0.95 })) };
  const weaken = (idx) => ({ ...strong, heroes: strong.heroes.map((h, i) => (idx.includes(i) ? { ...h, score: 0.75 } : h)) });
  // Only 6 confident heroes (4 dead or doubtful): no layout, unless a lower bar is asked for.
  assert.equal(learnLayout(weaken([0, 3, 6, 9])), null);
  near(learnLayout(weaken([0, 3, 6, 9]), { minScore: 0.7 }), 0.5, 'minScore 0.7');
  near(learnLayout(weaken([2, 7])), 1, '8 confident');
  // Two heroes missing (inside the row and at its end): their slots come from the spacing.
  near(learnLayout({ ...strong, heroes: strong.heroes.filter((h, i) => i !== 2 && i !== 9) }), 1.5, 'two missing');
  // A hero with a wrong slot number is dropped...
  const wrong = { ...strong, heroes: strong.heroes.map((h, i) => (i === 7 ? { ...h, slot: (h.slot + 2) % 5 } : h)) };
  near(learnLayout(wrong), 1.5, 'one wrong slot');
  // ... but not below 8 heroes.
  assert.equal(learnLayout({ ...wrong, heroes: wrong.heroes.filter((h, i) => i > 1) }), null);
  // Sizes that do not agree do not count.
  assert.equal(learnLayout({ ...strong, heroes: strong.heroes.map((h, i) => (i < 3 ? { ...h, w: h.w * 1.5, h: h.h * 1.5 } : h)) }), null);
});

test('layout path: empty and dead slots, a new game on the same screen', (t) => {
  const W = 1920;
  const H = 1080;
  const o = { frame: 2, yJitter: 2 };
  const pick = pickHeroes(1800);
  const layout = learnLayout(detectTopBar(makeScreen(W, H, { slots: imgs(pick), ...o, dead: 4, seed: 1801 }).screen, templates));
  assert.ok(layout, 'no layout learned');
  // Next frame: 3 slots empty (disconnected players), 2 heroes dead.
  const next = [...pick];
  [1, 6, 8].forEach((k) => (next[k] = null));
  const screen = toBgra(makeScreen(W, H, { slots: imgs(next), ...o, dead: [0, 7], seed: 1802 }).screen);
  const times = [];
  let r;
  for (let i = 0; i < 3; i++) {
    r = detectTopBar(screen, templates, { layout });
    times.push(r.ms);
  }
  t.diagnostic(`layout path with frames, offsets, 3 empty and 2 dead slots: ${times.join(', ')} ms`);
  assert.equal(r.searched, 'layout');
  assertHeroes(r, next, 'layout, empty and dead');
  assert.deepEqual(r.missing, [
    { side: 'left', slot: 1 },
    { side: 'right', slot: 1 },
    { side: 'right', slot: 3 },
  ]);
  assert.ok(Math.min(...times) < 500, `layout path took ${times} ms`);
  // A new game at the same resolution: ten other heroes, found through the same layout.
  const pick2 = pickHeroes(1803);
  const r2 = detectTopBar(makeScreen(W, H, { slots: imgs(pick2), ...o, seed: 1804 }).screen, templates, { layout });
  assert.equal(r2.searched, 'layout');
  assertHeroes(r2, pick2, 'layout, new game');
});

test('a stale layout (draft screen seen through the in-game layout) does not invent heroes', (t) => {
  // In-game layout at 1280x720; then the hero selection screen, whose portraits are bigger and lower. At the old
  // slots there is only game world and bar, and with fewer than minLayoutHeroes found there a full search decides.
  for (const [n, [W, H]] of [
    [1920, 1080],
    [1280, 720],
  ].entries()) {
    const pick = pickHeroes(1900 + n);
    const layout = learnLayout(detectTopBar(makeScreen(W, H, { slots: imgs(pick), scale: 0.03, jpeg: 50, seed: 1901 + n }).screen, templates));
    assert.ok(layout, 'no layout learned');
    const two = Array(10).fill(null);
    two[1] = pick[0];
    two[7] = pick[1];
    const draft = makeScreen(W, H, { slots: imgs(two), scale: 0.05, top: 0.035, gapFrac: 0.12, clockFrac: 2.2, seed: 1910 + n });
    const r = detectTopBar(draft.screen, templates, { layout });
    t.diagnostic(`stale layout ${W}x${H}: searched ${r.searched}, ${r.ms} ms`);
    assert.deepEqual(sides(r), [`left:${names[pick[0]]}`, `right:${names[pick[1]]}`], `${W}x${H}`);
    assert.equal(detectTopBar(draft.screen, templates, { layout, fallback: false }).searched, 'layout');
  }
});
