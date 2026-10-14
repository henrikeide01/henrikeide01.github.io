// Recognises the hero portraits in the Dota 2 top bar from a screenshot.
//
// Game State Integration never tells a third-party app which heroes the enemies picked, so the Electron app grabs
// the screen and asks this module which of the known hero images are shown in the top bar: 5 Radiant portraits
// left of the centre clock and 5 Dire portraits right of it in game, or the row of picked heroes during the draft.
//
// Pure functions on plain image objects { width, height, data, format }: data holds 4 bytes per pixel and format is
// 'rgba' or 'bgra' (Electron's nativeImage.toBitmap() is BGRA on Windows). Node built-ins only, no dependencies.
//
// How it works (more in README.md next to this file). All matching is normalised cross-correlation (NCC: the same
// picture brighter or with more contrast still scores 1) against the central part of every hero image.
//   1. Coarse: the top band of the screen is shrunk once per portrait size in opts.scales so that a portrait becomes
//      12x7 grey pixels, and every window is compared with every hero. Local maxima become candidates, ranked by
//      grey + colour match and contrast (a dim patch of game world with the right shapes ranks low).
//   2. Medium: the best candidates (a share for every size) get their position and size refined at 16x9.
//   3. Fine: the best of those are refined at 32x18 and classified against every hero (grey + colour).
//   4. The row: the portraits sit in one row of 5 + 5 evenly spaced slots mirrored around the screen centre. Once 3
//      portraits agree on that grid, only candidates on it count, and every empty slot is classified directly with
//      a score that ignores an overlay (finds dead heroes: grey, with the respawn timer on top).
//   5. learnLayout() remembers the 10 slot rectangles, so later frames only classify those (tens of milliseconds).

const CHANNELS = { rgba: [0, 1, 2], bgra: [2, 1, 0] };

// Portrait heights to search, as fractions of the screen height. Neighbours are ~20% apart; the fine pass corrects
// the size, so a portrait anywhere in 0.022..0.066 is found. In game the top bar portraits are ~3.3% of the height.
export const DEFAULT_SCALES = [0.024, 0.029, 0.035, 0.042, 0.05, 0.06];

export const DEFAULTS = {
  bandBottom: 0.1, // search y in [0, bandBottom * height]
  xFrom: 0.15, // ... and x in [xFrom, xTo] * width
  xTo: 0.85,
  scales: DEFAULT_SCALES,
  // Scores are 0..1 (NCC based, see README.md for how they were chosen). A row of portraits is accepted when at
  // least 3 candidates scoring rowScore sit on one evenly spaced row; then every portrait on that row needs
  // minScore. Without such a row (empty bar, first picks of the draft) a portrait needs loneScore.
  minScore: 0.7,
  rowScore: 0.82,
  loneScore: 0.88,
  coarseMin: 0.55, // 12x7 grey NCC a window needs to become a candidate
  maxRefine: 150, // the best this many coarse candidates get a 16x9 position/size refinement
  verifyMin: 0.6, // 16x9 NCC a candidate needs after it
  maxCandidates: 40, // candidates (best 16x9 score first) that get the fine pass
  minContrast: 6, // windows flatter than this (std of luma, 0..255) are skipped: empty bar, plain UI
  jitter: 0.12, // layout path: how far (fraction of the portrait height) a portrait may have moved
  // Layout path: with fewer heroes than minLayoutHeroes at the learned slots the layout may be stale (another game
  // mode's draft screen, a moved HUD) and a patch of whatever is there now can pass for a hero, so a full search runs
  // too and the answer with more heroes (then more total score) is used. fallback: false turns this off.
  fallback: true,
  minLayoutHeroes: 3,
  debug: false, // full search: add result.debug (candidate counts, time per stage, best candidates)
};

const SHORTLIST = 6; // heroes per window that the position/size refinement optimises for
const ROBUST_TOP = 12; // heroes per window that get the robust (overlay-tolerant) score at a known slot
const CLEAR_MATCH = 0.9; // plain score above which that robust second look is skipped (it only helps weak matches)
// Robust score (known slots only): fit ** ROBUST_POWER, scaled by how far the hero is ahead of the best hero that
// does not look like it (full credit from a lead of DISTINCT_LEAD in robust NCC). Ignoring the pixels that do not
// fit lets almost any hero fit a patch of game world or an unknown hero's portrait fairly well, but then many
// unrelated heroes fit about equally well; under a respawn timer the right hero still stands out clearly.
const ROBUST_POWER = 1.5;
const DISTINCT_LEAD = 0.2;
// Two heroes whose grey 32x18 images correlate above this are look-alikes: they do not count against each other's
// lead (either may be the one on screen; the better fit wins).
const RELATED = 0.7;
// Least weight of a pixel outside the overlay areas (overlayMask) in the robust NCC.
const OVERLAY_FLOOR = 1;
// Share of the overlay areas the robust NCC may ignore without a penalty. A respawn timer and a HUD frame together
// cover roughly a third to a half of them; ignoring that much is expected, not a sign of a poor fit. Each further
// share ignored lowers the score by the same share.
const OVERLAY_FREE = 0.5;
// Robust score: how much colour counts, by how colourful the window is compared with the hero image (luma-relative
// chroma, rhoW / rho). A dead hero's grey portrait reaches ~0.1-0.55 of its art's colourfulness (noise, JPEG chroma
// bleeding in from the bars around it), a live portrait ~0.8-1.2. Below GREY_RATIO colour does not count at all (it
// would only drag a grey portrait's score down), from COLOUR_RATIO on it counts half, as in the plain score.
const GREY_RATIO = 0.5;
const COLOUR_RATIO = 0.9;
// A window with less than this share of the hero image's contrast (luma std) is scored down: portraits are
// full-contrast UI images, a dim patch of game world is not. Lower at a known slot: dead heroes are darkened.
const MIN_CONTRAST_RATIO = 0.5;
const SLOT_CONTRAST_RATIO = 0.35;
// The usual distance between neighbouring portraits, in portrait widths (they sit close together).
const TYPICAL_PITCH = 1.08;

const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round1 = (v) => Math.round(v * 10) / 10;

function channelOrder(img) {
  const order = CHANNELS[String(img.format || 'rgba').toLowerCase()];
  if (!order) throw new Error(`Unknown pixel format "${img.format}" (expected rgba or bgra)`);
  return order;
}

function checkImage(img, what = 'image') {
  if (!img || !(img.width > 0) || !(img.height > 0) || !img.data || img.data.length < img.width * img.height * 4) {
    throw new Error(`Bad ${what}: expected { width, height, data (4 bytes per pixel), format }`);
  }
  channelOrder(img);
}

// Float planes (r, g, b, luma) of the rectangle (x0, y0, w, h) of an image. Plane pixel (i, j) is image pixel
// (x0 + i, y0 + j); everything else in this file uses screen coordinates.
function toPlanes(img, x0, y0, w, h) {
  const [ri, gi, bi] = channelOrder(img);
  const n = w * h;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  const y = new Float32Array(n);
  const d = img.data;
  const stride = img.width * 4;
  for (let j = 0; j < h; j++) {
    let s = (y0 + j) * stride + x0 * 4;
    for (let i = 0, o = j * w; i < w; i++, o++, s += 4) {
      const R = d[s + ri];
      const G = d[s + gi];
      const B = d[s + bi];
      r[o] = R;
      g[o] = G;
      b[o] = B;
      y[o] = 0.299 * R + 0.587 * G + 0.114 * B;
    }
  }
  return { x0, y0, w, h, r, g, b, y };
}

