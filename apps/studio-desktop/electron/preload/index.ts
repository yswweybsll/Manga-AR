import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('mangaArStudio', {
  appName: 'Manga AR Studio',
  host: {
    getState: () => ipcRenderer.invoke('host:get-state'),
  },
});
