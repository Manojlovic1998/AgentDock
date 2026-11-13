import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { KIND_LABEL, labelOf, plural } from '../../core/model/graph';
import { planRename } from '../../core/model/rename';
import { UiStore } from '../../core/state/ui.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { Icon } from '../../ui/icon';

/** Asks for the new name of a command, rule or MCP server and shows what the rename changes on disk. */
@Component({
  selector: 'ad-rename-dialog',
  imports: [Icon, CdkTrapFocus],
  template: `
    @if (target(); as t) {
      <button class="absolute inset-0 z-[46] cursor-default bg-black/45" tabindex="-1" aria-label="Cancel" (click)="cancel()"></button>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-title"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
        class="absolute top-[24%] left-1/2 z-[47] w-[440px] max-w-[calc(100%-32px)] -translate-x-1/2 rounded-[10px] border border-line2 bg-bg3 p-4 shadow-[0_24px_60px_var(--shd)]"
        (submit)="$event.preventDefault(); submit(t.id)"
      >
        <div class="flex items-start gap-2.5">
          <span class="tile" style="--k: var(--acc)"><svg adIcon="pencil"></svg></span>
          <div class="min-w-0 flex-1">
            <div id="rename-title" class="text-[13px] font-semibold">Rename {{ t.kind }} {{ t.label }}</div>
            <input
              class="inp mt-2 font-mono !text-[11.5px]"
              cdkFocusInitial
              aria-label="New name"
              [value]="name()"
              (input)="name.set($any($event.target).value)"
            />
            @if (t.error) {
              <p class="mt-1.5 text-[11.5px] text-err" role="alert">{{ t.error }}</p>
            } @else if (t.plan; as p) {
              <div class="mt-2 text-[11px] text-tx2">{{ plural(p.files.length, 'file') }} will change on disk, nothing else:</div>
              <ul class="mt-1 max-h-[120px] overflow-auto font-mono text-[11px] text-tx3">
                @for (f of p.files; track f) {
                  <li class="truncate">{{ f }}</li>
                }
              </ul>
              @if (p.mentions.length) {
                <p class="mt-2 text-[11.5px] text-warn">
                  The text of {{ p.mentions.join(', ') }} mentions the old name. Mentions in text are not rewritten: check them after renaming.
                </p>
              }
            }
          </div>
        </div>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button type="button" class="bt" (click)="cancel()">Cancel</button>
          <button type="submit" class="bt pr" [disabled]="!!t.error || busy()">Rename</button>
        </div>
      </form>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RenameDialog {
  private readonly ui = inject(UiStore);
  private readonly ws = inject(WorkspaceStore);
  protected readonly plural = plural;
  protected readonly busy = signal(false);

  protected readonly name = signal(this.current());

  protected readonly target = computed(() => {
    const id = this.ui.rename();
    const n = id ? this.ws.model().by[id] : undefined;
    if (!id || !n) return null;
    const typed = this.name().trim();
    // An unchanged name is not an error to show: the button is just disabled.
    const result = typed === n.name ? { error: '' } : planRename(n, typed, this.ws.model().all);
    return {
      id,
      kind: KIND_LABEL[n.type].toLowerCase(),
      label: labelOf(n),
      error: 'error' in result ? result.error : '',
      plan: 'plan' in result ? result.plan : null,
    };
  });

  private current(): string {
    const id = this.ui.rename();
    return (id ? this.ws.model().by[id]?.name : '') ?? '';
  }

  protected async submit(id: string): Promise<void> {
    const t = this.target();
    if (!t || t.error || this.busy() || this.name().trim() === this.ws.model().by[id]?.name) return;
    this.busy.set(true);
    try {
      await this.ws.rename(id, this.name());
    } finally {
      this.busy.set(false);
    }
  }

  protected cancel(): void {
    this.ui.rename.set(null);
  }
}
