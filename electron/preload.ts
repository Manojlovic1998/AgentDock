import { contextBridge, ipcRenderer } from 'electron';

/** The only surface the renderer gets: window controls for the custom title bar. */
contextBridge.exposeInMainWorld('agentDock', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  onMaximized: (listener: (maximized: boolean) => void) => {
    ipcRenderer.on('window:maximized', (_event, maximized: boolean) => listener(maximized));
  },
});
