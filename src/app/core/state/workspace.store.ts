import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { emptySnapshot } from '../data/build-snapshot';
import { makeAgent, makeCmd, makeMcp, makeMemory, makeRule, makeSkill } from '../data/mock-data';
import { ResourceRepository } from '../data/resource-repository';
import { buildModel, fileOps, findChanges, findProblems, isDerived, relTouches, statusMap, validName } from '../model/analysis';
import { copySummary } from '../model/copy';
import { parseResource, toList } from '../model/frontmatter';
import { FILTERS, KIND_LABEL, bounds, filterKey, labelOf, layout, plural } from '../model/graph';
import { HookAt, HookFields, listHooks, removeHook, setHook } from '../model/hooks';
import { McpConfig, mcpFields } from '../model/mcp';
import { planRename } from '../model/rename';
import { nameFromFile } from '../model/source';
import {
  Change,
  CopyItem,
  CopyResult,
  FileDoc,
  Kind,
  Point,
  Resource,
  ResourcePatch,
  SaveResult,
  Status,
  WorkspaceSnapshot,
  WorkspaceState,
  docChangeId,
} from '../model/types';
import { PrefsStore } from './prefs.store';
import { UiStore } from './ui.store';
import { ViewportStore } from './viewport.store';

interface UndoSnapshot {
  state: WorkspaceState;
  pos: Record<string, Point>;
  sel: string[];
}

/** Editing state for a freshly loaded snapshot: nothing pending except the sample presets. */
function pristine(snapshot: WorkspaceSnapshot): WorkspaceState {
  return {
    rel: snapshot.rel,
    baseRel: snapshot.rel,
    over: {},
    baseOver: {},
    added: [],
    addedSaved: [],
    deleted: [],
    deletedSaved: [],
    presets: snapshot.presets.map((p) => p.id),
    docs: {},
    baseDocs: {},
  };
}

/** Message of a failed IPC call, without Electron's "Error invoking remote method" prefix. */
const cause = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** Word used in the name of a new, untitled resource of each kind. */
const NEW_NAME: Record<Exclude<Kind, 'mem'>, string> = { agent: 'agent', skill: 'skill', cmd: 'command', rule: 'rule', mcp: 'server' };

/** Quiet time after the last edit before "Write changes immediately" saves. */
export const AUTOSAVE_MS = 1000;

/** Identifies a set of pending changes, so a save that failed is not repeated for the same content. */
const signature = (changes: Change[]): string => changes.map((c) => c.kind + c.file + '\n' + (c.text ?? '')).join('\0');

