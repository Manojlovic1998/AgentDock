import { Injectable, computed, inject, signal } from '@angular/core';
import { makeAgent, makeSkill } from '../data/mock-data';
import { ResourceRepository } from '../data/resource-repository';
import { buildModel, findChanges, findProblems, relTouches, statusMap } from '../model/analysis';
import { FILTERS, KIND_LABEL, bounds, filterKey, labelOf, layout, plural } from '../model/graph';
import { Change, Point, Resource, ResourcePatch, Status, WorkspaceState } from '../model/types';
import { PrefsStore } from './prefs.store';
import { UiStore } from './ui.store';
import { ViewportStore } from './viewport.store';

interface UndoSnapshot {
  state: WorkspaceState;
  pos: Record<string, Point>;
  sel: string[];
}

/**
 * The editable configuration graph: resources, relationships and pending edits,
 * with everything derived from them (model, problems, changes, counts).
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  private readonly ui = inject(UiStore);
  private readonly viewport = inject(ViewportStore);
  private readonly prefs = inject(PrefsStore);
  readonly snapshot = inject(ResourceRepository).load();

  readonly state = signal<WorkspaceState>({
    rel: this.snapshot.rel,
    baseRel: this.snapshot.rel,
    over: {},
    baseOver: {},
    added: [],
    addedSaved: [],
    deleted: [],
    deletedSaved: [],
    presets: this.snapshot.presets.map((p) => p.id),
  });

  private undoSnapshot: UndoSnapshot | null = null;

  readonly model = computed(() => buildModel(this.snapshot.nodes, this.state()));
  readonly problems = computed(() => findProblems(this.model()));
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
    return {
      agents: count('agent'),
      skills: count('skill'),
      commands: count('cmd'),
      rules: count('rule'),
      mcp: count('mcp'),
      claudemd: count('mem') + 2,
      settingsres: 3,
      hooks: 3,
      styles: 2,
      plugins: 2,
      memory: 3,
      other: 2,
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

  /** Makes the current state the saved baseline. No files are written in this build. */
  saveAll(): void {
    const n = this.changes().length;
    if (!n) return this.ui.note('Nothing to save');
    const s = this.state();
    this.act(
      { baseRel: s.rel, baseOver: s.over, addedSaved: s.added.map((a) => a.id), deletedSaved: s.deleted, presets: [] },
      `Saved ${plural(n, 'file')} to disk`,
      false,
    );
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
