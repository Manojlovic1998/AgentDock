import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Tests for electron/updater.ts, driven through the IPC handlers it registers.
 * `electron` and `electron-updater` are replaced, so nothing touches the network or the disk.
 */

const mocks = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter: Emitter } = require('node:events') as typeof import('node:events');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('node:path') as typeof import('node:path');
  const userData = fs.mkdtempSync(p.join(os.tmpdir(), 'agentdock-upd-'));
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const app = { isPackaged: true, version: '0.1.0-beta.1', getVersion: () => app.version, getPath: () => userData };
  const autoUpdater = Object.assign(new Emitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  });
  return { userData, handlers, app, autoUpdater, send: vi.fn(), openExternal: vi.fn(), fetch: vi.fn() };
});

vi.mock('electron', () => ({
  app: mocks.app,
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => unknown) => mocks.handlers.set(channel, fn) },
  net: { fetch: mocks.fetch },
  shell: { openExternal: mocks.openExternal },
}));
vi.mock('electron-updater', () => ({ autoUpdater: mocks.autoUpdater }));

import * as fs from 'node:fs';
import * as path from 'node:path';
import { compareVersions, registerUpdaterIpc } from './updater';

const call = (channel: string, ...args: unknown[]) => mocks.handlers.get(channel)!({}, ...args) as any;
const emitter = mocks.autoUpdater as unknown as EventEmitter;
const window = { webContents: { send: mocks.send } } as any;

const realPlatform = process.platform;

/** Pretends to run on `platform`, which decides whether updates install in place or open the release page. */
const usePlatform = (platform: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value: platform });

afterEach(() => usePlatform(realPlatform));

/** Registers the handlers on a fresh state; settings from earlier tests are cleared first. */
function setup(version = '0.1.0-beta.1', platform: NodeJS.Platform = 'win32') {
  usePlatform(platform);
  fs.rmSync(path.join(mocks.userData, 'updater.json'), { force: true });
  mocks.handlers.clear();
  mocks.autoUpdater.removeAllListeners();
  mocks.send.mockClear();
  mocks.app.version = version;
  mocks.app.isPackaged = true;
  return registerUpdaterIpc(() => window);
}

