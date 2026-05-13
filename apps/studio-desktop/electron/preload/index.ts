import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('mangaArStudio', {
  appName: 'Manga AR Studio',
});