/**
 * The editable configuration graph: resources, relationships and pending edits,
 * with everything derived from them (model, problems, changes, counts).
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  private readonly ui = inject(UiStore);
  private readonly viewport = inject(ViewportStore);
  private readonly prefs = inject(PrefsStore);
  private readonly repo = inject(ResourceRepository);

  private readonly loaded = signal<WorkspaceSnapshot>(emptySnapshot());
  /** Configuration as last read from the repository. Replaced by `reload()`. */
  get snapshot(): WorkspaceSnapshot {
    return this.loaded();
  }

  readonly state = signal<WorkspaceState>(pristine(this.snapshot));

  private undoSnapshot: UndoSnapshot | null = null;

  /** A save is being written; a second one does not start until it is done. */
  readonly saving = signal(false);
  /** Files of the open workspace are watched for changes made outside the app. */
  readonly watching = signal(false);
  /** Files changed on disk while there were pending edits, so the workspace was not reloaded. */
  readonly stale = signal(false);
  /** Signature of the changes whose save last failed. */
  private failed = '';
  /** A toast is offering Undo. A computed, so other toasts coming and going do not restart autosave. */
  private readonly undoable = computed(() => !!this.ui.toast()?.undo);
  private reloading = false;
  private reloadAgain = false;

  readonly model = computed(() => buildModel(this.snapshot.nodes, this.state()));
  readonly problems = computed(() => findProblems(this.model(), this.snapshot.problems));
  readonly status = computed(() => statusMap(this.problems()));
  readonly changes = computed(() => findChanges(this.snapshot.nodes, this.snapshot.presets, this.state(), this.prefs.prefs().normalize, this.snapshot.docs));

  constructor() {
    this.repo.onExternalChange(() => void this.externalChange());

    // Watching follows the setting and is re-armed after every load: a scan can find new folders.
    effect(() => {
      this.loaded();
      const p = this.prefs.prefs();
      const enabled = p.watch;
      void p.scanUser;
      untracked(() =>
        this.repo.watch(enabled).then(
          (on) => this.watching.set(on),
          () => this.watching.set(false),
        ),
      );
    });

    // "Write changes immediately": save once the edits have been quiet for a moment.
    effect((onCleanup) => {
      this.loaded();
      if (!this.prefs.prefs().autosave || !this.repo.persistent || this.saving()) return;
      const changes = this.changes();
      if (!changes.length || signature(changes) === this.failed) return;
      // An action that offers Undo keeps its window: saving rescans, which ends the undo.
      if (this.undoable()) return;
      const timer = setTimeout(() => void this.saveAll(true), AUTOSAVE_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }
  readonly autoLayout = computed(() => layout(this.model().list));

  /** Resources left on the canvas after the kind filters. */
  readonly visible = computed(() => {
    const filt = this.ui.filt();
    return this.model().list.filter((n) => filt[filterKey(n)] !== false);
  });
  readonly filters = computed(() => {
    const filt = this.ui.filt();
    const list = this.model().list;
    return FILTERS.map(([type, label]) => ({
      type,
      label,
      on: filt[type] !== false,
      n: list.filter((n) => filterKey(n) === type).length,
    }));
  });

  readonly errorCount = computed(() => this.problems().filter((p) => p.sev === 'err').length);
  readonly warnCount = computed(() => this.problems().filter((p) => p.sev === 'warn').length);
  readonly infoCount = computed(() => this.problems().length - this.errorCount() - this.warnCount());

  /** Resource counts per navigation entry. */
  readonly counts = computed<Record<string, number>>(() => {
    const list = this.model().list;
    const count = (t: string) => list.filter((n) => n.type === t && !n.missing).length;
    const rows = (table: string) => this.snapshot.tables[table]?.rows.length ?? 0;
    return {
      agents: count('agent'),
      skills: count('skill'),
      commands: count('cmd'),
      rules: count('rule'),
      mcp: count('mcp'),
      claudemd: count('mem') + rows('claudemd'),
      settingsres: rows('settingsres'),
      hooks: rows('hooks'),
      styles: rows('styles'),
      plugins: rows('plugins'),
      memory: rows('memory'),
      other: rows('other'),
    };
  });
  readonly total = computed(() => Object.values(this.counts()).reduce((a, n) => a + n, 0));

  /** The single selected resource, if exactly one existing resource is selected. */
  readonly selectedOne = computed<Resource | null>(() => {
    const sel = this.ui.sel();
    return sel.length === 1 ? (this.model().by[sel[0]] ?? null) : null;
  });

  statusOf(id: string): Status {
    return this.status()[id] ?? 'ok';
  }

  posOf(id: string): Point {
    return this.viewport.pos()[id] ?? this.autoLayout()[id];
  }

  skillsOf(id: string): Resource[] {
    const m = this.model();
    return m.rel.filter((r) => r[0] === id && m.by[r[1]].type === 'skill').map((r) => m.by[r[1]]);
  }

  neighbors(id: string): Resource[] {
    const m = this.model();
    const out: Resource[] = [];
    m.rel.forEach((r) => {
      if (r[0] === id) out.push(m.by[r[1]]);
      else if (r[1] === id) out.push(m.by[r[0]]);
    });
    return out;
  }

  bounds() {
    return bounds(this.model().list, (id) => this.posOf(id));
  }

  fit(): void {
    this.viewport.fit(this.bounds());
  }

  /* ---------- loading ---------- */

  /** First load, awaited before the app renders. */
  init(): Promise<void> {
    return this.reload();
  }

  /**
   * Reads the workspace again and drops pending edits. Selection and manual node positions are
   * kept for resources that still exist in the same folder.
   *
   * @remarks
   * A resource whose id changed but whose file did not (it was just created, or renamed in its
   * frontmatter) is followed by file, so saving does not deselect what the user is working on.
   *
   * @param keepEditsSince - Editing state at the moment a save started. Field edits made after
   * it, while the save and this reload were running, are applied again instead of being lost.
   */
  async reload(keepEditsSince?: WorkspaceState): Promise<void> {
    const before = this.snapshot;
    const fileOf: Record<string, string> = {};
    this.model().list.forEach((n) => {
      // MCP servers share one file, so it does not identify them.
      if (n.type !== 'mcp') fileOf[n.id] = n.file;
    });
    this.changes().forEach((c) => {
      if (c.kind === 'A' && !c.preset) fileOf[c.id] = c.file;
    });
    let next: WorkspaceSnapshot;
    try {
      next = await this.repo.load();
    } catch (e) {
      const root = this.prefs.prefs().root;
      next = emptySnapshot(root.split(/[\\/]/).filter(Boolean).pop() ?? '', root);
      this.ui.note(`Could not scan ${root}: ${cause(e)}`);
    }
    const ids = new Set(next.nodes.map((n) => n.id));
    const moved = next.path !== before.path;
    const byFile = new Map(next.nodes.filter((n) => n.type !== 'mcp').map((n) => [n.file, n.id]));
    /** Id the resource has in the new snapshot, or undefined when it is gone. */
    const follow = (id: string): string | undefined => (ids.has(id) ? id : moved ? undefined : byFile.get(fileOf[id]));
    const typed = this.state().over;

    this.loaded.set(next);
    this.state.set(pristine(next));
    this.undoSnapshot = null;
    this.stale.set(false);
    this.ui.sel.update((sel) => sel.map(follow).filter((id): id is string => !!id));
    this.ui.chSel.set(null);
    this.viewport.pos.update((pos) => {
      const kept: Record<string, Point> = {};
      if (!moved)
        Object.entries(pos).forEach(([id, p]) => {
          const to = follow(id);
          if (to) kept[to] = p;
        });
      return kept;
    });
    if (keepEditsSince) {
      Object.entries(typed).forEach(([id, patch]) => {
        const to = follow(id);
        const saved = (keepEditsSince.over[id] ?? {}) as Record<string, unknown>;
        const late = Object.entries(patch).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(saved[key]));
        if (to && late.length) this.edit(to, Object.fromEntries(late) as ResourcePatch);
      });
    }
    if (moved && this.viewport.fitted) setTimeout(() => this.fit(), 40);
  }

  /**
   * Handles a change made to the configuration files outside the app.
   *
   * @remarks
   * Without pending edits the workspace is read again. With pending edits nothing is reloaded,
   * because that would discard them: the workspace is marked stale instead, and saving still
   * refuses to overwrite a file that changed.
   */
  private async externalChange(): Promise<void> {
    if (this.saving()) return;
    if (this.reloading) {
      this.reloadAgain = true;
      return;
    }
    if (this.changes().length) {
      if (!this.stale()) this.ui.note('Files changed on disk. Save or discard your changes, then rescan to load them');
      this.stale.set(true);
      return;
    }
    this.reloading = true;
    try {
      do {
        this.reloadAgain = false;
        await this.reload();
      } while (this.reloadAgain && !this.changes().length);
    } finally {
      this.reloading = false;
    }
    this.ui.record(`Reloaded ${this.snapshot.name}: configuration changed on disk`);
  }

  /** Scans the current folder again, unless that would throw away unsaved edits. */
  async rescan(): Promise<void> {
    if (this.blockedByChanges('rescanning')) return;
    await this.reload();
    this.announce(`Rescanned ${this.snapshot.name}`);
  }

  /** Switches to another project folder; asks for one when no path is given. */
  async openFolder(path?: string): Promise<void> {
    if (!this.repo.desktop) return this.ui.note('Opening folders needs the desktop app: the browser build runs on sample data');
    if (this.blockedByChanges('opening another folder')) return;
    const root = path ?? (await this.repo.pickFolder());
    if (!root) return;
    const p = this.prefs.prefs();
    this.prefs.set('recent', [root, ...p.recent.filter((r) => r !== root)].slice(0, 6));
    this.prefs.set('root', root);
    await this.reload();
    this.announce(`Opened ${this.snapshot.name}`);
  }

  private blockedByChanges(doing: string): boolean {
    const n = this.changes().length;
    if (n && this.repo.persistent) this.ui.note(`Save or discard ${plural(n, 'pending change')} before ${doing}`);
    return n > 0 && this.repo.persistent;
  }

  /* ---------- actions ---------- */

  /** Applies a state patch, reports it in a toast and the activity log, and optionally arms undo. */
  private act(patch: Partial<WorkspaceState>, msg: string, undo: boolean): void {
    if (undo) this.undoSnapshot = { state: this.state(), pos: this.viewport.pos(), sel: this.ui.sel() };
    this.state.update((s) => ({ ...s, ...patch }));
    this.ui.ctx.set(null);
    this.ui.dialog.set(null);
    this.announce(msg, undo);
  }

  /** Reports a completed action without touching workspace state. */
  announce(msg: string, undo = false): void {
    this.ui.showToast(msg, undo, 6500);
    this.ui.record(msg);
  }

  undo(): void {
    const u = this.undoSnapshot;
    if (!u) return;
    this.state.set(u.state);
    this.viewport.pos.set(u.pos);
    this.ui.sel.set(u.sel);
    this.undoSnapshot = null;
    this.ui.showToast('Reverted', false, 4500);
  }

  attach(agentId: string, skillId: string): boolean {
    const key = agentId + '>' + skillId;
    const s = this.state();
    if (s.rel.indexOf(key) >= 0) return false;
    const by = this.model().by;
    this.act({ rel: s.rel.concat([key]) }, `Added ${by[skillId].name} to ${by[agentId].name}`, true);
    return true;
  }

  detach(agentId: string, skillId: string): void {
    const key = agentId + '>' + skillId;
    const by = this.model().by;
    this.act({ rel: this.state().rel.filter((r) => r !== key) }, `Removed ${by[skillId].name} from ${by[agentId].name}`, true);
  }

  detachAll(id: string): void {
    const s = this.state();
    const m = this.model();
    const node = m.by[id];
    // Relationships that follow from file content cannot be detached: there is nothing to write.
    const loose = (r: string): boolean => relTouches(r, id) && !isDerived(r.split('>')[0], m.allBy);
    const n = s.rel.filter(loose).length;
    if (!n) {
      const derived = m.rel.some((r) => r.indexOf(id) >= 0);
      return this.ui.note(labelOf(node) + (derived ? ' is only linked through file content. Edit the text to change that' : ' has no relationships'));
    }
    this.act(
      { rel: s.rel.filter((r) => !loose(r)) },
      `Detached ${n} relationship${n > 1 ? 's' : ''} from ${labelOf(node)}`,
      true,
    );
  }

  /** Number of relationships that would be cleaned up when the resource is deleted. */
  referenceCount(id: string): number {
    return this.model().rel.filter((r) => r.indexOf(id) >= 0).length;
  }

  remove(id: string): void {
    const n = this.model().by[id];
    if (!n) return;
    const s = this.state();
    const sel = this.ui.sel().filter((x) => x !== id);
    this.act(
      { deleted: s.deleted.concat([id]), rel: s.rel.filter((r) => !relTouches(r, id)) },
      `Deleted ${KIND_LABEL[n.type].toLowerCase()} ${labelOf(n)}`,
      true,
    );
    this.ui.sel.set(sel);
  }

  /**
   * Creates an untitled resource in project scope.
   *
   * @param type - Kind to create. A project has one CLAUDE.md, so `mem` only works when it has none.
   * @returns Id of the new resource, or null when it was not created.
   */
  addNode(type: Exclude<Kind, 'mem'>): string;
  addNode(type: Kind): string | null;
  addNode(type: Kind): string | null {
    const s = this.state();
    const all = this.snapshot.nodes.concat(s.added);
    if (type === 'mem') {
      if (this.model().by['mem:claude']) {
        this.ui.note('This project already has a CLAUDE.md');
        return null;
      }
      // A CLAUDE.md that was deleted and not saved yet comes back instead of being created twice.
      if (all.some((n) => n.id === 'mem:claude')) {
        this.act({ deleted: s.deleted.filter((id) => id !== 'mem:claude') }, 'Restored CLAUDE.md', true);
        return 'mem:claude';
      }
      this.act({ added: s.added.concat([makeMemory(this.snapshot.name)]) }, 'Created CLAUDE.md', true);
      return 'mem:claude';
    }
    const word = NEW_NAME[type];
    let i = 1;
    let id: string;
    do {
      id = 'untitled-' + word + (i > 1 ? '-' + i : '');
      i++;
    } while (all.some((n) => n.id === id || (n.type === type && n.name === id)));
    const node =
      type === 'cmd'
        ? makeCmd(id)
        : type === 'rule'
          ? makeRule(id)
          : type === 'mcp'
            ? makeMcp(id)
            : type === 'agent'
        ? makeAgent(
            id,
            'Describe when Claude should delegate to this agent.',
            'inherit',
            ['Read', 'Grep', 'Glob'],
            'default',
            'just now',
            'You are a specialist subagent.\n\nDescribe the task, the constraints and the expected output.',
          )
        : makeSkill(id, 'Describe what this skill does and when to use it.', 'project', 'just now');
    this.act({ added: s.added.concat([node]) }, `Created ${KIND_LABEL[type].toLowerCase()} ${id}`, true);
    return id;
  }

  edit(id: string, patch: ResourcePatch): void {
    this.state.update((s) => ({ ...s, over: { ...s.over, [id]: { ...(s.over[id] ?? {}), ...patch } } }));
  }

  /* ---------- editing files as text ---------- */

  /**
   * Whether the file behind a resource can be edited as text, and if not, why.
   *
   * @param n - Resource from the model.
   * @returns Null when it can, otherwise a sentence to show the user.
   */
  rawBlocker(n: Resource): string | null {
    if (n.missing) return 'This resource does not exist.';
    if (n.scope === 'plugin' || n.scope === 'managed') return `Files in ${n.scope} scope are read-only.`;
    if (n.raw === undefined) return this.repo.persistent ? 'Save this resource once before editing its source.' : 'The sample workspace has no files. Use the fields in the inspector.';
    return null;
  }

  /**
   * Replaces the text of a scanned resource's file.
   *
   * @remarks
   * The text is read back into fields (and, for an agent, into its skill and MCP relationships),
   * so the inspector, the graph and the source stay consistent and later field edits patch the
   * new text. For an MCP server the text is the one-server JSON document the Source view shows.
   *
   * @param id - Resource to edit. Must have a file on disk.
   * @param text - New content.
   * @returns Null when applied, otherwise why the text was not accepted.
   */
  editRaw(id: string, text: string): string | null {
    const m = this.model();
    const n = m.by[id];
    if (!n) return 'This resource no longer exists.';
    const blocked = this.rawBlocker(n);
    if (blocked) return blocked;

    if (n.type === 'mem') {
      this.edit(id, { body: text, lines: text ? text.replace(/\n$/, '').split('\n').length : 0 });
      return null;
    }
    if (n.type === 'mcp') {
      let cfg: McpConfig | undefined;
      try {
        cfg = (JSON.parse(text) as { mcpServers?: Record<string, McpConfig> })?.mcpServers?.[n.name];
      } catch (e) {
        return 'Not valid JSON: ' + (e as Error).message;
      }
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return `Keep the shape { "mcpServers": { "${n.name}": { … } } }. The server cannot be renamed here.`;
      const fields = mcpFields(cfg);
      this.edit(id, { raw: JSON.stringify({ mcpServers: { [n.name]: cfg } }, null, 2), transport: fields.transport, url: fields.url, desc: fields.url });
      return null;
    }

    const p = parseResource(n.type, text);
    const f = p.fields;
    const named = n.type === 'agent' || n.type === 'skill';
    // Every field is set, also to undefined, so a key removed from the text does not keep an earlier edit.
    const patch: ResourcePatch = { raw: text, name: named ? (f.name ?? nameFromFile(n)) : n.name, desc: f.desc ?? '', body: f.body };
    if (named) patch.tools = f.tools;
    if (n.type === 'agent') Object.assign(patch, { model: f.model, perm: f.perm });
    if (n.type === 'cmd') patch.hint = f.hint;
    if (n.type === 'rule') patch.paths = f.paths;
    if (n.type !== 'agent') {
      this.edit(id, patch);
      return null;
    }

    // An agent's relationships are what its text lists, among the resources that exist.
    const find = (type: Kind, name: string): string | undefined => m.list.find((x) => x.type === type && x.name === name)?.id;
    const servers = (Array.isArray(p.data['mcpServers']) ? (p.data['mcpServers'] as unknown[]) : []).filter((s): s is string => typeof s === 'string');
    const fromTools = (f.tools ?? []).flatMap((t) => /^mcp__(.+?)(?:__.*)?$/.exec(t)?.[1] ?? []);
    const linked = [
      ...(toList(p.data['skills']) ?? []).map((name) => find('skill', name)),
      ...servers.concat(fromTools).map((name) => find('mcp', name)),
    ].filter((x, i, all): x is string => !!x && all.indexOf(x) === i);
    patch.linked = linked;
    this.state.update((s) => ({
      ...s,
      over: { ...s.over, [id]: { ...(s.over[id] ?? {}), ...patch } },
      rel: s.rel.filter((r) => r.split('>')[0] !== id).concat(linked.map((to) => id + '>' + to)),
    }));
    return null;
  }

  /** Files without a graph node, with their current text. */
  readonly docs = computed(() => {
    const s = this.state();
    const scanned = this.snapshot.docs.map((d) => ({ ...d, text: s.docs[d.file] ?? d.text }));
    const created = Object.keys(s.docs)
      .filter((file) => !scanned.some((d) => d.file === file))
      .map<FileDoc>((file) => ({ file, kind: 'settings', scope: file.startsWith('~/') ? 'user' : /\.local\.json$/.test(file) ? 'local' : 'project', text: s.docs[file], writable: true }));
    return scanned.concat(created);
  });

  /**
   * Replaces the text of a file that has no graph node. A path the scan did not find is created
   * on save.
   *
   * @param file - Display path of the file.
   * @param text - New content.
   */
  editDoc(file: string, text: string): void {
    this.state.update((s) => ({ ...s, docs: { ...s.docs, [file]: text } }));
  }

  /* ---------- hooks ---------- */

  /** Settings files a hook can be added to, existing or not, most specific first. */
  readonly hookFiles = computed(() => {
    const files = ['.claude/settings.json', '.claude/settings.local.json'];
    if (this.prefs.prefs().scanUser) files.push('~/.claude/settings.json');
    return files;
  });

  /**
   * Hooks of every settings file, read from the current text so pending edits show.
   * Empty for the sample workspace, whose hooks are only listed.
   */
  readonly hooks = computed(() =>
    this.docs()
      .filter((d) => d.kind === 'settings')
      .flatMap((d) => listHooks(d.text).map((h) => ({ ...h, file: d.file, scope: d.scope, writable: d.writable }))),
  );

  /**
   * Adds a hook to a settings file, or changes one, as a pending edit of that file.
   *
   * @param file - Settings file to write to. Created on save when it does not exist.
   * @param at - Hook to change, or null to add one.
   * @param hook - Event, matcher and command.
   * @param from - File the hook is in now, when it is being moved to another one.
   * @returns False when a file involved is not valid JSON.
   */
  saveHook(file: string, at: HookAt | null, hook: HookFields, from = file): boolean {
    const textOf = (f: string): string => this.docs().find((d) => d.file === f)?.text ?? '';
    const moved = !!at && from !== file;
    const next = setHook(textOf(file), moved ? null : at, hook);
    const rest = moved ? removeHook(textOf(from), at) : '';
    if (next === null || rest === null) {
      this.ui.note(`Not changed: ${next === null ? file : from} is not valid JSON`);
      return false;
    }
    this.undoSnapshot = { state: this.state(), pos: this.viewport.pos(), sel: this.ui.sel() };
    if (moved) this.editDoc(from, rest);
    this.editDoc(file, next);
    this.announce(`${at ? 'Changed' : 'Added'} ${hook.event} hook in ${file}`, true);
    return true;
  }

  /** Removes a hook from a settings file, as a pending edit of that file. */
  removeHook(file: string, at: HookAt): void {
    const text = this.docs().find((d) => d.file === file)?.text;
    const next = text === undefined ? null : removeHook(text, at);
    if (next === null) return this.ui.note(`Not changed: ${file} is not valid JSON`);
    this.undoSnapshot = { state: this.state(), pos: this.viewport.pos(), sel: this.ui.sel() };
    this.editDoc(file, next);
    this.announce(`Removed ${at.event} hook from ${file}`, true);
  }

  discardOne(c: Change): void {
    const s = this.state();
    if (c.preset) {
      this.act({ presets: s.presets.filter((p) => p !== c.id) }, 'Discarded changes to ' + c.file, true);
      return;
    }
    if (c.id === docChangeId(c.file)) {
      const docs = { ...s.docs };
      if (c.file in s.baseDocs) docs[c.file] = s.baseDocs[c.file];
      else delete docs[c.file];
      this.act({ docs }, 'Discarded changes to ' + c.file, true);
      return;
    }
    const id = c.id;
    const from = (r: string) => r.split('>')[0];
    let rel: string[];
    let added = s.added;
    let deleted = s.deleted;
    const over = { ...s.over };
    if (c.kind === 'A') {
      added = added.filter((n) => n.id !== id);
      rel = s.rel.filter((r) => !relTouches(r, id));
    } else {
      rel = s.rel.filter((r) => from(r) !== id).concat(s.baseRel.filter((r) => from(r) === id));
      if (c.kind === 'D') {
        deleted = deleted.filter((x) => x !== id);
        s.baseRel.forEach((r) => {
          const p = r.split('>');
          if (p[1] === id && rel.indexOf(r) < 0 && deleted.indexOf(p[0]) < 0) rel.push(r);
        });
      }
    }
    if (s.baseOver[id]) over[id] = s.baseOver[id];
    else delete over[id];
    const sel = this.ui.sel().filter((x) => c.kind !== 'A' || x !== id);
    this.act({ rel, added, deleted, over }, 'Discarded changes to ' + c.file, true);
    this.ui.sel.set(sel);
  }

  discardAll(): void {
    const s = this.state();
    if (!this.changes().length) return this.ui.note('Nothing to discard');
    this.act(
      {
        rel: s.baseRel,
        over: s.baseOver,
        added: s.added.filter((n) => s.addedSaved.indexOf(n.id) >= 0),
        deleted: s.deletedSaved,
        presets: [],
        docs: s.baseDocs,
      },
      'Discarded all pending changes',
      true,
    );
    this.ui.sel.set([]);
  }

  /**
   * Writes pending changes and rescans, so the new baseline is what is on disk. Nothing is
   * written when any file fails its checks (changed on disk, read-only), and the edits stay pending.
   * The sample workspace has no files: there the current state just becomes the baseline.
   *
   * @param quiet - Saving was not asked for by the user (autosave): success is only logged.
   */
  async saveAll(quiet = false): Promise<void> {
    if (this.saving()) return;
    const changes = this.changes();
    const n = changes.length;
    if (!n) return quiet ? undefined : this.ui.note('Nothing to save');
    if (!this.repo.persistent) {
      const s = this.state();
      this.act(
        { baseRel: s.rel, baseOver: s.over, addedSaved: s.added.map((a) => a.id), deletedSaved: s.deleted, presets: [], baseDocs: s.docs },
        `Saved ${plural(n, 'file')} (sample workspace, nothing written to disk)`,
        false,
      );
      return;
    }
    // A new resource is written under its name, so the name has to work as a file name or JSON key.
    const m = this.model();
    const unnamed = this.state().added.map((a) => m.by[a.id]).find((a) => a && a.raw === undefined && !validName(a));
    if (unnamed) {
      this.failed = signature(changes);
      return this.ui.note(`Not saved: "${unnamed.name}" cannot be used as the name of a ${KIND_LABEL[unnamed.type].toLowerCase()}`);
    }
    const started = this.state();
    this.saving.set(true);
    try {
      let result: SaveResult;
      try {
        result = await this.repo.save(fileOps(changes, this.model().allBy, this.snapshot.docs));
      } catch (e) {
        result = { ok: false, errors: [{ file: 'workspace', error: cause(e) }] };
      }
      if (!result.ok) {
        const [first, ...more] = result.errors;
        const rest = more.length ? ` (and ${plural(more.length, 'other file')})` : '';
        this.failed = signature(changes);
        this.ui.dialog.set(null);
        return this.ui.note(`Not saved: ${first.file} ${first.error}${rest}`);
      }
      this.failed = '';
      await this.reload(started);
    } finally {
      this.saving.set(false);
    }
    if (quiet) this.ui.record(`Saved ${plural(n, 'file')} to disk automatically`);
    else this.announce(`Saved ${plural(n, 'file')} to disk`);
  }

  /**
   * Renames a command, rule or MCP server on disk right away, and rewrites what refers to it.
   *
   * @remarks
   * Unlike field edits this is not staged: the file is moved (or the server re-keyed together with
   * the agents that list it) in one batch that is refused as a whole if any file changed since the
   * scan. It needs a clean workspace, so no pending edit is lost by the rescan that follows.
   *
   * @param id - Resource to rename.
   * @param name - The new name.
   * @returns Whether the rename was written. A reason is shown to the user otherwise.
   */
  async rename(id: string, name: string): Promise<boolean> {
    if (this.saving()) return false;
    const n = this.model().by[id];
    if (!n) return false;
    if (!this.repo.persistent) {
      this.ui.note('Renaming needs a project folder: the sample workspace has no files');
      return false;
    }
    if (this.blockedByChanges('renaming')) return false;
    const result = planRename(n, name, this.model().all);
    if ('error' in result) {
      this.ui.note(result.error);
      return false;
    }
    this.saving.set(true);
    try {
      let saved: SaveResult;
      try {
        saved = await this.repo.save(result.plan.ops);
      } catch (e) {
        saved = { ok: false, errors: [{ file: 'workspace', error: cause(e) }] };
      }
      if (!saved.ok) {
        const [first] = saved.errors;
        this.ui.note(`Not renamed: ${first.file} ${first.error}`);
        return false;
      }
      await this.reload();
    } finally {
      this.saving.set(false);
    }
    const to = n.type + ':' + name.trim();
    this.ui.sel.set([to]);
    const others = result.plan.files.length - 1;
    this.ui.ctx.set(null);
    this.ui.rename.set(null);
    this.announce(`Renamed ${n.name} to ${name.trim()}` + (n.type === 'mcp' && others > 0 ? ` and updated ${plural(others, 'agent')}` : ''));
    return true;
  }

  /** What the status bar says about file watching. */
  readonly watchLabel = computed(() => {
    if (!this.loaded().path || !this.repo.persistent) return 'Sample workspace';
    if (!this.watching()) return 'Not watching files';
    return this.prefs.prefs().scanUser ? 'Watching .claude/ and ~/.claude/' : 'Watching .claude/';
  });

  /* ---------- copying to another project ---------- */

  /** The open workspace is backed by files on disk; false for the sample workspace. */
  get persistent(): boolean {
    return this.repo.persistent;
  }

  /** Whether the open workspace has files that can be copied; false for the sample workspace. */
  get canCopy(): boolean {
    return this.repo.persistent;
  }

  /**
   * Asks the user for a folder with the native picker.
   *
   * @returns The chosen folder, or null when the picker was cancelled or is not available.
   */
  chooseFolder(): Promise<string | null> {
    return this.repo.pickFolder();
  }

  /**
   * Checks which of the given resources another project already has.
   *
   * @param dest - Folder of the other project.
   * @param items - Resources about to be copied there.
   * @returns One flag per item. All false when the folder cannot be read.
   */
  async existsIn(dest: string, items: CopyItem[]): Promise<boolean[]> {
    try {
      return await this.repo.existsIn(dest, items);
    } catch {
      return items.map(() => false);
    }
  }

  /**
   * Copies agents and skills, as saved on disk, into another project and reports the outcome
   * in a toast and the activity log. The open workspace is not changed.
   *
   * @param dest - Folder of the other project. It is added to the recent folders on success.
   * @param items - Resources to copy.
   * @param replace - Replace resources the destination already has, instead of skipping them.
   * @returns False when nothing could be copied because of an error, true otherwise.
   */
  async copyTo(dest: string, items: CopyItem[], replace: boolean): Promise<boolean> {
    let result: CopyResult;
    try {
      result = await this.repo.copyTo(dest, items, replace);
    } catch (e) {
      result = { copied: [], skipped: [], errors: [{ file: 'workspace', error: cause(e) }] };
    }
    const failed = result.errors.length;
    if (failed && !result.copied.length) {
      const [first, ...more] = result.errors;
      this.ui.note(`Not copied: ${first.file} ${first.error}${more.length ? ` (and ${plural(more.length, 'other file')})` : ''}`);
      return false;
    }
    const recent = this.prefs.prefs().recent;
    this.prefs.set('recent', [dest, ...recent.filter((r) => r !== dest)].slice(0, 6));
    const name = dest.split(/[\\/]/).filter(Boolean).pop() ?? dest;
    this.announce(copySummary(result.copied.length, result.skipped.length, name) + (failed ? `. ${plural(failed, 'file')} failed` : ''));
    return true;
  }

  tidyLayout(): void {
    this.viewport.pos.set({});
    this.announce('Layout tidied');
    setTimeout(() => this.fit(), 40);
  }

  get confirmDelete(): boolean {
    return this.prefs.prefs().confirm;
  }
}
