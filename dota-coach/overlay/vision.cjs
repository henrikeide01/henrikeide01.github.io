// Reads the hero picks from the screen and sends them to the coach. Dota's Game State Integration never tells a
// third-party app what the enemies picked, so the desktop app looks at the hero portraits in the top bar instead
// (during the draft, and early in the game until all 10 heroes are known). Nothing is stored or sent anywhere
// except to the local coach server; a screenshot is only saved when the user asks for one (for troubleshooting).
const { desktopCapturer, screen, nativeImage, net } = require('electron');
const { Worker } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes';
const DRAFT_PHASES = ['draft', 'strategy'];
const GAME_PHASES = ['pregame', 'laning', 'mid', 'late'];
const MAX_GAME_SCANS = 12; // in game: only the first minutes (until all heroes are found), so the game stays smooth
const GAME_SCAN_UNTIL = 150; // game clock seconds
const MAX_CAPTURE_WIDTH = 1920; // portraits are big enough at 1080p; larger captures only cost time
const KEEP_DEBUG = 6;

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

// A Buffer may share its memory with others; give the worker its own copy it can take over.
const ownBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);

// nativeImage -> { width, height, data, format } in real pixels (getSize() can be in DIPs on HiDPI screens).
function toImage(img) {
  const bmp = img.toBitmap();
  const size = img.getSize();
  const scale = Math.sqrt(bmp.length / 4 / (size.width * size.height)) || 1;
  const width = Math.round(size.width * scale);
  const height = Math.round(bmp.length / 4 / width);
  return { width, height, data: ownBuffer(bmp), format: 'bgra' };
}

// The top band is all the detection looks at: if it is (nearly) one colour, the capture shows nothing useful
// (exclusive fullscreen gives a black picture on Windows).
function flatTopBand(img) {
  const d = new Uint8Array(img.data);
  const rows = Math.round(img.height * 0.1);
  let n = 0;
  let sum = 0;
  let sq = 0;
  for (let y = 0; y < rows; y += 4) {
    for (let x = 0; x < img.width; x += 8) {
      const o = (y * img.width + x) * 4;
      const l = 0.114 * d[o] + 0.587 * d[o + 1] + 0.299 * d[o + 2];
      n++;
      sum += l;
      sq += l * l;
    }
  }
  return n > 0 && Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) < 2;
}

