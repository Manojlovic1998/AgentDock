import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Tests for electron/workspace.ts, driven through the IPC handlers it registers.
 * `electron` and the home folder are replaced so every test works inside a temporary folder.
 */

/** Folders shared by the mocks and the tests. */
const sandbox = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('node:path') as typeof import('node:path');
  const base = fs.realpathSync(fs.mkdtempSync(p.join(os.tmpdir(), 'agentdock-ws-')));
  const dirs = { base, home: p.join(base, 'home'), trash: p.join(base, 'trash'), managed: p.join(base, 'managed') };
  process.env['ProgramFiles'] = dirs.managed;
  return dirs;
});

/** Handlers the module registers with `ipcMain.handle`, by channel name. */
const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => unknown>());

vi.mock('electron', async () => {
  const fs = await import('node:fs');
  const p = await import('node:path');
  let n = 0;
  return {
    ipcMain: { handle: (channel: string, fn: (...args: any[]) => unknown) => void handlers.set(channel, fn) },
    shell: {
      /** Moves the item into the sandbox "Recycle Bin" instead of the real one. */
      trashItem: async (item: string) => {
        fs.mkdirSync(sandbox.trash, { recursive: true });
        fs.renameSync(item, p.join(sandbox.trash, `${n++}-${p.basename(item)}`));
      },
    },
    dialog: {},
    BrowserWindow: { fromWebContents: () => null },
  };
});

vi.mock('node:os', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:os')>();
  const mocked = { ...real, homedir: () => sandbox.home };
  return { ...mocked, default: mocked };
});

interface SaveError {
  file: string;
  error: string;
}
interface ApplyResult {
  ok: boolean;
  errors: SaveError[];
}
interface CopyResult {
  copied: string[];
  skipped: string[];
  errors: SaveError[];
}
interface ScanFile {
  kind: string;
  scope: string;
  plugin?: string;
  file: string;
  text: string;
  mtime: number;
}
interface ScanResult {
  root: string;
  name: string;
  branch: string;
  files: ScanFile[];
  plugins: { name: string; version: string; description: string }[];
  unsetEnv: string[];
}

/** Calls an IPC handler the way the renderer would. */
const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => Promise.resolve(handlers.get(channel)!({ sender: undefined }, ...args) as T);

const apply = (root: string, ops: unknown[]) => invoke<ApplyResult>('workspace:apply', root, ops);
const scan = (root: string, over: Record<string, unknown> = {}) =>
  invoke<ScanResult>('workspace:scan', root, { user: false, plugins: false, managed: false, ignore: [], ...over });
const copy = (from: string, to: string, items: unknown[], replace = false) => invoke<CopyResult>('workspace:copy', from, to, items, replace);

let counter = 0;

/** A new empty project folder. */
function project(): string {
  const dir = path.join(sandbox.base, `proj-${++counter}`);
  fsSync.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Writes a file, creating its folders. */
function put(file: string, text: string): string {
  fsSync.mkdirSync(path.dirname(file), { recursive: true });
  fsSync.writeFileSync(file, text);
  return file;
}

const read = (file: string): string => fsSync.readFileSync(file, 'utf8');
const exists = (file: string): boolean => fsSync.existsSync(file);
const mtimeOf = (file: string): number => fsSync.statSync(file).mtimeMs;
const trashed = (): string[] => (exists(sandbox.trash) ? fsSync.readdirSync(sandbox.trash) : []);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  const { registerWorkspaceIpc } = await import('./workspace');
  registerWorkspaceIpc();
});

beforeEach(() => {
  fsSync.mkdirSync(sandbox.home, { recursive: true });
});

afterEach(async () => {
  await invoke('workspace:unwatch');
  fsSync.rmSync(sandbox.home, { recursive: true, force: true });
  fsSync.rmSync(sandbox.trash, { recursive: true, force: true });
  fsSync.rmSync(sandbox.managed, { recursive: true, force: true });
});

afterAll(() => {
  fsSync.rmSync(sandbox.base, { recursive: true, force: true });
});

