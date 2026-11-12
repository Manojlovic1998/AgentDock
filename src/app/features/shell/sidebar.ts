import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IconName } from '../../core/model/icons';
import { Commands } from '../../core/state/commands';
import { UiStore } from '../../core/state/ui.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { Icon } from '../../ui/icon';

type NavDef = [id: string, label: string, icon: IconName];

const NAV: [key: string, label: string, items: NavDef[]][] = [
  [
    'ws',
    'Workspace',
    [
      ['overview', 'Overview', 'dash'],
      ['workspace', 'Visual Workspace', 'network'],
    ],
  ],
  [
    'res',
    'Resources',
    [
      ['agents', 'Agents', 'bot'],
      ['skills', 'Skills', 'zap'],
      ['commands', 'Commands', 'terminal'],
      ['rules', 'Rules', 'rule'],
      ['claudemd', 'CLAUDE.md', 'file'],
      ['settingsres', 'Settings', 'sliders'],
      ['hooks', 'Hooks', 'hook'],
      ['styles', 'Output Styles', 'type'],
      ['mcp', 'MCP Servers', 'plug'],
      ['plugins', 'Plugins', 'box'],
      ['memory', 'Memory', 'db'],
      ['other', 'Other Resources', 'folder'],
    ],
  ],
  [
    'tools',
    'Tools',
    [
      ['validation', 'Validation', 'shield'],
      ['changes', 'Changes', 'branch'],
      ['activity', 'Activity', 'activity'],
    ],
  ],
];

@Component({
  selector: 'ad-sidebar',
  imports: [Icon],
  template: `
    <div class="flex flex-1 flex-col gap-px px-1.5 pb-2">
      @for (sec of nav(); track sec.key) {
        <button class="sh" [attr.aria-expanded]="sec.open" (click)="toggle(sec.key)">
          <svg [adIcon]="sec.open ? 'chevD' : 'chevR'" class="s text-tx3"></svg>
          <span class="lb">{{ sec.label }}</span>
        </button>
        @if (sec.open || ui.sideCollapsed()) {
          @for (it of sec.items; track it.id) {
            <button
              class="nv"
              [class.on]="it.on"
              [attr.data-tip]="it.label"
              [attr.aria-current]="it.on ? 'page' : null"
              (click)="cmd.go(it.id)"
            >
              <svg [adIcon]="it.icon"></svg>
              <span class="lbl el min-w-0 flex-1">{{ it.label }}</span>
              <span class="ct" [class]="it.countClass">{{ it.count }}</span>
            </button>
          }
        }
      }
    </div>
    <div class="border-t border-line p-1.5">
      <button
        class="nv"
        [attr.data-tip]="ui.sideCollapsed() ? 'Expand sidebar' : 'Collapse sidebar'"
        (click)="ui.sideCollapsed.set(!ui.sideCollapsed())"
      >
        <svg adIcon="panelL"></svg><span class="lbl">Collapse sidebar</span>
      </button>
    </div>
  `,
  host: {
    class: 'side scr flex flex-none flex-col overflow-x-hidden overflow-y-auto border-r border-line bg-bg1',
    '[class.col]': 'ui.sideCollapsed()',
    role: 'navigation',
    'aria-label': 'Primary',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sidebar {
  protected readonly cmd = inject(Commands);
  protected readonly ui = inject(UiStore);
  private readonly ws = inject(WorkspaceStore);

  protected readonly nav = computed(() => {
    const counts = this.ws.counts();
    const screen = this.cmd.screen();
    const problems = this.ws.errorCount() + this.ws.warnCount();
    return NAV.map(([key, label, items]) => ({
      key,
      label,
      open: this.ui.secOpen()[key] !== false,
      items: items.map(([id, itemLabel, icon]) => {
        const c = id === 'validation' ? problems : id === 'changes' ? this.ws.changes().length : counts[id];
        return {
          id,
          label: itemLabel,
          icon,
          on: screen === id,
          count: c ? c : '',
          countClass: id === 'validation' && this.ws.errorCount() ? 'ct bad' : id === 'changes' ? 'ct chg' : 'ct',
        };
      }),
    }));
  });

  protected toggle(key: string): void {
    this.ui.secOpen.update((o) => ({ ...o, [key]: o[key] === false }));
  }
}
