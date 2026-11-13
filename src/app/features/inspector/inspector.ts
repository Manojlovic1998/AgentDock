import { Menu, MenuItem, MenuTrigger } from '@angular/aria/menu';
import { Tab, TabContent, TabList, TabPanel, Tabs } from '@angular/aria/tabs';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { validName } from '../../core/model/analysis';
import { firstText } from '../../core/model/frontmatter';
import { KIND_LABEL, STATUS_LABEL, labelOf, plural } from '../../core/model/graph';
import { MCP_TRANSPORTS } from '../../core/model/mcp';
import { SEVERITY_ICON, iconFor } from '../../core/model/icons';
import { highlight, sourceOf } from '../../core/model/source';
import { Kind, Resource, ResourcePatch } from '../../core/model/types';
import { Commands } from '../../core/state/commands';
import { InspectorTab, UiStore } from '../../core/state/ui.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { Drag, DragDelta } from '../../headless/drag';
import { MenuDismiss } from '../../headless/menu-dismiss';
import { Tip } from '../../headless/tip';
import { Icon } from '../../ui/icon';
import { SegOption, Segmented } from '../../ui/segmented';
import { SourceCode } from '../../ui/source-code';

const TOOLS = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'WebFetch'];

const MODELS: SegOption[] = ['inherit', 'haiku', 'sonnet', 'opus'].map((m) => ({ value: m, label: m }));

const PERMISSION_MODES: [mode: string, hint: string][] = [
  ['default', 'Ask before edits'],
  ['acceptEdits', 'Auto-accept edits'],
  ['plan', 'Read-only planning'],
  ['bypassPermissions', 'Skip all prompts'],
];

const RELATION_TITLE: Record<Kind, string> = {
  agent: 'Associated skills',
  skill: 'Related agents',
  cmd: 'Delegates to',
  mcp: 'Used by agents',
  rule: 'Imported by',
  mem: 'Imported rules',
};

const WIDTH_MIN = 272;
const WIDTH_MAX = 520;

