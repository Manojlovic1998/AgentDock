import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { Dirent, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/*
 * File access for the workspace: scanning Claude Code configuration and applying saved changes.
 * This process only reads and writes; the renderer parses (src/app/core/data/build-snapshot.ts).
 * The types below mirror src/app/core/data/scan.ts and the FileOp types in core/model/types.ts.
 */

type ScanScope = 'project' | 'local' | 'user' | 'plugin';
type ScanKind = 'agent' | 'skill' | 'cmd' | 'rule' | 'style' | 'settings' | 'claudemd' | 'mcp' | 'memory' | 'other';

interface ScanFile {
  kind: ScanKind;
  scope: ScanScope;
  plugin?: string;
  file: string;
  text: string;
  mtime: number;
}

interface ScanPlugin {
  name: string;
  version: string;
  description: string;
  mtime: number;
}

interface ScanOptions {
  user: boolean;
  plugins: boolean;
  ignore: string[];
}

type FileOp =
  | { op: 'write'; file: string; text: string; mtime?: number }
  | { op: 'trash'; file: string }
  | { op: 'jsonRemove'; file: string; path: string[] };

interface SaveError {
  file: string;
  error: string;
}

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_DEPTH = 6;
const HOME = os.homedir();
const USER_DIR = path.join(HOME, '.claude');

const posix = (p: string): string => p.split(path.sep).join('/');
const expand = (p: string): string => (p === '~' ? HOME : /^~[\\/]/.test(p) ? path.join(HOME, p.slice(2)) : p);

/** Whether `child` is `parent` or lies inside it. */
function within(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function stat(p: string) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

async function entries(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readJson(p: string): Promise<Record<string, any> | null> {
  try {
    const v: unknown = JSON.parse((await fs.readFile(p, 'utf8')).replace(/^﻿/, ''));
    return v && typeof v === 'object' ? (v as Record<string, any>) : null;
  } catch {
    return null;
  }
}

/** Collects scanned files for one scan run. */
class Scan {
  readonly files: ScanFile[] = [];

  constructor(
    private readonly root: string,
    private readonly ignore: string[],
  ) {}

  /** Path as shown in the app: project-relative, "~/…" for the home folder. */
  display(abs: string): string {
    if (within(this.root, abs)) return posix(path.relative(this.root, abs));
    if (within(HOME, abs)) return '~/' + posix(path.relative(HOME, abs));
    return posix(abs);
  }

  /** Adds one file. `readText` is false for files that are only listed. */
  async add(abs: string, kind: ScanKind, scope: ScanScope, as?: { plugin: string; file: string }, readText = true): Promise<void> {
    const st = await stat(abs);
    if (!st?.isFile() || st.size > MAX_FILE_BYTES) return;
    const text = readText ? (await fs.readFile(abs, 'utf8')).replace(/^﻿/, '').replace(/\r\n/g, '\n') : '';
    this.files.push({ kind, scope, plugin: as?.plugin, file: as?.file ?? this.display(abs), text, mtime: st.mtimeMs });
  }

  /** Markdown files below a folder. Symbolic links and ignored folder names are skipped. */
  async markdown(dir: string, depth = 0): Promise<string[]> {
    const out: string[] = [];
    for (const e of await entries(dir)) {
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH && this.ignore.indexOf(e.name) < 0) out.push(...(await this.markdown(abs, depth + 1)));
      } else if (e.name.toLowerCase().endsWith('.md')) out.push(abs);
    }
    return out.sort();
  }

  /** The agents, skills, commands, rules and output styles of one configuration folder. */
  async folder(dir: string, scope: ScanScope, plugin?: { name: string; base: string }): Promise<void> {
    const as = (abs: string) => (plugin ? { plugin: plugin.name, file: plugin.name + '/' + posix(path.relative(plugin.base, abs)) } : undefined);
    for (const abs of await this.markdown(path.join(dir, 'agents'))) await this.add(abs, 'agent', scope, as(abs));
    for (const e of await entries(path.join(dir, 'skills'))) {
      const abs = path.join(dir, 'skills', e.name, 'SKILL.md');
      if (e.isDirectory() && this.ignore.indexOf(e.name) < 0) await this.add(abs, 'skill', scope, as(abs));
    }
    for (const abs of await this.markdown(path.join(dir, 'commands'))) await this.add(abs, 'cmd', scope, as(abs));
    if (plugin) return;
    for (const abs of await this.markdown(path.join(dir, 'rules'))) await this.add(abs, 'rule', scope);
    for (const abs of await this.markdown(path.join(dir, 'output-styles'))) await this.add(abs, 'style', scope);
  }
}

/** Branch name from .git/HEAD, without starting git. Handles worktrees, where .git is a file. */
async function branchOf(root: string): Promise<string> {
  try {
    let gitDir = path.join(root, '.git');
    if ((await fs.stat(gitDir)).isFile()) {
      const link = /^gitdir:\s*(.+)$/m.exec(await fs.readFile(gitDir, 'utf8'));
      if (!link) return '';
      gitDir = path.resolve(root, link[1].trim());
    }
    const head = (await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    return ref ? ref[1] : head.slice(0, 7);
  } catch {
    return '';
  }
}

/** Installed plugins as [name, record] pairs. The registry lists one record or several per plugin. */
async function installedPlugins(): Promise<[string, Record<string, any>][]> {
  const registry = await readJson(path.join(USER_DIR, 'plugins', 'installed_plugins.json'));
  const plugins = registry?.['plugins'];
  if (!plugins || typeof plugins !== 'object') return [];
  const out: [string, Record<string, any>][] = [];
  for (const [key, value] of Object.entries(plugins as Record<string, unknown>)) {
    const record = (Array.isArray(value) ? value[value.length - 1] : value) as Record<string, any> | undefined;
    if (record && typeof record['installPath'] === 'string') out.push([key.split('@')[0], record]);
  }
  return out;
}

async function scanWorkspace(rootInput: string, options: ScanOptions) {
  const root = path.resolve(expand(rootInput));
  if (!(await stat(root))?.isDirectory()) throw new Error('folder not found');
  const scan = new Scan(root, options.ignore ?? []);
  const claude = path.join(root, '.claude');
  const isHome = path.relative(root, HOME) === '';

  // Project scope. Opening the home folder itself would read ~/.claude twice, so it counts as user scope only.
  if (!isHome) {
    await scan.folder(claude, 'project');
    await scan.add(path.join(root, 'CLAUDE.md'), 'claudemd', 'project');
    await scan.add(path.join(claude, 'CLAUDE.md'), 'claudemd', 'project');
    await scan.add(path.join(root, 'CLAUDE.local.md'), 'claudemd', 'local');
    await scan.add(path.join(claude, 'settings.json'), 'settings', 'project');
    await scan.add(path.join(claude, 'settings.local.json'), 'settings', 'local');
    await scan.add(path.join(root, '.mcp.json'), 'mcp', 'project');
    const known = ['settings.json', 'settings.local.json', 'CLAUDE.md'];
    for (const e of await entries(claude)) {
      if (e.isFile() && known.indexOf(e.name) < 0) await scan.add(path.join(claude, e.name), 'other', 'project', undefined, false);
    }
  }

  if (options.user) {
    await scan.folder(USER_DIR, 'user');
    await scan.add(path.join(USER_DIR, 'CLAUDE.md'), 'claudemd', 'user');
    await scan.add(path.join(USER_DIR, 'settings.json'), 'settings', 'user');
    await scan.add(path.join(USER_DIR, 'keybindings.json'), 'other', 'user', undefined, false);

    // Auto memory lives in a folder named after the project path with every separator turned into "-".
    const slug = root.replace(/[^A-Za-z0-9]/g, '-');
    for (const abs of await scan.markdown(path.join(USER_DIR, 'projects', slug, 'memory'))) await scan.add(abs, 'memory', 'user');

    // ~/.claude.json also holds history and account state: only its MCP servers leave this process.
    const state = path.join(HOME, '.claude.json');
    const json = await readJson(state);
    if (json) {
      const key = Object.keys(json['projects'] ?? {}).find((k) => path.relative(path.resolve(k), root) === '');
      const servers = { ...(json['mcpServers'] ?? {}), ...((key && json['projects'][key]?.['mcpServers']) ?? {}) };
      const st = await stat(state);
      if (Object.keys(servers).length && st)
        scan.files.push({ kind: 'mcp', scope: 'user', file: '~/.claude.json', text: JSON.stringify({ mcpServers: servers }, null, 2), mtime: st.mtimeMs });
    }
  }

  const plugins: ScanPlugin[] = [];
  if (options.plugins) {
    for (const [name, record] of await installedPlugins()) {
      const base = expand(String(record['installPath']));
      const st = await stat(base);
      if (!st?.isDirectory()) continue;
      const manifest = await readJson(path.join(base, '.claude-plugin', 'plugin.json'));
      plugins.push({
        name,
        version: String(record['version'] ?? manifest?.['version'] ?? ''),
        description: String(manifest?.['description'] ?? ''),
        mtime: st.mtimeMs,
      });
      await scan.folder(base, 'plugin', { name, base });
      await scan.add(path.join(base, '.mcp.json'), 'mcp', 'plugin', { plugin: name, file: name + '/.mcp.json' });
    }
  }

  const referenced = scan.files.filter((f) => f.kind === 'mcp').flatMap((f) => [...f.text.matchAll(/\$\{([A-Za-z_]\w*)\}/g)].map((m) => m[1]));
  return {
    root,
    home: HOME,
    name: path.basename(root) || root,
    branch: await branchOf(root),
    files: scan.files,
    plugins,
    unsetEnv: [...new Set(referenced)].filter((name) => process.env[name] === undefined),
  };
}

/* ---------- writing ---------- */

/** Resolves a display path and refuses anything outside the configuration AgentDock edits. */
function target(root: string, file: string): string {
  const abs = path.resolve(root, expand(file));
  const allowed =
    within(path.join(root, '.claude'), abs) ||
    // path.relative compares case-insensitively on Windows, unlike ===.
    path.relative(path.join(root, 'CLAUDE.md'), abs) === '' ||
    path.relative(path.join(root, '.mcp.json'), abs) === '' ||
    ['agents', 'skills', 'commands', 'rules'].some((dir) => within(path.join(USER_DIR, dir), abs));
  if (!allowed) throw new Error('is read-only (outside the project and user configuration folders)');
  return abs;
}

/** Checks one operation without changing anything, and returns the work to do if it passes. */
async function prepare(root: string, op: FileOp): Promise<() => Promise<void>> {
  const abs = target(root, op.file);
  const st = await stat(abs);

  if (op.op === 'trash') return async () => void (st && (await shell.trashItem(abs)));

  if (op.op === 'jsonRemove') {
    const text = st ? await fs.readFile(abs, 'utf8') : '';
    let json: any;
    try {
      json = JSON.parse(text.replace(/^﻿/, ''));
    } catch {
      throw new Error('is not valid JSON');
    }
    return async () => {
      const key = op.path[op.path.length - 1];
      const parent = op.path.slice(0, -1).reduce((o, k) => o?.[k], json);
      if (parent && typeof parent === 'object') delete parent[key];
      const indent = /^\{\r?\n(\s+)/.exec(text)?.[1] ?? '  ';
      const out = JSON.stringify(json, null, indent) + '\n';
      await fs.writeFile(abs, text.indexOf('\r\n') >= 0 ? out.replace(/\n/g, '\r\n') : out, 'utf8');
    };
  }

  // A scanned file must be unchanged since the scan; a new file must not overwrite an existing one.
  if (op.mtime === undefined) {
    if (st) throw new Error('already exists');
  } else if (!st) {
    throw new Error('was removed on disk since the last scan');
  } else if (Math.abs(st.mtimeMs - op.mtime) > 1) {
    throw new Error('changed on disk since the last scan');
  }
  const crlf = !!st && (await fs.readFile(abs, 'utf8')).indexOf('\r\n') >= 0;
  return async () => {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, crlf ? op.text.replace(/\n/g, '\r\n') : op.text, 'utf8');
  };
}

/** Applies all operations, or none if any of them fails its checks. */
async function applyOps(rootInput: string, ops: FileOp[]) {
  const root = path.resolve(expand(rootInput));
  const errors: SaveError[] = [];
  const work: [FileOp, () => Promise<void>][] = [];
  for (const op of ops) {
    try {
      work.push([op, await prepare(root, op)]);
    } catch (e) {
      errors.push({ file: op.file, error: (e as Error).message });
    }
  }
  if (errors.length) return { ok: false, errors };
  for (const [op, run] of work) {
    try {
      await run();
    } catch (e) {
      errors.push({ file: op.file, error: 'could not be written: ' + (e as Error).message });
    }
  }
  return { ok: !errors.length, errors };
}

export function registerWorkspaceIpc(): void {
  ipcMain.handle('workspace:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const options = { title: 'Open project folder', properties: ['openDirectory' as const] };
    const result = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle('workspace:scan', (_e, root: string, options: ScanOptions) => scanWorkspace(root, options));
  ipcMain.handle('workspace:exists', (_e, root: string, paths: string[]) =>
    Promise.all(paths.map(async (p) => !!(await stat(path.resolve(expand(root), expand(p))))?.isFile())),
  );
  ipcMain.handle('workspace:apply', (_e, root: string, ops: FileOp[]) => applyOps(root, ops));
}
