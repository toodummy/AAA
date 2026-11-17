// STORMZILLA desktop shell (Electron). Loads the Vite build from ../dist and bridges Steam.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

const STEAM_APP_ID = Number(process.env.STORMZILLA_APPID || 480); // replace 480 (Spacewar test app) with the real App ID
let steam = null;
try {
  const sw = require('steamworks.js');
  steam = sw.init(STEAM_APP_ID);
  sw.electronEnableSteamOverlay();
} catch (e) { console.log('[steam] not available:', e && e.message); }

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win;
function create() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1600, width), height: Math.min(900, height), minWidth: 960, minHeight: 600,
    backgroundColor: '#0b0d12', show: false, autoHideMenuBar: true, title: 'STORMZILLA',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setMenu(null);
  win.once('ready-to-show', () => { win.show(); if (process.argv.includes('--fullscreen')) win.setFullScreen(true); });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.on('before-input-event', (e, input) => { if (input.key === 'F12' && input.control && input.shift) win.webContents.toggleDevTools(); });
}
ipcMain.on('sz:quit', () => app.quit());
ipcMain.on('sz:fullscreen', (_e, on) => { if (win) win.setFullScreen(!!on); });
ipcMain.on('sz:achievement', (_e, id) => {
  try { if (steam && !steam.achievement.isActivated(String(id).toUpperCase())) steam.achievement.activate(String(id).toUpperCase()); } catch (e) { /* not configured in Steamworks yet */ }
});
app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