/** Details and editing for the current selection. */
@Component({
  selector: 'ad-inspector',
  imports: [Icon, Tip, Drag, Segmented, SourceCode, Tabs, TabList, Tab, TabPanel, TabContent, Menu, MenuItem, MenuTrigger, MenuDismiss],
  templateUrl: './inspector.html',
  host: {
    class: 'insp relative flex min-h-0 max-w-[92vw] flex-none flex-col border-l border-line bg-bg1',
    role: 'complementary',
    'aria-label': 'Inspector',
    'data-tour': 'inspector',
    '[style.width.px]': 'ui.inspW()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Inspector {
  protected readonly ui = inject(UiStore);
  protected readonly ws = inject(WorkspaceStore);
  protected readonly cmd = inject(Commands);

  protected readonly sevIcon = SEVERITY_ICON;
  protected readonly models = MODELS;
  protected readonly transports: SegOption[] = MCP_TRANSPORTS.map((t) => ({ value: t, label: t }));
  private resizeFrom = 0;

  protected readonly one = this.ws.selectedOne;

  protected readonly multi = computed(() => {
    const by = this.ws.model().by;
    return this.ui
      .sel()
      .filter((id) => by[id])
      .map((id) => this.row(by[id]));
  });

  /** Tabs available for the selected resource kind. */
  protected readonly tabs = computed<{ id: InspectorTab; label: string }[]>(() => {
    const n = this.one();
    if (!n) return [];
    if (n.type === 'agent')
      return [
        { id: 'ov', label: 'Overview' },
        { id: 'cf', label: 'Configuration' },
        { id: 'sk', label: 'Skills ' + this.ws.skillsOf(n.id).length },
        { id: 'src', label: 'Source' },
      ];
    if (n.missing) return [{ id: 'ov', label: 'Overview' }];
    if (n.type === 'skill')
      return [
        { id: 'ov', label: 'Overview' },
        { id: 'cf', label: 'Instructions' },
        { id: 'src', label: 'Source' },
      ];
    return [
      { id: 'ov', label: 'Overview' },
      { id: 'cf', label: n.type === 'mem' ? 'Content' : 'Configuration' },
      { id: 'src', label: 'Source' },
    ];
  });

  /**
   * Whether the name can no longer be changed here. The name of a command or rule is its file
   * path and that of an MCP server its key in the file, so it is fixed once the resource is saved.
   */
  protected readonly nameLocked = computed(() => {
    const n = this.one();
    return !!n && n.raw !== undefined && n.type !== 'agent' && n.type !== 'skill';
  });

  protected readonly nameHint = computed(() => {
    const n = this.one();
    if (!n || n.type === 'agent' || n.type === 'skill') return '';
    if (this.nameLocked()) {
      if (n.type === 'mem') return '';
      return n.type === 'mcp' ? 'The name is the key in the file. Use Rename to change it.' : 'The name is the file path. Use Rename to change it.';
    }
    if (!validName(n)) return n.type === 'mcp' ? 'Use a name without spaces.' : 'This name cannot be used as a file name.';
    return n.type === 'mcp' ? '' : 'Use a colon for a subfolder: git:commit is saved as git/commit.md.';
  });

  protected readonly bodyTitle = computed(() => {
    const type = this.one()?.type;
    return type === 'cmd' ? 'Prompt' : type === 'rule' ? 'Rule text' : type === 'mem' ? 'CLAUDE.md' : 'Instructions';
  });

  protected readonly tab = computed<InspectorTab>(() => (this.tabs().some((t) => t.id === this.ui.tab()) ? this.ui.tab() : 'ov'));

  /** Which tab panels exist for the selection; panels are only rendered next to a matching tab. */
  protected readonly has = computed(() => {
    const out: Partial<Record<InspectorTab, boolean>> = {};
    this.tabs().forEach((t) => (out[t.id] = true));
    return out;
  });

  protected readonly header = computed(() => {
    const n = this.one();
    if (!n) return null;
    const status = this.ws.statusOf(n.id);
    return {
      type: n.type,
      icon: iconFor(n.type),
      label: labelOf(n),
      kind: KIND_LABEL[n.type] + (n.scope && !n.missing ? ' · ' + n.scope : ''),
      status,
      statusLabel: n.missing ? 'Missing' : STATUS_LABEL[status],
    };
  });

  protected readonly overview = computed(() => {
    const n = this.one();
    if (!n) return null;
    const neighbours = this.ws.neighbors(n.id);
    const isAgent = n.type === 'agent';
    const relA = isAgent ? neighbours.filter((x) => x.type === 'skill') : neighbours;
    const relB = isAgent ? neighbours.filter((x) => x.type !== 'skill') : [];
    return {
      problems: this.ws.problems().filter((p) => p.target === n.id || p.also === n.id),
      metaTitle: n.type === 'skill' ? 'Metadata' : 'Details',
      kv: this.details(n),
      tools: isAgent ? (n.tools ?? []) : null,
      relTitle: RELATION_TITLE[n.type],
      relA: relA.map((x) => this.row(x, x.type === 'skill' ? x.scope : undefined)),
      relB: relB.map((x) => this.row(x)),
    };
  });

  protected readonly toolOptions = computed(() => {
    const tools = this.one()?.tools ?? [];
    return TOOLS.map((t) => ({ label: t, on: tools.indexOf(t) >= 0 }));
  });

  protected readonly permissionModes = computed(() => PERMISSION_MODES.map(([mode, hint]) => ({ mode, hint, pick: () => this.edit({ perm: mode }) })));

  protected readonly skills = computed(() => {
    const n = this.one();
    if (!n) return { attached: [], addable: [] };
    const attached = this.ws.skillsOf(n.id);
    return {
      attached: attached.map((x) => ({ id: x.id, name: x.name, scope: x.scope, missing: !!x.missing })),
      addable: this.ws
        .model()
        .list.filter((x) => x.type === 'skill' && !x.missing && attached.indexOf(x) < 0)
        .map((x) => ({ name: x.name, scope: x.scope, pick: () => void this.ws.attach(n.id, x.id) })),
    };
  });

  protected readonly source = computed(() => {
    const n = this.one();
    const m = this.ws.model();
    return n && this.tab() === 'src' ? highlight(sourceOf(n, m.rel, m.by)) : [];
  });

  private row(n: Resource, kind?: string) {
    return { id: n.id, type: n.type, icon: iconFor(n.type), name: labelOf(n), kind: kind ?? KIND_LABEL[n.type] };
  }

  private details(n: Resource): [string, string | undefined][] {
    const status = this.ws.statusOf(n.id);
    switch (n.type) {
      case 'agent':
        return [
          ['Model', n.model],
          ['Permission mode', n.perm],
          ['File', n.file],
          ['Modified', n.mod],
        ];
      case 'skill':
        return n.missing
          ? [
              ['Status', 'not found'],
              ['Searched', '.claude/skills, ~/.claude/skills, plugins'],
            ]
          : [
              ['Scope', n.scope],
              ['Allowed tools', (n.tools ?? []).join(', ')],
              ['Location', n.file],
              ['Modified', n.mod],
            ];
      case 'cmd':
        return [
          ['Argument hint', n.hint],
          ['File', n.file],
          ['Modified', n.mod],
        ];
      case 'rule':
        return [
          ['Applies to', n.paths || 'all files'],
          ['File', n.file],
          ['Modified', n.mod],
        ];
      case 'mcp':
        return [
          ['Transport', n.transport],
          [n.transport === 'http' ? 'URL' : 'Command', n.url],
          ['Defined in', n.file],
          ['Status', status === 'warn' ? 'env var missing' : 'configured'],
        ];
      default:
        return [
          ['Scope', n.scope ?? 'project'],
          ['Length', plural(n.lines ?? 0, 'line')],
          ['File', n.file],
          ['Modified', n.mod],
        ];
    }
  }

  /* ---------- actions ---------- */

  protected pickTab(tab: string | undefined): void {
    if (tab) this.ui.tab.set(tab as InspectorTab);
  }

  protected edit(patch: ResourcePatch): void {
    const n = this.one();
    if (n) this.ws.edit(n.id, patch);
  }

  /** Edits the text below the frontmatter, keeping what is derived from it in step. */
  protected editBody(body: string): void {
    const n = this.one();
    if (!n) return;
    // What a rule shows as its description is the first line of its text.
    if (n.type === 'rule') this.edit({ body, desc: firstText(body) });
    else if (n.type === 'mem') this.edit({ body, lines: body ? body.replace(/\n$/, '').split('\n').length : 0 });
    else this.edit({ body });
  }

  protected text(e: Event): string {
    return (e.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  /** Toggles a tool, keeping the canonical tool order. */
  protected toggleTool(tool: string): void {
    const cur = this.one()?.tools ?? [];
    const on = cur.indexOf(tool) >= 0;
    // Entries outside the canonical list (mcp__server__tool, Bash(git:*)) are kept after the known ones.
    const custom = cur.filter((t) => TOOLS.indexOf(t) < 0);
    this.edit({ tools: on ? cur.filter((t) => t !== tool) : TOOLS.filter((t) => t === tool || cur.indexOf(t) >= 0).concat(custom) });
  }

  protected detach(skillId: string): void {
    const n = this.one();
    if (n) this.ws.detach(n.id, skillId);
  }

  protected resizeStart(): void {
    this.resizeFrom = this.ui.inspW();
  }

  protected resizeMove(d: DragDelta): void {
    this.ui.inspW.set(Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, this.resizeFrom - d.dx)));
  }
}
