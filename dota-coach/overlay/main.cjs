// Dota Coach desktop app: an app window (the dashboard) plus a transparent, click-through overlay that
// stays on top of Dota 2 (use "Borderless Window" in Dota), and a tray icon.
// Hotkeys:  Alt+Shift+C  overlay on/off  ·  Alt+Shift+M  move overlay  ·  Alt+Shift+S  speech on/off
//           Alt+Shift+D  show/hide the app window
const { app, BrowserWindow, globalShortcut, screen, Menu, Tray, nativeImage, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const BOUNDS_FILE = path.join(ROOT, 'overlay-window.json');
const MAP_BOUNDS_FILE = path.join(ROOT, 'overlay-map-window.json');
const ICON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAASklEQVR4nGN4FGzPQAkmpOA/FJNlwH80TJIB6JpxGkKKZqyG4NUMA/gMIaiZkCFEacZnCNUMoNgLVAlEqkQjVRISVZIyVTITURgADhoIh7/697sAAAAASUVORK5CYII=',
);

if (!app.requestSingleInstanceLock()) app.quit();

// The overlay is a small window that changes a few times a second: drawing it on the CPU keeps the graphics
// card free for Dota (fewer frame drops and less input lag). "gpu": true in settings.json turns it back on.
try {
  if (JSON.parse(fs.readFileSync(path.join(ROOT, 'settings.json'), 'utf8')).gpu !== true) app.disableHardwareAcceleration();
} catch {
  app.disableHardwareAcceleration();
}

let overlay = null;
let mainWin = null;
let tray = null;
let vision = null;
let editMode = false;
let quitting = false;
let baseUrl = '';

// The overlay's default spot: top right of a screen.
function defaultBounds(display = screen.getPrimaryDisplay(), size = { width: 360, height: 580 }) {
  const wa = display.workArea;
  return { ...size, x: wa.x + wa.width - size.width - 20, y: wa.y + 90 };
}

// userPlaced: the user moved the overlay themselves (edit mode); then the app never moves it.
let userPlaced = false;
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(BOUNDS_FILE, 'utf8'));
    userPlaced = !!b.userPlaced;
    // A monitor that is gone: start on the main screen again.
    const visible = screen.getAllDisplays().some((d) => b.x < d.bounds.x + d.bounds.width - 40 && b.x + b.width > d.bounds.x + 40 && b.y < d.bounds.y + d.bounds.height - 40 && b.y + b.height > d.bounds.y);
    if (!visible) return defaultBounds(undefined, { width: b.width || 360, height: b.height || 580 });
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  } catch {
    return defaultBounds();
  }
}

function saveBounds() {
  if (!overlay) return;
  if (editMode) userPlaced = true;
  fs.writeFileSync(BOUNDS_FILE, JSON.stringify({ ...overlay.getBounds(), userPlaced }));
}

// Dota was found on another screen than the overlay: move the overlay there (unless the user placed it).
function followDota(display) {
  if (!overlay || overlay.isDestroyed() || userPlaced) return;
  if (screen.getDisplayMatching(overlay.getBounds()).id === display.id) return;
  const b = overlay.getBounds();
  overlay.setBounds(defaultBounds(display, { width: b.width, height: b.height }));
  saveBounds();
}

// ---- The route minimap window: its own small click-through window, by default just above Dota's minimap ----
let mapWin = null;
let mapPlaced = false;
function mapDefaultBounds(display = screen.getPrimaryDisplay(), size = { width: 250, height: 300 }) {
  const wa = display.workArea;
  return { ...size, x: wa.x + 10, y: wa.y + wa.height - size.height - Math.round(wa.height * 0.27) };
}
function loadMapBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(MAP_BOUNDS_FILE, 'utf8'));
    mapPlaced = !!b.userPlaced;
    const visible = screen.getAllDisplays().some((d) => b.x < d.bounds.x + d.bounds.width - 40 && b.x + b.width > d.bounds.x + 40 && b.y < d.bounds.y + d.bounds.height - 40 && b.y + b.height > d.bounds.y);
    if (!visible) return mapDefaultBounds();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  } catch {
    return mapDefaultBounds();
  }
}
function saveMapBounds() {
  if (!mapWin || mapWin.isDestroyed()) return;
  if (editMode) mapPlaced = true;
  fs.writeFileSync(MAP_BOUNDS_FILE, JSON.stringify({ ...mapWin.getBounds(), userPlaced: mapPlaced }));
}
function createMapWindow() {
  mapWin = new BrowserWindow({
    ...loadMapBounds(),
    minWidth: 160,
    minHeight: 160,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    webPreferences: { backgroundThrottling: false },
  });
  mapWin.setAlwaysOnTop(true, 'screen-saver');
  mapWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mapWin.setIgnoreMouseEvents(true);
  mapWin.loadURL(`${baseUrl}/overlay.html?electron=1&view=map`);
  mapWin.once('ready-to-show', () => mapWin.showInactive());
  mapWin.on('moved', saveMapBounds);
  mapWin.on('resized', saveMapBounds);
}
function followDotaMap(display) {
  if (!mapWin || mapWin.isDestroyed() || mapPlaced) return;
  if (screen.getDisplayMatching(mapWin.getBounds()).id === display.id) return;
  const b = mapWin.getBounds();
  mapWin.setBounds(mapDefaultBounds(display, { width: b.width, height: b.height }));
  saveMapBounds();
}

const runInOverlay = (js) => overlay.webContents.executeJavaScript(js).catch(() => undefined);
const runInMap = (js) => (mapWin && !mapWin.isDestroyed() ? mapWin.webContents.executeJavaScript(js).catch(() => undefined) : undefined);