describe('write guard', () => {
  it('allows the project and user configuration', async () => {
    const root = project();
    const files = [
      '.claude/agents/a.md',
      '.claude/deep/er/x.json',
      'CLAUDE.md',
      'CLAUDE.local.md',
      '.mcp.json',
      '~/.claude/agents/u.md',
      '~/.claude/skills/s/SKILL.md',
      '~/.claude/CLAUDE.md',
      '~/.claude/settings.json',
    ];
    const result = await apply(root, files.map((file) => ({ op: 'write', file, text: 'x\n' })));
    expect(result).toEqual({ ok: true, errors: [] });
    expect(exists(path.join(root, '.claude/agents/a.md'))).toBe(true);
    expect(exists(path.join(sandbox.home, '.claude/skills/s/SKILL.md'))).toBe(true);
  });

  it('refuses everything else and writes nothing', async () => {
    const root = project();
    const files = ['src/x.ts', '../outside.md', '.claude/../escape.md', 'README.md', '~/.claude/plugins/p.md', '~/.claude.json', '~/.claude/keybindings.json'];
    for (const file of files) {
      const result = await apply(root, [{ op: 'write', file, text: 'x' }]);
      expect(result.ok, file).toBe(false);
      expect(result.errors[0].error, file).toContain('read-only');
    }
    expect(exists(path.join(root, 'src/x.ts'))).toBe(false);
    expect(exists(path.join(root, '..', 'outside.md'))).toBe(false);
    expect(exists(path.join(root, 'escape.md'))).toBe(false);
    expect(exists(path.join(sandbox.home, '.claude.json'))).toBe(false);
  });

  it.runIf(process.platform === 'win32')('refuses the managed folder', async () => {
    const root = project();
    const file = path.join(sandbox.managed, 'ClaudeCode', 'managed-settings.json');
    const result = await apply(root, [{ op: 'write', file, text: '{}' }]);
    expect(result.errors[0].error).toContain('managed by your organization');
    expect(exists(file)).toBe(false);
  });
});

