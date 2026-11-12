import { Menu, MenuItem, MenuTrigger } from '@angular/aria/menu';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Commands } from '../../core/state/commands';
import { PrefsStore } from '../../core/state/prefs.store';
import { UiStore } from '../../core/state/ui.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { WindowControls } from '../../core/window-controls';
import { MenuDismiss } from '../../headless/menu-dismiss';
import { Tip } from '../../headless/tip';
import { Icon } from '../../ui/icon';

@Component({
  selector: 'ad-title-bar',
  imports: [Icon, Tip, Menu, MenuItem, MenuTrigger, MenuDismiss],
  template: `
    <div class="flex items-center gap-2">
      <span class="inline-flex size-5 items-center justify-center rounded-[5px] bg-acc text-acc-tx">
        <svg adIcon="logo" class="s" style="stroke-width: 2.4"></svg>
      </span>
      <span class="font-semibold tracking-[-0.01em] max-wide:hidden">AgentDock</span>
    </div>
    <span class="vsep max-wide:hidden"></span>

    <div class="relative">
      <button class="bt gh" ngMenuTrigger [menu]="wsMenu" aria-label="Switch workspace">
        <svg adIcon="folder"></svg>
        <span class="text-tx">{{ ws.snapshot.name }}</span>
        <span class="chip">{{ ws.snapshot.branch }}</span>
        <svg adIcon="chevD" class="s"></svg>
      </button>
      <div ngMenu adMenuDismiss #wsMenu="ngMenu" class="menu top-[30px] left-0 w-[280px]" (itemSelected)="$event?.()">
        <div class="lb px-2 pt-1.5 pb-1">Workspaces</div>
        @for (w of workspaces; track w.path) {
          <div ngMenuItem class="mi" [value]="w.pick">
            <svg [adIcon]="w.current ? 'check' : 'folder'"></svg>
            <span class="el min-w-0 flex-1">{{ w.name }}</span>
            <span class="t3 font-mono text-[10.5px]">{{ w.path }}</span>
          </div>
        }
        <div class="msep"></div>
        <div ngMenuItem class="mi" [value]="openFolder"><svg adIcon="plus"></svg>Open folder…</div>
      </div>
    </div>

    <div class="flex min-w-0 flex-1 items-center justify-center">
      <button
        class="flex h-[26px] w-[380px] max-w-full items-center gap-2 rounded-md border border-line2 bg-bg2 px-2 text-tx3 max-wide:hidden"
        aria-label="Search resources and commands"
        (click)="cmd.openPalette()"
      >
        <svg adIcon="search"></svg>
        <span class="min-w-0 flex-1">Search resources and commands</span>
        <span class="kbd">Ctrl K</span>
      </button>
    </div>

    @if (ws.changes().length) {
      <button class="bt gh" style="color: var(--acc)" (click)="cmd.go('changes')">
        <span class="dot" style="background: var(--acc)"></span>{{ ws.changes().length }} unsaved
      </button>
    }
    <button class="ib" adTip="Command palette" aria-label="Command palette" (click)="cmd.openPalette()">
      <svg adIcon="cmdk"></svg>
    </button>
    <button
      class="ib"
      [adTip]="prefs.theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
      aria-label="Toggle theme"
      (click)="prefs.toggleTheme()"
    >
      <svg [adIcon]="prefs.theme() === 'dark' ? 'sun' : 'moon'"></svg>
    </button>
    <button class="ib" [class.on]="cmd.screen() === 'settings'" adTip="Settings" aria-label="Settings" (click)="cmd.go('settings')">
      <svg adIcon="gear"></svg>
    </button>
    @if (win.available) {
      <span class="vsep"></span>
      <div class="flex items-center">
        <button class="ib" aria-label="Minimize window" (click)="win.minimize()"><svg adIcon="minus" class="s"></svg></button>
        <button class="ib" [attr.aria-label]="win.maximized() ? 'Restore window' : 'Maximize window'" (click)="win.toggleMaximize()">
          <svg adIcon="square" class="s"></svg>
        </button>
        <button class="ib hover:!bg-err hover:!text-white" aria-label="Close window" (click)="win.close()">
          <svg adIcon="x" class="s"></svg>
        </button>
      </div>
    }
  `,
  host: {
    class: 'drag-region relative flex h-[38px] flex-none items-center gap-2 border-b border-line bg-bg0 pr-1.5 pl-2.5',
    role: 'banner',
    '(dblclick)': 'onDoubleClick($event)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitleBar {
  protected readonly cmd = inject(Commands);
  protected readonly ws = inject(WorkspaceStore);
  protected readonly prefs = inject(PrefsStore);
  protected readonly win = inject(WindowControls);
  private readonly ui = inject(UiStore);

  protected readonly workspaces = [
    { name: this.ws.snapshot.name, path: this.ws.snapshot.path, current: true, pick: () => {} },
    { name: 'acme-mobile', path: '~/code/acme-mobile', current: false, pick: () => this.unavailable() },
    { name: 'User scope', path: '~/.claude', current: false, pick: () => this.unavailable() },
  ];

  protected readonly openFolder = () => this.ui.note('Opening folders is not available yet: this build runs on sample data');

  private unavailable(): void {
    this.ui.note(`Only ${this.ws.snapshot.name} is populated in this build`);
  }

  protected onDoubleClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.win.toggleMaximize();
  }
}