// Resampling weights for one axis: output pixel i covers source [start + i*len/n, start + (i+1)*len/n).
// Shrinking averages the covered area (box filter, partial pixels weighted by coverage); enlarging interpolates
// linearly. Source indices are clamped to [0, limit). Returns the number of taps per output pixel.
function axisWeights(ax, start, len, n, limit) {
  const r = len / n;
  const taps = r >= 1 ? Math.ceil(r) + 1 : 2;
  if (ax.idx.length < n * taps) {
    ax.idx = new Int32Array(n * taps * 2);
    ax.wt = new Float32Array(n * taps * 2);
  }
  const { idx, wt } = ax;
  for (let i = 0; i < n; i++) {
    const base = i * taps;
    let k = 0;
    if (r >= 1) {
      const a = Math.max(0, start + i * r);
      const b = Math.min(limit, start + (i + 1) * r);
      if (b > a) {
        let sum = 0;
        for (let x = Math.floor(a); x < b && k < taps; x++, k++) {
          const w = Math.min(b, x + 1) - Math.max(a, x);
          idx[base + k] = x;
          wt[base + k] = w;
          sum += w;
        }
        for (let j = 0; j < k; j++) wt[base + j] /= sum;
      } else {
        // Entirely outside the source: repeat the nearest edge pixel.
        idx[base] = clamp(Math.floor(start + (i + 0.5) * r), 0, limit - 1);
        wt[base] = 1;
        k = 1;
      }
    } else {
      const c = start + (i + 0.5) * r - 0.5;
      const x0 = Math.floor(c);
      const f = c - x0;
      idx[base] = clamp(x0, 0, limit - 1);
      wt[base] = 1 - f;
      idx[base + 1] = clamp(x0 + 1, 0, limit - 1);
      wt[base + 1] = f;
      k = 2;
    }
    for (; k < taps; k++) {
      idx[base + k] = idx[base];
      wt[base + k] = 0;
    }
  }
  return taps;
}

// Separable resampler for float planes. setup() computes the weights for one rectangle, apply() runs them on any
// plane of that size (so r, g, b and luma share the work). Scratch buffers are reused: no allocation per call.
class Resampler {
  constructor() {
    this.ax = { idx: new Int32Array(0), wt: new Float32Array(0) };
    this.ay = { idx: new Int32Array(0), wt: new Float32Array(0) };
    this.tmp = new Float32Array(0);
  }

  // Sample the rectangle (rx, ry, rw, rh) (fractional, plane coordinates) of a pw x ph plane into dw x dh.
  setup(pw, ph, rx, ry, rw, rh, dw, dh) {
    this.pw = pw;
    this.dw = dw;
    this.dh = dh;
    this.tx = axisWeights(this.ax, rx, rw, dw, pw);
    this.ty = axisWeights(this.ay, ry, rh, dh, ph);
    const { idx } = this.ay;
    let lo = Infinity;
    let hi = -1;
    for (let i = 0; i < dh * this.ty; i++) {
      if (idx[i] < lo) lo = idx[i];
      if (idx[i] > hi) hi = idx[i];
    }
    this.ya = lo;
    this.rows = hi - lo + 1;
    if (this.tmp.length < this.rows * dw) this.tmp = new Float32Array(this.rows * dw * 2);
    return this;
  }

  apply(plane, out) {
    const { pw, dw, dh, tx, ty, tmp, ya, rows } = this;
    const { idx: ix, wt: wx } = this.ax;
    const { idx: iy, wt: wy } = this.ay;
    for (let r = 0; r < rows; r++) {
      const src = (ya + r) * pw;
      const t = r * dw;
      for (let i = 0, b = 0; i < dw; i++, b += tx) {
        let s = 0;
        for (let k = 0; k < tx; k++) s += plane[src + ix[b + k]] * wx[b + k];
        tmp[t + i] = s;
      }
    }
    for (let j = 0, b = 0; j < dh; j++, b += ty) {
      const o = j * dw;
      for (let i = 0; i < dw; i++) out[o + i] = 0;
      for (let k = 0; k < ty; k++) {
        const w = wy[b + k];
        if (w === 0) continue;
        const t = (iy[b + k] - ya) * dw;
        for (let i = 0; i < dw; i++) out[o + i] += tmp[t + i] * w;
      }
    }
    return out;
  }
}

// Make v zero-mean with unit length, in place. Returns its length before normalising (0 for a flat patch).
function normalise(v) {
  const n = v.length;
  let s = 0;
  for (let i = 0; i < n; i++) s += v[i];
  const mean = s / n;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    v[i] -= mean;
    ss += v[i] * v[i];
  }
  const len = Math.sqrt(ss);
  if (len > 1e-6) for (let i = 0; i < n; i++) v[i] /= len;
  return len;
}

function dot(a, b, offset, n) {
  let s0 = 0;
  let s1 = 0;
  let i = 0;
  for (; i + 1 < n; i += 2) {
    s0 += a[i] * b[offset + i];
    s1 += a[i + 1] * b[offset + i + 1];
  }
  if (i < n) s0 += a[i] * b[offset + i];
  return s0 + s1;
}

// How colourful a patch is: RMS chroma relative to the luma contrast. A brightness/contrast change keeps it; a
// greyed-out (dead) portrait drops to ~0. Used to decide how much the colour score may count. Pixels set in mask
// (optional) are left out: a coloured HUD frame around a dead hero's grey portrait must not make it look colourful.
function colourfulness(r, g, b, y, n, mask = null) {
  let c = 0;
  let s = 0;
  let s2 = 0;
  let m = 0;
  for (let i = 0; i < n; i++) {
    if (mask && mask[i]) continue;
    const cr = r[i] - y[i];
    const cb = b[i] - y[i];
    c += cr * cr + cb * cb;
    s += y[i];
    s2 += y[i] * y[i];
    m++;
  }
  if (!m) return 0;
  const varY = s2 / m - (s / m) * (s / m);
  return Math.sqrt(c / m) / Math.sqrt(Math.max(varY, 1));
}

// The k-th smallest (0-based) of the first n values of a, by quickselect (a stays as it is).
let selBuf = new Float32Array(0);
function kth(a, n, k) {
  if (selBuf.length < n) selBuf = new Float32Array(n);
  const v = selBuf;
  for (let i = 0; i < n; i++) v[i] = a[i];
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = v[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (v[i] < pivot) i++;
      while (v[j] > pivot) j--;
      if (i <= j) {
        const t = v[i];
        v[i++] = v[j];
        v[j--] = t;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return v[k];
}

// NCC that ignores pixels which do not fit: iteratively reweighted least squares with Tukey's biweight on the
// residuals of the best linear fit x ~ a + b*t (scale from the median absolute residual). A respawn timer or a HUD
// frame over part of a portrait then barely lowers the score. floor (optional): per pixel, the least weight it may
// get; 1 where no overlay can be, so the fit cannot explain away the parts in which two heroes differ. Writes the
// pixel weights (0..1) into w and returns { ncc, coverage } (coverage = mean weight, 1 when every pixel fits).
// x, t: zero-mean unit vectors.
function robustNcc(x, t, off, n, w, res, floor = null) {
  for (let i = 0; i < n; i++) w[i] = 1;
  let ncc = 0;
  for (let it = 0; it < 4; it++) {
    let sw = 0;
    let sx = 0;
    let st = 0;
    for (let i = 0; i < n; i++) {
      sw += w[i];
      sx += w[i] * x[i];
      st += w[i] * t[off + i];
    }
    if (sw < 0.25 * n) return { ncc: 0, coverage: sw / n };
    const mx = sx / sw;
    const mt = st / sw;
    let cxt = 0;
    let cxx = 0;
    let ctt = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - mx;
      const dt = t[off + i] - mt;
      cxt += w[i] * dx * dt;
      cxx += w[i] * dx * dx;
      ctt += w[i] * dt * dt;
    }
    ncc = cxx > 0 && ctt > 0 ? cxt / Math.sqrt(cxx * ctt) : 0;
    if (it === 3) break;
    const beta = ctt > 0 ? cxt / ctt : 0;
    for (let i = 0; i < n; i++) res[i] = Math.abs(x[i] - mx - beta * (t[off + i] - mt));
    const c = 4.685 * 1.4826 * Math.max(kth(res, n, n >> 1), 1e-4);
    for (let i = 0; i < n; i++) {
      const u = res[i] / c;
      w[i] = u < 1 ? (1 - u * u) ** 2 : 0;
      if (floor && w[i] < floor[i]) w[i] = floor[i];
    }
  }
  let sw = 0;
  for (let i = 0; i < n; i++) sw += w[i];
  return { ncc, coverage: sw / n };
}

// Weighted NCC of two vectors made of `planes` planes of n pixels each, with one weight per pixel.
function weightedNcc(x, t, off, n, planes, w) {
  let sw = 0;
  let sx = 0;
  let st = 0;
  for (let p = 0; p < planes; p++) {
    for (let i = 0; i < n; i++) {
      const j = p * n + i;
      sw += w[i];
      sx += w[i] * x[j];
      st += w[i] * t[off + j];
    }
  }
  if (sw <= 0) return 0;
  const mx = sx / sw;
  const mt = st / sw;
  let cxt = 0;
  let cxx = 0;
  let ctt = 0;
  for (let p = 0; p < planes; p++) {
    for (let i = 0; i < n; i++) {
      const j = p * n + i;
      const dx = x[j] - mx;
      const dt = t[off + j] - mt;
      cxt += w[i] * dx * dt;
      cxx += w[i] * dx * dx;
      ctt += w[i] * dt * dt;
    }
  }
  return cxx > 0 && ctt > 0 ? cxt / Math.sqrt(cxx * ctt) : 0;
}

// Pixels of a w x h patch that an overlay may cover: the respawn timer (centred text on a dead hero's portrait: the
// middle half of the width and 70% of the height) and the outermost pixel ring (a HUD frame, or the edge of the
// slot reaching into the portrait).
function overlayMask(w, h) {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const centre = y >= Math.floor(h * 0.15) && y < Math.ceil(h * 0.85) && x >= Math.floor(w * 0.25) && x < Math.ceil(w * 0.75);
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      mask[y * w + x] = centre || edge ? 1 : 0;
    }
  }
  return mask;
}

