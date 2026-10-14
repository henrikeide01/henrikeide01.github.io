// Dota Coach desktop app: an app window (the dashboard) plus a transparent, click-through overlay that
// stays on top of Dota 2 (use "Borderless Window" in Dota), and a tray icon.
// Hotkeys:  Alt+Shift+C  overlay on/off  ·  Alt+Shift+M  move overlay  ·  Alt+Shift+S  speech on/off
//           Alt+Shift+D  show/hide the app window
const { app, BrowserWindow, globalShortcut, screen, Menu, Tray, nativeImage, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BOUNDS_FILE = path.join(ROOT, 'overlay-window.json');
const ICON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAASklEQVR4nGN4FGzPQAkmpOA/FJNlwH80TJIB6JpxGkKKZqyG4NUMA/gMIaiZkCFEacZnCNUMoNgLVAlEqkQjVRISVZIyVTITURgADhoIh7/697sAAAAASUVORK5CYII=',
);

if (!app.requestSingleInstanceLock()) app.quit();

let overlay = null;
let mainWin = null;
let tray = null;
let editMode = false;
let quitting = false;
let baseUrl = '';

function loadBounds() {
  try {
    return JSON.parse(fs.readFileSync(BOUNDS_FILE, 'utf8'));
  } catch {
    const { width } = screen.getPrimaryDisplay().workAreaSize;
    return { width: 360, height: 580, x: width - 380, y: 90 };
  }
}

function saveBounds() {
  if (overlay) fs.writeFileSync(BOUNDS_FILE, JSON.stringify(overlay.getBounds()));
}

const runInOverlay = (js) => overlay.webContents.executeJavaScript(js).catch(() => undefined);

function setEditMode(on) {
  editMode = on;
  overlay.setIgnoreMouseEvents(!on, { forward: true });
  overlay.setFocusable(on);
  runInOverlay(`window.dotaCoach && window.dotaCoach.setEditMode(${on})`);
  if (!on) saveBounds();
  updateTray();
}

function toggleOverlay() {
  if (overlay.isVisible()) overlay.hide();
  else overlay.showInactive();
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

async function startCoachServer() {
  try {
    const { startServer } = await import('../src/server.js');
    // After a match, bring the app window up with the analysis (like Blitz does).
    const srv = await startServer({ onReport: () => showMain(false) });
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
  overlay.setIgnoreMouseEvents(true, { forward: true });
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
  createMain();

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
});
app.on('will-quit', () => globalShortcut.unregisterAll());