describe('apply: files', () => {
  it('creates a new file with its folders, and refuses to overwrite it without a scan', async () => {
    const root = project();
    const file = '.claude/agents/team/new.md';
    expect((await apply(root, [{ op: 'write', file, text: 'one\n' }])).ok).toBe(true);
    expect(read(path.join(root, file))).toBe('one\n');

    const again = await apply(root, [{ op: 'write', file, text: 'two\n' }]);
    expect(again.errors).toEqual([{ file, error: 'already exists' }]);
    expect(read(path.join(root, file))).toBe('one\n');
  });

  it('writes a scanned file only when it is unchanged since the scan', async () => {
    const root = project();
    const abs = put(path.join(root, '.claude/agents/a.md'), 'old\n');
    const file = '.claude/agents/a.md';

    expect((await apply(root, [{ op: 'write', file, text: 'new\n', mtime: mtimeOf(abs) }])).ok).toBe(true);
    expect(read(abs)).toBe('new\n');

    const stale = await apply(root, [{ op: 'write', file, text: 'newer\n', mtime: mtimeOf(abs) - 5000 }]);
    expect(stale.errors[0].error).toContain('changed on disk');
    expect(read(abs)).toBe('new\n');
  });

  it('refuses a scanned file that has been deleted since', async () => {
    const root = project();
    const result = await apply(root, [{ op: 'write', file: '.claude/agents/gone.md', text: 'x', mtime: Date.now() }]);
    expect(result.errors[0].error).toContain('removed on disk');
    expect(exists(path.join(root, '.claude/agents/gone.md'))).toBe(false);
  });

  it('keeps the line endings of the file it replaces', async () => {
    const root = project();
    const crlf = put(path.join(root, '.claude/agents/crlf.md'), 'a\r\nb\r\n');
    const lf = put(path.join(root, '.claude/agents/lf.md'), 'a\nb\n');
    await apply(root, [
      { op: 'write', file: '.claude/agents/crlf.md', text: 'x\ny\n', mtime: mtimeOf(crlf) },
      { op: 'write', file: '.claude/agents/lf.md', text: 'x\ny\n', mtime: mtimeOf(lf) },
    ]);
    expect(read(crlf)).toBe('x\r\ny\r\n');
    expect(read(lf)).toBe('x\ny\n');
  });

  it('moves a trashed file to the Recycle Bin and ignores a missing one', async () => {
    const root = project();
    const abs = put(path.join(root, '.claude/agents/a.md'), 'x');
    const result = await apply(root, [
      { op: 'trash', file: '.claude/agents/a.md' },
      { op: 'trash', file: '.claude/agents/never-existed.md' },
    ]);
    expect(result.ok).toBe(true);
    expect(exists(abs)).toBe(false);
    expect(trashed()).toHaveLength(1);
  });

  it('writes nothing when any operation fails its checks', async () => {
    const root = project();
    const keep = put(path.join(root, '.claude/agents/keep.md'), 'keep\n');
    const result = await apply(root, [
      { op: 'write', file: '.claude/agents/fresh.md', text: 'fresh\n' },
      { op: 'write', file: '.claude/agents/keep.md', text: 'changed\n', mtime: mtimeOf(keep) - 5000 },
      { op: 'trash', file: '.claude/agents/keep.md' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(exists(path.join(root, '.claude/agents/fresh.md'))).toBe(false);
    expect(read(keep)).toBe('keep\n');
    expect(trashed()).toHaveLength(0);
  });
});

describe('apply: JSON edits', () => {
  const file = '.mcp.json';

  it('sets a nested value and creates the file and the missing objects', async () => {
    const root = project();
    const result = await apply(root, [{ op: 'jsonSet', file, path: ['mcpServers', 'git'], value: { command: 'git-mcp' } }]);
    expect(result.ok).toBe(true);
    expect(JSON.parse(read(path.join(root, file)))).toEqual({ mcpServers: { git: { command: 'git-mcp' } } });
  });

  it('applies all edits to one file in a single write and keeps the rest of it', async () => {
    const root = project();
    const abs = put(path.join(root, file), '{\n    "other": 1,\n    "mcpServers": {\n        "a": {},\n        "b": {}\n    }\n}\n');
    const result = await apply(root, [
      { op: 'jsonRemove', file, path: ['mcpServers', 'a'], mtime: mtimeOf(abs) },
      { op: 'jsonSet', file, path: ['mcpServers', 'c'], value: { url: 'https://x' } },
    ]);
    expect(result.ok).toBe(true);
    const text = read(abs);
    expect(JSON.parse(text)).toEqual({ other: 1, mcpServers: { b: {}, c: { url: 'https://x' } } });
    expect(text).toContain('\n    "other"');
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('keeps tabs and CRLF line endings', async () => {
    const root = project();
    const abs = put(path.join(root, file), '{\r\n\t"mcpServers": {}\r\n}\r\n');
    await apply(root, [{ op: 'jsonSet', file, path: ['mcpServers', 'a'], value: {} }]);
    expect(read(abs)).toBe('{\r\n\t"mcpServers": {\r\n\t\t"a": {}\r\n\t}\r\n}\r\n');
  });

  it('removing a key below a missing parent changes nothing, and never creates the file', async () => {
    const root = project();
    const abs = put(path.join(root, '.claude/settings.json'), '{\n  "a": 1\n}\n');
    const ok = await apply(root, [{ op: 'jsonRemove', file: '.claude/settings.json', path: ['hooks', 'Stop'] }]);
    expect(ok.ok).toBe(true);
    expect(JSON.parse(read(abs))).toEqual({ a: 1 });

    const none = await apply(root, [{ op: 'jsonRemove', file, path: ['mcpServers', 'x'] }]);
    expect(none.ok).toBe(true);
    expect(exists(path.join(root, file))).toBe(false);
  });

  it('refuses a file that is not a JSON object', async () => {
    const root = project();
    put(path.join(root, file), '{ not json');
    put(path.join(root, '.claude/settings.json'), '[1, 2]');
    const bad = await apply(root, [{ op: 'jsonSet', file, path: ['a'], value: 1 }]);
    const array = await apply(root, [{ op: 'jsonSet', file: '.claude/settings.json', path: ['a'], value: 1 }]);
    expect(bad.errors[0].error).toBe('is not valid JSON');
    expect(array.errors[0].error).toBe('is not a JSON object');
    expect(read(path.join(root, file))).toBe('{ not json');
  });

  it('refuses a file that changed or was removed since the scan', async () => {
    const root = project();
    const abs = put(path.join(root, file), '{}\n');
    const stale = await apply(root, [{ op: 'jsonSet', file, path: ['a'], value: 1, mtime: mtimeOf(abs) - 5000 }]);
    expect(stale.errors[0].error).toContain('changed on disk');
    const gone = await apply(root, [{ op: 'jsonSet', file: '.claude/settings.json', path: ['a'], value: 1, mtime: 1 }]);
    expect(gone.errors[0].error).toContain('removed on disk');
    expect(read(abs)).toBe('{}\n');
  });

  it('does not write a JSON file when a plain file in the same batch fails', async () => {
    const root = project();
    put(path.join(root, '.claude/agents/a.md'), 'x');
    const result = await apply(root, [
      { op: 'jsonSet', file, path: ['a'], value: 1 },
      { op: 'write', file: '.claude/agents/a.md', text: 'y' },
    ]);
    expect(result.ok).toBe(false);
    expect(exists(path.join(root, file))).toBe(false);
  });
});

describe('copy', () => {
  const agent = { kind: 'agent', file: '.claude/agents/team/rev.md' };

  it('copies agents, commands and rules with their subfolders', async () => {
    const from = project();
    const to = project();
    put(path.join(from, '.claude/agents/team/rev.md'), 'agent');
    put(path.join(from, '.claude/commands/git/commit.md'), 'cmd');
    put(path.join(from, '.claude/rules/style.md'), 'rule');
    const result = await copy(from, to, [agent, { kind: 'cmd', file: '.claude/commands/git/commit.md' }, { kind: 'rule', file: '.claude/rules/style.md' }]);
    expect(result.errors).toEqual([]);
    expect(result.copied).toHaveLength(3);
    expect(read(path.join(to, '.claude/agents/team/rev.md'))).toBe('agent');
    expect(read(path.join(to, '.claude/commands/git/commit.md'))).toBe('cmd');
    expect(read(path.join(to, '.claude/rules/style.md'))).toBe('rule');
  });

  it('copies a skill as its whole folder and leaves symbolic links out', async () => {
    const from = project();
    const to = project();
    put(path.join(from, '.claude/skills/deploy/SKILL.md'), 'skill');
    put(path.join(from, '.claude/skills/deploy/scripts/run.sh'), 'echo');
    let linked = true;
    try {
      fsSync.symlinkSync(path.join(from, '.claude/skills/deploy/SKILL.md'), path.join(from, '.claude/skills/deploy/link.md'));
    } catch {
      linked = false; // creating links needs a privilege on Windows
    }
    const result = await copy(from, to, [{ kind: 'skill', file: '.claude/skills/deploy/SKILL.md' }]);
    expect(result.errors).toEqual([]);
    expect(read(path.join(to, '.claude/skills/deploy/SKILL.md'))).toBe('skill');
    expect(read(path.join(to, '.claude/skills/deploy/scripts/run.sh'))).toBe('echo');
    if (linked) expect(exists(path.join(to, '.claude/skills/deploy/link.md'))).toBe(false);
  });

  it('skips what the destination has, and replaces it only on request, through the Recycle Bin', async () => {
    const from = project();
    const to = project();
    put(path.join(from, agent.file), 'new');
    put(path.join(to, agent.file), 'old');

    const kept = await copy(from, to, [agent]);
    expect(kept).toEqual({ copied: [], skipped: [agent.file], errors: [] });
    expect(read(path.join(to, agent.file))).toBe('old');

    const replaced = await copy(from, to, [agent], true);
    expect(replaced.copied).toEqual([agent.file]);
    expect(read(path.join(to, agent.file))).toBe('new');
    expect(trashed()).toHaveLength(1);
  });

  it('replaces a skill folder without leaving files of the old one behind', async () => {
    const from = project();
    const to = project();
    put(path.join(from, '.claude/skills/s/SKILL.md'), 'new');
    put(path.join(to, '.claude/skills/s/SKILL.md'), 'old');
    put(path.join(to, '.claude/skills/s/stale.txt'), 'stale');
    await copy(from, to, [{ kind: 'skill', file: '.claude/skills/s/SKILL.md' }], true);
    expect(read(path.join(to, '.claude/skills/s/SKILL.md'))).toBe('new');
    expect(exists(path.join(to, '.claude/skills/s/stale.txt'))).toBe(false);
  });

  it('refuses a bad destination', async () => {
    const from = project();
    put(path.join(from, agent.file), 'x');
    const missing = await copy(from, path.join(from, 'nope'), [agent]);
    expect(missing.errors[0].error).toBe('is not a folder');
    const same = await copy(from, from, [agent]);
    expect(same.errors[0].error).toContain('already open');
  });

  it('refuses items that are not what they claim, and then copies nothing at all', async () => {
    const from = project();
    const to = project();
    put(path.join(from, agent.file), 'x');
    put(path.join(from, 'src/evil.md'), 'x');
    put(path.join(from, '.claude/skills/s/notes.md'), 'x');
    const result = await copy(from, to, [
      agent,
      { kind: 'agent', file: 'src/evil.md' },
      { kind: 'skill', file: '.claude/skills/s/notes.md' },
      { kind: 'rule', file: '.claude/rules/gone.md' },
    ]);
    expect(result.copied).toEqual([]);
    expect(result.errors.map((e) => e.error)).toEqual([
      'is not inside .claude/agents of this project',
      'is not the SKILL.md of a skill folder',
      'no longer exists on disk',
    ]);
    expect(exists(path.join(to, agent.file))).toBe(false);
  });

  describe('MCP servers', () => {
    const server = (name: string, file = '.mcp.json') => ({ kind: 'mcp', file, name });

    it('merges servers into the destination as single keys and keeps the rest of the file', async () => {
      const from = project();
      const to = project();
      put(path.join(from, '.mcp.json'), JSON.stringify({ mcpServers: { git: { command: 'git' }, db: { command: 'db' } } }));
      put(path.join(to, '.mcp.json'), '{\r\n\t"note": true,\r\n\t"mcpServers": {\r\n\t\t"mine": {}\r\n\t}\r\n}\r\n');
      const result = await copy(from, to, [server('git')]);
      expect(result.copied).toEqual(['.mcp.json › git']);
      const text = read(path.join(to, '.mcp.json'));
      expect(JSON.parse(text)).toEqual({ note: true, mcpServers: { mine: {}, git: { command: 'git' } } });
      expect(text).toContain('\r\n\t"note"');
    });

    it('creates .mcp.json when the destination has none', async () => {
      const from = project();
      const to = project();
      put(path.join(from, '.mcp.json'), JSON.stringify({ mcpServers: { git: { command: 'git' } } }));
      await copy(from, to, [server('git')]);
      expect(JSON.parse(read(path.join(to, '.mcp.json')))).toEqual({ mcpServers: { git: { command: 'git' } } });
    });

    it('skips an existing server unless replace is on', async () => {
      const from = project();
      const to = project();
      put(path.join(from, '.mcp.json'), JSON.stringify({ mcpServers: { git: { command: 'new' } } }));
      put(path.join(to, '.mcp.json'), JSON.stringify({ mcpServers: { git: { command: 'old' } } }));
      expect((await copy(from, to, [server('git')])).skipped).toEqual(['.mcp.json › git']);
      expect(JSON.parse(read(path.join(to, '.mcp.json'))).mcpServers.git.command).toBe('old');
      expect((await copy(from, to, [server('git')], true)).copied).toEqual(['.mcp.json › git']);
      expect(JSON.parse(read(path.join(to, '.mcp.json'))).mcpServers.git.command).toBe('new');
    });

    it('reports a server that is gone, one with the wrong file and an invalid destination', async () => {
      const from = project();
      const to = project();
      put(path.join(from, '.mcp.json'), JSON.stringify({ mcpServers: { git: {} } }));
      const gone = await copy(from, to, [server('missing')]);
      expect(gone.errors[0].error).toBe('no longer exists in .mcp.json');
      const wrong = await copy(from, to, [server('git', '.claude/other.json')]);
      expect(wrong.errors[0].error).toBe('is not a server of the project .mcp.json');

      put(path.join(to, '.mcp.json'), '{ broken');
      const invalid = await copy(from, to, [server('git')]);
      expect(invalid.errors[0].error).toContain('not valid JSON');
      expect(read(path.join(to, '.mcp.json'))).toBe('{ broken');
    });

    it('does not copy files when a server fails', async () => {
      const from = project();
      const to = project();
      put(path.join(from, agent.file), 'x');
      const result = await copy(from, to, [agent, server('missing')]);
      expect(result.copied).toEqual([]);
      expect(exists(path.join(to, agent.file))).toBe(false);
    });
  });
});

describe('has', () => {
  it('tells which files and servers a project already has', async () => {
    const root = project();
    put(path.join(root, '.claude/agents/a.md'), 'x');
    put(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { git: {} } }));
    const flags = await invoke<boolean[]>('workspace:has', root, [
      { kind: 'agent', file: '.claude/agents/a.md' },
      { kind: 'agent', file: '.claude/agents/b.md' },
      { kind: 'mcp', file: '.mcp.json', name: 'git' },
      { kind: 'mcp', file: '.mcp.json', name: 'db' },
    ]);
    expect(flags).toEqual([true, false, true, false]);
  });

  it('exists answers per path', async () => {
    const root = project();
    put(path.join(root, 'CLAUDE.md'), 'x');
    expect(await invoke<boolean[]>('workspace:exists', root, ['CLAUDE.md', 'nope.md', '.claude'])).toEqual([true, false, false]);
  });
});

describe('scan: project', () => {
  const find = (r: ScanResult, file: string) => r.files.find((f) => f.file === file);

  it('reads every kind of project file with its scope', async () => {
    const root = project();
    put(path.join(root, '.claude/agents/team/rev.md'), 'a');
    put(path.join(root, '.claude/skills/deploy/SKILL.md'), 's');
    put(path.join(root, '.claude/skills/deploy/notes.md'), 'ignored');
    put(path.join(root, '.claude/commands/git/commit.md'), 'c');
    put(path.join(root, '.claude/rules/style.md'), 'r');
    put(path.join(root, '.claude/output-styles/terse.md'), 'o');
    put(path.join(root, '.claude/settings.json'), '{}');
    put(path.join(root, '.claude/settings.local.json'), '{}');
    put(path.join(root, '.claude/CLAUDE.md'), 'inner');
    put(path.join(root, 'CLAUDE.md'), 'outer');
    put(path.join(root, 'CLAUDE.local.md'), 'local');
    put(path.join(root, '.mcp.json'), '{}');
    put(path.join(root, '.claude/statusline.sh'), 'echo');
    put(path.join(root, 'src/app.md'), 'not config');

    const r = await scan(root);
    const got = Object.fromEntries(r.files.map((f) => [f.file, `${f.kind}/${f.scope}`]));
    expect(got).toEqual({
      '.claude/agents/team/rev.md': 'agent/project',
      '.claude/skills/deploy/SKILL.md': 'skill/project',
      '.claude/commands/git/commit.md': 'cmd/project',
      '.claude/rules/style.md': 'rule/project',
      '.claude/output-styles/terse.md': 'style/project',
      '.claude/CLAUDE.md': 'claudemd/project',
      'CLAUDE.md': 'claudemd/project',
      'CLAUDE.local.md': 'claudemd/local',
      '.claude/settings.json': 'settings/project',
      '.claude/settings.local.json': 'settings/local',
      '.mcp.json': 'mcp/project',
      '.claude/statusline.sh': 'other/project',
    });
    expect(find(r, '.claude/statusline.sh')!.text).toBe('');
    expect(r.name).toBe(path.basename(root));
  });

  it('strips a BOM and turns CRLF into LF, and reports the mtime', async () => {
    const root = project();
    const abs = put(path.join(root, '.claude/agents/a.md'), '﻿one\r\ntwo\r\n');
    const file = find(await scan(root), '.claude/agents/a.md')!;
    expect(file.text).toBe('one\ntwo\n');
    expect(file.mtime).toBe(mtimeOf(abs));
  });

  it('skips files over 1 MiB, ignored folders and symbolic links', async () => {
    const root = project();
    put(path.join(root, '.claude/agents/big.md'), 'x'.repeat(1024 * 1024 + 1));
    put(path.join(root, '.claude/agents/small.md'), 'x');
    put(path.join(root, '.claude/agents/vendor/v.md'), 'x');
    put(path.join(root, '.claude/skills/vendor/SKILL.md'), 'x');
    put(path.join(root, 'elsewhere/real.md'), 'x');
    try {
      fsSync.symlinkSync(path.join(root, 'elsewhere'), path.join(root, '.claude/agents/linked'), 'junction');
    } catch {
      /* links are not available here */
    }
    const files = (await scan(root, { ignore: ['vendor'] })).files.map((f) => f.file);
    expect(files).toEqual(['.claude/agents/small.md']);
  });

  it('stops looking six folders down', async () => {
    const root = project();
    put(path.join(root, '.claude/agents/a/b/c/d/e/f/ok.md'), 'x');
    put(path.join(root, '.claude/agents/a/b/c/d/e/f/g/too-deep.md'), 'x');
    expect((await scan(root)).files.map((f) => f.file)).toEqual(['.claude/agents/a/b/c/d/e/f/ok.md']);
  });

  it('rejects a folder that does not exist', async () => {
    await expect(scan(path.join(sandbox.base, 'missing'))).rejects.toThrow('folder not found');
  });

  it('does not read ~/.claude twice when the home folder itself is opened', async () => {
    put(path.join(sandbox.home, '.claude/agents/u.md'), 'x');
    expect((await scan(sandbox.home)).files).toEqual([]);
    const withUser = await scan(sandbox.home, { user: true });
    // Shown relative to the opened folder, which is the home folder here.
    expect(withUser.files.map((f) => `${f.file}/${f.scope}`)).toEqual(['.claude/agents/u.md/user']);
  });
});

describe('scan: user scope, plugins and managed', () => {
  it('reads ~/.claude, the auto memory of the project and only the MCP servers of ~/.claude.json', async () => {
    const root = project();
    put(path.join(sandbox.home, '.claude/agents/u.md'), 'x');
    put(path.join(sandbox.home, '.claude/CLAUDE.md'), 'x');
    put(path.join(sandbox.home, '.claude/settings.json'), '{}');
    put(path.join(sandbox.home, '.claude/keybindings.json'), '{}');
    put(path.join(sandbox.home, '.claude/projects', root.replace(/[^A-Za-z0-9]/g, '-'), 'memory', 'MEMORY.md'), 'mem');
    put(
      path.join(sandbox.home, '.claude.json'),
      JSON.stringify({
        userID: 'secret-account-id',
        history: ['private prompt'],
        mcpServers: { global: { command: 'g' } },
        projects: { [root]: { mcpServers: { local: { command: 'l' } }, history: ['x'] }, [path.join(sandbox.base, 'other')]: { mcpServers: { foreign: {} } } },
      }),
    );

    const r = await scan(root, { user: true });
    const got = Object.fromEntries(r.files.map((f) => [f.file, `${f.kind}/${f.scope}`]));
    expect(got).toEqual({
      '~/.claude/agents/u.md': 'agent/user',
      '~/.claude/CLAUDE.md': 'claudemd/user',
      '~/.claude/settings.json': 'settings/user',
      '~/.claude/keybindings.json': 'other/user',
      [`~/.claude/projects/${root.replace(/[^A-Za-z0-9]/g, '-')}/memory/MEMORY.md`]: 'memory/user',
      '~/.claude.json': 'mcp/user',
    });
    const mcp = r.files.find((f) => f.file === '~/.claude.json')!;
    expect(JSON.parse(mcp.text)).toEqual({ mcpServers: { global: { command: 'g' }, local: { command: 'l' } } });
    expect(mcp.text).not.toContain('secret-account-id');
    expect(mcp.text).not.toContain('private prompt');
  });

  it('leaves user files out when user scope is off', async () => {
    put(path.join(sandbox.home, '.claude/agents/u.md'), 'x');
    expect((await scan(project())).files).toEqual([]);
  });

  it('reads installed plugins, prefixed with the plugin name', async () => {
    const root = project();
    const a = path.join(sandbox.base, 'plugins', 'a');
    const b = path.join(sandbox.base, 'plugins', 'b');
    put(path.join(a, 'agents/helper.md'), 'x');
    put(path.join(a, 'skills/s/SKILL.md'), 'x');
    put(path.join(a, 'rules/ignored.md'), 'x');
    put(path.join(a, '.mcp.json'), '{}');
    put(path.join(a, '.claude-plugin/plugin.json'), JSON.stringify({ description: 'Plugin A', version: '9.9.9' }));
    put(path.join(b, 'commands/go.md'), 'x');
    put(
      path.join(sandbox.home, '.claude/plugins/installed_plugins.json'),
      JSON.stringify({
        plugins: {
          'a@market': [{ installPath: 'ignored-old', version: '0' }, { installPath: a, version: '1.2.3' }],
          'b@market': { installPath: b },
          'missing@market': { installPath: path.join(sandbox.base, 'plugins', 'missing') },
        },
      }),
    );
    const r = await scan(root, { plugins: true });
    expect(r.files.map((f) => `${f.file}/${f.kind}/${f.plugin}`).sort()).toEqual([
      'a/.mcp.json/mcp/a',
      'a/agents/helper.md/agent/a',
      'a/skills/s/SKILL.md/skill/a',
      'b/commands/go.md/cmd/b',
    ]);
    expect(r.plugins.map((p) => [p.name, p.version, p.description])).toEqual([
      ['a', '1.2.3', 'Plugin A'],
      ['b', '', ''],
    ]);
  });

  it.runIf(process.platform === 'win32')('reads the managed folder only when asked to', async () => {
    const dir = path.join(sandbox.managed, 'ClaudeCode');
    put(path.join(dir, 'managed-settings.json'), '{}');
    put(path.join(dir, 'managed-settings.d', '10-a.json'), '{}');
    put(path.join(dir, 'managed-mcp.json'), '{}');
    const root = project();
    expect((await scan(root)).files).toEqual([]);
    const r = await scan(root, { managed: true });
    expect(r.files.map((f) => `${f.kind}/${f.scope}`)).toEqual(['settings/managed', 'settings/managed', 'mcp/managed']);
  });
});

describe('scan: environment and git', () => {
  it('lists the variables .mcp.json uses that are not set', async () => {
    const root = project();
    process.env['AGENTDOCK_TEST_SET'] = '1';
    delete process.env['AGENTDOCK_TEST_UNSET'];
    put(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { a: { env: { A: '${AGENTDOCK_TEST_SET}', B: '${AGENTDOCK_TEST_UNSET}', C: '${AGENTDOCK_TEST_UNSET}' } } } }));
    expect((await scan(root)).unsetEnv).toEqual(['AGENTDOCK_TEST_UNSET']);
    delete process.env['AGENTDOCK_TEST_SET'];
  });

  it('reads the branch from .git/HEAD, from a worktree file and from a detached HEAD', async () => {
    const plain = project();
    put(path.join(plain, '.git/HEAD'), 'ref: refs/heads/feat/x\n');
    expect((await scan(plain)).branch).toBe('feat/x');

    const detached = project();
    put(path.join(detached, '.git/HEAD'), '0123456789abcdef\n');
    expect((await scan(detached)).branch).toBe('0123456');

    const main = project();
    const wt = project();
    put(path.join(main, '.git/worktrees/wt/HEAD'), 'ref: refs/heads/wt-branch\n');
    put(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git/worktrees/wt')}\n`);
    expect((await scan(wt)).branch).toBe('wt-branch');

    expect((await scan(project())).branch).toBe('');
  });
});

describe('watch', () => {
  /** A stand-in for the window that receives `workspace:changed`. */
  function sender() {
    return { send: vi.fn(), isDestroyed: () => false };
  }
  const watch = (s: ReturnType<typeof sender>, root: string, user = false) => handlers.get('workspace:watch')!({ sender: s }, root, user);

  // A save of an earlier test mutes events for 800 ms (the module keeps that state), so let it pass.
  beforeEach(() => sleep(900));

  it('reports a change in .claude once, however many files changed', async () => {
    const root = project();
    fsSync.mkdirSync(path.join(root, '.claude/agents'), { recursive: true });
    const s = sender();
    await watch(s, root);
    put(path.join(root, '.claude/agents/a.md'), '1');
    put(path.join(root, '.claude/agents/b.md'), '2');
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledWith('workspace:changed'), { timeout: 5000 });
    await sleep(700);
    expect(s.send).toHaveBeenCalledTimes(1);
  });

  it('reports changes of the top-level files and of the user folder', async () => {
    const root = project();
    fsSync.mkdirSync(path.join(sandbox.home, '.claude/agents'), { recursive: true });
    const s = sender();
    await watch(s, root, true);
    put(path.join(root, 'CLAUDE.md'), 'x');
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(1), { timeout: 5000 });
    put(path.join(sandbox.home, '.claude/agents/u.md'), 'x');
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(2), { timeout: 5000 });
  });

  it('ignores unrelated files in the project root', async () => {
    const root = project();
    const s = sender();
    await watch(s, root);
    put(path.join(root, 'README.md'), 'x');
    await sleep(800);
    expect(s.send).not.toHaveBeenCalled();
  });

  it('does not report the changes of its own saves', async () => {
    const root = project();
    fsSync.mkdirSync(path.join(root, '.claude'), { recursive: true });
    const s = sender();
    await watch(s, root);
    await apply(root, [{ op: 'write', file: '.claude/agents/mine.md', text: 'x' }]);
    await sleep(700);
    expect(s.send).not.toHaveBeenCalled();
  });

  it('stops after unwatch, and a new watch replaces the old one', async () => {
    const root = project();
    fsSync.mkdirSync(path.join(root, '.claude'), { recursive: true });
    const old = sender();
    const current = sender();
    await watch(old, root);
    await watch(current, root);
    await invoke('workspace:unwatch');
    put(path.join(root, '.claude/a.md'), 'x');
    await sleep(800);
    expect(old.send).not.toHaveBeenCalled();
    expect(current.send).not.toHaveBeenCalled();
  });
});
