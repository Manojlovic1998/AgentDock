import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, viewChild } from '@angular/core';
import { IconName } from '../../core/model/icons';
import { Commands, KIND_SCREEN } from '../../core/state/commands';
import { UiStore } from '../../core/state/ui.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { Icon } from '../../ui/icon';

interface MenuEntry {
  label: string;
  icon: IconName;
  kbd?: string;
  danger?: boolean;
  /** Draw a separator above this entry. */
  sep?: boolean;
  run: () => void;
}

/** Actions for one resource, opened by right-click or a "More actions" button. */
@Component({
  selector: 'ad-context-menu',
  imports: [Icon],
  template: `
    <button
      class="absolute inset-0 z-30 cursor-default"
      tabindex="-1"
      aria-label="Close menu"
      (click)="close()"
      (contextmenu)="$event.preventDefault(); close()"
    ></button>
    @if (menu(); as m) {
      <div #panel class="menu w-[230px]" role="menu" [attr.aria-label]="m.title" [style.left.px]="m.x" [style.top.px]="m.y" (keydown)="onKey($event)">
        <div class="el px-2 py-1 font-mono text-[10.5px] text-tx3">{{ m.title }}</div>
        @for (it of m.items; track it.label) {
          @if (it.sep) {
            <div class="msep" role="separator"></div>
          }
          <button class="mi" [class.dg]="it.danger" role="menuitem" (click)="it.run()">
            <svg [adIcon]="it.icon"></svg>
            <span class="flex-1 text-left">{{ it.label }}</span>
            @if (it.kbd) {
              <span class="kbd">{{ it.kbd }}</span>
            }
          </button>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextMenu {
  private readonly ui = inject(UiStore);
  private readonly ws = inject(WorkspaceStore);
  private readonly cmd = inject(Commands);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly menu = computed(() => {
    const ctx = this.ui.ctx();
    const n = ctx ? this.ws.model().by[ctx.id] : undefined;
    if (!ctx || !n) return null;
    const items: MenuEntry[] = [
      { label: 'Open in inspector', icon: 'panelR', run: () => this.cmd.focusNode(n.id) },
      { label: 'View source', icon: 'code', run: () => this.cmd.focusNode(n.id, 'src') },
      { label: 'Reveal in resource list', icon: 'arrowUR', run: () => this.cmd.go(KIND_SCREEN[n.type]) },
      { label: 'Copy file path', icon: 'copy', sep: true, run: () => this.copyPath(n.file) },
      { label: 'Detach all relationships', icon: 'unlink', run: () => this.ws.detachAll(n.id) },
      { label: 'Delete', icon: 'trash', danger: true, sep: true, run: () => this.cmd.askDelete(n.id) },
    ];
    // CLAUDE.md is the only kind that cannot go to another project; the entry sits with the other file actions.
    if (n.type !== 'mem') {
      items.splice(5, 0, { label: 'Copy to another project…', icon: 'folder', run: () => this.cmd.askCopy(n.id) });
    }
    return { x: ctx.x, y: ctx.y, title: n.file, items };
  });

  constructor() {
    afterNextRender(() => this.buttons()[0]?.focus());
  }

  private buttons(): HTMLElement[] {
    return Array.from(this.panel()?.nativeElement.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []);
  }

  protected onKey(e: KeyboardEvent): void {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const all = this.buttons();
    const at = all.indexOf(e.target as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (at + step + all.length) % all.length;
    all[next]?.focus();
  }

  private copyPath(file: string): void {
    void navigator.clipboard?.writeText(file).catch(() => undefined);
    this.ui.note('Copied ' + file);
  }

  protected close(): void {
    this.ui.ctx.set(null);
  }
}
