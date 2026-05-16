import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, ipcMain } from 'electron';

import { HostServer } from './host/hostServer.js';
import { getDefaultStudioWindowOptions } from '../../src/main/window/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let hostServer: HostServer | null = null;

function createWindow() {
  const options = getDefaultStudioWindowOptions();
  const win = new BrowserWindow({
    width: options.width,
    height: options.height,
    title: options.title,
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.js', import.meta.url)),
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
    return;
  }

  void win.loadFile(path.join(__dirname, '../../dist/index.html'));
}

ipcMain.handle('host:get-state', () => {
  return hostServer?.getState() ?? null;
});

app.whenReady().then(async () => {
  hostServer = new HostServer({
    hostId: `studio-${Date.now()}`,
    dataDir: path.join(app.getPath('userData'), 'host'),
  });
  await hostServer.start();
  createWindow();
});

app.on('before-quit', () => {
  void hostServer?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