// Copy of v with the masked pixels set to 0 and the others zero-mean with unit length.
function maskedUnit(v, mask, out) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < v.length; i++) {
    if (mask[i]) continue;
    s += v[i];
    n++;
  }
  const mean = s / n;
  let ss = 0;
  for (let i = 0; i < v.length; i++) {
    out[i] = mask[i] ? 0 : v[i] - mean;
    ss += out[i] * out[i];
  }
  const len = Math.sqrt(ss);
  if (len > 1e-6) for (let i = 0; i < v.length; i++) out[i] /= len;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Public image helpers

// Crop (integer pixels, clamped to the image). Keeps the pixel format.
export function crop(img, x, y, w, h) {
  checkImage(img);
  const x0 = clamp(Math.round(x), 0, img.width);
  const y0 = clamp(Math.round(y), 0, img.height);
  const x1 = clamp(Math.round(x + w), x0, img.width);
  const y1 = clamp(Math.round(y + h), y0, img.height);
  const cw = x1 - x0;
  const ch = y1 - y0;
  const data = new Uint8Array(cw * ch * 4);
  for (let j = 0; j < ch; j++) {
    const s = ((y0 + j) * img.width + x0) * 4;
    data.set(img.data.subarray(s, s + cw * 4), j * cw * 4);
  }
  return { width: cw, height: ch, data, format: img.format || 'rgba' };
}

// Area-average resize (linear interpolation when enlarging). Always returns an rgba image.
export function resize(img, width, height) {
  checkImage(img);
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  const order = channelOrder(img);
  const src = img.data;
  const n = img.width * img.height;
  const rs = new Resampler().setup(img.width, img.height, 0, 0, img.width, img.height, width, height);
  const plane = new Float32Array(n);
  const out = new Float32Array(width * height);
  const data = new Uint8Array(width * height * 4);
  for (let c = 0; c < 4; c++) {
    const from = c < 3 ? order[c] : 3;
    for (let i = 0; i < n; i++) plane[i] = src[i * 4 + from];
    rs.apply(plane, out);
    for (let i = 0; i < out.length; i++) data[i * 4 + c] = clamp(Math.round(out[i]), 0, 255);
  }
  return { width, height, data, format: 'rgba' };
}
// ---------------------------------------------------------------------------------------------------------------
// Templates

// heroes: [{ name, image }] with the official landscape hero images (256x144). Precomputes, for the central
// opts.crop part of every image (default 0.9, so a slightly different crop in game still lines up):
//   coarse: 12x7 grey and colour (opts.coarseSize), medium: 16x9 grey (opts.mediumSize), zero-mean, unit length
//   fine:   32x18 grey and colour (r, g, b planes normalised together), grey without the centre (where a respawn
//           timer goes), plus contrast and how colourful it is (opts.fineSize)
export function prepareTemplates(heroes, opts = {}) {
  const list = (heroes || []).filter((h) => h && h.name && h.image);
  if (!list.length) throw new Error('prepareTemplates: no hero images');
  const cropFrac = opts.crop ?? 0.9;
  const level = ([w, h]) => ({ w, h, n: w * h, gray: new Float32Array(list.length * w * h) });
  const coarse = level(opts.coarseSize || [12, 7]);
  const medium = level(opts.mediumSize || [16, 9]);
  const fine = level(opts.fineSize || [32, 18]);
  const nf = fine.n;
  coarse.sigma = new Float32Array(list.length);
  coarse.colour = new Float32Array(list.length * coarse.n * 3);
  fine.mask = overlayMask(fine.w, fine.h);
  // Least weight per pixel in the robust NCC: 0 where an overlay may be, OVERLAY_FLOOR elsewhere.
  fine.floor = Float32Array.from(fine.mask, (m) => (m ? 0 : OVERLAY_FLOOR));
  fine.masked = new Float32Array(list.length * nf);
  fine.free = fine.mask.reduce((s, m) => s + (m ? 0 : 1), 0); // pixels outside the overlay areas
  fine.colour = new Float32Array(list.length * nf * 3);
  fine.rho = new Float32Array(list.length);
  fine.sigma = new Float32Array(list.length);
  const rs = new Resampler();
  const fr = new Float32Array(nf);
  const fg = new Float32Array(nf);
  const fb = new Float32Array(nf);
  const first = list[0].image;
  const aspect = opts.aspect || first.width / first.height;

  list.forEach(({ image }, k) => {
    checkImage(image, `image for ${list[k].name}`);
    const P = toPlanes(image, 0, 0, image.width, image.height);
    const rw = image.width * cropFrac;
    const rh = image.height * cropFrac;
    const rx = (image.width - rw) / 2;
    const ry = (image.height - rh) / 2;
    for (const L of [coarse, medium]) {
      rs.setup(P.w, P.h, rx, ry, rw, rh, L.w, L.h);
      const sigma = normalise(rs.apply(P.y, L.gray.subarray(k * L.n, (k + 1) * L.n))) / Math.sqrt(L.n);
      if (L !== coarse) continue;
      coarse.sigma[k] = sigma;
      const cv = coarse.colour.subarray(k * L.n * 3, (k + 1) * L.n * 3);
      [P.r, P.g, P.b].forEach((plane, c) => rs.apply(plane, cv.subarray(c * L.n, (c + 1) * L.n)));
      normalise(cv);
    }
    rs.setup(P.w, P.h, rx, ry, rw, rh, fine.w, fine.h);
    const gy = rs.apply(P.y, fine.gray.subarray(k * nf, (k + 1) * nf));
    rs.apply(P.r, fr);
    rs.apply(P.g, fg);
    rs.apply(P.b, fb);
    fine.rho[k] = colourfulness(fr, fg, fb, gy, nf, fine.mask);
    fine.sigma[k] = normalise(gy) / Math.sqrt(nf);
    maskedUnit(gy, fine.mask, fine.masked.subarray(k * nf, (k + 1) * nf));
    const cv = fine.colour.subarray(k * nf * 3, (k + 1) * nf * 3);
    cv.set(fr, 0);
    cv.set(fg, nf);
    cv.set(fb, nf * 2);
    normalise(cv);
  });

  // Look-alikes (grey NCC above RELATED), as a count x count matrix of 0/1.
  const K = list.length;
  fine.related = new Uint8Array(K * K);
  for (let a = 0; a < K; a++) {
    fine.related[a * K + a] = 1;
    const ta = fine.gray.subarray(a * nf, (a + 1) * nf);
    for (let b = a + 1; b < K; b++) {
      if (dot(ta, fine.gray, b * nf, nf) > RELATED) fine.related[a * K + b] = fine.related[b * K + a] = 1;
    }
  }

  return { names: list.map((h) => h.name), count: K, aspect, crop: cropFrac, coarse, medium, fine };
}

