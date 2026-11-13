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
  has: (root: string, items: unknown[]) => ipcRenderer.invoke('workspace:has', root, items),
  apply: (root: string, ops: unknown[]) => ipcRenderer.invoke('workspace:apply', root, ops),
  copy: (from: string, to: string, items: unknown[], replace: boolean) => ipcRenderer.invoke('workspace:copy', from, to, items, replace),
  watch: (root: string, user: boolean) => ipcRenderer.invoke('workspace:watch', root, user),
  unwatch: () => ipcRenderer.invoke('workspace:unwatch'),
  getUpdateState: () => ipcRenderer.invoke('updater:state'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  skipUpdate: () => ipcRenderer.invoke('updater:skip'),
  setAutoUpdateCheck: (on: boolean) => ipcRenderer.invoke('updater:set-auto', on),
  onUpdateState: (listener: (state: unknown) => void) => {
    ipcRenderer.on('updater:state', (_event, state: unknown) => listener(state));
  },
  onChanged: (listener: () => void) => {
    ipcRenderer.on('workspace:changed', () => listener());
  },
});
