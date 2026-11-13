import { Menu, MenuItem, MenuTrigger } from '@angular/aria/menu';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { labelOf } from '../../core/model/graph';
import { iconFor } from '../../core/model/icons';
import { Kind } from '../../core/model/types';
import { Commands } from '../../core/state/commands';
import { UiStore } from '../../core/state/ui.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { MenuDismiss } from '../../headless/menu-dismiss';
import { Tip } from '../../headless/tip';
import { Icon } from '../../ui/icon';
import { SegOption, Segmented } from '../../ui/segmented';
import { GraphCanvas } from './graph-canvas';
import { SourceView } from './source-view';

type View = 'graph' | 'source';

/** Visual workspace: toolbar with the graph canvas or the source view below it. */
@Component({
  selector: 'ad-workspace',
  imports: [Icon, Tip, Segmented, Menu, MenuItem, MenuTrigger, MenuDismiss, GraphCanvas, SourceView],
  template: `
    <div class="relative flex min-h-10 flex-none flex-wrap items-center gap-2 border-b border-line bg-bg1 px-2.5 py-1.5">
      <ad-segmented aria-label="View" [options]="views" [value]="ui.view()" (valueChange)="ui.view.set($event)" />
      <div class="relative flex w-[200px] items-center">
        <svg adIcon="search" class="absolute left-2 text-tx3"></svg>
        <input
          class="inp !pl-7"
          placeholder="Find on canvas"
          aria-label="Find on canvas"
          [value]="ui.q()"
          (input)="ui.q.set($any($event.target).value)"
        />
      </div>
      @if (matchLabel(); as label) {
        <span class="font-mono text-[11px] text-tx3">{{ label }}</span>
      }
      <div class="flex flex-wrap items-center gap-1" data-tour="filters">
        @for (f of ws.filters(); track f.type) {
          <button class="fc" [class]="'k-' + f.type" [class.on]="f.on" [attr.aria-pressed]="f.on" (click)="toggleFilter(f.type, f.on)">
            <i></i>{{ f.label }}<span class="font-mono text-tx3">{{ f.n }}</span>
          </button>
        }
      </div>
      <span class="flex-1"></span>
      <div class="relative">
        <button class="bt" ngMenuTrigger [menu]="newMenu" data-tour="new">
          <svg adIcon="plus"></svg>New<svg adIcon="chevD" class="s text-tx3"></svg>
        </button>
        <div ngMenu adMenuDismiss #newMenu="ngMenu" class="menu top-[30px] right-0" (itemSelected)="$event?.()">
          <div ngMenuItem class="mi k-agent" [value]="newAgent">
            <svg adIcon="bot" class="kc"></svg>Agent<span class="flex-1"></span>
            <span class="t3 font-mono text-[10.5px]">.claude/agents</span>
          </div>
          <div ngMenuItem class="mi k-skill" [value]="newSkill">
            <svg adIcon="zap" class="kc"></svg>Skill<span class="flex-1"></span>
            <span class="t3 font-mono text-[10.5px]">.claude/skills</span>
          </div>
          @for (k of moreKinds; track k.type) {
            <div ngMenuItem class="mi" [class]="'k-' + k.type" [value]="k.create">
              <svg [adIcon]="k.icon" class="kc"></svg>{{ k.label }}<span class="flex-1"></span>
              <span class="t3 ml-4 font-mono text-[10.5px]">{{ k.where }}</span>
            </div>
          }
        </div>
      </div>
      <button class="bt gh" adTip="Tidy node positions" (click)="cmd.autoLayout()"><svg adIcon="layout"></svg>Auto-layout</button>
      <span class="vsep"></span>
      <button
        class="ib"
        [class.on]="ui.inspOpen()"
        adTip="Toggle inspector"
        [tipEnd]="true"
        aria-label="Toggle inspector"
        (click)="ui.inspOpen.set(!ui.inspOpen())"
      >
        <svg adIcon="panelR"></svg>
      </button>
    </div>

    @if (ui.view() === 'graph') {
      <ad-graph-canvas />
    } @else {
      <ad-source-view />
    }
  `,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Workspace {
  protected readonly ui = inject(UiStore);
  protected readonly ws = inject(WorkspaceStore);
  protected readonly cmd = inject(Commands);

  protected readonly views: SegOption<View>[] = [
    { value: 'graph', label: 'Graph', icon: 'network' },
    { value: 'source', label: 'Source', icon: 'code' },
  ];

  protected readonly newAgent = () => this.cmd.addNode('agent');
  protected readonly newSkill = () => this.cmd.addNode('skill');
  /** The other kinds the New menu can create, with the place each one is saved to. */
  protected readonly moreKinds = (
    [
      ['cmd', 'Command', '.claude/commands'],
      ['rule', 'Rule', '.claude/rules'],
      ['mcp', 'MCP server', '.mcp.json'],
      ['mem', 'CLAUDE.md', 'project root'],
    ] as [Kind, string, string][]
  ).map(([type, label, where]) => ({ type, label, where, icon: iconFor(type), create: () => this.cmd.addNode(type) }));

  protected readonly matchLabel = computed(() => {
    const q = this.ui.q().trim().toLowerCase();
    if (!q) return '';
    const n = this.ws.visible().filter((r) => labelOf(r).toLowerCase().indexOf(q) >= 0).length;
    return n + (n === 1 ? ' match' : ' matches');
  });

  protected toggleFilter(type: string, on: boolean): void {
    this.ui.filt.update((f) => ({ ...f, [type]: !on }));
  }
}