// ---------------------------------------------------------------------------------------------------------------
// Coarse pass

// All windows of one portrait height (screen px) between plane columns sx0 and sx1. Returns the local maxima of
// the best-hero NCC as candidates { cx, cy, h, coarse, ks } (portrait centre and height in screen px; coarse = the
// ranking score: grey and colour NCC times the contrast prior; ks = the best heroes there).
function coarseScan(T, P, sx0, sx1, ph, o, rs) {
  const { w: cw, h: ch, n, gray: tpl } = T.coarse;
  const K = T.count;
  const rw = ph * T.aspect * T.crop;
  const rh = ph * T.crop;
  const fx = rw / cw; // screen px per coarse pixel
  const fy = rh / ch;
  const bw = Math.floor((sx1 - sx0) / fx);
  const bh = Math.floor(P.h / fy);
  if (bw < cw || bh < ch) return [];

  // The band shrunk so that the crop part of a portrait of this height is exactly cw x ch pixels.
  rs.setup(P.w, P.h, sx0, 0, bw * fx, bh * fy, bw, bh);
  const D = rs.apply(P.y, new Float32Array(bw * bh));
  const DC = [P.r, P.g, P.b].map((plane) => rs.apply(plane, new Float32Array(bw * bh)));

  // Integral images for the mean and contrast of every window.
  const iw = bw + 1;
  const I1 = new Float64Array(iw * (bh + 1));
  const I2 = new Float64Array(iw * (bh + 1));
  for (let y = 0; y < bh; y++) {
    let s1 = 0;
    let s2 = 0;
    for (let x = 0; x < bw; x++) {
      const v = D[y * bw + x];
      s1 += v;
      s2 += v * v;
      I1[(y + 1) * iw + x + 1] = I1[y * iw + x + 1] + s1;
      I2[(y + 1) * iw + x + 1] = I2[y * iw + x + 1] + s2;
    }
  }

  const nu = bw - cw + 1;
  const nv = bh - ch + 1;
  const score = new Float32Array(nu * nv).fill(-1);
  const arg = new Int32Array(nu * nv).fill(-1); // best hero per window
  const sig = new Float32Array(nu * nv); // contrast (luma std) per window
  const minNorm = o.minContrast * Math.sqrt(n);
  const gather = (u, v, out, at, src = D) => {
    for (let j = 0; j < ch; j++) {
      const s = (v + j) * bw + u;
      for (let i = 0; i < cw; i++) out[at + j * cw + i] = src[s + i];
    }
  };
  // Four neighbouring windows are matched together: each template value is loaded once for four dot products.
  const buf = new Float32Array(4 * n);
  const inv = new Float64Array(4);
  const best = new Float64Array(4);
  const bestK = new Int32Array(4);
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u += 4) {
      let any = false;
      for (let q = 0; q < 4; q++) {
        const uu = u + q;
        inv[q] = 0;
        if (uu >= nu) continue;
        const a = v * iw + uu;
        const b = (v + ch) * iw + uu;
        const s1 = I1[b + cw] - I1[b] - I1[a + cw] + I1[a];
        const s2 = I2[b + cw] - I2[b] - I2[a + cw] + I2[a];
        const norm = Math.sqrt(Math.max(0, s2 - (s1 * s1) / n));
        if (norm < minNorm) continue;
        inv[q] = 1 / norm;
        any = true;
        gather(uu, v, buf, q * n);
      }
      if (!any) continue;
      // Templates are zero-mean, so dot(raw window, template) / |window - mean| is the NCC.
      let b0 = -Infinity;
      let b1 = -Infinity;
      let b2 = -Infinity;
      let b3 = -Infinity;
      let k0 = 0;
      let k1 = 0;
      let k2 = 0;
      let k3 = 0;
      for (let k = 0, off = 0; k < K; k++, off += n) {
        let s0 = 0;
        let s1 = 0;
        let s2 = 0;
        let s3 = 0;
        for (let i = 0; i < n; i++) {
          const t = tpl[off + i];
          s0 += t * buf[i];
          s1 += t * buf[n + i];
          s2 += t * buf[2 * n + i];
          s3 += t * buf[3 * n + i];
        }
        if (s0 > b0) {
          b0 = s0;
          k0 = k;
        }
        if (s1 > b1) {
          b1 = s1;
          k1 = k;
        }
        if (s2 > b2) {
          b2 = s2;
          k2 = k;
        }
        if (s3 > b3) {
          b3 = s3;
          k3 = k;
        }
      }
      best[0] = b0;
      best[1] = b1;
      best[2] = b2;
      best[3] = b3;
      bestK[0] = k0;
      bestK[1] = k1;
      bestK[2] = k2;
      bestK[3] = k3;
      for (let q = 0; q < 4; q++) {
        if (!inv[q]) continue;
        score[v * nu + u + q] = best[q] * inv[q];
        arg[v * nu + u + q] = bestK[q];
        sig[v * nu + u + q] = 1 / inv[q] / Math.sqrt(n);
      }
    }
  }

  // Local maxima (ties go to the first one) above the coarse threshold, with their best heroes. Only a neighbour
  // with the same best hero can suppress a window: at 12x7 a window shifted by a pixel or two often matches some
  // other hero slightly better than the aligned window matches the right one.
  const peaks = [];
  const win = new Float32Array(n);
  const cwin = new Float32Array(n * 3);
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) {
      const i = v * nu + u;
      const s = score[i];
      if (s < o.coarseMin) continue;
      let peak = true;
      for (let dv = -1; dv <= 1 && peak; dv++) {
        for (let du = -1; du <= 1; du++) {
          const uu = u + du;
          const vv = v + dv;
          if ((!dv && !du) || uu < 0 || vv < 0 || uu >= nu || vv >= nv) continue;
          const j = vv * nu + uu;
          if (arg[j] === arg[i] && (score[j] > s || (score[j] === s && j < i))) {
            peak = false;
            break;
          }
        }
      }
      if (!peak) continue;
      gather(u, v, win, 0);
      const top = [];
      for (let k = 0; k < K; k++) {
        const d = dot(win, tpl, k * n, n);
        if (top.length < SHORTLIST || d > top[SHORTLIST - 1][0]) {
          top.push([d, k]);
          top.sort((a, b) => b[0] - a[0]);
          if (top.length > SHORTLIST) top.pop();
        }
      }
      // Ranked like the final score: grey and colour NCC with the contrast prior. Patches of game world that happen
      // to have a hero's shapes rarely have its colours too, and are dimmer than a portrait.
      DC.forEach((plane, c) => gather(u, v, cwin, c * n, plane));
      normalise(cwin);
      const colour = dot(cwin, T.coarse.colour, arg[i] * n * 3, n * 3);
      const faint = Math.min(1, sig[i] / (MIN_CONTRAST_RATIO * Math.max(T.coarse.sigma[arg[i]], 1)));
      const rank = (0.5 * s + 0.5 * colour) * faint;
      peaks.push({ cx: P.x0 + sx0 + (u + cw / 2) * fx, cy: P.y0 + (v + ch / 2) * fy, h: ph, coarse: rank, ks: top.map((t) => t[1]) });
    }
  }
  return peaks;
}

// ---------------------------------------------------------------------------------------------------------------
// Medium and fine passes

const box = (c, aspect) => ({ x: c.cx - (c.h * aspect) / 2, y: c.cy - c.h / 2, w: c.h * aspect, h: c.h });

function overlap(a, b) {
  const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ix > 0 && iy > 0 ? ix * iy : 0;
}