describe('compareVersions', () => {
  it('orders numbers, prereleases and releases', () => {
    expect(compareVersions('0.1.1', '0.1.0')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.1.0-beta.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0-beta.2', '0.1.0-beta.10')).toBeLessThan(0);
    expect(compareVersions('0.1.0-beta.1', '0.1.0-rc.1')).toBeLessThan(0);
    expect(compareVersions('v0.1.0', '0.1.0')).toBe(0);
  });
});

describe('updater', () => {
  beforeEach(() => {
    mocks.autoUpdater.checkForUpdates.mockReset().mockResolvedValue(undefined);
    mocks.autoUpdater.downloadUpdate.mockReset().mockResolvedValue(undefined);
    mocks.autoUpdater.quitAndInstall.mockReset();
    mocks.openExternal.mockReset();
    mocks.fetch.mockReset();
  });

  it('lets a beta see prereleases and never downloads on its own', () => {
    setup('0.1.0-beta.1');
    expect(mocks.autoUpdater.allowPrerelease).toBe(true);
    expect(mocks.autoUpdater.autoDownload).toBe(false);
    setup('1.0.0');
    expect(mocks.autoUpdater.allowPrerelease).toBe(false);
  });

  it('offers an update found by a check', async () => {
    setup();
    await call('updater:check');
    emitter.emit('update-available', { version: '0.1.0-beta.2', releaseNotes: '<p>Fixes &amp; more</p>' });
    const state = await call('updater:state');
    expect(state).toMatchObject({ status: 'available', version: '0.1.0-beta.2', notes: 'Fixes & more', current: '0.1.0-beta.1' });
    expect(mocks.send).toHaveBeenLastCalledWith('updater:state', expect.objectContaining({ status: 'available' }));
  });

  it('reports "up to date" to a manual check but stays quiet on startup', async () => {
    const updater = setup();
    await call('updater:check');
    emitter.emit('update-not-available');
    expect((await call('updater:state')).status).toBe('uptodate');

    const quiet = setup();
    quiet.checkOnStartup();
    await Promise.resolve();
    emitter.emit('update-not-available');
    expect((await call('updater:state')).status).toBe('idle');
    expect(updater).toBeDefined();
  });

  it('hides a skipped version from automatic checks only', async () => {
    const updater = setup();
    await call('updater:check');
    emitter.emit('update-available', { version: '0.1.0-beta.2' });
    await call('updater:skip');
    expect((await call('updater:state')).status).toBe('idle');

    const again = setup(); // clears the file, so write the skip back
    expect(again).toBeDefined();
    fs.writeFileSync(path.join(mocks.userData, 'updater.json'), JSON.stringify({ autoCheck: true, skipped: '0.1.0-beta.2' }));
    mocks.handlers.clear();
    registerUpdaterIpc(() => window).checkOnStartup();
    await Promise.resolve();
    emitter.emit('update-available', { version: '0.1.0-beta.2' });
    expect((await call('updater:state')).status).toBe('idle');

    await call('updater:check'); // a manual check shows it anyway
    emitter.emit('update-available', { version: '0.1.0-beta.2' });
    expect((await call('updater:state')).status).toBe('available');
    expect(updater).toBeDefined();
  });

  it('downloads, reports progress and installs', async () => {
    setup();
    await call('updater:check');
    emitter.emit('update-available', { version: '0.1.0-beta.2' });
    await call('updater:download');
    expect(mocks.autoUpdater.downloadUpdate).toHaveBeenCalled();
    emitter.emit('download-progress', { percent: 41.6 });
    expect(await call('updater:state')).toMatchObject({ status: 'downloading', percent: 42 });
    emitter.emit('update-downloaded', {});
    expect((await call('updater:state')).status).toBe('downloaded');
    await call('updater:install');
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalled();
  });

  it('refuses to install before the download has finished', async () => {
    setup();
    await call('updater:install');
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('shows a failed download but not a failed automatic check', async () => {
    setup().checkOnStartup();
    await Promise.resolve();
    emitter.emit('error', new Error('offline'));
    expect((await call('updater:state')).status).toBe('idle');

    await call('updater:check');
    emitter.emit('update-available', { version: '0.1.0-beta.2' });
    await call('updater:download');
    emitter.emit('error', new Error('connection lost'));
    expect(await call('updater:state')).toMatchObject({ status: 'error', error: 'connection lost' });
  });

  it('does not contact GitHub from a development run', async () => {
    setup();
    mocks.app.isPackaged = false;
    const state = await call('updater:check');
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(state.status).toBe('error');
  });

  it('keeps the automatic-check choice between runs', async () => {
    setup();
    await call('updater:set-auto', false);
    expect((await call('updater:state')).autoCheck).toBe(false);
    mocks.handlers.clear();
    registerUpdaterIpc(() => window).checkOnStartup();
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });
});

describe('updater on macOS', () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.openExternal.mockReset();
  });

  const releases = [
    { tag_name: 'v0.1.0-beta.3', html_url: 'https://github.com/o/r/releases/tag/v0.1.0-beta.3', body: 'Third beta', draft: false, prerelease: true },
    { tag_name: 'v0.1.0-beta.2', html_url: 'https://github.com/o/r/releases/tag/v0.1.0-beta.2', draft: false, prerelease: true },
    { tag_name: 'v0.1.0-beta.9', html_url: 'x', draft: true, prerelease: true },
  ];

  it('finds the newest published release and opens its page instead of downloading', async () => {
    setup('0.1.0-beta.1', 'darwin');
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => releases });
    const state = await call('updater:check');
    expect(state).toMatchObject({ status: 'available', version: '0.1.0-beta.3', notes: 'Third beta', manualInstall: true });
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    await call('updater:download');
    expect(mocks.openExternal).toHaveBeenCalledWith('https://github.com/o/r/releases/tag/v0.1.0-beta.3');
  });

  it('ignores prereleases for a stable build', async () => {
    setup('0.1.0', 'darwin');
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => releases });
    expect((await call('updater:check')).status).toBe('uptodate');
  });
});
