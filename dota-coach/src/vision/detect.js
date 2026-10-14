// Recognises the hero portraits in the Dota 2 top bar from a screenshot.
//
// Game State Integration never tells a third-party app which heroes the enemies picked, so the Electron app grabs
// the screen and asks this module which of the known hero images are shown in the top bar: 5 Radiant portraits
// left of the centre clock and 5 Dire portraits right of it in game, or the row of picked heroes during the draft.
//
// Pure functions on plain image objects { width, height, data, format }: data holds 4 bytes per pixel and format is
// 'rgba' or 'bgra' (Electron's nativeImage.toBitmap() is BGRA on Windows). Node built-ins only, no dependencies.
//
// How it works (more in README.md next to this file):
//   1. Coarse pass: the top band of the screen is shrunk once per portrait size in opts.scales so that a portrait
//      becomes 12x7 grey pixels, and every window is compared with every hero by normalised cross-correlation
//      (NCC: insensitive to brightness and contrast). Local maxima become candidates.
//   2. Fine pass: each candidate's position and size are refined by hill climbing at 32x18, then it is classified
//      against all heroes with a grey + colour NCC score (grey only when the portrait is greyed out: dead hero).
//   3. Portraits do not overlap, each hero is shown once, at most 5 per side, and all portraits share one row.
//   4. learnLayout() remembers the 10 slot rectangles, so later frames only classify those (a few milliseconds).

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
  coarseMin: 0.55, // 12x7 NCC a window needs to become a candidate
  maxVerify: 1500, // at most this many coarse peaks (best first) get the 16x9 check
  verifyMin: 0.6, // 16x9 NCC a candidate needs after the check
  maxCandidates: 40, // candidates (best 16x9 score first) that get the fine pass
  minContrast: 6, // windows flatter than this (std of luma, 0..255) are skipped: empty bar, plain UI
  jitter: 0.12, // layout path: how far (fraction of the portrait height) a portrait may have moved
  fallback: true, // layout path: run a full search when no slot holds a hero (the layout is stale)
};

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
// greyed-out (dead) portrait drops to ~0. Used to decide how much the colour score may count.
function colourfulness(r, g, b, y, n) {
  let c = 0;
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const cr = r[i] - y[i];
    const cb = b[i] - y[i];
    c += cr * cr + cb * cb;
    s += y[i];
    s2 += y[i] * y[i];
  }
  const varY = s2 / n - (s / n) * (s / n);
  return Math.sqrt(c / n) / Math.sqrt(Math.max(varY, 1));
}

// NCC that ignores pixels which do not fit: iteratively reweighted least squares with Tukey's biweight on the
// residuals of the best linear fit x ~ a + b*t (scale from the median absolute residual). A respawn timer, a cursor
// or another overlay on part of a portrait then barely lowers the score. Writes the pixel weights (0..1) into w and
// returns { ncc, coverage } (coverage = mean weight, 1 when every pixel fits). x, t: zero-mean unit vectors.
function robustNcc(x, t, off, n, w, res) {
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
    const sorted = res.slice(0, n).sort();
    const c = 4.685 * 1.4826 * Math.max(sorted[n >> 1], 1e-4);
    for (let i = 0; i < n; i++) {
      const u = res[i] / c;
      w[i] = u < 1 ? (1 - u * u) ** 2 : 0;
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
//   coarse: 12x7 grey (opts.coarseSize), medium: 16x9 grey (opts.mediumSize), all zero-mean with unit length
//   fine:   32x18 grey and colour (r, g, b planes normalised together), plus how colourful it is (opts.fineSize)
export function prepareTemplates(heroes, opts = {}) {
  const list = (heroes || []).filter((h) => h && h.name && h.image);
  if (!list.length) throw new Error('prepareTemplates: no hero images');
  const cropFrac = opts.crop ?? 0.9;
  const level = ([w, h]) => ({ w, h, n: w * h, gray: new Float32Array(list.length * w * h) });
  const coarse = level(opts.coarseSize || [12, 7]);
  const medium = level(opts.mediumSize || [16, 9]);
  const fine = level(opts.fineSize || [32, 18]);
  const nf = fine.n;
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
      normalise(rs.apply(P.y, L.gray.subarray(k * L.n, (k + 1) * L.n)));
    }
    rs.setup(P.w, P.h, rx, ry, rw, rh, fine.w, fine.h);
    const gy = rs.apply(P.y, fine.gray.subarray(k * nf, (k + 1) * nf));
    rs.apply(P.r, fr);
    rs.apply(P.g, fg);
    rs.apply(P.b, fb);
    fine.rho[k] = colourfulness(fr, fg, fb, gy, nf);
    fine.sigma[k] = normalise(gy) / Math.sqrt(nf);
    const cv = fine.colour.subarray(k * nf * 3, (k + 1) * nf * 3);
    cv.set(fr, 0);
    cv.set(fg, nf);
    cv.set(fb, nf * 2);
    normalise(cv);
  });

  return { names: list.map((h) => h.name), count: list.length, aspect, crop: cropFrac, coarse, medium, fine };
}