// Matches portrait-sized windows of one set of planes against the templates, at the medium or fine level.
class Matcher {
  constructor(T, P) {
    this.T = T;
    this.P = P;
    this.rs = new Resampler();
    this.buf = new Map([T.medium, T.fine].map((L) => [L, new Float32Array(L.n)]));
    const nf = T.fine.n;
    this.r = new Float32Array(nf);
    this.g = new Float32Array(nf);
    this.b = new Float32Array(nf);
    this.cv = new Float32Array(nf * 3);
    this.evals = 0;
  }

  // Sample the luma of the crop part of the portrait centred at (cx, cy) with height h at level L.
  sample(L, cx, cy, h) {
    const { T, P } = this;
    const rh = h * T.crop;
    const rw = rh * T.aspect;
    this.rs.setup(P.w, P.h, cx - rw / 2 - P.x0, cy - rh / 2 - P.y0, rw, rh, L.w, L.h);
    this.evals++;
    return this.rs.apply(P.y, this.buf.get(L));
  }

  // The grey window at (cx, cy, h) as a zero-mean unit vector and the templates to compare it with, or null for a
  // flat window. masked (fine level only): only the pixels outside the overlay areas (overlayMask) count.
  unit(L, cx, cy, h, masked) {
    const v = this.sample(L, cx, cy, h);
    if (normalise(v) < 1e-3) return null;
    if (!masked) return { v, tpl: L.gray };
    return { v: maskedUnit(v, L.mask, (this.mv ||= new Float32Array(L.n))), tpl: L.masked };
  }

  // Best grey NCC among the heroes ks for this window (-1 for a flat window).
  fit(L, cx, cy, h, ks, masked = false) {
    const u = this.unit(L, cx, cy, h, masked);
    if (!u) return -1;
    let best = -1;
    for (const k of ks) {
      const s = dot(u.v, u.tpl, k * L.n, L.n);
      if (s > best) best = s;
    }
    return best;
  }

  // Grey NCC at level L against every hero: { fit, ks } with the best score and the indices of the best `top`.
  rank(L, c, top, masked = false) {
    const u = this.unit(L, c.cx, c.cy, c.h, masked);
    if (!u) return { fit: -1, ks: [] };
    const scores = [];
    for (let k = 0; k < this.T.count; k++) scores.push([dot(u.v, u.tpl, k * L.n, L.n), k]);
    scores.sort((a, b) => b[0] - a[0]);
    return { fit: scores[0][0], ks: scores.slice(0, top).map((s) => s[1]) };
  }

  // Hill climbing on position and size: steps of `step` level pixels and `size` (relative), halved whenever no move
  // helps. limits (optional): { cx, cy, h, dxy, ds } keeps the window near a known slot. masked: see unit().
  refine(L, c, ks, { step = 1, minStep = 0.25, size = 0.06, maxIter = 40, limits = null, masked = false } = {}) {
    let { cx, cy, h } = c;
    let best = this.fit(L, cx, cy, h, ks, masked);
    const px = (h * this.T.crop) / L.h;
    let d = step * px;
    let ds = size;
    const ok = (x, y, hh) =>
      !limits || (Math.abs(x - limits.cx) <= limits.dxy && Math.abs(y - limits.cy) <= limits.dxy && Math.abs(hh / limits.h - 1) <= limits.ds);
    for (let iter = 0; iter < maxIter && d >= minStep * px; iter++) {
      const moves = [
        [cx + d, cy, h],
        [cx - d, cy, h],
        [cx, cy + d, h],
        [cx, cy - d, h],
        [cx, cy, h * (1 + ds)],
        [cx, cy, h / (1 + ds)],
      ];
      let bestMove = null;
      for (const m of moves) {
        if (!ok(...m)) continue;
        const s = this.fit(L, m[0], m[1], m[2], ks, masked);
        if (s > best + 1e-4) {
          best = s;
          bestMove = m;
        }
      }
      if (bestMove) [cx, cy, h] = bestMove;
      else {
        d /= 2;
        ds /= 2;
      }
    }
    return Object.assign(c, { cx, cy, h, fit: best });
  }

  // Final score against every hero: grey and colour NCC averaged, scored down for a window with much less contrast
  // than the hero image. With robust, weak results get a second look: the best heroes are scored again with the
  // robust NCC (an overlay such as the respawn timer ignored), with less weight on colour for a grey window and a
  // lower contrast bar (dead heroes). Only used where a portrait is known to be (grid slots, layout): in the open
  // search it would also let random background match. Returns the best 5 as [{ k, score }].
  classify(c, robust = false) {
    const { T } = this;
    const L = T.fine;
    const { n, gray, colour, rho, sigma } = L;
    const gy = this.sample(L, c.cx, c.cy, c.h);
    this.rs.apply(this.P.r, this.r);
    this.rs.apply(this.P.g, this.g);
    this.rs.apply(this.P.b, this.b);
    const rhoW = colourfulness(this.r, this.g, this.b, gy, n, L.mask);
    const sigmaW = normalise(gy) / Math.sqrt(n);
    if (sigmaW < 1e-3) return [];
    this.cv.set(this.r, 0);
    this.cv.set(this.g, n);
    this.cv.set(this.b, n * 2);
    normalise(this.cv);
    const out = [];
    for (let k = 0; k < T.count; k++) {
      const gs = dot(gy, gray, k * n, n);
      if (gs < 0.2) continue;
      const cs = dot(this.cv, colour, k * n * 3, n * 3);
      // Portraits are full-contrast UI images; a dim patch of game world that happens to have the right shape is not.
      const faint = Math.min(1, sigmaW / (MIN_CONTRAST_RATIO * Math.max(sigma[k], 1)));
      out.push({ k, score: (0.5 * gs + 0.5 * cs) * faint });
    }
    out.sort((a, b) => b.score - a.score);
    if (robust && !(out[0]?.score >= CLEAR_MATCH)) {
      const w = (this.w ||= new Float32Array(n));
      const res = (this.res ||= new Float32Array(n));
      // Second look at the best plain matches and the best matches without the centre of the portrait (a timer
      // over a dead hero's portrait can push the right hero far down the plain ranking).
      const mv = maskedUnit(gy, L.mask, (this.mv ||= new Float32Array(n)));
      const byMask = [];
      for (let k = 0; k < T.count; k++) byMask.push([dot(mv, L.masked, k * n, n), k]);
      byMask.sort((a, b) => b[0] - a[0]);
      const look = out.slice(0, ROBUST_TOP);
      for (const [, k] of byMask.slice(0, ROBUST_TOP)) {
        if (!look.some((o) => o.k === k)) {
          const o = { k, score: -1 };
          out.push(o);
          look.push(o);
        }
      }
      const fits = look.map((o) => {
        const { ncc, coverage } = robustNcc(gy, gray, o.k * n, n, w, res, L.floor);
        const cs = weightedNcc(this.cv, colour, o.k * n * 3, n, 3, w);
        // Colour counts less when the window is less colourful than the hero image, and not at all for a grey
        // window (dead heroes are shown grey); the contrast bar is lower (they are darkened too).
        const ratio = rhoW / Math.max(rho[o.k], 0.05);
        const alpha = 0.5 * clamp((ratio - GREY_RATIO) / (COLOUR_RATIO - GREY_RATIO), 0, 1);
        const faint = Math.min(1, sigmaW / (SLOT_CONTRAST_RATIO * Math.max(sigma[o.k], 1)));
        // Pixels outside the overlay areas always count fully, so only the overlay areas can lose weight: penalise
        // ignoring more than OVERLAY_FREE of them (a fit that explains away most of the window is a poor fit).
        const ignored = 1 - (coverage * n - L.free) / Math.max(n - L.free, 1);
        const covered = Math.min(1, 1 + OVERLAY_FREE - ignored);
        return { o, fit: (1 - alpha) * ncc + alpha * cs, covered, faint };
      });
      const { related } = L;
      for (const f of fits) {
        // Lead over the best hero that is not a look-alike of this one (ratio test): a dead hero under its timer
        // fits ~0.2-0.6 better than any other hero, game world or an unknown hero's portrait at most ~0.15.
        let rival = 0;
        for (const g of fits) if (!related[f.o.k * T.count + g.o.k] && g.fit > rival) rival = g.fit;
        const distinct = clamp((f.fit - rival) / DISTINCT_LEAD, 0, 1);
        const score = Math.max(0, f.fit) ** ROBUST_POWER * f.covered * f.faint * distinct;
        if (score > f.o.score) f.o.score = score;
      }
      out.sort((a, b) => b.score - a.score);
    }
    return out.slice(0, 5);
  }

