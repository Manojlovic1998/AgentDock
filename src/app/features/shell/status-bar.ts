import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { plural } from '../../core/model/graph';
import { BottomTab, UiStore } from '../../core/state/ui.store';
import { ViewportStore } from '../../core/state/viewport.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { Tip } from '../../headless/tip';
import { Icon } from '../../ui/icon';

@Component({
  selector: 'ad-status-bar',
  imports: [Icon, Tip],
  template: `
    <span class="sb"><svg adIcon="branch" class="s"></svg>{{ ws.snapshot.branch }}</span>
    <button class="sb" adTip="Open problems panel" [tipAbove]="true" (click)="openPanel('problems')">
      <svg adIcon="xCircle" class="s c-err"></svg>{{ ws.errorCount() }}
      <svg adIcon="alert" class="s c-warn"></svg>{{ ws.warnCount() }}
      <svg adIcon="info" class="s c-info"></svg>{{ ws.infoCount() }}
    </button>
    <button class="sb" adTip="Open changes panel" [tipAbove]="true" (click)="openPanel('changes')">
      <svg adIcon="branch" class="s"></svg>{{ changeLabel() }}
    </button>
    <span class="flex-1"></span>
    @if (ws.stale()) {
      <button class="sb" adTip="Files changed outside AgentDock. Rescan to load them" [tipAbove]="true" (click)="ws.rescan()">
        <svg adIcon="alert" class="s c-warn"></svg>Changed on disk
      </button>
    } @else {
      <span class="sb max-wide:hidden"><span class="dot" [style.background]="ws.watching() ? null : 'var(--tx3)'"></span>{{ ws.watchLabel() }}</span>
    }
    <span class="sb font-mono max-wide:hidden">{{ totalLabel() }}</span>
    <span class="sb font-mono">{{ zoomPct() }}</span>
    <button
      class="ib !h-5 !w-[22px]"
      [class.on]="ui.bottomOpen()"
      adTip="Toggle bottom panel"
      [tipAbove]="true"
      [tipEnd]="true"
      aria-label="Toggle bottom panel"
      (click)="ui.bottomOpen.set(!ui.bottomOpen())"
    >
      <svg adIcon="panelB" class="s"></svg>
    </button>
  `,
  host: {
    class: 'flex h-6 flex-none items-center gap-1 border-t border-line bg-bg0 px-2 text-[11px] text-tx2',
    role: 'contentinfo',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBar {
  protected readonly ws = inject(WorkspaceStore);
  protected readonly ui = inject(UiStore);
  private readonly viewport = inject(ViewportStore);

  protected readonly changeLabel = computed(() => {
    const n = this.ws.changes().length;
    return n ? plural(n, 'pending change') : 'No pending changes';
  });
  protected readonly totalLabel = computed(() => plural(this.ws.total(), 'resource'));
  protected readonly zoomPct = computed(() => Math.round(this.viewport.zoom() * 100) + '%');

  /** Opens the panel on the given tab, or closes it when that tab is already showing. */
  protected openPanel(tab: BottomTab): void {
    this.ui.bottomOpen.set(!(this.ui.bottomOpen() && this.ui.btab() === tab));
    this.ui.btab.set(tab);
  }
}
