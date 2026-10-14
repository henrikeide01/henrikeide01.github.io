// Reads the hero picks from the screen and sends them to the coach. Dota's Game State Integration never tells a
// third-party app what the enemies picked, so the desktop app looks at the hero portraits in the top bar instead
// (during the draft, and early in the game until all 10 heroes are known). Nothing is stored or sent anywhere
// except to the local coach server; a screenshot is only saved when the user asks for one (for troubleshooting).
const { desktopCapturer, screen, nativeImage } = require('electron');
const { Worker } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes';
const DRAFT_PHASES = ['draft', 'strategy'];
const GAME_PHASES = ['pregame', 'laning', 'mid', 'late'];
const MAX_GAME_SCANS = 40; // in game: stop looking after ~3 minutes if not all heroes are found
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

function startVision({ root, baseUrl, log = (...a) => console.log(...a) }) {
  const cacheDir = path.join(root, 'cache', 'heroimg');
  const layoutFile = path.join(root, 'cache', 'vision-layout.json');
  const debugDir = path.join(root, 'debug');
  const layouts = readJson(layoutFile) || {};
  const status = { active: true, ready: false, templates: 0, found: null, heroes: [], lastRun: null, ms: null, searched: null, error: null, debugFile: null, screen: null, displays: 0 };

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
      const res = await fetch(`${CDN}/${name}.png`);
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

  async function capture() {
    const display = screen.getPrimaryDisplay();
    const width = Math.round(display.size.width * display.scaleFactor);
    const height = Math.round(display.size.height * display.scaleFactor);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
    status.displays = screen.getAllDisplays().length;
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) throw new Error('Fikk ikke tatt skjermbilde');
    return src.thumbnail;
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

  async function scan(phaseGroup) {
    const thumb = await capture();
    const img = toImage(thumb);
    status.screen = `${img.width}x${img.height}`;
    const key = `${img.width}x${img.height}:${phaseGroup}`;
    const opts = layouts[key] ? { layout: layouts[key] } : {};
    const { result, layout } = await call({ type: 'detect', screen: img, opts }, [img.data]);
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
    status.error = null;
    if (saveDebug) {
      saveDebug = false;
      status.debugFile = writeDebug(thumb, { ...result, layout: opts.layout || null });
      log(`  Lagret skjermbilde for feilsøking: ${status.debugFile}`);
    }
    const picks = tracker.add(result);
    if (picks.changed) await api('/api/draft/auto', { left: picks.left, right: picks.right });
  }

  async function tick() {
    if (stopped) return;
    let delay = 4000;
    try {
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
      const inGame = GAME_PHASES.includes(st.phase) && (st.draft?.enemies?.length || 0) < 5 && gameScans < MAX_GAME_SCANS;
      if (inDraft || inGame || saveDebug) {
        if (inGame) gameScans++;
        await scan(inDraft ? 'draft' : 'game');
        delay = inDraft ? 2000 : 5000;
      }
    } catch (err) {
      status.error = err.message;
      delay = 10000;
    }
    try {
      const r = await api('/api/vision/status', status);
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
