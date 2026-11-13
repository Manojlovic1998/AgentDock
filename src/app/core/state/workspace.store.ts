import { Injectable, computed, inject, signal } from '@angular/core';
import { emptySnapshot } from '../data/build-snapshot';
import { makeAgent, makeSkill } from '../data/mock-data';
import { ResourceRepository } from '../data/resource-repository';
import { buildModel, fileOps, findChanges, findProblems, relTouches, statusMap } from '../model/analysis';
import { copySummary } from '../model/copy';
import { FILTERS, KIND_LABEL, bounds, filterKey, labelOf, layout, plural } from '../model/graph';
import { Change, CopyItem, CopyResult, Point, Resource, ResourcePatch, SaveResult, Status, WorkspaceSnapshot, WorkspaceState } from '../model/types';
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
  };
}

/** Message of a failed IPC call, without Electron's "Error invoking remote method" prefix. */
const cause = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

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

  readonly model = computed(() => buildModel(this.snapshot.nodes, this.state()));
  readonly problems = computed(() => findProblems(this.model(), this.snapshot.problems));
  readonly status = computed(() => statusMap(this.problems()));
  readonly changes = computed(() => findChanges(this.snapshot.nodes, this.snapshot.presets, this.state()));
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
   */
  async reload(): Promise<void> {
    const before = this.snapshot;
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
    this.loaded.set(next);
    this.state.set(pristine(next));
    this.undoSnapshot = null;
    this.ui.sel.update((sel) => sel.filter((id) => ids.has(id)));
    this.ui.chSel.set(null);
    this.viewport.pos.update((pos) => (moved ? {} : Object.fromEntries(Object.entries(pos).filter(([id]) => ids.has(id)))));
    if (moved && this.viewport.fitted) setTimeout(() => this.fit(), 40);
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
    const node = this.model().by[id];
    const n = s.rel.filter((r) => relTouches(r, id)).length;
    if (!n) return this.ui.note(labelOf(node) + ' has no relationships');
    this.act(
      { rel: s.rel.filter((r) => !relTouches(r, id)) },
      `Detached ${n} relationship${n > 1 ? 's' : ''} from ${labelOf(node)}`,
      true,
    );
  }

  /** Number of relationships that would be cleaned up when the resource is deleted. */
  referenceCount(id: string): number {
    return this.state().rel.filter((r) => relTouches(r, id)).length;
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

  /** Creates an untitled agent or skill and returns its id. */
  addNode(type: 'agent' | 'skill'): string {
    const s = this.state();
    const all = this.snapshot.nodes.concat(s.added);
    let i = 1;
    let id: string;
    do {
      id = 'untitled-' + type + (i > 1 ? '-' + i : '');
      i++;
    } while (all.some((n) => n.id === id));
    const node =
      type === 'agent'
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
    this.act({ added: s.added.concat([node]) }, `Created ${type} ${id}`, true);
    return id;
  }

  edit(id: string, patch: ResourcePatch): void {
    this.state.update((s) => ({ ...s, over: { ...s.over, [id]: { ...(s.over[id] ?? {}), ...patch } } }));
  }

  discardOne(c: Change): void {
    const s = this.state();
    if (c.preset) {
      this.act({ presets: s.presets.filter((p) => p !== c.id) }, 'Discarded changes to ' + c.file, true);
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
   */
  async saveAll(): Promise<void> {
    const changes = this.changes();
    const n = changes.length;
    if (!n) return this.ui.note('Nothing to save');
    if (!this.repo.persistent) {
      const s = this.state();
      this.act(
        { baseRel: s.rel, baseOver: s.over, addedSaved: s.added.map((a) => a.id), deletedSaved: s.deleted, presets: [] },
        `Saved ${plural(n, 'file')} (sample workspace, nothing written to disk)`,
        false,
      );
      return;
    }
    let result: SaveResult;
    try {
      result = await this.repo.save(fileOps(changes, this.model().allBy));
    } catch (e) {
      result = { ok: false, errors: [{ file: 'workspace', error: cause(e) }] };
    }
    if (!result.ok) {
      const [first, ...more] = result.errors;
      const rest = more.length ? ` (and ${plural(more.length, 'other file')})` : '';
      this.ui.dialog.set(null);
      return this.ui.note(`Not saved: ${first.file} ${first.error}${rest}`);
    }
    await this.reload();
    this.announce(`Saved ${plural(n, 'file')} to disk`);
  }

  /* ---------- copying to another project ---------- */

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
