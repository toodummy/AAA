const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('stormzillaNative', {
  quit: () => ipcRenderer.send('sz:quit'),
  setFullscreen: (on) => ipcRenderer.send('sz:fullscreen', !!on),
  achievement: (id) => ipcRenderer.send('sz:achievement', id),
  platform: 'steam',
});
