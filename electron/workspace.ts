import { BrowserWindow, WebContents, dialog, ipcMain, shell } from 'electron';
import { Dirent, FSWatcher, promises as fs, watch as watchPath } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/*
 * File access for the workspace: scanning Claude Code configuration and applying saved changes.
 * This process only reads and writes; the renderer parses (src/app/core/data/build-snapshot.ts).
 * The types below mirror src/app/core/data/scan.ts and the FileOp types in core/model/types.ts.
 */

type ScanScope = 'managed' | 'project' | 'local' | 'user' | 'plugin';
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
  managed: boolean;
  ignore: string[];
}

type FileOp =
  | { op: 'write'; file: string; text: string; mtime?: number }
  | { op: 'trash'; file: string }
  | { op: 'jsonRemove'; file: string; path: string[]; mtime?: number }
  | { op: 'jsonSet'; file: string; path: string[]; value: unknown; mtime?: number };

type JsonOp = Extract<FileOp, { op: 'jsonRemove' | 'jsonSet' }>;

interface SaveError {
  file: string;
  error: string;
}

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_DEPTH = 6;
const HOME = os.homedir();
const USER_DIR = path.join(HOME, '.claude');
/** System folder an organization deploys managed settings to. */
const MANAGED_DIR =
  process.platform === 'win32'
    ? path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'ClaudeCode')
    : process.platform === 'darwin'
      ? '/Library/Application Support/ClaudeCode'
      : '/etc/claude-code';
/** Folders of `~/.claude` that hold configuration AgentDock shows. */
const USER_FOLDERS = ['agents', 'skills', 'commands', 'rules', 'output-styles'];

/** Folder Claude Code keeps a project's auto memory in: the path with every separator turned into "-". */
const memoryDir = (root: string): string => path.join(USER_DIR, 'projects', root.replace(/[^A-Za-z0-9]/g, '-'), 'memory');

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

    for (const abs of await scan.markdown(memoryDir(root))) await scan.add(abs, 'memory', 'user');

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

  // Managed files are deployed by an organization: shown with the highest precedence, never written.
  if (options.managed) {
    await scan.add(path.join(MANAGED_DIR, 'managed-settings.json'), 'settings', 'managed');
    const dropIns = path.join(MANAGED_DIR, 'managed-settings.d');
    for (const e of (await entries(dropIns)).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.json')) await scan.add(path.join(dropIns, e.name), 'settings', 'managed');
    }
    await scan.add(path.join(MANAGED_DIR, 'managed-mcp.json'), 'mcp', 'managed');
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

/* ---------- watching ---------- */

const WATCH_DEBOUNCE_MS = 300;
/** How long after a save of our own file events are still attributed to it. */
const OWN_WRITE_MS = 800;

let watchers: FSWatcher[] = [];
let watchTimer: ReturnType<typeof setTimeout> | undefined;
let ownWriteUntil = 0;

function stopWatching(): void {
  clearTimeout(watchTimer);
  watchers.forEach((w) => w.close());
  watchers = [];
}

/**
 * Watches the configuration of one project and tells the renderer when it changes on disk.
 *
 * @remarks
 * Replaces any earlier watch. Events are debounced, and those caused by AgentDock's own saves
 * are dropped. `~/.claude.json` is left out on purpose: Claude Code rewrites it constantly.
 *
 * @param sender - Window to notify with `workspace:changed`.
 * @param rootInput - Project folder.
 * @param user - Also watch the user configuration in `~/.claude`.
 */
function watchWorkspace(sender: WebContents, rootInput: string, user: boolean): void {
  stopWatching();
  const root = path.resolve(expand(rootInput));
  const notify = (): void => {
    if (Date.now() < ownWriteUntil) return;
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      if (!sender.isDestroyed()) sender.send('workspace:changed');
    }, WATCH_DEBOUNCE_MS);
  };
  /** Watches a folder; with `names`, only for those entries directly inside it. A missing folder is skipped. */
  const add = (dir: string, recursive: boolean, names?: string[]): void => {
    try {
      const w = watchPath(dir, { recursive }, (_event, file) => {
        if (!names || !file || names.indexOf(path.basename(String(file))) >= 0) notify();
      });
      w.on('error', () => w.close());
      watchers.push(w);
    } catch {
      /* the folder does not exist, or cannot be watched */
    }
  };

  // The root watcher also sees `.claude` being created; the scan that follows re-arms the watch.
  add(root, false, ['.claude', 'CLAUDE.md', 'CLAUDE.local.md', '.mcp.json']);
  add(path.join(root, '.claude'), true);
  if (user && path.relative(root, HOME) !== '') {
    add(USER_DIR, false, ['CLAUDE.md', 'settings.json', ...USER_FOLDERS]);
    USER_FOLDERS.forEach((dir) => add(path.join(USER_DIR, dir), true));
    add(memoryDir(root), true);
  }
}

