// add sp.onEvent to preload bridge
const { contextBridge, ipcRenderer } = require('electron');

const mode = location.hash.includes('overlay') ? 'overlay' : 'app';

contextBridge.exposeInMainWorld('sp', {
  mode,
  platform: process.platform,
  // existing APIs kept as-is (this file in repo already contains many functions)
  // We'll only add onEvent here for the new events pipeline
  onEvent: (cb) => ipcRenderer.on('sp:event', (_e, ev) => cb(ev)),
});