// ---------------------------------------------------------------------------------------------------------------
// Coarse pass

// All windows of one portrait height (screen px) in the band. Returns the local maxima of the best-hero NCC as
// candidates { cx, cy, h, coarse, ks } (portrait centre and height in screen px; ks = the best heroes there).
const SHORTLIST = 6;
const ROBUST_TOP = 12; // heroes per window that get the robust score
// Open search: a window with less than this share of the hero image's contrast (luma std) is scored down.
const MIN_CONTRAST_RATIO = 0.5;
function coarseScan(T, P, ph, o, rs) {
  const { w: cw, h: ch, n, gray: tpl } = T.coarse;
  const K = T.count;
  const rw = ph * T.aspect * T.crop;
  const rh = ph * T.crop;
  const fx = rw / cw; // screen px per coarse pixel
  const fy = rh / ch;
  const bw = Math.floor(P.w / fx);
  const bh = Math.floor(P.h / fy);
  if (bw < cw || bh < ch) return [];

  // The band shrunk so that the crop part of a portrait of this height is exactly cw x ch pixels.
  rs.setup(P.w, P.h, 0, 0, bw * fx, bh * fy, bw, bh);
  const D = rs.apply(P.y, new Float32Array(bw * bh));

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
  const minNorm = o.minContrast * Math.sqrt(n);
  const gather = (u, v, out, at) => {
    for (let j = 0; j < ch; j++) {
      const s = (v + j) * bw + u;
      for (let i = 0; i < cw; i++) out[at + j * cw + i] = D[s + i];
    }
  };
  // Four neighbouring windows are matched together: each template value is loaded once for four dot products.
  const buf = new Float32Array(4 * n);
  const inv = new Float64Array(4);
  const best = new Float64Array(4);
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
        if (s0 > b0) b0 = s0;
        if (s1 > b1) b1 = s1;
        if (s2 > b2) b2 = s2;
        if (s3 > b3) b3 = s3;
      }
      best[0] = b0;
      best[1] = b1;
      best[2] = b2;
      best[3] = b3;
      for (let q = 0; q < 4; q++) if (inv[q]) score[v * nu + u + q] = best[q] * inv[q];
    }
  }

  // Local maxima (ties go to the first one) above the coarse threshold, with their best heroes.
  const peaks = [];
  const win = new Float32Array(n);
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
          if (score[j] > s || (score[j] === s && j < i)) {
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
      peaks.push({ cx: P.x0 + (u + cw / 2) * fx, cy: P.y0 + (v + ch / 2) * fy, h: ph, coarse: s, ks: top.map((t) => t[1]) });
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
const iou = (a, b) => {
  const i = overlap(a, b);
  return i / (a.w * a.h + b.w * b.h - i);
};

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

  // Best grey NCC among the heroes ks for this window (-1 for a flat window).
  fit(L, cx, cy, h, ks) {
    const v = this.sample(L, cx, cy, h);
    if (normalise(v) < 1e-3) return -1;
    let best = -1;
    for (const k of ks) {
      const s = dot(v, L.gray, k * L.n, L.n);
      if (s > best) best = s;
    }
    return best;
  }

  // Grey NCC at the fine level against every hero; the indices of the best `top`.
  shortlist(c, top) {
    const L = this.T.fine;
    const v = this.sample(L, c.cx, c.cy, c.h);
    if (normalise(v) < 1e-3) return [];
    const scores = [];
    for (let k = 0; k < this.T.count; k++) scores.push([dot(v, L.gray, k * L.n, L.n), k]);
    scores.sort((a, b) => b[0] - a[0]);
    return scores.slice(0, top).map((s) => s[1]);
  }

  // Hill climbing on position and size: steps of `step` level pixels and `size` (relative), halved whenever no move
  // helps. limits (optional): { cx, cy, h, dxy, ds } keeps the window near a known slot.
  refine(L, c, ks, { step = 1, minStep = 0.25, size = 0.06, maxIter = 40, limits = null } = {}) {
    let { cx, cy, h } = c;
    let best = this.fit(L, cx, cy, h, ks);
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
        const s = this.fit(L, m[0], m[1], m[2], ks);
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

  // Final score against every hero: grey NCC blended with colour NCC. The colour part counts up to 50%, less when
  // the window is less colourful than the hero image (dead heroes are shown grey). With robust, the best few are
  // scored again with the robust NCC (an overlay such as the respawn timer ignored, scaled down by how much was
  // ignored). Robust scoring is only used where a portrait is known to be (grid slots, layout): in the open search
  // it would also let random background match. Returns the best 5 as [{ k, score }].
  classify(c, robust = false) {
    const { T } = this;
    const L = T.fine;
    const { n, gray, colour, rho, sigma } = L;
    const gy = this.sample(L, c.cx, c.cy, c.h);
    this.rs.apply(this.P.r, this.r);
    this.rs.apply(this.P.g, this.g);
    this.rs.apply(this.P.b, this.b);
    const rhoW = colourfulness(this.r, this.g, this.b, gy, n);
    const sigmaW = normalise(gy) / Math.sqrt(n);
    if (sigmaW < 1e-3) return [];
    this.cv.set(this.r, 0);
    this.cv.set(this.g, n);
    this.cv.set(this.b, n * 2);
    normalise(this.cv);
    const alphaOf = robust ? (k) => 0.5 * Math.min(1, rhoW / Math.max(rho[k], 0.05)) : () => 0.5;
    const out = [];
    for (let k = 0; k < T.count; k++) {
      const gs = dot(gy, gray, k * n, n);
      if (gs < 0.2) continue;
      const cs = dot(this.cv, colour, k * n * 3, n * 3);
      const alpha = alphaOf(k);
      // Portraits are full-contrast UI images; a dim patch of game world that happens to have the right shape is
      // not. Only in the open search: a dead hero's darkened portrait is scored at its slot.
      const faint = robust ? 1 : Math.min(1, sigmaW / (MIN_CONTRAST_RATIO * Math.max(sigma[k], 1)));
      out.push({ k, score: ((1 - alpha) * gs + alpha * cs) * faint });
    }
    out.sort((a, b) => b.score - a.score);
    if (robust) {
      const w = (this.w ||= new Float32Array(n));
      const res = (this.res ||= new Float32Array(n));
      for (const o of out.slice(0, ROBUST_TOP)) {
        const { ncc, coverage } = robustNcc(gy, gray, o.k * n, n, w, res);
        const cs = weightedNcc(this.cv, colour, o.k * n * 3, n, 3, w);
        const alpha = alphaOf(o.k);
        const score = ((1 - alpha) * ncc + alpha * cs) * (0.4 + 0.6 * coverage);
        if (score > o.score) o.score = score;
      }
      out.sort((a, b) => b.score - a.score);
    }
    return out.slice(0, 5);
  }

  // Fine pass for one candidate: refine on a grey shortlist, classify, and if the winner was not on the
  // shortlist refine again for it. With limits (a known slot: grid fill-in, layout) scoring is robust, and the
  // unrefined box is classified too and the better answer kept, because an overlay (respawn timer) can pull the
  // hill climbing off the portrait.
  examine(c, limits = null) {
    const L = this.T.fine;
    const robust = !!limits;
    const start = { ...c };
    const ks = this.shortlist(c, 6);
    if (!ks.length) return { ...c, top: [] };
    this.refine(L, c, ks, { step: 1, size: 0.03, minStep: 0.2, limits });
    let top = this.classify(c, robust);
    if (top.length && !ks.includes(top[0].k)) {
      this.refine(L, c, [top[0].k], { step: 0.5, size: 0.02, minStep: 0.2, limits });
      top = this.classify(c, robust);
    }
    if (limits) {
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
// the best score per slot), from every pair of candidates; on a tie the one that puts the portrait nearest the
// clock in the slot next to it (always true in game; during the draft that slot may still be empty on both
// sides). Returns null when no two candidates agree.
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
          if (!best || sum > best.sum + 1e-6 || (sum > best.sum - 1e-6 && g > best.g)) best = { g, p, sum, on };
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

// Slot (0..4 left to right on each side) of a candidate on the grid's row, or null if it is not on the grid.
function gridSlot(grid, c) {
  if (Math.abs(c.h / grid.h - 1) > 0.2 || Math.abs(c.cy - grid.cy) > 0.3 * grid.h) return null;
  const m = (Math.abs(c.cx - grid.mid) - grid.g) / grid.p;
  const r = Math.round(m);
  if (r < 0 || r > 4 || Math.abs(m - r) * grid.p > 0.2 * grid.p + 1) return null;
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

function fullSearch(screen, T, o) {
  const W = screen.width;
  const H = screen.height;
  const x0 = clamp(Math.floor(o.xFrom * W), 0, W - 1);
  const x1 = clamp(Math.ceil(o.xTo * W), x0 + 1, W);
  const y1 = clamp(Math.ceil(o.bandBottom * H), 1, H);
  const P = toPlanes(screen, x0, 0, x1 - x0, y1);
  const rs = new Resampler();

  // 1. Coarse: every window at every size; drop peaks that repeat a better one at the neighbouring size.
  let peaks = [];
  for (const s of o.scales) peaks = peaks.concat(coarseScan(T, P, s * H, o, rs));
  peaks.sort((a, b) => b.coarse - a.coarse);
  const distinct = [];
  for (const p of peaks) {
    const dup = distinct.some(
      (q) => Math.abs(q.cx - p.cx) <= 0.2 * Math.min(p.h, q.h) * T.aspect && Math.abs(q.cy - p.cy) <= 0.2 * Math.min(p.h, q.h) && Math.max(p.h, q.h) / Math.min(p.h, q.h) < 1.3,
    );
    if (!dup) distinct.push(p);
    if (distinct.length >= o.maxVerify) break;
  }

  // 2. Medium: a quick position/size refinement of every peak against its best heroes at 16x9. The textured
  //    game world fools the 12x7 pass now and then; at 16x9 real portraits stand out.
  const m = new Matcher(T, P);
  const verified = [];
  for (const p of distinct) {
    const c = m.refine(T.medium, { cx: p.cx, cy: p.cy, h: p.h }, p.ks, { step: 1, size: 0.07, minStep: 0.3, maxIter: 12 });
    if (c.fit >= o.verifyMin) verified.push({ ...c, box: box(c, T.aspect) });
  }
  verified.sort((a, b) => b.fit - a.fit);
  const kept = [];
  for (const c of verified) {
    if (kept.some((k) => iou(k.box, c.box) > 0.5)) continue;
    kept.push(c);
    if (kept.length >= o.maxCandidates) break;
  }

  // 3. Fine: refine and classify the best ones.
  let cands = kept.map((c) => m.examine({ cx: c.cx, cy: c.cy, h: c.h }));

  // 4. The row: with 3+ strong candidates on one evenly spaced row, only candidates on it count, and every empty slot of
  //    the row is classified directly (robust scoring, like the layout path). That finds what the coarse passes
  //    ranked too low, such as dead heroes (grey, with a respawn timer on top).
  let grid = fitRowGrid(cands.filter((c) => bestScore(c) >= o.rowScore), W, T.aspect);
  let accepted;
  if (grid && grid.count >= 3) {
    cands = cands.filter((c) => gridSlot(grid, c) != null);
    accepted = assign(cands, T, W, o.minScore);
    for (const side of ['left', 'right']) {
      for (let slot = 0; slot < 5; slot++) {
        if (accepted.some((a) => a.side === side && gridSlot(grid, a.c) === slot)) continue;
        const d = grid.g + (side === 'left' ? 4 - slot : slot) * grid.p;
        const c = { cx: side === 'left' ? grid.mid - d : grid.mid + d, cy: grid.cy, h: grid.h };
        if (c.cx - (c.h * T.aspect) / 2 < P.x0 || c.cx + (c.h * T.aspect) / 2 > P.x0 + P.w) continue;
        cands.push(m.examine(c, { ...c, dxy: o.jitter * c.h, ds: 0.08 }));
      }
    }
    accepted = assign(cands, T, W, o.minScore);
  } else {
    // 5. No row of three (empty bar, first picks of the draft): only very confident portraits, in one row.
    accepted = assign(cands, T, W, o.loneScore);
    grid = fitRowGrid(accepted.map((a) => a.c), W, T.aspect);
    if (grid) accepted = accepted.filter((a) => gridSlot(grid, a.c) != null);
    else if (accepted.length > 1) accepted = [accepted[0]];
  }
  for (const a of accepted) a.slot = grid ? gridSlot(grid, a.c) : a.side === 'left' ? 4 : 0;
  const heroes = accepted.map((a) => toHero(a, T)).sort((a, b) => a.x - b.x);
  globalThis.__visionDebug = { peaks, distinct, verified, kept, cands };
  return { heroes, scale: heroes.length ? Math.round((median(heroes.map((h) => h.h)) / H) * 10000) / 10000 : null, evals: m.evals };
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
  return { heroes, missing, scale: L.scale, evals: m.evals };
}

// screen: { width, height, data, format }; templates: from prepareTemplates(). See DEFAULTS for opts.
// Returns { heroes: [{ name, score, margin, x, y, w, h, side, slot }], scale, ms, searched, width, height }
// (heroes left to right; with a layout also missing: [{ side, slot }] for the slots without a hero).
export function detectTopBar(screen, templates, opts = {}) {
  const t0 = performance.now();
  checkImage(screen, 'screen');
  const o = { ...DEFAULTS, ...opts };
  const T = templates;
  let res = null;
  let searched = 'full';
  const L = o.layout;
  if (L && L.slots?.length && L.width === screen.width && L.height === screen.height) {
    res = layoutSearch(screen, T, o);
    searched = 'layout';
    if (!res.heroes.length && o.fallback) res = null;
  }
  if (!res) {
    res = fullSearch(screen, T, o);
    searched = 'full';
  }
  const out = { heroes: res.heroes, scale: res.scale, ms: Math.round(performance.now() - t0), searched, width: screen.width, height: screen.height };
  if (res.missing) out.missing = res.missing;
  return out;
}

// From a full detection with >= 8 confident heroes in one row, the 10 slot rectangles (missing slots filled in from
// the even spacing: centre x = start(side) + slot * pitch). Returns null when the detection is not good enough.
export function learnLayout(result) {
  const all = (result && result.heroes) || [];
  if (all.length < 8 || !result.width || !result.height) return null;
  const hMed = median(all.map((h) => h.h));
  const cyMed = median(all.map((h) => h.y + h.h / 2));
  const list = all.filter((h) => Math.abs(h.h / hMed - 1) <= 0.12 && Math.abs(h.y + h.h / 2 - cyMed) <= 0.25 * hMed && h.slot != null);
  if (list.length < 8) return null;
  const sides = ['left', 'right'];
  if (sides.some((s) => !list.some((h) => h.side === s))) return null;

  // Least squares for cx = a_side + slot * pitch, pitch shared by both sides: unknowns [aL, aR, pitch].
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
  if (!sol) return null;
  const [aL, aR, pitch] = sol;
  const w = median(list.map((h) => h.w));
  if (!(pitch >= 0.9 * w && pitch <= 2 * w)) return null;
  for (const h of list) {
    const pred = (h.side === 'left' ? aL : aR) + h.slot * pitch;
    if (Math.abs(h.x + h.w / 2 - pred) > 0.3 * pitch) return null;
  }
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