function setEditMode(on) {
  editMode = on;
  // Click-through without forwarding: Windows then never sends the game's mouse input through our window.
  overlay.setIgnoreMouseEvents(!on);
  overlay.setFocusable(on);
  runInOverlay(`window.dotaCoach && window.dotaCoach.setEditMode(${on})`);
  if (mapWin && !mapWin.isDestroyed()) {
    mapWin.setIgnoreMouseEvents(!on);
    mapWin.setFocusable(on);
    runInMap(`window.dotaCoach && window.dotaCoach.setEditMode(${on})`);
  }
  if (!on) {
    saveBounds();
    saveMapBounds();
  }
  updateTray();
}

function toggleOverlay() {
  const show = !overlay.isVisible();
  for (const w of [overlay, mapWin]) {
    if (!w || w.isDestroyed()) continue;
    if (show) w.showInactive();
    else w.hide();
  }
  updateTray();
}

async function toggleSpeech() {
  const on = await runInOverlay('window.dotaCoach ? !window.dotaCoach.speechEnabled() : false');
  await runInOverlay(`window.dotaCoach && window.dotaCoach.setSpeech(${!!on})`);
  tray?.setToolTip(`Dota Coach – tale ${on ? 'på' : 'av'}`);
}

function showMain(focus = true) {
  if (!mainWin) return;
  if (focus) {
    mainWin.show();
    mainWin.focus();
  } else mainWin.showInactive();
}

function toggleMain() {
  if (mainWin.isVisible() && mainWin.isFocused()) mainWin.hide();
  else showMain();
}

function updateTray() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Åpne Dota Coach (Alt+Shift+D)', click: () => showMain() },
      { type: 'separator' },
      { label: overlay.isVisible() ? 'Skjul overlay (Alt+Shift+C)' : 'Vis overlay (Alt+Shift+C)', click: toggleOverlay },
      { label: editMode ? 'Lås overlay (Alt+Shift+M)' : 'Flytt overlay (Alt+Shift+M)', click: () => setEditMode(!editMode) },
      { label: 'Tale av/på (Alt+Shift+S)', click: toggleSpeech },
      { type: 'separator' },
      {
        label: 'Avslutt Dota Coach',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// Restart after an update. If the update changed the npm packages, go through «Dota Coach.bat»
// so they get installed first.
function restartApp() {
  quitting = true;
  if (process.platform === 'win32' && fs.existsSync(path.join(ROOT, '.needs-install'))) {
    spawn(`start "" "${path.join(ROOT, 'Dota Coach.bat')}"`, { shell: true, cwd: ROOT, detached: true, stdio: 'ignore' }).unref();
  } else {
    app.relaunch();
  }
  app.exit(0);
}

async function startCoachServer() {
  try {
    const { startServer } = await import('../src/server.js');
    // After a match, bring the app window up with the analysis (like Blitz does).
    const srv = await startServer({ onReport: () => showMain(false), onRestart: restartApp });
    return srv.port;
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    try {
      return JSON.parse(fs.readFileSync(path.join(ROOT, 'settings.json'), 'utf8')).port || 3355;
    } catch {
      return 3355; // a server from start.bat is already running
    }
  }
}

function createOverlay() {
  overlay = new BrowserWindow({
    ...loadBounds(),
    minWidth: 260,
    minHeight: 200,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true);
  overlay.loadURL(`${baseUrl}/overlay.html?electron=1`);
  overlay.once('ready-to-show', () => overlay.showInactive());
  overlay.on('moved', saveBounds);
  overlay.on('resized', saveBounds);
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    title: 'Dota Coach',
    icon: ICON,
    backgroundColor: '#0a0d12',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { backgroundThrottling: false },
  });
  mainWin.loadURL(`${baseUrl}/`);
  mainWin.once('ready-to-show', () => mainWin.show());
  // Closing the window keeps the coach running in the tray, like Blitz.
  mainWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWin.hide();
  });
}

app.on('second-instance', () => showMain());

app.whenReady().then(async () => {
  let port;
  try {
    port = await startCoachServer();
  } catch (err) {
    dialog.showErrorBox('Dota Coach', `Klarte ikke å starte coachen:\n${err.message}`);
    app.quit();
    return;
  }
  baseUrl = `http://127.0.0.1:${port}`;
  createOverlay();
  createMapWindow();
  createMain();

  // Recognises the heroes in the draft from the screen, so nobody has to enter them by hand.
  try {
    vision = require('./vision.cjs').startVision({
      root: ROOT,
      baseUrl,
      // Our own windows show hero pictures too: they must not be read as picks.
      excludeRects: () => [overlay, mapWin, mainWin].filter((w) => w && !w.isDestroyed() && w.isVisible() && !w.isMinimized()).map((w) => w.getBounds()),
      // The user puts the overlay over Dota, so that is the screen to look at.
      getDisplay: () => (overlay && !overlay.isDestroyed() ? screen.getDisplayMatching(overlay.getBounds()) : screen.getPrimaryDisplay()),
      onDotaDisplay: (display) => {
        followDota(display);
        followDotaMap(display);
      },
    });
  } catch (err) {
    console.error('Bildegjenkjenningen startet ikke:', err.message);
  }

  globalShortcut.register('Alt+Shift+C', toggleOverlay);
  globalShortcut.register('Alt+Shift+M', () => setEditMode(!editMode));
  globalShortcut.register('Alt+Shift+S', toggleSpeech);
  globalShortcut.register('Alt+Shift+D', toggleMain);

  tray = new Tray(ICON);
  tray.setToolTip('Dota Coach');
  tray.on('click', () => showMain());
  updateTray();
});

app.on('before-quit', () => {
  quitting = true;
  vision?.stop();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
