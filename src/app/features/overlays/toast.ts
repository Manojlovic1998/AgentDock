import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { UiStore } from '../../core/state/ui.store';
import { WorkspaceStore } from '../../core/state/workspace.store';

/** Transient confirmation of the last action, with Undo when it can be reverted. */
@Component({
  selector: 'ad-toast-outlet',
  template: `
    <div role="status" aria-live="polite">
      @if (ui.toast(); as t) {
        <div class="toast">
          <span>{{ t.msg }}</span>
          @if (t.undo) {
            <button (click)="ws.undo()">Undo</button>
          }
          <button class="!border-0 !px-1" aria-label="Dismiss" (click)="ui.toast.set(null)">✕</button>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastOutlet {
  protected readonly ui = inject(UiStore);
  protected readonly ws = inject(WorkspaceStore);
}
