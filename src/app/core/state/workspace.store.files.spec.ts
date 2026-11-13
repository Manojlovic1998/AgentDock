import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { buildSnapshot } from '../data/build-snapshot';
import { ResourceRepository } from '../data/resource-repository';
import { ScanFile } from '../data/scan';
import { CopyResult, FileOp, SaveResult, WorkspaceSnapshot } from '../model/types';
import { PrefsStore } from './prefs.store';
import { UiStore } from './ui.store';
import { AUTOSAVE_MS, WorkspaceStore } from './workspace.store';

const AGENT = `---
name: reviewer
description: Reviews code.
---

You review changes.
`;

/** A workspace backed by an in-memory folder, so saving and rescanning behave as they do on disk. */
class FolderRepository extends ResourceRepository {
  readonly desktop = true;
  readonly persistent = true;
  files: Record<string, string> = { '.claude/agents/reviewer.md': AGENT };
  saves: FileOp[][] = [];
  /** Error every save fails with, while set. */
  failWith = '';
  /** Called while a save is being written, before it resolves. */
  duringSave: (() => void) | null = null;
  watched: boolean[] = [];
  private clock = 1;
  private listener: () => void = () => undefined;

  load(): Promise<WorkspaceSnapshot> {
    const files: ScanFile[] = Object.entries(this.files).map(([file, text]) => ({
      kind: /settings(\.local)?\.json$/.test(file) ? 'settings' : file.includes('/skills/') ? 'skill' : 'agent',
      scope: 'project',
      file,
      text,
      mtime: this.clock,
    }));
    return Promise.resolve(buildSnapshot({ root: '/code/shop', home: '/home/me', name: 'shop', branch: 'main', files, plugins: [], unsetEnv: [] }, Date.now()));
  }

  async save(ops: FileOp[]): Promise<SaveResult> {
    this.saves.push(ops);
    await Promise.resolve();
    this.duringSave?.();
    if (this.failWith) return { ok: false, errors: [{ file: ops[0].file, error: this.failWith }] };
    this.clock++;
    ops.forEach((op) => {
      if (op.op === 'write') this.files[op.file] = op.text;
      else if (op.op === 'trash') delete this.files[op.file];
    });
    return { ok: true, errors: [] };
  }

  /** Changes a file the way another program would, and reports it like the file watcher does. */
  writeOutside(file: string, text: string): void {
    this.clock++;
    this.files[file] = text;
    this.listener();
  }

  pickFolder(): Promise<string | null> {
    return Promise.resolve(null);
  }

  existsIn(_dest: string, items: unknown[]): Promise<boolean[]> {
    return Promise.resolve(items.map(() => false));
  }

  copyTo(): Promise<CopyResult> {
    return Promise.resolve({ copied: [], skipped: [], errors: [] });
  }

  watch(enabled: boolean): Promise<boolean> {
    this.watched.push(enabled);
    return Promise.resolve(enabled);
  }

  onExternalChange(listener: () => void): void {
    this.listener = listener;
  }
}

