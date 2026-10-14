// Transparent, click-through overlay window that stays on top of Dota 2 (use "Borderless Window" in Dota).
// Hotkeys:  Alt+Shift+C  show/hide   ·   Alt+Shift+M  move mode on/off   ·   Alt+Shift+S  speech on/off
const { app, BrowserWindow, globalShortcut, screen, Menu, Tray, nativeImage, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const BOUNDS_FILE = path.join(__dirname, '..', 'overlay-window.json');
let win = null;
let tray = null;
let editMode = false;

function loadBounds() {
  try {
    return JSON.parse(fs.readFileSync(BOUNDS_FILE, 'utf8'));
  } catch {
    const { width } = screen.getPrimaryDisplay().workAreaSize;
    return { width: 360, height: 560, x: width - 380, y: 90 };
  }
}

function saveBounds() {
  if (win) fs.writeFileSync(BOUNDS_FILE, JSON.stringify(win.getBounds()));
}

function setEditMode(on) {
  editMode = on;
  win.setIgnoreMouseEvents(!on, { forward: true });
  win.setFocusable(on);
  win.webContents.executeJavaScript(`window.dotaCoach && window.dotaCoach.setEditMode(${on})`).catch(() => {});
  if (!on) saveBounds();
  updateTray();
}

function toggleVisible() {
  if (win.isVisible()) win.hide();
  else win.showInactive();
  updateTray();
}

async function toggleSpeech() {
  const on = await win.webContents.executeJavaScript('window.dotaCoach ? !window.dotaCoach.speechEnabled() : false').catch(() => false);
  await win.webContents.executeJavaScript(`window.dotaCoach && window.dotaCoach.setSpeech(${on})`).catch(() => {});
  updateTray(on);
}

function updateTray(speech) {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: win.isVisible() ? 'Skjul overlay (Alt+Shift+C)' : 'Vis overlay (Alt+Shift+C)', click: toggleVisible },
      { label: editMode ? 'Lås posisjon (Alt+Shift+M)' : 'Flytt overlay (Alt+Shift+M)', click: () => setEditMode(!editMode) },
      { label: 'Tale av/på (Alt+Shift+S)', click: toggleSpeech },
      { type: 'separator' },
      { label: 'Avslutt Dota Coach', click: () => app.quit() },
    ]),
  );
  if (speech !== undefined) tray.setToolTip(`Dota Coach – tale ${speech ? 'på' : 'av'}`);
}

async function createWindow() {
  // Start the coach server in this process, unless one is already running (start.bat).
  let port = 3355;
  try {
    const { startServer } = await import('../src/server.js');
    const srv = await startServer({});
    port = srv.port;
  } catch (err) {
    if (err.code !== 'EADDRINUSE') {
      dialog.showErrorBox('Dota Coach', `Klarte ikke å starte serveren:\n${err.message}`);
      app.quit();
      return;
    }
    try {
      port = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'settings.json'), 'utf8')).port || port;
    } catch {
      // default port
    }
  }

  win = new BrowserWindow({
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
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadURL(`http://127.0.0.1:${port}/overlay.html?electron=1`);
  win.once('ready-to-show', () => win.showInactive());
  win.on('moved', saveBounds);
  win.on('resized', saveBounds);

  globalShortcut.register('Alt+Shift+C', toggleVisible);
  globalShortcut.register('Alt+Shift+M', () => setEditMode(!editMode));
  globalShortcut.register('Alt+Shift+S', toggleSpeech);

  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAASklEQVR4nGN4FGzPQAkmpOA/FJNlwH80TJIB6JpxGkKKZqyG4NUMA/gMIaiZkCFEacZnCNUMoNgLVAlEqkQjVRISVZIyVTITURgADhoIh7/697sAAAAASUVORK5CYII=',
  );
  tray = new Tray(icon);
  tray.setToolTip('Dota Coach');
  updateTray();
}

app.whenReady().then(createWindow);
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