/* ---------- writing ---------- */

/** Resolves a display path and refuses anything outside the configuration AgentDock edits. */
function target(root: string, file: string): string {
  const abs = path.resolve(root, expand(file));
  if (within(MANAGED_DIR, abs)) throw new Error('is managed by your organization and cannot be changed here');
  /** path.relative compares case-insensitively on Windows, unlike ===. */
  const is = (p: string): boolean => path.relative(p, abs) === '';
  const allowed =
    within(path.join(root, '.claude'), abs) ||
    ['CLAUDE.md', 'CLAUDE.local.md', '.mcp.json'].some((name) => is(path.join(root, name))) ||
    ['CLAUDE.md', 'settings.json'].some((name) => is(path.join(USER_DIR, name))) ||
    [...USER_FOLDERS.map((dir) => path.join(USER_DIR, dir)), memoryDir(root)].some((dir) => within(dir, abs));
  if (!allowed) throw new Error('is read-only (outside the project and user configuration folders)');
  return abs;
}

/**
 * Checks the edits to one JSON file without changing anything.
 *
 * @remarks
 * All edits to a file are applied to one parsed copy and written once: applying them one by one
 * would let each write undo the one before it. Indentation and line endings of the file are kept.
 *
 * @param root - Absolute project folder.
 * @param file - Display path of the JSON file.
 * @param ops - Edits to that file, applied in order.
 * @returns The work to do.
 * @throws Error with a message that follows the file name when the file is outside the editable
 * configuration, changed since the scan, or is not a JSON object.
 */
