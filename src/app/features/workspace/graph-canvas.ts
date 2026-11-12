import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, viewChild } from '@angular/core';
import { KIND_LABEL, NODE_SIZE, STATUS_LABEL, edgePath, labelOf, plural } from '../../core/model/graph';
import { SEVERITY_ICON, iconFor } from '../../core/model/icons';
import { Kind, Point, Resource } from '../../core/model/types';
import { Commands } from '../../core/state/commands';
import { PrefsStore } from '../../core/state/prefs.store';
import { UiStore } from '../../core/state/ui.store';
import { ViewportStore } from '../../core/state/viewport.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { Drag, DragDelta } from '../../headless/drag';
import { Tip } from '../../headless/tip';
import { Icon } from '../../ui/icon';

/** Group frames drawn behind the nodes: [kind colour, label, member kinds]. */
const GROUPS: [Kind, string, Kind[]][] = [
  ['cmd', 'Commands', ['cmd']],
  ['agent', 'Agents', ['agent']],
  ['skill', 'Skills', ['skill']],
  ['mcp', 'MCP servers', ['mcp']],
  ['mem', 'Memory and rules', ['mem', 'rule']],
];

interface NodeDrag {
  id: string;
  ox: number;
  oy: number;
  /** Manual position before the drag, if the node had one. */
  had: Point | undefined;
  /** Existing skills can be dropped on agents. */
  skill: boolean;
}