  // Fine pass for one candidate: refine on a grey shortlist, classify, and if the winner was not on the
  // shortlist refine again for it. With limits (a known slot: grid fill-in, layout) scoring is robust, position and
  // size are fitted outside the overlay areas only (a respawn timer would pull the window off a dead hero's
  // portrait), and the unrefined box is classified too and the better answer kept.
  examine(c, limits = null) {
    const L = this.T.fine;
    const robust = !!limits;
    const start = { ...c };
    const { ks } = this.rank(L, c, SHORTLIST, robust);
    if (!ks.length) return { ...c, top: [] };
    this.refine(L, c, ks, { step: 1, size: 0.03, minStep: 0.2, limits, masked: robust });
    let top = this.classify(c, robust);
    if (top.length && !ks.includes(top[0].k)) {
      this.refine(L, c, [top[0].k], { step: 0.5, size: 0.02, minStep: 0.2, limits, masked: robust });
      top = this.classify(c, robust);
    }
    if (limits && !(top[0]?.score >= CLEAR_MATCH)) {
      const still = this.classify(start, robust);
      if (still.length && (!top.length || still[0].score > top[0].score)) return { ...start, top: still };
    }
    return { ...c, top };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Putting detections together

const bestScore = (c) => (c.top.length ? c.top[0].score : -1);

// Greedy: best score first; a candidate may not overlap an accepted portrait, takes its best hero not yet taken
// (scores >= minScore only), and each side holds at most 5.
function assign(cands, T, W, minScore) {
  const accepted = [];
  const used = new Set();
  const perSide = { left: 0, right: 0 };
  const sorted = cands.filter((c) => bestScore(c) >= minScore).sort((a, b) => bestScore(b) - bestScore(a));
  for (const c of sorted) {
    const b = box(c, T.aspect);
    if (accepted.some((a) => overlap(a.box, b) > 0.25 * Math.min(a.box.w * a.box.h, b.w * b.h))) continue;
    const side = c.cx < W / 2 ? 'left' : 'right';
    if (perSide[side] >= 5) continue;
    const pick = c.top.findIndex((t) => t.score >= minScore && !used.has(t.k));
    if (pick < 0) continue;
    used.add(c.top[pick].k);
    perSide[side]++;
    accepted.push({ c, box: b, side, k: c.top[pick].k, score: c.top[pick].score, next: c.top.find((t, i) => i !== pick) });
  }
  return accepted;
}

// The top bar is one row of 5 + 5 evenly spaced slots mirrored around the screen centre: every portrait has the
// same height and vertical centre, and its distance from the screen centre is d = g + m * pitch, with m = 0..4
// counting outwards from the clock. Finds the row (cy, h) and (g, pitch) that explain the most candidates (sum of
// the best score per slot), from every pair of candidates. Ties (two portraits 3 slots apart fit 2 wide gaps as
// well as 3 narrow ones) go to the pitch closest to TYPICAL_PITCH portrait widths (the portraits sit close
// together), then to the grid that puts the portrait nearest the clock in the slot next to it (always true in
// game; during the draft that slot may still be empty on both sides). Null when no two candidates agree.
function fitRowGrid(cands, W, aspect) {
  const mid = W / 2;
  const items = cands.map((c) => ({ c, d: Math.abs(c.cx - mid), left: c.cx < mid, score: bestScore(c) }));
  const fits = (it, row) => Math.abs(it.c.h / row.h - 1) <= 0.15 && Math.abs(it.c.cy - row.cy) <= 0.25 * row.h;
  const support = (row) => {
    const slots = new Map();
    for (const it of items) {
      if (!fits(it, row)) continue;
      const m = (it.d - row.g) / row.p;
      const r = Math.round(m);
      if (r < 0 || r > 4 || Math.abs(m - r) * row.p > 0.15 * row.p + 1) continue;
      const key = `${it.left ? 'L' : 'R'}${r}`;
      const prev = slots.get(key);
      if (!prev || prev.it.score < it.score) slots.set(key, { it, m: r });
    }
    return [...slots.values()];
  };
  let best = null;
  for (const a of items) {
    for (const b of items) {
      const diff = b.d - a.d;
      const w = ((a.c.h + b.c.h) / 2) * aspect;
      if (diff < 0.8 * w || !fits(b, a.c)) continue;
      const base = { cy: (a.c.cy + b.c.cy) / 2, h: (a.c.h + b.c.h) / 2 };
      for (let md = 1; md <= 4; md++) {
        const p = diff / md;
        if (p < 0.95 * w || p > 2 * w) continue;
        for (let m = 0; m + md <= 4; m++) {
          const g = a.d - m * p;
          if (g < 0.45 * w) continue;
          const on = support({ ...base, g, p });
          const sum = on.reduce((s, x) => s + x.it.score, 0);
          const gapErr = Math.abs(p / w - TYPICAL_PITCH);
          const better =
            !best ||
            sum > best.sum + 1e-6 ||
            (sum > best.sum - 1e-6 && (gapErr < best.gapErr - 0.05 || (gapErr < best.gapErr + 0.05 && g > best.g)));
          if (better) best = { g, p, sum, on, gapErr };
        }
      }
    }
  }
  if (!best) return null;
  // Least squares d = g + m * pitch over the supporting candidates; row from their medians.
  const { on } = best;
  const mm = on.reduce((s, x) => s + x.m, 0) / on.length;
  const dm = on.reduce((s, x) => s + x.it.d, 0) / on.length;
  let sxy = 0;
  let sxx = 0;
  for (const x of on) {
    sxy += (x.m - mm) * (x.it.d - dm);
    sxx += (x.m - mm) ** 2;
  }
  const p = sxx > 0 ? sxy / sxx : best.p;
  return {
    mid,
    g: dm - p * mm,
    p,
    cy: median(on.map((x) => x.it.c.cy)),
    h: median(on.map((x) => x.it.c.h)),
    count: on.length,
  };
}

// How many slots out from the clock a candidate on the grid's row sits (d = g + m * pitch, may be negative or
// above 4 when extrapolating), or null when it is off the row or between slots.
function latticeIndex(grid, c) {
  if (Math.abs(c.h / grid.h - 1) > 0.2 || Math.abs(c.cy - grid.cy) > 0.3 * grid.h) return null;
  const m = (Math.abs(c.cx - grid.mid) - grid.g) / grid.p;
  const r = Math.round(m) || 0; // no -0
  return Math.abs(m - r) * grid.p > 0.2 * grid.p + 1 ? null : r;
}

// Slot (0..4 left to right on each side) of a candidate on the grid, or null if it is not on the grid.
function gridSlot(grid, c) {
  const r = latticeIndex(grid, c);
  if (r == null || r < 0 || r > 4) return null;
  return c.cx < grid.mid ? 4 - r : r;
}

function toHero(a, T) {
  return {
    name: T.names[a.k],
    score: Math.round(a.score * 1000) / 1000,
    // How far ahead of the next best hero it was (small = the two look alike).
    margin: Math.round((a.score - (a.next ? a.next.score : 0)) * 1000) / 1000,
    x: round1(a.box.x),
    y: round1(a.box.y),
    w: round1(a.box.w),
    h: round1(a.box.h),
    side: a.side,
    slot: a.slot ?? null,
  };
}

// Classifies every empty slot of the grid directly (robust scoring, like the layout path) and assigns again.
// The grid takes the portrait nearest the clock as the slot next to it. If both of those were missed (dead heroes,
// empty in the draft) everything sits one slot further out, so slots inside it are tried as well, as far as the 5
// slots per side allow; a portrait found there moves the grid inwards. A slot between portraits already found
// (either side: the bar is mirrored) needs minScore, one beyond them rowScore, as the grid may reach past the end
// of the bar there; with strict set every slot needs rowScore. Returns { grid, accepted, cands } with slots set.
function fillIn(m, T, W, o, grid, accepted, cands, strict) {
  const found = accepted.map((a) => latticeIndex(grid, a.c));
  const [lo, hi] = [Math.min(...found), Math.max(...found)];
  const w = grid.h * T.aspect;
  for (const side of ['left', 'right']) {
    for (let r = hi - 4; r <= 4; r++) {
      const d = grid.g + r * grid.p;
      if (d < 0.45 * w || accepted.some((a) => a.side === side && latticeIndex(grid, a.c) === r)) continue;
      const c = { cx: side === 'left' ? grid.mid - d : grid.mid + d, cy: grid.cy, h: grid.h };
      if (c.cx - w / 2 < 0 || c.cx + w / 2 > W) continue;
      const need = strict || r < lo || r > hi ? o.rowScore : o.minScore;
      cands.push({ ...m.examine(c, { ...c, dxy: o.jitter * c.h, ds: 0.08 }), need });
    }
  }
  cands = cands.filter((c) => latticeIndex(grid, c) != null && bestScore(c) >= (c.need ?? o.minScore));
  accepted = assign(cands, T, W, o.minScore);
  // Only 5 slots per side: keep the 5-slot window (the grid as found, or moved inwards) with the most score.
  let shift = 0;
  let bestSum = -1;
  for (let sh = Math.min(0, ...accepted.map((a) => latticeIndex(grid, a.c))); sh <= 0; sh++) {
    const sum = accepted.reduce((t, a) => {
      const r = latticeIndex(grid, a.c);
      return r >= sh && r <= sh + 4 ? t + a.score : t;
    }, 0);
    if (sum > bestSum + 1e-6 || (sum > bestSum - 1e-6 && sh === 0)) [shift, bestSum] = [sh, sum];
  }
  grid = { ...grid, g: grid.g + shift * grid.p };
  if (accepted.some((a) => gridSlot(grid, a.c) == null)) {
    cands = cands.filter((c) => gridSlot(grid, c) != null);
    accepted = assign(cands, T, W, o.minScore);
  }
  for (const a of accepted) a.slot = gridSlot(grid, a.c);
  return { grid, accepted, cands };
}

function fullSearch(screen, T, o) {
  const W = screen.width;
  const H = screen.height;
  const x0 = clamp(Math.floor(o.xFrom * W), 0, W - 1);
  const x1 = clamp(Math.ceil(o.xTo * W), x0 + 1, W);
  const y1 = clamp(Math.ceil(o.bandBottom * H), 1, H);
  // The whole width of the band: the search covers [x0, x1), but a grid slot outside it may still be classified.
  const P = toPlanes(screen, 0, 0, W, y1);
  const rs = new Resampler();

  // 1. Coarse: every window at every size. The best maxRefine go on, shared out between the sizes (details inside
  //    big portraits match small heroes well and would otherwise crowd out the big ones); a peak that repeats a
  //    better one (same hero, same size) is skipped. Not across sizes: a detail of a portrait at the next size down
  //    often ranks above the whole portrait, and the medium pass cannot grow it by 20% to the right size.
  const t0 = performance.now();
  const perScale = o.scales.map((s) => coarseScan(T, P, x0, x1, s * H, o, rs).sort((a, b) => b.coarse - a.coarse));
  const t1 = performance.now();
  const peaks = perScale.flat().sort((a, b) => b.coarse - a.coarse);
  const quota = Math.ceil(o.maxRefine / (2 * o.scales.length));
  const distinct = [];
  const take = (p) => {
    if (distinct.length >= o.maxRefine || distinct.includes(p)) return;
    const dup = distinct.some(
      (q) =>
        q.ks[0] === p.ks[0] &&
        Math.abs(q.cx - p.cx) <= 0.2 * Math.min(p.h, q.h) * T.aspect &&
        Math.abs(q.cy - p.cy) <= 0.2 * Math.min(p.h, q.h) &&
        Math.max(p.h, q.h) / Math.min(p.h, q.h) < 1.1,
    );
    if (!dup) distinct.push(p);
  };
  for (const list of perScale) list.slice(0, quota).forEach(take);
  for (const p of peaks) {
    if (distinct.length >= o.maxRefine) break;
    take(p);
  }

  // 2. Medium: the best maxRefine peaks (by coarse score) get a quick position/size refinement at 16x9 on their
  //    best heroes. Textured game world fools the 12x7 pass now and then; at 16x9 real portraits stand out.
  const m = new Matcher(T, P);
  const verified = [];
  for (const p of distinct) {
    // Start from the best of three sizes: the coarse sizes are ~20% apart.
    let h = p.h;
    let fit = -2;
    for (const f of [1, 1.1, 1 / 1.1]) {
      const s = m.fit(T.medium, p.cx, p.cy, p.h * f, p.ks);
      if (s > fit) [fit, h] = [s, p.h * f];
    }
    const c = m.refine(T.medium, { cx: p.cx, cy: p.cy, h }, p.ks, { step: 1, size: 0.05, minStep: 0.3, maxIter: 12 });
    if (c.fit >= o.verifyMin) verified.push({ ...c, box: box(c, T.aspect) });
  }
  verified.sort((a, b) => b.fit - a.fit);
  const t2 = performance.now();
  const kept = [];
  for (const c of verified) {
    // Portraits do not overlap: skip a box mostly covered by a better one (also a detail inside a big portrait).
    if (kept.some((k) => overlap(k.box, c.box) > 0.5 * Math.min(k.box.w * k.box.h, c.box.w * c.box.h))) continue;
    kept.push(c);
    if (kept.length >= o.maxCandidates) break;
  }

  // 3. Fine: refine and classify the best ones.
  let cands = kept.map((c) => m.examine({ cx: c.cx, cy: c.cy, h: c.h }));
  const open = cands;

  // 4. The row: with 3+ strong candidates on one evenly spaced row, only candidates on it count, and every empty
  //    slot of the row is classified directly (robust scoring, like the layout path). That finds what the coarse
  //    passes ranked too low, such as dead heroes (grey, with a respawn timer on top).
  let grid = fitRowGrid(cands.filter((c) => bestScore(c) >= o.rowScore), W, T.aspect);
  let accepted;
  if (grid && grid.count >= 3) {
    cands = cands.filter((c) => { const r = latticeIndex(grid, c); return r != null && r >= 0 && r <= 4; });
    accepted = assign(cands, T, W, o.minScore);
    ({ grid, accepted, cands } = fillIn(m, T, W, o, grid, accepted, cands, false));
  } else {
    // 5. No row of three (empty bar, first picks of the draft): only very confident portraits, in the row of the
    //    best one. If two of them agree on the spacing, the other slots are tried too (needing rowScore).
    accepted = assign(cands, T, W, o.loneScore);
    if (accepted.length) {
      const row = accepted[0].c;
      accepted = accepted.filter((a) => Math.abs(a.c.h / row.h - 1) <= 0.15 && Math.abs(a.c.cy - row.cy) <= 0.25 * row.h);
    }
    grid = fitRowGrid(accepted.map((a) => a.c), W, T.aspect);
    if (grid) {
      accepted = accepted.filter((a) => gridSlot(grid, a.c) != null);
      cands = accepted.map((a) => a.c);
      ({ grid, accepted, cands } = fillIn(m, T, W, o, grid, accepted, cands, true));
    } else {
      // Slots counted from the clock outwards.
      for (const side of ['left', 'right']) {
        const mine = accepted.filter((a) => a.side === side).sort((a, b) => Math.abs(a.c.cx - W / 2) - Math.abs(b.c.cx - W / 2));
        mine.forEach((a, i) => (a.slot = side === 'left' ? 4 - i : i));
      }
    }
  }
  const heroes = accepted.map((a) => toHero(a, T)).sort((a, b) => a.x - b.x);
  const res = { heroes, scale: heroes.length ? Math.round((median(heroes.map((h) => h.h)) / H) * 10000) / 10000 : null };
  if (o.debug) {
    // For tuning on real screenshots: how many candidates each stage kept, where the time went, and the best
    // candidates whether accepted or not.
    const t3 = performance.now();
    res.debug = {
      peaks: peaks.length,
      refined: distinct.length,
      examined: open.length,
      evals: m.evals,
      ms: { coarse: Math.round(t1 - t0), medium: Math.round(t2 - t1), fine: Math.round(t3 - t2) },
      grid: grid && { g: round1(grid.g), pitch: round1(grid.p), cy: round1(grid.cy), h: round1(grid.h), count: grid.count },
      candidates: [...new Set([...open, ...cands])]
        .filter((c) => c.top.length)
        .sort((a, b) => bestScore(b) - bestScore(a))
        .slice(0, 20)
        .map((c) => ({ name: T.names[c.top[0].k], score: Math.round(bestScore(c) * 1000) / 1000, cx: round1(c.cx), cy: round1(c.cy), h: round1(c.h) })),
    };
  }
  return res;
}

// Fast path: classify only at the learned slot rectangles (with a little position/size search).
function layoutSearch(screen, T, o) {
  const L = o.layout;
  const W = screen.width;
  const H = screen.height;
  const hMax = Math.max(...L.slots.map((s) => s.h));
  const margin = Math.ceil(o.jitter * hMax + 0.1 * hMax + 2);
  const x0 = clamp(Math.floor(Math.min(...L.slots.map((s) => s.x)) - margin), 0, W - 1);
  const y0 = clamp(Math.floor(Math.min(...L.slots.map((s) => s.y)) - margin), 0, H - 1);
  const x1 = clamp(Math.ceil(Math.max(...L.slots.map((s) => s.x + s.w)) + margin), x0 + 1, W);
  const y1 = clamp(Math.ceil(Math.max(...L.slots.map((s) => s.y + s.h)) + margin), y0 + 1, H);
  const P = toPlanes(screen, x0, y0, x1 - x0, y1 - y0);
  const m = new Matcher(T, P);

  const found = L.slots.map((s) => {
    const c = { cx: s.x + s.w / 2, cy: s.y + s.h / 2, h: s.h };
    const limits = { cx: c.cx, cy: c.cy, h: c.h, dxy: o.jitter * s.h, ds: 0.08 };
    return { slot: s, ...m.examine(c, limits) };
  });

  // Each hero once: the better-scoring slot keeps it, the other falls back to its next best.
  const used = new Set();
  const picked = new Map();
  const order = found.map((f, i) => i).sort((a, b) => (found[b].top[0]?.score ?? -1) - (found[a].top[0]?.score ?? -1));
  for (const i of order) {
    const pick = found[i].top.findIndex((t) => t.score >= o.minScore && !used.has(t.k));
    if (pick < 0) continue;
    used.add(found[i].top[pick].k);
    picked.set(i, pick);
  }
  const heroes = [];
  const missing = [];
  found.forEach((f, i) => {
    if (!picked.has(i)) {
      missing.push({ side: f.slot.side, slot: f.slot.slot });
      return;
    }
    const pick = picked.get(i);
    const a = { k: f.top[pick].k, score: f.top[pick].score, next: f.top.find((t, j) => j !== pick), box: box(f, T.aspect), side: f.slot.side, slot: f.slot.slot };
    heroes.push(toHero(a, T));
  });
  heroes.sort((a, b) => a.x - b.x);
  const res = { heroes, missing, scale: L.scale };
  if (o.debug) res.debug = { evals: m.evals };
  return res;
}

// screen: { width, height, data, format }; templates: from prepareTemplates(). See DEFAULTS for opts.
// Returns { heroes: [{ name, score, margin, x, y, w, h, side, slot }], scale, ms, searched, width, height }
// (heroes left to right; with a layout also missing: [{ side, slot }] for the slots without a hero).
export function detectTopBar(screen, templates, opts = {}) {
  const t0 = performance.now();
  checkImage(screen, 'screen');
  if (!templates || !templates.count || !templates.fine) throw new Error('detectTopBar: templates must come from prepareTemplates()');
  const o = { ...DEFAULTS, ...opts };
  const T = templates;
  let res = null;
  let searched = 'full';
  const L = o.layout;
  if (L && L.slots?.length && L.width === screen.width && L.height === screen.height) {
    res = layoutSearch(screen, T, o);
    searched = 'layout';
    if (o.fallback && res.heroes.length < o.minLayoutHeroes) {
      const full = fullSearch(screen, T, o);
      const total = (r) => r.heroes.reduce((t, h) => t + h.score, 0);
      if (full.heroes.length > res.heroes.length || (full.heroes.length === res.heroes.length && total(full) >= total(res))) {
        res = full;
        searched = 'full';
      }
    }
  }
  if (!res) {
    res = fullSearch(screen, T, o);
    searched = 'full';
  }
  const out = { heroes: res.heroes, scale: res.scale, ms: Math.round(performance.now() - t0), searched, width: screen.width, height: screen.height };
  if (res.missing) out.missing = res.missing;
  if (res.debug) out.debug = res.debug;
  return out;
}

// From a full detection with >= 8 confident heroes (score >= opts.minScore, default rowScore: weak matches, such as a
// dead hero that barely fits, do not count) in one row, the 10 slot rectangles (missing slots filled in from the
// even spacing: centre x = start(side) + slot * pitch). Heroes off that spacing (a wrong slot number) are dropped,
// worst first, as long as 8 remain. Returns null when the detection is not good enough.
export function learnLayout(result, { minScore = DEFAULTS.rowScore } = {}) {
  const all = ((result && result.heroes) || []).filter((h) => h.score >= minScore && h.slot != null);
  if (all.length < 8 || !result.width || !result.height) return null;
  const hMed = median(all.map((h) => h.h));
  const cyMed = median(all.map((h) => h.y + h.h / 2));
  let list = all.filter((h) => Math.abs(h.h / hMed - 1) <= 0.12 && Math.abs(h.y + h.h / 2 - cyMed) <= 0.25 * hMed);
  const sides = ['left', 'right'];
  const w = median(list.map((h) => h.w));
  let fit = null;
  for (;;) {
    if (list.length < 8 || sides.some((s) => !list.some((h) => h.side === s))) return null;
    fit = fitSlots(list);
    if (!fit) return null;
    const err = (h) => Math.abs(h.x + h.w / 2 - ((h.side === 'left' ? fit.aL : fit.aR) + h.slot * fit.pitch));
    const worst = list.reduce((a, b) => (err(b) > err(a) ? b : a));
    if (err(worst) <= 0.3 * Math.abs(fit.pitch)) break;
    list = list.filter((h) => h !== worst);
  }
  const { aL, aR, pitch } = fit;
  if (!(pitch >= 0.9 * w && pitch <= 2 * w)) return null;
  const y = median(list.map((h) => h.y));
  const slots = [];
  for (const side of sides) {
    for (let k = 0; k < 5; k++) {
      const cx = (side === 'left' ? aL : aR) + k * pitch;
      slots.push({ side, slot: k, x: round1(cx - w / 2), y: round1(y), w: round1(w), h: round1(hMed) });
    }
  }
  return { width: result.width, height: result.height, scale: Math.round((hMed / result.height) * 10000) / 10000, pitch: round1(pitch), slots };
}

// Least squares for cx = a_side + slot * pitch, pitch shared by both sides: { aL, aR, pitch } or null.
function fitSlots(list) {
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const v = [0, 0, 0];
  for (const h of list) {
    const row = [h.side === 'left' ? 1 : 0, h.side === 'right' ? 1 : 0, h.slot];
    const cx = h.x + h.w / 2;
    for (let i = 0; i < 3; i++) {
      v[i] += row[i] * cx;
      for (let j = 0; j < 3; j++) A[i][j] += row[i] * row[j];
    }
  }
  const sol = solve3(A, v);
  return sol && { aL: sol[0], aR: sol[1], pitch: sol[2] };
}

// Solves the 3x3 system A x = v (Gaussian elimination with partial pivoting); null when singular.
function solve3(A, v) {
  const M = A.map((row, i) => [...row, v[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j < 4; j++) M[r][j] -= f * M[c][j];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}