describe('WorkspaceStore with files', () => {
  let ws: WorkspaceStore;
  let ui: UiStore;
  let prefs: PrefsStore;
  let repo: FolderRepository;

  /** Lets effects run and pending promises settle. */
  const settle = async (): Promise<void> => {
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    TestBed.tick();
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [{ provide: ResourceRepository, useClass: FolderRepository }] });
    ws = TestBed.inject(WorkspaceStore);
    ui = TestBed.inject(UiStore);
    prefs = TestBed.inject(PrefsStore);
    repo = TestBed.inject(ResourceRepository) as FolderRepository;
    await ws.init();
    await settle();
  });

  afterEach(() => vi.useRealTimers());

  describe('normalize frontmatter on save', () => {
    it('leaves the key order alone by default and sorts it when the setting is on', () => {
      repo.files['.claude/agents/reviewer.md'] = '---\ndescription: Reviews code.\nname: reviewer\n---\nBody\n';
      return ws.reload().then(() => {
        ws.edit('agent:reviewer', { model: 'opus' });
        expect(ws.changes()[0].text).toBe('---\ndescription: Reviews code.\nname: reviewer\nmodel: opus\n---\nBody\n');

        prefs.set('normalize', true);
        expect(ws.changes()[0].text).toBe('---\nname: reviewer\ndescription: Reviews code.\nmodel: opus\n---\nBody\n');
      });
    });

    it('does not create changes of its own', async () => {
      repo.files['.claude/agents/reviewer.md'] = '---\ndescription: Reviews code.\nname: reviewer\n---\nBody\n';
      await ws.reload();
      prefs.set('normalize', true);
      expect(ws.changes()).toEqual([]);
    });
  });

  describe('write changes immediately', () => {
    it('keeps edits pending while the setting is off', async () => {
      ws.edit('agent:reviewer', { desc: 'Reviews pull requests.' });
      await settle();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 3);
      expect(repo.saves).toHaveLength(0);
      expect(ws.changes()).toHaveLength(1);
    });

    it('saves once the edits have been quiet for a moment', async () => {
      prefs.set('autosave', true);
      ws.edit('agent:reviewer', { desc: 'Reviews pull' });
      await settle();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 100);
      ws.edit('agent:reviewer', { desc: 'Reviews pull requests.' });
      await settle();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 100);
      expect(repo.saves).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(200);
      await settle();
      expect(repo.saves).toHaveLength(1);
      expect(repo.files['.claude/agents/reviewer.md']).toContain('description: Reviews pull requests.');
      expect(ws.changes()).toEqual([]);
      expect(ui.toast()).toBeNull();
      expect(ui.log()[0].msg).toBe('Saved 1 file to disk automatically');
    });

    it('keeps what was typed while the save was running', async () => {
      prefs.set('autosave', true);
      repo.duringSave = () => ws.edit('agent:reviewer', { desc: 'Typed during the save.' });
      ws.edit('agent:reviewer', { desc: 'First.' });
      await settle();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      repo.duringSave = null;
      await settle();

      expect(repo.files['.claude/agents/reviewer.md']).toContain('description: First.');
      expect(ws.model().by['agent:reviewer'].desc).toBe('Typed during the save.');
      expect(ws.changes()).toHaveLength(1);
    });

    it('does not repeat a save that failed until the changes differ', async () => {
      prefs.set('autosave', true);
      repo.failWith = 'changed on disk since the last scan';
      ws.edit('agent:reviewer', { desc: 'One.' });
      await settle();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 5);
      await settle();
      expect(repo.saves).toHaveLength(1);
      expect(ui.toast()?.msg).toBe('Not saved: .claude/agents/reviewer.md changed on disk since the last scan');

      ws.edit('agent:reviewer', { desc: 'Two.' });
      await settle();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      await settle();
      expect(repo.saves).toHaveLength(2);
    });

    it('waits while an action can still be undone', async () => {
      prefs.set('autosave', true);
      ws.remove('agent:reviewer');
      await settle();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2);
      expect(repo.saves).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(6500);
      await settle();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      await settle();
      expect(repo.saves).toEqual([[{ op: 'trash', file: '.claude/agents/reviewer.md' }]]);
    });
  });

  describe('editing source', () => {
    const SKILL = '---\nname: lint\ndescription: Lints.\n---\nRun it.\n';

    beforeEach(async () => {
      repo.files['.claude/skills/lint/SKILL.md'] = SKILL;
      await ws.reload();
    });

    it('reads typed source back into fields and relationships', () => {
      const text = '---\nname: reviewer\ndescription: Reviews hard.\nmodel: opus\nskills:\n  - lint\n  - ghost\n---\n\nNew instructions.\n';
      expect(ws.editRaw('agent:reviewer', text)).toBeNull();
      expect(ws.model().by['agent:reviewer']).toMatchObject({ desc: 'Reviews hard.', model: 'opus', body: 'New instructions.' });
      expect(ws.skillsOf('agent:reviewer').map((s) => s.id)).toEqual(['skill:lint']);
      // The typed text is what gets written, byte for byte.
      expect(ws.changes()[0].text).toBe(text);

      // A key that is removed from the text is no longer overridden by an earlier edit.
      ws.editRaw('agent:reviewer', AGENT);
      expect(ws.model().by['agent:reviewer']).toMatchObject({ desc: 'Reviews code.', model: 'inherit' });
      expect(ws.skillsOf('agent:reviewer')).toEqual([]);
      expect(ws.changes()).toEqual([]);
    });

    it('keeps field edits and source edits consistent', () => {
      ws.editRaw('agent:reviewer', AGENT.replace('Reviews code.', 'Reviews code well.'));
      ws.edit('agent:reviewer', { model: 'haiku' });
      expect(ws.changes()[0].text).toBe('---\nname: reviewer\ndescription: Reviews code well.\nmodel: haiku\n---\n\nYou review changes.\n');
    });

    it('reads CLAUDE.md as plain text and MCP servers as JSON', async () => {
      expect(ws.editRaw('agent:nope', 'x')).toBe('This resource no longer exists.');
      const sample = ws.model().by['skill:lint'];
      expect(ws.rawBlocker(sample)).toBeNull();
      expect(ws.rawBlocker({ ...sample, scope: 'plugin' })).toBe('Files in plugin scope are read-only.');
      expect(ws.rawBlocker({ ...sample, raw: undefined })).toBe('Save this resource once before editing its source.');
    });
  });

  describe('files without a graph node', () => {
    it('lists them, tracks their edits as changes, and discards or saves them', async () => {
      repo.files['.claude/settings.json'] = '{\n  "permissions": {}\n}\n';
      await ws.reload();
      expect(ws.docs().map((d) => d.file)).toEqual(['.claude/settings.json']);

      ws.editDoc('.claude/settings.json', '{\n  "permissions": { "deny": ["Read(./.env)"] }\n}\n');
      const [change] = ws.changes();
      expect(change).toMatchObject({ id: 'doc:.claude/settings.json', kind: 'M', add: 1, del: 1 });
      ws.discardOne(change);
      expect(ws.changes()).toEqual([]);
      expect(ws.docs()[0].text).toBe('{\n  "permissions": {}\n}\n');

      ws.editDoc('.claude/settings.json', '{}\n');
      await ws.saveAll();
      expect(repo.files['.claude/settings.json']).toBe('{}\n');
      expect(repo.saves[0]).toEqual([{ op: 'write', file: '.claude/settings.json', text: '{}\n', mtime: 1 }]);
      expect(ws.changes()).toEqual([]);
    });

    it('adds, changes and removes hooks as edits of the settings file, creating it when missing', async () => {
      expect(ws.hooks()).toEqual([]);
      expect(ws.saveHook('.claude/settings.json', null, { event: 'Stop', matcher: '', command: 'echo done' })).toBe(true);
      expect(ws.changes()).toMatchObject([{ id: 'doc:.claude/settings.json', kind: 'A' }]);
      expect(ws.hooks()).toMatchObject([{ event: 'Stop', command: 'echo done', file: '.claude/settings.json', writable: true }]);

      const [hook] = ws.hooks();
      ws.saveHook('.claude/settings.json', hook.at, { event: 'Stop', matcher: '', command: 'echo finished' });
      expect(ws.hooks().map((h) => h.command)).toEqual(['echo finished']);

      // Moving a hook to another file edits both files.
      ws.saveHook('.claude/settings.local.json', hook.at, { event: 'Stop', matcher: '', command: 'echo finished' }, '.claude/settings.json');
      expect(ws.hooks().map((h) => h.file)).toEqual(['.claude/settings.local.json']);

      ws.removeHook('.claude/settings.local.json', ws.hooks()[0].at);
      expect(ws.hooks()).toEqual([]);

      await ws.saveAll();
      expect(Object.keys(repo.files).filter((f) => f.endsWith('.json'))).toEqual(['.claude/settings.json', '.claude/settings.local.json']);
    });

    it('does not touch a settings file that is not valid JSON', async () => {
      repo.files['.claude/settings.json'] = '{ broken';
      await ws.reload();
      expect(ws.saveHook('.claude/settings.json', null, { event: 'Stop', matcher: '', command: 'x' })).toBe(false);
      expect(ui.toast()?.msg).toBe('Not changed: .claude/settings.json is not valid JSON');
      expect(ws.changes()).toEqual([]);
    });
  });

  describe('saving', () => {
    it('keeps a new resource selected when the scan gives it its real id', async () => {
      const id = ws.addNode('agent');
      ui.sel.set([id]);
      await ws.saveAll();
      expect(ui.sel()).toEqual(['agent:untitled-agent']);
    });

    it('keeps a renamed resource selected', async () => {
      ui.sel.set(['agent:reviewer']);
      ws.edit('agent:reviewer', { name: 'critic' });
      await ws.saveAll();
      expect(ui.sel()).toEqual(['agent:critic']);
    });
  });

  describe('watching files', () => {
    it('follows the setting', async () => {
      expect(repo.watched[repo.watched.length - 1]).toBe(true);
      expect(ws.watching()).toBe(true);
      expect(ws.watchLabel()).toBe('Watching .claude/ and ~/.claude/');

      prefs.set('watch', false);
      await settle();
      expect(repo.watched[repo.watched.length - 1]).toBe(false);
      expect(ws.watchLabel()).toBe('Not watching files');
    });

    it('reloads when files change and nothing is pending', async () => {
      repo.writeOutside('.claude/agents/reviewer.md', AGENT.replace('Reviews code.', 'Edited elsewhere.'));
      await settle();
      expect(ws.model().by['agent:reviewer'].desc).toBe('Edited elsewhere.');
      expect(ws.stale()).toBe(false);
      expect(ui.log()[0].msg).toBe('Reloaded shop: configuration changed on disk');
    });

    it('keeps pending edits and marks the workspace stale instead', async () => {
      ws.edit('agent:reviewer', { model: 'opus' });
      repo.writeOutside('.claude/agents/reviewer.md', AGENT.replace('Reviews code.', 'Edited elsewhere.'));
      await settle();
      expect(ws.model().by['agent:reviewer']).toMatchObject({ model: 'opus', desc: 'Reviews code.' });
      expect(ws.stale()).toBe(true);
      expect(ui.toast()?.msg).toContain('Files changed on disk');

      ws.discardAll();
      await ws.rescan();
      expect(ws.stale()).toBe(false);
      expect(ws.model().by['agent:reviewer'].desc).toBe('Edited elsewhere.');
    });
  });
});
