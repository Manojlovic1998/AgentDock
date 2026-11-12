import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal } from '@angular/core';
import { STATUS_LABEL, labelOf, plural } from '../../core/model/graph';
import { IconName, iconFor } from '../../core/model/icons';
import { Kind, KindOrNone, Resource, Status } from '../../core/model/types';
import { Commands } from '../../core/state/commands';
import { UiStore } from '../../core/state/ui.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { Tip } from '../../headless/tip';
import { Icon } from '../../ui/icon';

interface Row {
  key: string;
  /** Graph node behind the row, when there is one. */
  id: string | null;
  type: KindOrNone;
  icon: IconName;
  name: string;
  desc: string;
  a: string;
  b: string;
  st: Status;
  stLabel: string;
  mod: string;
  editTab: 'cf' | 'src';
}

interface Listing {
  title: string;
  sub: string;
  cols: [string, string, string, string];
  rows: Row[];
  create: 'agent' | 'skill' | null;
}

/** Lists backed by graph resources: [kind, title, subtitle, column headers]. */
const NODE_SCREENS: Record<string, [Kind, string, string, [string, string, string]]> = {
  agents: ['agent', 'Agents', 'Subagents Claude can delegate work to.', ['Agent', 'Model', 'Skills']],
  skills: ['skill', 'Skills', 'Reusable instructions Claude loads on demand.', ['Skill', 'Scope', 'Related agents']],
  commands: ['cmd', 'Commands', 'Slash commands defined for this project.', ['Command', 'Arguments', 'Delegates to']],
  rules: ['rule', 'Rules', 'Modular instructions in .claude/rules/.', ['Rule', 'Scope', 'Applies to']],
  mcp: ['mcp', 'MCP Servers', 'External tool servers from .mcp.json.', ['Server', 'Transport', 'Used by']],
};

const STATIC_ICON: Record<string, IconName> = {
  claudemd: 'file',
  settingsres: 'sliders',
  hooks: 'hook',
  styles: 'type',
  plugins: 'box',
  memory: 'db',
  other: 'folder',
};

