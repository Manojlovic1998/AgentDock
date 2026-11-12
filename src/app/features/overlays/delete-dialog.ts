import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { KIND_LABEL, labelOf, plural } from '../../core/model/graph';
import { UiStore } from '../../core/state/ui.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { Icon } from '../../ui/icon';

/** Confirmation before a resource and its references are removed. */
@Component({
  selector: 'ad-delete-dialog',
  imports: [Icon, CdkTrapFocus],
  template: `
    @if (target(); as t) {
      <button class="absolute inset-0 z-[46] cursor-default bg-black/45" tabindex="-1" aria-label="Cancel" (click)="cancel()"></button>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-body"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
        class="absolute top-[28%] left-1/2 z-[47] w-[400px] max-w-[calc(100%-32px)] -translate-x-1/2 rounded-[10px] border border-line2 bg-bg3 p-4 shadow-[0_24px_60px_var(--shd)]"
      >
        <div class="flex items-start gap-2.5">
          <span class="tile" style="--k: var(--err)"><svg adIcon="trash"></svg></span>
          <div class="min-w-0 flex-1">
            <div id="delete-title" class="text-[13px] font-semibold">{{ t.title }}</div>
            <p id="delete-body" class="mt-1 leading-normal text-tx2">{{ t.body }}</p>
            <div class="mt-1.5 font-mono text-[11px] text-tx3">{{ t.file }}</div>
          </div>
        </div>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button class="bt" cdkFocusInitial (click)="cancel()">Cancel</button>
          <button class="bt dgf" (click)="ws.remove(t.id)">Delete</button>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteDialog {
  private readonly ui = inject(UiStore);
  protected readonly ws = inject(WorkspaceStore);

  protected readonly target = computed(() => {
    const id = this.ui.dialog();
    const n = id ? this.ws.model().by[id] : undefined;
    if (!n) return null;
    const refs = this.ws.referenceCount(n.id);
    return {
      id: n.id,
      title: `Delete ${KIND_LABEL[n.type].toLowerCase()} ${labelOf(n)}?`,
      body: `The file is removed and ${plural(refs, 'reference')} to it ${refs === 1 ? 'is' : 'are'} cleaned up. Nothing is written to disk until you save, and you can undo.`,
      file: n.file,
    };
  });

  protected cancel(): void {
    this.ui.dialog.set(null);
  }
}
