import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only surface the renderer gets: window controls for the custom title bar, and workspace
 * file access. Typed on the renderer side as AgentDockBridge (src/app/core/window-controls.ts).
 */
contextBridge.exposeInMainWorld('agentDock', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  onMaximized: (listener: (maximized: boolean) => void) => {
    ipcRenderer.on('window:maximized', (_event, maximized: boolean) => listener(maximized));
  },
  pickFolder: () => ipcRenderer.invoke('workspace:pick'),
  scan: (root: string, options: unknown) => ipcRenderer.invoke('workspace:scan', root, options),
  exists: (root: string, paths: string[]) => ipcRenderer.invoke('workspace:exists', root, paths),
  apply: (root: string, ops: unknown[]) => ipcRenderer.invoke('workspace:apply', root, ops),
});