/** Table view of one resource category, or of the session activity. */
@Component({
  selector: 'ad-browser',
  imports: [Icon, Tip],
  template: `
    <div class="flex min-h-11 flex-none flex-wrap items-center gap-2.5 border-b border-line bg-bg1 px-4 py-2">
      <h1 class="m-0 text-sm font-semibold">{{ listing().title }}</h1>
      <span class="font-mono text-[11px] text-tx3">{{ countLabel() }}</span>
      <span class="el min-w-0 flex-1 text-tx3 max-wide:hidden">{{ listing().sub }}</span>
      <div class="relative flex w-[220px] items-center">
        <svg adIcon="search" class="absolute left-2 text-tx3"></svg>
        <input
          class="inp !pl-7"
          aria-label="Filter list"
          [placeholder]="'Filter ' + listing().title.toLowerCase()"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
        />
      </div>
      @if (listing().create; as type) {
        <button class="bt pr" (click)="cmd.addNode(type)"><svg adIcon="plus"></svg>New {{ type }}</button>
      }
    </div>
    <div class="scr min-h-0 flex-1 overflow-auto">
      <div class="min-w-[980px]" role="table" [attr.aria-label]="listing().title">
        <div class="th cols lb" role="row">
          <span role="columnheader">{{ listing().cols[0] }}</span>
          <span role="columnheader">Description</span>
          <span role="columnheader">{{ listing().cols[1] }}</span>
          <span role="columnheader">{{ listing().cols[2] }}</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">{{ listing().cols[3] }}</span>
          <span></span>
        </div>
        @for (r of rows(); track r.key) {
          <div class="trow cols" [class]="'k-' + r.type" role="row">
            <button class="flex min-w-0 items-center gap-[9px] text-left" [class]="'k-' + r.type" role="cell" (click)="open(r)">
              <span class="tile sm"><svg [adIcon]="r.icon" class="s"></svg></span>
              <span class="el font-mono text-xs font-medium">{{ r.name }}</span>
            </button>
            <span class="el text-tx2" role="cell">{{ r.desc }}</span>
            <span role="cell"><span class="chip">{{ r.a }}</span></span>
            <span class="el font-mono text-[11px] text-tx2" role="cell">{{ r.b }}</span>
            <span class="st" role="cell"><span class="dot" [class]="r.st"></span>{{ r.stLabel }}</span>
            <span class="text-[11.5px] text-tx3" role="cell">{{ r.mod }}</span>
            <span class="ra flex items-center justify-end gap-0.5" role="cell">
              @if (r.id; as id) {
                <button class="ib" adTip="Open in visual workspace" [tipEnd]="true" aria-label="Open in visual workspace" (click)="cmd.focusNode(id)">
                  <svg adIcon="network"></svg>
                </button>
                <button class="ib" adTip="Edit" [tipEnd]="true" aria-label="Edit" (click)="cmd.focusNode(id, r.editTab)">
                  <svg adIcon="pencil"></svg>
                </button>
                <button class="ib !text-err" adTip="Delete" [tipEnd]="true" aria-label="Delete" (click)="cmd.askDelete(id)">
                  <svg adIcon="trash"></svg>
                </button>
              }
            </span>
          </div>
        } @empty {
          <div class="px-4 py-7 text-tx3">Nothing matches this filter.</div>
        }
      </div>
    </div>
  `,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Browser {
  protected readonly cmd = inject(Commands);
  private readonly ws = inject(WorkspaceStore);
  private readonly ui = inject(UiStore);

  /** Route parameter: agents, skills, hooks, activity, ... */
  readonly kind = input('agents');

  /** Filter text; cleared when the list changes. */
  protected readonly query = linkedSignal({ source: this.kind, computation: () => '' });

  protected readonly listing = computed<Listing>(() => {
    const kind = this.kind();
    const m = this.ws.model();
    const node = NODE_SCREENS[kind];
    if (node) {
      const [type, title, sub, c] = node;
      return {
        title,
        sub,
        cols: [c[0], c[1], c[2], 'Modified'],
        rows: m.list.filter((n) => n.type === type && !n.missing).map((n) => this.nodeRow(n)),
        create: type === 'agent' || type === 'skill' ? type : null,
      };
    }
    const table = this.ws.snapshot.tables[kind];
    if (table) {
      const claude = kind === 'claudemd' ? m.by['mem:claude'] : undefined;
      return {
        title: table.title,
        sub: table.sub,
        cols: [table.c[0], table.c[1], table.c[2], 'Modified'],
        rows: (claude ? [this.nodeRow(claude)] : []).concat(
          table.rows.map((r, i) => ({
            key: kind + ':' + i,
            id: null,
            type: 'x' as const,
            icon: STATIC_ICON[kind] ?? 'file',
            name: r[0],
            desc: r[1],
            a: r[2],
            b: r[3],
            st: r[4],
            stLabel: STATUS_LABEL[r[4]],
            mod: r[5],
            editTab: 'src' as const,
          })),
        ),
        create: null,
      };
    }
    return {
      title: 'Activity',
      sub: 'Edits, scans and external file changes in this session.',
      cols: ['Event', 'Source', 'Detail', 'When'],
      rows: this.ui
        .log()
        .concat(this.ws.snapshot.activity)
        .map((a, i) => ({
          key: 'activity:' + i,
          id: null,
          type: 'x' as const,
          icon: 'activity' as const,
          name: a.msg.split(' ').slice(0, 2).join(' '),
          desc: a.msg,
          a: a.t === 'just now' ? 'editor' : 'history',
          b: '',
          st: 'ok' as const,
          stLabel: 'Logged',
          mod: a.t,
          editTab: 'src' as const,
        })),
      create: null,
    };
  });

  protected readonly rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    const rows = this.listing().rows;
    return q ? rows.filter((r) => (r.name + ' ' + r.desc).toLowerCase().indexOf(q) >= 0) : rows;
  });

  protected readonly countLabel = computed(() => this.rows().length + (this.query().trim() ? ' matching' : ' total'));

  private nodeRow(n: Resource): Row {
    const st = this.ws.statusOf(n.id);
    const a = n.type === 'agent' ? n.model : n.type === 'skill' ? n.scope : n.type === 'cmd' ? n.hint : n.type === 'mcp' ? n.transport : 'project';
    const b =
      n.type === 'agent'
        ? plural(this.ws.skillsOf(n.id).length, 'skill')
        : n.type === 'rule'
          ? n.paths || 'all files'
          : n.type === 'mem'
            ? '412 lines'
            : this.ws
                .neighbors(n.id)
                .map((x) => x.name)
                .join(', ') || 'none';
    return {
      key: n.id,
      id: n.id,
      type: n.type,
      icon: iconFor(n.type),
      name: labelOf(n),
      desc: n.desc,
      a: a ?? '',
      b,
      st,
      stLabel: STATUS_LABEL[st],
      mod: n.mod,
      editTab: n.type === 'agent' || n.type === 'skill' ? 'cf' : 'src',
    };
  }

  protected open(r: Row): void {
    if (r.id) this.cmd.focusNode(r.id);
    else if (this.kind() !== 'activity') this.ui.note(r.name + ' has no graph node. Open it from the source tree.');
  }
}
