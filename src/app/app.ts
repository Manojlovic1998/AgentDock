import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Commands } from './core/state/commands';
import { TourStore } from './core/state/tour.store';
import { UiStore } from './core/state/ui.store';
import { Inspector } from './features/inspector/inspector';
import { CommandPalette } from './features/overlays/command-palette';
import { ContextMenu } from './features/overlays/context-menu';
import { CopyDialog } from './features/overlays/copy-dialog';
import { DeleteDialog } from './features/overlays/delete-dialog';
import { HookDialog } from './features/overlays/hook-dialog';
import { RenameDialog } from './features/overlays/rename-dialog';
import { ToastOutlet } from './features/overlays/toast';
import { TourOutlet } from './features/overlays/tour-outlet';
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
    CopyDialog,
    DeleteDialog,
    RenameDialog,
    HookDialog,
    ToastOutlet,
    TourOutlet,
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
    @if (ui.rename()) {
      <ad-rename-dialog />
    }
    @if (ui.copy()) {
      <ad-copy-dialog />
    }
    @if (ui.hook()) {
      <ad-hook-dialog />
    }
    @if (ui.palette()) {
      <ad-command-palette />
    }
    <ad-toast-outlet />
    <ad-tour-outlet />
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
  private readonly tour = inject(TourStore);

  protected readonly showInspector = computed(() => this.cmd.screen() === 'workspace' && this.ui.inspOpen());

  constructor() {
    afterNextRender(() => this.tour.offerOnce());
  }

  protected onKey(e: KeyboardEvent): void {
    const kind = this.tour.active()?.kind;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      // The product tour covers the app, so the palette would open underneath it.
      if (kind === 'tour') this.tour.stop();
      if (this.ui.palette()) this.ui.palette.set(false);
      else this.cmd.openPalette();
    } else if (e.key === 'Escape') {
      // A walkthrough stays: Escape there closes the menu or dialog the user is working in.
      if (kind && kind !== 'walkthrough') this.tour.stop();
      this.ui.closeOverlays();
    } else if (kind === 'tour' && e.key === 'ArrowRight') {
      this.tour.next();
    } else if (kind === 'tour' && e.key === 'ArrowLeft') {
      this.tour.back();
    }
  }
}