async function prepareJson(root: string, file: string, ops: JsonOp[]): Promise<() => Promise<void>> {
  const abs = target(root, file);
  const st = await stat(abs);
  const mtime = ops.find((op) => op.mtime !== undefined)?.mtime;
  if (st && mtime !== undefined && Math.abs(st.mtimeMs - mtime) > 1) throw new Error('changed on disk since the last scan');
  if (!st && mtime !== undefined) throw new Error('was removed on disk since the last scan');
  if (!st && ops.every((op) => op.op === 'jsonRemove')) return async () => undefined;

  const text = st ? await fs.readFile(abs, 'utf8') : '{}';
  let json: any;
  try {
    json = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('is not valid JSON');
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('is not a JSON object');

  return async () => {
    for (const op of ops) {
      const key = op.path[op.path.length - 1];
      let parent = json;
      for (const k of op.path.slice(0, -1)) {
        if (!parent[k] || typeof parent[k] !== 'object') {
          if (op.op === 'jsonRemove') break;
          parent[k] = {};
        }
        parent = parent[k];
      }
      if (op.op === 'jsonSet') parent[key] = op.value;
      else if (parent && typeof parent === 'object') delete parent[key];
    }
    const indent = /^\{\r?\n(\s+)/.exec(text)?.[1] ?? '  ';
    const out = JSON.stringify(json, null, indent) + '\n';
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, text.indexOf('\r\n') >= 0 ? out.replace(/\n/g, '\r\n') : out, 'utf8');
  };
}

/** Checks one file operation without changing anything, and returns the work to do if it passes. */
async function prepare(root: string, op: Exclude<FileOp, JsonOp>): Promise<() => Promise<void>> {
  const abs = target(root, op.file);
  const st = await stat(abs);

  if (op.op === 'trash') return async () => void (st && (await shell.trashItem(abs)));

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
  const work: [string, () => Promise<void>][] = [];
  const json = new Map<string, JsonOp[]>();
  for (const op of ops) {
    if (op.op === 'jsonRemove' || op.op === 'jsonSet') {
      json.set(op.file, (json.get(op.file) ?? []).concat([op]));
      continue;
    }
    try {
      work.push([op.file, await prepare(root, op)]);
    } catch (e) {
      errors.push({ file: op.file, error: (e as Error).message });
    }
  }
  for (const [file, edits] of json) {
    try {
      work.push([file, await prepareJson(root, file, edits)]);
    } catch (e) {
      errors.push({ file, error: (e as Error).message });
    }
  }
  if (errors.length) return { ok: false, errors };
  ownWriteUntil = Infinity;
  for (const [file, run] of work) {
    try {
      await run();
    } catch (e) {
      errors.push({ file, error: 'could not be written: ' + (e as Error).message });
    }
  }
  ownWriteUntil = Date.now() + OWN_WRITE_MS;
  return { ok: !errors.length, errors };
}

/* ---------- copying to another project ---------- */

/**
 * One resource to copy. Mirrors `CopyItem` in src/app/core/model/types.ts.
 */
interface CopyItem {
  kind: 'agent' | 'skill' | 'cmd' | 'rule' | 'mcp';
  /** Project-relative path of the file, of the skill's `SKILL.md`, or `.mcp.json` for a server. */
  file: string;
  /** Key of the server in `.mcp.json`. Set for `mcp` only. */
  name?: string;
}

/** Folder below `.claude/` that each kind copied as files lives in. */
const COPY_DIR = { agent: 'agents', skill: 'skills', cmd: 'commands', rule: 'rules' } as const;

/** An item that is copied as a file or folder, as opposed to a server merged into `.mcp.json`. */
type FileItem = CopyItem & { kind: keyof typeof COPY_DIR };

/** How an item is named in results and errors: its path, or the server inside `.mcp.json`. */
const labelOf = (item: CopyItem): string => (item.kind === 'mcp' ? `.mcp.json › ${item.name}` : item.file);

/**
 * Checks one copy without changing anything.
 *
 * @param from - Absolute folder of the project the resource is in.
 * @param to - Absolute folder of the project it goes to.
 * @param item - The resource to copy.
 * @param replace - Whether a resource that already exists in the destination is replaced.
 * @returns The work to do, or null when the destination already has the resource and it is kept.
 * @throws Error with a message that follows the file name ("is not ...") when the item is not a
 * file of its kind inside the source project's `.claude` folder, or no longer exists.
 */
async function prepareCopy(from: string, to: string, item: FileItem, replace: boolean): Promise<(() => Promise<void>) | null> {
  const dir = COPY_DIR[item.kind];
  if (!dir) throw new Error('cannot be copied as a file');
  const base = path.join(from, '.claude', dir);
  const file = path.resolve(from, item.file);
  if (!within(base, file) || path.relative(base, file) === '') throw new Error(`is not inside .claude/${dir} of this project`);
  if (!(await stat(file))?.isFile()) throw new Error('no longer exists on disk');

  // An agent is one file. A skill is its folder: SKILL.md plus the scripts and references next to it.
  const isSkill = item.kind === 'skill';
  if (isSkill && (path.basename(file) !== 'SKILL.md' || path.relative(base, path.dirname(file)) === '')) throw new Error('is not the SKILL.md of a skill folder');
  const source = isSkill ? path.dirname(file) : file;
  const dest = path.join(to, '.claude', dir, path.relative(base, source));

  const existing = await stat(dest);
  if (existing && !replace) return null;
  return async () => {
    if (existing) await shell.trashItem(dest);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    if (isSkill) await fs.cp(source, dest, { recursive: true, filter: async (src) => !(await fs.lstat(src)).isSymbolicLink() });
    else await fs.copyFile(source, dest);
  };
}

/** `mcpServers` of a parsed `.mcp.json`; empty when the key is missing or not an object. */
const serversOf = (json: Record<string, any> | null): Record<string, any> => {
  const servers = json?.['mcpServers'];
  return servers && typeof servers === 'object' && !Array.isArray(servers) ? servers : {};
};

/**
 * Checks the copy of MCP servers without changing anything.
 *
 * @remarks
 * All servers go into one write of the destination's `.mcp.json`, so they cannot overwrite each
 * other. The rest of that file, its indentation and line endings are kept. A server that is
 * replaced is overwritten in place: it is one key of a file, so there is nothing to move to the
 * Recycle Bin.
 *
 * @param from - Absolute folder of the project the servers are in.
 * @param to - Absolute folder of the project they go to.
 * @param items - Servers to copy.
 * @param replace - Whether a server the destination already has is replaced.
 * @param skipped - Receives the label of every server that is kept as it is.
 * @param errors - Receives a message for every server that cannot be copied.
 * @returns The servers that will be written and the work to do, or null when there is nothing to write.
 */
async function prepareMcpCopy(
  from: string,
  to: string,
  items: CopyItem[],
  replace: boolean,
  skipped: string[],
  errors: SaveError[],
): Promise<{ items: CopyItem[]; run: () => Promise<void> } | null> {
  if (!items.length) return null;
  const sources = serversOf(await readJson(path.join(from, '.mcp.json')));
  const destFile = path.join(to, '.mcp.json');
  const destText = (await stat(destFile)) ? (await fs.readFile(destFile, 'utf8')).replace(/^﻿/, '') : '';
  let dest: Record<string, any> = {};
  if (destText) {
    try {
      const parsed: unknown = JSON.parse(destText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      dest = parsed as Record<string, any>;
    } catch {
      items.forEach((item) => errors.push({ file: labelOf(item), error: 'cannot be copied: .mcp.json of the destination is not valid JSON' }));
      return null;
    }
  }
  const existing = serversOf(dest);

  const todo: CopyItem[] = [];
  for (const item of items) {
    const config = item.name ? sources[item.name] : undefined;
    if (item.file !== '.mcp.json') errors.push({ file: labelOf(item), error: 'is not a server of the project .mcp.json' });
    else if (!config || typeof config !== 'object') errors.push({ file: labelOf(item), error: 'no longer exists in .mcp.json' });
    else if (item.name! in existing && !replace) skipped.push(labelOf(item));
    else todo.push(item);
  }
  if (!todo.length) return null;

  return {
    items: todo,
    run: async () => {
      const servers = { ...existing };
      todo.forEach((item) => (servers[item.name!] = sources[item.name!]));
      const indent = /^\{\r?\n([ \t]+)/.exec(destText)?.[1] ?? '  ';
      const out = JSON.stringify({ ...dest, mcpServers: servers }, null, indent) + '\n';
      await fs.writeFile(destFile, destText.indexOf('\r\n') >= 0 ? out.replace(/\n/g, '\r\n') : out, 'utf8');
    },
  };
}

/**
 * Copies agents, skills, commands, rules and MCP servers from one project into another.
 *
 * @remarks
 * Like {@link applyOps}, every item is checked before anything is written, so a bad request
 * copies nothing. A replaced file or skill folder goes to the Recycle Bin / Trash.
 *
 * @param fromInput - Project folder the resources are in.
 * @param toInput - Project folder to copy into. Must exist and differ from the source.
 * @param items - Resources to copy.
 * @param replace - Replace resources the destination already has, instead of skipping them.
 * @returns Which files were copied, skipped or failed. Mirrors `CopyResult` in types.ts.
 */
async function copyResources(fromInput: string, toInput: string, items: CopyItem[], replace: boolean) {
  const from = path.resolve(expand(fromInput));
  const to = path.resolve(expand(toInput));
  const copied: string[] = [];
  const skipped: string[] = [];
  const errors: SaveError[] = [];
  if (!(await stat(to))?.isDirectory()) return { copied, skipped, errors: [{ file: toInput, error: 'is not a folder' }] };
  if (path.relative(from, to) === '') return { copied, skipped, errors: [{ file: toInput, error: 'is the project that is already open' }] };

  const work: [CopyItem, () => Promise<void>][] = [];
  for (const item of items) {
    if (item.kind === 'mcp') continue;
    try {
      const run = await prepareCopy(from, to, item as FileItem, replace);
      if (run) work.push([item, run]);
      else skipped.push(item.file);
    } catch (e) {
      errors.push({ file: item.file, error: (e as Error).message });
    }
  }
  const servers = await prepareMcpCopy(from, to, items.filter((item) => item.kind === 'mcp'), replace, skipped, errors);
  if (errors.length) return { copied, skipped: [], errors };
  for (const [item, run] of work) {
    try {
      await run();
      copied.push(item.file);
    } catch (e) {
      errors.push({ file: item.file, error: 'could not be copied: ' + (e as Error).message });
    }
  }
  if (servers) {
    try {
      await servers.run();
      servers.items.forEach((item) => copied.push(labelOf(item)));
    } catch (e) {
      servers.items.forEach((item) => errors.push({ file: labelOf(item), error: 'could not be copied: ' + (e as Error).message }));
    }
  }
  return { copied, skipped, errors };
}

/**
 * Checks which resources a project already has.
 *
 * @param rootInput - Project folder to look in.
 * @param items - Resources about to be copied there.
 * @returns One flag per item: whether its file exists, or for a server, whether `.mcp.json` has its key.
 */
async function hasResources(rootInput: string, items: CopyItem[]): Promise<boolean[]> {
  const root = path.resolve(expand(rootInput));
  const servers = serversOf(await readJson(path.join(root, '.mcp.json')));
  return Promise.all(
    items.map(async (item) => (item.kind === 'mcp' ? !!item.name && item.name in servers : !!(await stat(path.resolve(root, expand(item.file))))?.isFile())),
  );
}

export function registerWorkspaceIpc(): void {
  ipcMain.handle('workspace:copy', (_e, from: string, to: string, items: CopyItem[], replace: boolean) => copyResources(from, to, items, !!replace));
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
  ipcMain.handle('workspace:has', (_e, root: string, items: CopyItem[]) => hasResources(root, items));
  ipcMain.handle('workspace:apply', (_e, root: string, ops: FileOp[]) => applyOps(root, ops));
  ipcMain.handle('workspace:watch', (e, root: string, user: boolean) => watchWorkspace(e.sender, root, !!user));
  ipcMain.handle('workspace:unwatch', () => stopWatching());
}
