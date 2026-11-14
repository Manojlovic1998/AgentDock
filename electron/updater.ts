import { BrowserWindow, app, ipcMain, net, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** GitHub repository the releases are published to. */
const OWNER = 'Manojlovic1998';
const REPO = 'AgentDock';

/** Longest release-notes text sent to the renderer, in characters. */
const NOTES_LIMIT = 800;

/** Where an update is in its life cycle. `idle` means there is nothing to show. */
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'uptodate' | 'error';

/** Everything the renderer needs to draw the update dialog and the Settings section. */
export interface UpdateState {
  status: UpdateStatus;
  /** Version of the running app. */
  current: string;
  /** Version offered by the update, once one is found. */
  version?: string;
  /** Release notes as plain text, shortened to a few paragraphs. */
  notes?: string;
  /** Download progress from 0 to 100, while `status` is `downloading`. */
  percent?: number;
  /** Message to show, while `status` is `error`. */
  error?: string;
  /** The update cannot be installed in place and "download" opens the release page instead. */
  manualInstall: boolean;
  /** Whether the app looks for updates by itself shortly after it starts. */
  autoCheck: boolean;
}

/** Settings kept between runs in `updater.json` in the user data folder. */
interface Stored {
  autoCheck: boolean;
  /** Version the user chose to skip. Automatic checks stay quiet about it. */
  skipped: string;
}

/** Handle returned by {@link registerUpdaterIpc}. */
export interface Updater {
  /** Runs the automatic check, unless the user turned it off. Never shows "up to date" or errors. */
  checkOnStartup(): void;
}

/** Splits a version like `0.1.0-beta.2` into its numbers and prerelease identifiers. */
function parse(version: string): { nums: number[]; pre: string[] } {
  const [core, pre] = version.replace(/^v/, '').split('-', 2);
  return { nums: core.split('.').map((n) => parseInt(n, 10) || 0), pre: pre ? pre.split('.') : [] };
}

/**
 * Compares two versions by semver rules: a prerelease is older than its release, and prerelease
 * identifiers compare number by number, then as text.
 *
 * @returns A negative number when `a` is older than `b`, positive when newer, 0 when equal.
 */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d;
  }
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && +p !== +q) return +p - +q;
    if (pn !== qn) return pn ? -1 : 1;
    if (!pn && p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** Turns release notes, which may be HTML or markdown, into short plain text. */
function plainNotes(notes: unknown): string | undefined {
  const raw = Array.isArray(notes) ? notes.map((n: { note?: string }) => n.note ?? '').join('\n') : typeof notes === 'string' ? notes : '';
  const text = raw
    .replace(/<\/(p|li|h\d|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return undefined;
  return text.length > NOTES_LIMIT ? text.slice(0, NOTES_LIMIT).trimEnd() + '…' : text;
}

/** Newest published release that is newer than `current`, read from GitHub. Used where updates cannot install in place. */
async function latestRelease(current: string): Promise<{ version: string; notes?: string; url: string } | null> {
  const res = await net.fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=20`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AgentDock' },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const releases = (await res.json()) as { tag_name: string; body?: string; html_url: string; draft: boolean; prerelease: boolean }[];
  const beta = current.includes('-');
  let best: { version: string; notes?: string; url: string } | null = null;
  for (const r of releases) {
    if (r.draft || (r.prerelease && !beta)) continue;
    const version = r.tag_name.replace(/^v/, '');
    if (compareVersions(version, current) <= 0) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { version, notes: plainNotes(r.body), url: r.html_url };
  }
  return best;
}

/**
 * Registers the `updater:*` IPC handlers and wires `electron-updater`.
 *
 * @remarks
 * The state is pushed to the renderer on `updater:state` whenever it changes. Builds that run
 * unpackaged (development) never contact GitHub. On macOS the app is not code signed, which
 * blocks in-place installs, so the release page is opened for the user to download from.
 *
 * @param getWindow - Returns the window that receives state changes, if one is open.
 */
export function registerUpdaterIpc(getWindow: () => BrowserWindow | undefined): Updater {
  const file = path.join(app.getPath('userData'), 'updater.json');
  const manualInstall = process.platform === 'darwin';
  const current = app.getVersion();
  let stored: Stored = { autoCheck: true, skipped: '' };
  try {
    stored = { ...stored, ...(JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Stored>) };
  } catch {
    /* first run, or an unreadable file: defaults apply */
  }

  let state: UpdateState = { status: 'idle', current, manualInstall, autoCheck: stored.autoCheck };
  /** Whether the check in progress was started by the user, so its outcome is always shown. */
  let manual = false;
  let releaseUrl = '';

  const save = (): void => {
    try {
      fs.writeFileSync(file, JSON.stringify(stored));
    } catch {
      /* the choice only lasts until the app closes */
    }
  };

  const set = (patch: Partial<UpdateState>): UpdateState => {
    state = { ...state, ...patch, autoCheck: stored.autoCheck };
    getWindow()?.webContents.send('updater:state', state);
    return state;
  };

  /** Records an update found by a check, unless it is one the user skipped and the check was automatic. */
  const found = (version: string, notes: string | undefined): void => {
    if (!manual && stored.skipped === version) set({ status: 'idle' });
    else set({ status: 'available', version, notes, percent: undefined, error: undefined });
  };

  const failed = (message: string): void => {
    if (manual || state.status === 'downloading') set({ status: 'error', error: message });
    else set({ status: 'idle' });
  };

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // A beta build moves to the next beta or to the release; a stable build never sees prereleases.
  autoUpdater.allowPrerelease = current.includes('-');
  autoUpdater.on('update-available', (info) => found(info.version, plainNotes(info.releaseNotes)));
  autoUpdater.on('update-not-available', () => set({ status: manual ? 'uptodate' : 'idle' }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', () => set({ status: 'downloaded', percent: 100 }));
  autoUpdater.on('error', (err) => failed(err?.message ?? 'The update failed.'));

  const check = async (byUser: boolean): Promise<UpdateState> => {
    if (state.status === 'checking' || state.status === 'downloading' || state.status === 'downloaded') return state;
    manual = byUser;
    if (!app.isPackaged) return set({ status: byUser ? 'error' : 'idle', error: 'Updates are only available in installed builds.' });
    set({ status: 'checking', error: undefined });
    try {
      if (manualInstall) {
        const release = await latestRelease(current);
        if (release) {
          releaseUrl = release.url;
          found(release.version, release.notes);
        } else set({ status: byUser ? 'uptodate' : 'idle' });
      } else {
        await autoUpdater.checkForUpdates();
      }
    } catch (e) {
      failed(e instanceof Error ? e.message : 'Could not check for updates.');
    }
    return state;
  };

  ipcMain.handle('updater:state', () => state);
  ipcMain.handle('updater:check', () => check(true));
  ipcMain.handle('updater:download', async () => {
    if (state.status !== 'available') return state;
    if (manualInstall) {
      if (releaseUrl) void shell.openExternal(releaseUrl);
      return set({ status: 'idle' });
    }
    set({ status: 'downloading', percent: 0 });
    try {
      await autoUpdater.downloadUpdate();
    } catch (e) {
      failed(e instanceof Error ? e.message : 'The download failed.');
    }
    return state;
  });
  ipcMain.handle('updater:install', () => {
    if (state.status === 'downloaded') autoUpdater.quitAndInstall();
  });
  ipcMain.handle('updater:skip', () => {
    if (state.version) {
      stored.skipped = state.version;
      save();
    }
    return set({ status: 'idle' });
  });
  ipcMain.handle('updater:set-auto', (_e, on: boolean) => {
    stored.autoCheck = !!on;
    save();
    return set({});
  });

  return {
    checkOnStartup: () => {
      if (stored.autoCheck) void check(false);
    },
  };
}
