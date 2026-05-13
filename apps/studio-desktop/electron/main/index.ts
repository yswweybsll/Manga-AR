import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow } from 'electron';

import { getDefaultStudioWindowOptions } from '../../src/main/window/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

app.whenReady().then(createWindow);

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
