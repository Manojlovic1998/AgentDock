import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { KIND_LABEL, labelOf, plural } from '../../core/model/graph';
import { IconName, iconFor } from '../../core/model/icons';
import { KindOrNone } from '../../core/model/types';
import { Commands } from '../../core/state/commands';
import { UiStore } from '../../core/state/ui.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { ListNav } from '../../headless/list-nav';
import { Icon } from '../../ui/icon';

interface PaletteItem {
  type: KindOrNone;
  icon: IconName;
  label: string;
  hint: string;
  mono: boolean;
  run: () => void;
}

const MAX_RESULTS = 10;

/** Search over commands and resources. Arrows move, Enter runs, Escape closes. */
@Component({
  selector: 'ad-command-palette',
  imports: [Icon, ListNav, CdkTrapFocus],
  template: `
    <button class="absolute inset-0 z-[46] cursor-default bg-black/45" tabindex="-1" aria-label="Close command palette" (click)="close()"></button>
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      cdkTrapFocus
      [cdkTrapFocusAutoCapture]="true"
      class="absolute top-[84px] left-1/2 z-[47] w-[560px] max-w-[calc(100%-32px)] -translate-x-1/2 overflow-hidden rounded-[10px] border border-line2 bg-bg3 shadow-[0_24px_60px_var(--shd)]"
    >
      <div class="flex h-[42px] items-center gap-2.5 border-b border-line px-3">
        <svg adIcon="search" class="text-tx3"></svg>
        <input
          cdkFocusInitial
          class="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] outline-none"
          placeholder="Type a command or resource name"
          aria-label="Command palette search"
          aria-controls="palette-results"
          idPrefix="palette-opt-"
          [adListNav]="items().length"
          [(active)]="active"
          [value]="query()"
          (input)="setQuery($any($event.target).value)"
          (commit)="run(items()[$event])"
          (dismiss)="close()"
        />
        <span class="kbd">esc</span>
      </div>
      <div id="palette-results" role="listbox" aria-label="Results" class="scr max-h-80 overflow-y-auto p-1">
        @for (p of items(); track $index) {
          <button
            class="mi !h-[30px]"
            [class]="'k-' + p.type"
            [class.act]="$index === active()"
            role="option"
            tabindex="-1"
            [id]="'palette-opt-' + $index"
            [attr.aria-selected]="$index === active()"
            (mousemove)="active.set($index)"
            (click)="run(p)"
          >
            <svg [adIcon]="p.icon" [class.kc]="p.type !== 'x'"></svg>
            <span class="el min-w-0 flex-1 text-left" [class.font-mono]="p.mono">{{ p.label }}</span>
            <span class="t3 text-[11px]">{{ p.hint }}</span>
          </button>
        } @empty {
          <div class="px-2.5 py-3.5 text-tx3">No commands or resources match.</div>
        }
      </div>
      <div class="flex h-7 items-center gap-3 border-t border-line px-3 text-[11px] text-tx3">
        <span><span class="kbd">↑↓</span> navigate</span>
        <span><span class="kbd">↵</span> run</span>
        <span class="flex-1"></span>
        <span>{{ countLabel() }}</span>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandPalette {
  private readonly ui = inject(UiStore);
  private readonly ws = inject(WorkspaceStore);
  private readonly cmd = inject(Commands);

  protected readonly query = signal('');
  protected readonly active = signal(0);

  private readonly commands: PaletteItem[] = (
    [
      ['Go to Visual Workspace', 'network', () => this.cmd.go('workspace')],
      ['Go to Overview', 'dash', () => this.cmd.go('overview')],
      ['Go to Validation', 'shield', () => this.cmd.go('validation')],
      ['Go to Changes', 'branch', () => this.cmd.go('changes')],
      ['Toggle light and dark theme', 'sun', () => this.cmd.toggleTheme()],
      ['Auto-layout graph', 'layout', () => this.cmd.autoLayout()],
      ['Run validation', 'shield', () => this.cmd.runValidation()],
      ['Save all changes', 'save', () => this.cmd.saveAll()],
      ['Open settings', 'gear', () => this.cmd.go('settings')],
    ] as [string, IconName, () => void][]
  ).map(([label, icon, run]) => ({ type: 'x', icon, label, hint: 'Command', mono: false, run }));

  protected readonly items = computed<PaletteItem[]>(() => {
    const q = this.query().trim().toLowerCase();
    const resources: PaletteItem[] = this.ws
      .model()
      .list.filter((n) => !n.missing)
      .map((n) => ({
        type: n.type,
        icon: iconFor(n.type),
        label: labelOf(n),
        hint: KIND_LABEL[n.type],
        mono: true,
        run: () => this.cmd.focusNode(n.id),
      }));
    const all = this.commands.concat(resources);
    return (q ? all.filter((p) => p.label.toLowerCase().indexOf(q) >= 0) : all).slice(0, MAX_RESULTS);
  });

  protected readonly countLabel = computed(() => plural(this.items().length, 'result'));

  protected setQuery(value: string): void {
    this.query.set(value);
    this.active.set(0);
  }

  protected run(item: PaletteItem | undefined): void {
    if (!item) return;
    this.close();
    item.run();
  }

  protected close(): void {
    this.ui.palette.set(false);
  }
}