// excludeRects(): the app's own windows (screen coordinates); they are blanked out so the hero pictures in the
// overlay are never taken for picks. getDisplay(): the screen Dota is on (where the user put the overlay).
function startVision({ root, baseUrl, log = (...a) => console.log(...a), excludeRects = () => [], getDisplay = () => screen.getPrimaryDisplay() }) {
  const cacheDir = path.join(root, 'cache', 'heroimg');
  const layoutFile = path.join(root, 'cache', 'vision-layout.json');
  const debugDir = path.join(root, 'debug');
  const layouts = readJson(layoutFile) || {};
  const status = { active: true, ready: false, templates: 0, found: null, heroes: [], lastRun: null, ms: null, searched: null, error: null, hint: null, debugFile: null, screen: null, displays: 0 };
  // Downloads go through Electron's network stack when available (uses the Windows proxy and certificates).
  const download = (url) => (net?.fetch ? net.fetch(url) : fetch(url));
  let preferredScreen = null; // the source where heroes were found this match (more than one monitor)

  let PickTracker = null;
  let tracker = null;
  let worker = null;
  let seq = 0;
  const pending = new Map();
  let stopped = false;
  let timer = null;
  let matchKey = undefined;
  let gameScans = 0;
  let saveDebug = false;

  function startWorker() {
    worker = new Worker(path.join(__dirname, 'vision-worker.mjs'));
    worker.on('message', (m) => {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m);
      else p.reject(new Error(m.error));
    });
    worker.on('error', (err) => {
      status.error = `Bildegjenkjenningen krasjet: ${err.message}`;
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker = null;
      status.ready = false;
    });
  }

  function call(msg, transfer = []) {
    if (!worker) return Promise.reject(new Error('Bildegjenkjenningen kjører ikke'));
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const t = setTimeout(() => {
        if (pending.delete(id)) reject(new Error('Bildegjenkjenningen svarte ikke'));
      }, 60000);
      pending.set(id, {
        resolve: (v) => (clearTimeout(t), resolve(v)),
        reject: (e) => (clearTimeout(t), reject(e)),
      });
      worker.postMessage({ ...msg, id }, transfer);
    });
  }

  async function api(p, body) {
    const res = await fetch(baseUrl + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    return res.json();
  }

  // The official hero pictures are the templates; they are downloaded once and kept in cache/heroimg.
  async function heroImage(name) {
    const file = path.join(cacheDir, `${name}.png`);
    if (!fs.existsSync(file)) {
      const res = await download(`${CDN}/${name}.png`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    const img = nativeImage.createFromPath(file);
    if (img.isEmpty()) {
      fs.rmSync(file, { force: true });
      throw new Error('ugyldig bilde');
    }
    return toImage(img);
  }

  async function loadTemplates() {
    fs.mkdirSync(cacheDir, { recursive: true });
    const { heroes } = readJson(path.join(root, 'data', 'heroes.json'));
    const out = [];
    const failed = [];
    for (let i = 0; i < heroes.length; i += 8) {
      const batch = heroes.slice(i, i + 8);
      const imgs = await Promise.all(batch.map((h) => heroImage(h.name).catch(() => null)));
      batch.forEach((h, k) => (imgs[k] ? out.push({ name: h.name, image: imgs[k] }) : failed.push(h.name)));
    }
    if (out.length < 20) throw new Error(`Fikk bare lastet ${out.length} heltebilder (sjekk internett)`);
    await call({ type: 'templates', heroes: out }, out.map((h) => h.image.data));
    status.templates = out.length;
    status.ready = true;
    if (failed.length) log(`  Bildegjenkjenning: mangler bilder for ${failed.length} helter (${failed.slice(0, 5).join(', ')} …)`);
  }

  // All screens are captured (at most 1920 px wide); returns the one to look at first, and the others.
  async function capture() {
    const displays = screen.getAllDisplays();
    status.displays = displays.length;
    const fullW = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)));
    const fullH = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)));
    const k = Math.min(1, MAX_CAPTURE_WIDTH / fullW);
    const width = Math.round(fullW * k);
    const height = Math.round(fullH * k);
    const sources = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } })).filter((s) => !s.thumbnail.isEmpty());
    if (!sources.length) throw new Error('Fikk ikke tatt skjermbilde');
    const displayOf = (src) => displays.find((d) => String(d.id) === String(src.display_id)) || (sources.length === 1 ? displays[0] : null);
    let wanted = null;
    try {
      wanted = getDisplay();
    } catch {}
    const first =
      sources.find((s) => preferredScreen && s.id === preferredScreen) ||
      sources.find((s) => wanted && String(s.display_id) === String(wanted.id)) ||
      sources[0];
    return { first: { src: first, display: displayOf(first) }, others: sources.filter((s) => s !== first).map((src) => ({ src, display: displayOf(src) })) };
  }

  // Blank out the app's own windows (only the top of the screen matters).
  function maskOwnWindows(img, display) {
    if (!display) return;
    let rects = [];
    try {
      rects = excludeRects() || [];
    } catch {}
    const sx = img.width / display.bounds.width;
    const sy = img.height / display.bounds.height;
    const maxY = Math.round(img.height * 0.15);
    const d = new Uint8Array(img.data);
    for (const r of rects) {
      const x0 = Math.max(0, Math.floor((r.x - display.bounds.x) * sx));
      const x1 = Math.min(img.width, Math.ceil((r.x + r.width - display.bounds.x) * sx));
      const y0 = Math.max(0, Math.floor((r.y - display.bounds.y) * sy));
      const y1 = Math.min(maxY, Math.ceil((r.y + r.height - display.bounds.y) * sy));
      for (let y = y0; y < y1; y++) d.fill(0, (y * img.width + x0) * 4, (y * img.width + x1) * 4);
    }
  }

  function writeDebug(thumb, result) {
    fs.mkdirSync(debugDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(debugDir, `draft-${stamp}.png`);
    fs.writeFileSync(file, thumb.toPNG());
    fs.writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify(result, null, 1));
    const old = fs.readdirSync(debugDir).filter((f) => f.startsWith('draft-')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_DEBUG * 2))) fs.rmSync(path.join(debugDir, f), { force: true });
    return file;
  }

  async function detectOn(shot, phaseGroup) {
    const thumb = shot.src.thumbnail;
    const img = toImage(thumb);
    maskOwnWindows(img, shot.display);
    const flat = flatTopBand(img);
    const key = `${img.width}x${img.height}:${phaseGroup}`;
    const opts = layouts[key] ? { layout: layouts[key] } : {};
    const { result, layout } = await call({ type: 'detect', screen: img, opts }, [img.data]);
    return { thumb, img: { width: result.width, height: result.height }, key, opts, result, layout, flat };
  }

  async function scan(phaseGroup) {
    const shots = await capture();
    let shot = shots.first;
    let r = await detectOn(shot, phaseGroup);
    // Nothing on this screen: look at the other monitors right away, and remember the one Dota is on.
    if (!r.result.heroes.length && shots.others.length) {
      for (const other of shots.others) {
        const r2 = await detectOn(other, phaseGroup);
        if (r2.result.heroes.length) {
          shot = other;
          r = r2;
          break;
        }
      }
    }
    if (r.result.heroes.length) preferredScreen = shot.src.id;
    const { thumb, key, opts, result, layout } = r;
    status.screen = `${result.width}x${result.height}`;
    status.hint = r.flat
      ? 'Skjermbildet er svart eller helt ensfarget. Sett Dota til «Borderless Window» (Innstillinger → Video).'
      : !result.heroes.length && phaseGroup === 'draft' && status.displays > 1
        ? 'Ser ingen helter. Står Dota på en annen skjerm enn overlayet?'
        : null;
    if (layout && JSON.stringify(layout) !== JSON.stringify(layouts[key])) {
      layouts[key] = layout;
      fs.mkdirSync(path.dirname(layoutFile), { recursive: true });
      fs.writeFileSync(layoutFile, JSON.stringify(layouts));
    }
    status.lastRun = Date.now();
    status.ms = result.ms;
    status.searched = result.searched;
    status.found = result.heroes.length;
    status.heroes = result.heroes.map((h) => ({ name: h.name, side: h.side, slot: h.slot, score: Math.round(h.score * 100) / 100 }));
    if (saveDebug) {
      saveDebug = false;
      status.debugFile = writeDebug(thumb, { ...result, layout: opts.layout || null });
      log(`  Lagret skjermbilde for feilsøking: ${status.debugFile}`);
    }
    const picks = tracker.add(result);
    if (picks.changed) await api('/api/draft/auto', { left: picks.left, right: picks.right });
  }

  // A screenshot for troubleshooting even when the recognition itself does not work.
  async function rawDebug() {
    saveDebug = false;
    const shots = await capture();
    status.debugFile = writeDebug(shots.first.src.thumbnail, { error: status.error, note: 'bildegjenkjenningen var ikke klar' });
    log(`  Lagret skjermbilde for feilsøking: ${status.debugFile}`);
  }

  let lastError = null;
  async function tick() {
    if (stopped) return;
    let delay = 4000;
    try {
      if (saveDebug && !status.ready) await rawDebug().catch(() => {});
      if (!PickTracker) {
        ({ PickTracker } = await import(pathToFileURL(path.join(root, 'src', 'vision', 'picks.js')).href));
        tracker = new PickTracker();
      }
      if (!worker) startWorker();
      if (!status.ready) await loadTemplates();

      const st = await api('/api/state');
      const id = st.matchId || null;
      if (st.phase === 'menu' || (id && id !== matchKey && matchKey !== undefined && matchKey !== null)) {
        // A new match (or back in the menu): start over.
        if (tracker.confirmed.size) tracker.reset();
        gameScans = 0;
      }
      if (id) matchKey = id;
      const inDraft = DRAFT_PHASES.includes(st.phase);
      const inGame =
        GAME_PHASES.includes(st.phase) && (st.clock ?? 0) <= GAME_SCAN_UNTIL && (st.draft?.enemies?.length || 0) < 5 && gameScans < MAX_GAME_SCANS;
      if (inDraft || inGame || saveDebug) {
        if (inGame) gameScans++;
        await scan(inDraft ? 'draft' : 'game');
        // Once the slots are known a scan takes a few milliseconds, so the draft can be followed closely.
        delay = inDraft ? (status.searched === 'layout' ? 1000 : 2000) : 8000;
      }
      status.error = null;
    } catch (err) {
      // desktopCapturer rejects with a plain string.
      status.error = err?.message || String(err);
      if (status.error !== lastError) log(`  Bildegjenkjenning: ${status.error}`);
      delay = 10000;
    }
    lastError = status.error;
    try {
      const r = await api('/api/vision/status', status);
      if (r?.command?.resetPicks) tracker?.reset();
      if (r?.command?.saveDebug) {
        saveDebug = true;
        delay = Math.min(delay, 500);
      }
    } catch {
      // the coach server restarts during updates
    }
    if (!stopped) timer = setTimeout(tick, delay);
  }

  timer = setTimeout(tick, 3000);
  return {
    status: () => status,
    stop() {
      stopped = true;
      clearTimeout(timer);
      worker?.terminate();
    },
  };
}

module.exports = { startVision };