/** The node graph: pannable, zoomable canvas with draggable resources and their relationships. */
@Component({
  selector: 'ad-graph-canvas',
  imports: [Icon, Tip, Drag],
  template: `
    <div
      #vp
      class="vp absolute inset-0 overflow-hidden bg-bg2"
      [class.grid]="prefs.prefs().grid"
      [class.pan]="viewport.panning()"
      [style.background-size]="gridSize()"
      [style.background-position]="gridPos()"
      adDrag
      [stopPress]="false"
      (dragStart)="panStart()"
      (dragMove)="panMove($event)"
      (dragEnd)="viewport.panning.set(false)"
      (tap)="clearSelection()"
      (wheel)="onWheel($event)"
    >
      <div class="absolute top-0 left-0 size-0 origin-top-left" [style.transform]="worldTransform()">
        @for (g of groups(); track g.type) {
          <div class="grp" [class]="'k-' + g.type" [style.left.px]="g.x" [style.top.px]="g.y" [style.width.px]="g.w" [style.height.px]="g.h">
            <span class="gl"><i></i>{{ g.label }}</span>
          </div>
        }
        <svg aria-hidden="true" class="pointer-events-none absolute top-0 left-0 size-2.5 overflow-visible">
          <path class="e dimd" [attr.d]="edges().dim" />
          <path class="e" [attr.d]="edges().base" />
          <path class="e wr" [attr.d]="edges().warn" />
          <path class="e er" [attr.d]="edges().err" />
          <path class="e hl" [attr.d]="edges().hl" />
          <path class="e dr" [attr.d]="edges().drag" />
        </svg>
        @for (n of nodes(); track n.id) {
          <button
            [class]="'nd k-' + n.type + ' ' + n.cls"
            [style.left.px]="n.x"
            [style.top.px]="n.y"
            [style.width.px]="n.w"
            [style.height.px]="n.h"
            [attr.aria-label]="n.aria"
            [attr.aria-pressed]="n.selected"
            [attr.data-tour]="'node-' + n.type"
            adDrag
            (dragStart)="nodeDragStart(n.id)"
            (dragMove)="nodeDragMove($event)"
            (dragEnd)="nodeDragEnd()"
            (tap)="ui.select(n.id, $event.shift)"
            (click)="onNodeClick(n.id, $event)"
            (contextmenu)="cmd.openContext(n.id, $event)"
          >
            <span class="nb">
              <span class="tile"><svg [adIcon]="n.icon"></svg></span>
              <span class="ntx">
                <span class="flex items-center gap-1.5">
                  <span class="nn min-w-0 flex-1">{{ n.label }}</span>
                  @if (n.flag) {
                    <svg [adIcon]="n.flagIcon" class="s" [class]="'c-' + n.status"></svg>
                  }
                </span>
                <span class="ns">
                  <span class="el min-w-0 flex-1">{{ n.sub }}</span>
                  @if (n.badge) {
                    <span class="chip !h-[15px] !px-[5px] !text-[9.5px]">{{ n.badge }}</span>
                  }
                </span>
              </span>
            </span>
            @if (n.type === 'agent') {
              <span class="nfoot">
                <span class="chip !h-4">{{ n.model }}</span>
                <span class="flex items-center gap-1"><svg adIcon="zap" class="s" style="color: var(--c-skill)"></svg>{{ n.skillLabel }}</span>
                <span class="flex-1"></span>
                <span class="st !text-[10.5px]"><span class="dot" [class]="n.status"></span>{{ n.statusLabel }}</span>
              </span>
            }
            @if (n.dropHint) {
              <span class="dh">Release to add skill</span>
            }
          </button>
        }
      </div>

      @if (bar(); as b) {
        <div class="fl -translate-x-1/2" [style.left.px]="b.x" [style.top.px]="b.y" (mousedown)="$event.stopPropagation()">
          <button class="ib" adTip="View source" [tipAbove]="true" aria-label="View source" (click)="viewSource()">
            <svg adIcon="code"></svg>
          </button>
          <button class="ib" adTip="Detach all relationships" [tipAbove]="true" aria-label="Detach all relationships" (click)="ws.detachAll(b.id)">
            <svg adIcon="unlink"></svg>
          </button>
          <button class="ib !text-err" adTip="Delete" [tipAbove]="true" aria-label="Delete resource" (click)="cmd.askDelete(b.id)">
            <svg adIcon="trash"></svg>
          </button>
          <span class="vsep"></span>
          <button class="ib" adTip="More actions" [tipAbove]="true" aria-label="More actions" (click)="cmd.openContext(b.id, $event)">
            <svg adIcon="more" style="stroke-width: 2.6"></svg>
          </button>
        </div>
      }

      <div class="fl bottom-3 left-3" (mousedown)="$event.stopPropagation()">
        <button class="ib" adTip="Zoom out" [tipAbove]="true" aria-label="Zoom out" (click)="viewport.zoomBy(0.87)"><svg adIcon="minus"></svg></button>
        <button class="w-11 text-center font-mono text-[11px] text-tx2" adTip="Reset to 100%" [tipAbove]="true" (click)="viewport.zoomBy(0)">
          {{ zoomPct() }}
        </button>
        <button class="ib" adTip="Zoom in" [tipAbove]="true" aria-label="Zoom in" (click)="viewport.zoomBy(1.15)"><svg adIcon="plus"></svg></button>
        <span class="vsep"></span>
        <button class="ib" adTip="Fit to screen" [tipAbove]="true" aria-label="Fit to screen" (click)="ws.fit()"><svg adIcon="fit"></svg></button>
        <button
          class="ib"
          [class.on]="prefs.prefs().grid"
          adTip="Toggle grid"
          [tipAbove]="true"
          aria-label="Toggle grid"
          (click)="prefs.set('grid', !prefs.prefs().grid)"
        >
          <svg adIcon="grid"></svg>
        </button>
      </div>

      <div
        class="pointer-events-none absolute bottom-3.5 left-1/2 flex -translate-x-1/2 items-center gap-2.5 text-[11px] whitespace-nowrap text-tx3 max-wide:hidden"
      >
        <span>Drag a skill onto an agent to associate</span><span>·</span>
        <span><span class="kbd">Shift</span> click to multi-select</span><span>·</span>
        <span>Right-click for actions</span>
      </div>

      @if (prefs.prefs().mini) {
        <div
          class="absolute right-3 bottom-3 h-[120px] w-[180px] overflow-hidden rounded-[7px] border border-line2 bg-bg1 shadow-[0_8px_22px_var(--shd)]"
          aria-hidden="true"
          (mousedown)="$event.stopPropagation()"
        >
          <div class="absolute top-1.5 left-1.5 h-[108px] w-[168px]">
            @for (m of mini().nodes; track m.id) {
              <span
                class="mm"
                [class]="'k-' + m.type"
                [class.on]="m.on"
                [style.left.px]="m.x"
                [style.top.px]="m.y"
                [style.width.px]="m.w"
                [style.height.px]="m.h"
              ></span>
            }
            <span
              class="absolute rounded-xs border border-acc bg-acc-s"
              [style.left.px]="mini().vx"
              [style.top.px]="mini().vy"
              [style.width.px]="mini().vw"
              [style.height.px]="mini().vh"
            ></span>
          </div>
        </div>
      }
    </div>
  `,
  host: { class: 'relative block min-h-0 flex-1', 'data-tour': 'canvas' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphCanvas {
  protected readonly ws = inject(WorkspaceStore);
  protected readonly ui = inject(UiStore);
  protected readonly viewport = inject(ViewportStore);
  protected readonly prefs = inject(PrefsStore);
  protected readonly cmd = inject(Commands);

  private readonly vp = viewChild.required<ElementRef<HTMLElement>>('vp');
  private drag: NodeDrag | null = null;
  private panOrigin: Point = { x: 0, y: 0 };

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.vp().nativeElement;
      const measure = () => {
        this.viewport.setSize(el.clientWidth, el.clientHeight);
        if (!this.viewport.fitted && el.clientWidth > 0) this.ws.fit();
      };
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  /* ---------- view model ---------- */

  protected readonly zoomPct = computed(() => Math.round(this.viewport.zoom() * 100) + '%');
  protected readonly worldTransform = computed(
    () => `translate(${Math.round(this.viewport.px())}px, ${Math.round(this.viewport.py())}px) scale(${this.viewport.zoom().toFixed(3)})`,
  );
  protected readonly gridSize = computed(() => {
    const g = Math.round(24 * this.viewport.zoom());
    return `${g}px ${g}px`;
  });
  protected readonly gridPos = computed(() => `${Math.round(this.viewport.px())}px ${Math.round(this.viewport.py())}px`);

  /** Ids connected to the current selection. */
  private readonly neighbours = computed(() => {
    const sel = this.ui.sel();
    const out: Record<string, true> = {};
    this.ws.model().rel.forEach((r) => {
      if (sel.indexOf(r[0]) >= 0) out[r[1]] = true;
      if (sel.indexOf(r[1]) >= 0) out[r[0]] = true;
    });
    return out;
  });

  protected readonly nodes = computed(() => {
    const m = this.ws.model();
    const sel = this.ui.sel();
    const nb = this.neighbours();
    const prefs = this.prefs.prefs();
    const q = this.ui.q().trim().toLowerCase();
    const dragId = this.viewport.dragId();
    const dropId = this.viewport.dropId();
    const dragNode = dragId ? m.by[dragId] : null;
    const draggingSkill = !!dragNode && dragNode.type === 'skill' && !dragNode.missing;
    const rel = this.ws.state().rel;

    return this.ws.visible().map((n) => {
      const p = this.ws.posOf(n.id);
      const size = NODE_SIZE[n.type];
      const status = this.ws.statusOf(n.id);
      const selected = sel.indexOf(n.id) >= 0;
      const match = !!q && labelOf(n).toLowerCase().indexOf(q) >= 0;
      const cls: string[] = [];
      if (n.missing) cls.push('ghost');
      if (selected) cls.push('sel');
      else if (nb[n.id]) cls.push('hl');
      if (q ? !match : sel.length && prefs.dim && !selected && !nb[n.id] && !dragNode) cls.push('dim');
      if (match) cls.push('match');
      if (dragId === n.id) cls.push('drag');
      if (draggingSkill && n.type === 'agent') {
        if (dropId === n.id) cls.push('drop');
        else if (rel.indexOf(n.id + '>' + dragNode.id) < 0) cls.push('can');
      }
      if (status !== 'ok') cls.push('s-' + status);
      return {
        id: n.id,
        type: n.type,
        cls: cls.join(' '),
        selected,
        x: Math.round(p.x),
        y: Math.round(p.y),
        w: size[0],
        h: size[1],
        icon: iconFor(n.type),
        label: labelOf(n),
        sub: this.subtitle(n, status),
        badge: n.type === 'skill' ? n.scope : n.type === 'mcp' ? n.transport : '',
        flag: status !== 'ok' && n.type !== 'agent',
        flagIcon: status === 'err' ? SEVERITY_ICON.err : SEVERITY_ICON.warn,
        status,
        statusLabel: STATUS_LABEL[status],
        model: n.model,
        skillLabel: n.type === 'agent' ? plural(this.ws.skillsOf(n.id).length, 'skill') : '',
        dropHint: dropId === n.id,
        aria: KIND_LABEL[n.type] + ' ' + labelOf(n),
      };
    });
  });

  private subtitle(n: Resource, status: string): string {
    if (n.type === 'rule') return n.file;
    if (n.type === 'mcp') return status === 'warn' ? 'Environment variable missing' : 'Configured';
    if (n.type === 'mem') return 'Project memory · 412 lines';
    return n.missing ? 'Not found in any scope' : n.desc;
  }

  /** Edge paths batched per visual state, so the canvas draws six paths in total. */
  protected readonly edges = computed(() => {
    const m = this.ws.model();
    const sel = this.ui.sel();
    const prefs = this.prefs.prefs();
    const visible: Record<string, true> = {};
    this.ws.visible().forEach((n) => (visible[n.id] = true));
    const E = { base: '', hl: '', dim: '', warn: '', err: '', drag: '' };
    m.rel.forEach((r) => {
      if (!visible[r[0]] || !visible[r[1]]) return;
      const a = m.by[r[0]];
      const b = m.by[r[1]];
      const d = edgePath(a, b, this.ws.posOf(a.id), this.ws.posOf(b.id), prefs.edge === 'orth');
      const on = sel.indexOf(a.id) >= 0 || sel.indexOf(b.id) >= 0;
      if (b.missing) E.err += d;
      else if (on) E.hl += d;
      else if (b.type === 'mcp' && this.ws.statusOf(b.id) === 'warn') E.warn += d;
      else if (sel.length && prefs.dim) E.dim += d;
      else E.base += d;
    });
    const dropId = this.viewport.dropId();
    const dragId = this.viewport.dragId();
    if (dropId && dragId && m.by[dropId] && m.by[dragId])
      E.drag = edgePath(m.by[dropId], m.by[dragId], this.ws.posOf(dropId), this.ws.posOf(dragId), false);
    return E;
  });

  protected readonly groups = computed(() => {
    const vis = this.ws.visible();
    const dragId = this.viewport.dragId();
    const out: { type: Kind; label: string; x: number; y: number; w: number; h: number }[] = [];
    for (const [type, label, kinds] of GROUPS) {
      const members = vis.filter((n) => kinds.indexOf(n.type) >= 0 && n.id !== dragId);
      if (!members.length) continue;
      let x0 = 1e9;
      let y0 = 1e9;
      let x1 = -1e9;
      let y1 = -1e9;
      for (const n of members) {
        const p = this.ws.posOf(n.id);
        const z = NODE_SIZE[n.type];
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x + z[0]);
        y1 = Math.max(y1, p.y + z[1]);
      }
      out.push({
        type,
        label: label + ' · ' + members.length,
        x: Math.round(x0 - 14),
        y: Math.round(y0 - 30),
        w: Math.round(x1 - x0 + 28),
        h: Math.round(y1 - y0 + 44),
      });
    }
    return out;
  });

  protected readonly mini = computed(() => {
    const b = this.ws.bounds();
    const k = Math.min(168 / b.w, 108 / b.h);
    const zoom = this.viewport.zoom();
    const sel = this.ui.sel();
    return {
      nodes: this.ws.visible().map((n) => {
        const p = this.ws.posOf(n.id);
        const z = NODE_SIZE[n.type];
        return {
          id: n.id,
          type: n.type,
          on: sel.indexOf(n.id) >= 0,
          x: Math.round((p.x - b.x) * k),
          y: Math.round((p.y - b.y) * k),
          w: Math.max(3, Math.round(z[0] * k)),
          h: Math.max(2, Math.round(z[1] * k)),
        };
      }),
      vx: Math.round((-this.viewport.px() / zoom - b.x) * k),
      vy: Math.round((-this.viewport.py() / zoom - b.y) * k),
      vw: Math.round((this.viewport.vw() / zoom) * k),
      vh: Math.round((this.viewport.vh() / zoom) * k),
    };
  });

  /** Floating toolbar above the single selected node, when it is comfortably on screen. */
  protected readonly bar = computed(() => {
    const one = this.ws.selectedOne();
    if (!one || this.viewport.dragId() || this.viewport.panning()) return null;
    if (this.ui.filt()[one.type === 'mem' ? 'rule' : one.type] === false) return null;
    const p = this.ws.posOf(one.id);
    const zoom = this.viewport.zoom();
    const x = (p.x + NODE_SIZE[one.type][0] / 2) * zoom + this.viewport.px();
    const y = p.y * zoom + this.viewport.py() - 42;
    const onScreen = x > 60 && x < this.viewport.vw() - 60 && y > 4 && y < this.viewport.vh() - 60;
    return onScreen ? { id: one.id, x: Math.round(x), y: Math.round(y) } : null;
  });

  /* ---------- interaction ---------- */

  protected panStart(): void {
    this.panOrigin = { x: this.viewport.px(), y: this.viewport.py() };
    this.viewport.panning.set(true);
  }

  protected panMove(d: DragDelta): void {
    this.viewport.panTo(this.panOrigin.x + d.dx, this.panOrigin.y + d.dy);
  }

  protected clearSelection(): void {
    this.ui.sel.set([]);
    this.ui.ctx.set(null);
  }

  protected onWheel(e: WheelEvent): void {
    const r = this.vp().nativeElement.getBoundingClientRect();
    this.viewport.zoomAt(e.clientX - r.left, e.clientY - r.top, this.viewport.zoom() * (e.deltaY < 0 ? 1.08 : 0.926));
  }

  /** Keyboard activation; pointer selection is handled by the drag directive's tap. */
  protected onNodeClick(id: string, e: MouseEvent): void {
    if (e.detail === 0) this.ui.select(id, e.shiftKey);
  }

  protected viewSource(): void {
    this.ui.tab.set('src');
    this.ui.inspOpen.set(true);
  }

  protected nodeDragStart(id: string): void {
    const n = this.ws.model().by[id];
    if (!n) return;
    const p = this.ws.posOf(id);
    this.drag = { id, ox: p.x, oy: p.y, had: this.viewport.pos()[id], skill: n.type === 'skill' && !n.missing };
  }

  protected nodeDragMove(d: DragDelta): void {
    const g = this.drag;
    if (!g) return;
    const zoom = this.viewport.zoom();
    const x = g.ox + d.dx / zoom;
    const y = g.oy + d.dy / zoom;
    let dropId: string | null = null;
    if (g.skill) {
      const rel = this.ws.state().rel;
      const [aw, ah] = NODE_SIZE.agent;
      const [sw, sh] = NODE_SIZE.skill;
      for (const a of this.ws.model().list) {
        if (a.type !== 'agent') continue;
        const p = this.ws.posOf(a.id);
        const overlaps = x < p.x + aw && x + sw > p.x && y < p.y + ah && y + sh > p.y;
        if (overlaps && rel.indexOf(a.id + '>' + g.id) < 0) dropId = a.id;
      }
    }
    this.viewport.place(g.id, { x, y });
    this.viewport.dragId.set(g.id);
    this.viewport.dropId.set(dropId);
    this.ui.ctx.set(null);
  }

  protected nodeDragEnd(): void {
    const g = this.drag;
    this.drag = null;
    if (!g) return;
    const dropId = this.viewport.dropId();
    if (dropId) {
      // The skill snaps back to where it was; only the relationship changes.
      this.viewport.restore(g.id, g.had);
      this.viewport.endDrag();
      this.ws.attach(dropId, g.id);
      this.ui.sel.set([dropId]);
      this.ui.tab.set('sk');
      this.ui.inspOpen.set(true);
      return;
    }
    const p = this.viewport.pos()[g.id];
    if (this.prefs.prefs().snap && p) this.viewport.place(g.id, { x: Math.round(p.x / 8) * 8, y: Math.round(p.y / 8) * 8 });
    this.viewport.endDrag();
  }
}
