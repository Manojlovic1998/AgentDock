import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Commands } from './core/state/commands';
import { UiStore } from './core/state/ui.store';
import { Inspector } from './features/inspector/inspector';
import { CommandPalette } from './features/overlays/command-palette';
import { ContextMenu } from './features/overlays/context-menu';
import { DeleteDialog } from './features/overlays/delete-dialog';
import { ToastOutlet } from './features/overlays/toast';
import { BottomPanel } from './features/shell/bottom-panel';
import { Sidebar } from './features/shell/sidebar';
import { StatusBar } from './features/shell/status-bar';
import { TitleBar } from './features/shell/title-bar';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    TitleBar,
    Sidebar,
    StatusBar,
    BottomPanel,
    Inspector,
    CommandPalette,
    ContextMenu,
    DeleteDialog,
    ToastOutlet,
  ],
  template: `
    <ad-title-bar />
    <div class="relative flex min-h-0 flex-1">
      <ad-sidebar />
      <main class="flex min-w-0 flex-1 flex-col bg-bg2">
        <router-outlet />
        @if (ui.bottomOpen()) {
          <ad-bottom-panel />
        }
      </main>
      @if (showInspector()) {
        <ad-inspector />
      }
    </div>
    <ad-status-bar />

    @if (ui.ctx()) {
      <ad-context-menu />
    }
    @if (ui.dialog()) {
      <ad-delete-dialog />
    }
    @if (ui.palette()) {
      <ad-command-palette />
    }
    <ad-toast-outlet />
  `,
  host: {
    class: 'relative flex h-screen flex-col overflow-hidden bg-bg1 text-tx',
    '(document:keydown)': 'onKey($event)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly ui = inject(UiStore);
  private readonly cmd = inject(Commands);

  protected readonly showInspector = computed(() => this.cmd.screen() === 'workspace' && this.ui.inspOpen());

  protected onKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (this.ui.palette()) this.ui.palette.set(false);
      else this.cmd.openPalette();
    } else if (e.key === 'Escape') {
      this.ui.closeOverlays();
    }
  }
}
