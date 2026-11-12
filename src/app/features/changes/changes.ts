import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { plural } from '../../core/model/graph';
import { PrefsStore } from '../../core/state/prefs.store';
import { UiStore } from '../../core/state/ui.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { Icon } from '../../ui/icon';

const KIND_LABEL = { M: 'Modified', A: 'Added', D: 'Deleted' } as const;

/** Pending file changes with a line diff; nothing is written until the user saves. */
@Component({
  selector: 'ad-changes',
  imports: [Icon],
  template: `
    <div class="flex min-h-11 flex-none flex-wrap items-center gap-2.5 border-b border-line bg-bg1 px-4 py-2">
      <h1 class="m-0 text-sm font-semibold">Changes</h1>
      <span class="font-mono text-[11px] text-tx3">{{ summary() }}</span>
      <span class="flex-1"></span>
      <button class="bt dg" (click)="ws.discardAll()">Discard all</button>
      <button class="bt pr" (click)="ws.saveAll()"><svg adIcon="save"></svg>Save all to disk</button>
    </div>
    <div class="flex min-h-0 flex-1 flex-wrap">
      <div class="scr max-w-[340px] flex-[1_1_280px] overflow-y-auto border-r border-line bg-bg1 p-1.5">
        @for (c of ws.changes(); track c.id) {
          <button
            class="nv !h-[30px]"
            [class.on]="c.id === current()?.id"
            [attr.aria-current]="c.id === current()?.id ? 'true' : null"
            (click)="ui.chSel.set(c.id)"
          >
            <span class="kd" [class]="c.kind">{{ c.kind }}</span>
            <span class="el min-w-0 flex-1 text-left font-mono text-[11.5px]">{{ c.file }}</span>
            <span class="c-ok font-mono text-[10.5px]">+{{ c.add }}</span>
            <span class="c-err font-mono text-[10.5px]">−{{ c.del }}</span>
          </button>
        } @empty {
          <div class="px-2.5 py-4 leading-normal text-tx3">
            Working tree clean. Edit a field or change a relationship in the visual workspace and it will appear here before
            anything is written to disk.
          </div>
        }
      </div>
      <div class="flex min-h-0 min-w-0 flex-[999_1_480px] flex-col">
        @if (current(); as c) {
          <div class="flex h-[34px] flex-none items-center gap-2.5 border-b border-line px-3">
            <span class="kd" [class]="c.kind">{{ c.kind }}</span>
            <span class="el min-w-0 flex-1 font-mono text-[11.5px]">{{ c.file }}</span>
            <span class="text-tx3">{{ kindLabel[c.kind] }}</span>
            <span class="c-ok font-mono">+{{ c.add }}</span>
            <span class="c-err font-mono">−{{ c.del }}</span>
            <button class="bt gh" (click)="ws.discardOne(c)">Discard file</button>
          </div>
          <div class="scr flex-1 overflow-auto py-2" [style.font-size.px]="prefs.codeSize()">
            @for (d of c.lines; track $index) {
              <div class="dl" [class]="d.c">
                <span class="ln">{{ d.o }}</span>
                <span class="ln">{{ d.n }}</span>
                <span class="sg">{{ d.s }}</span>
                <span>{{ d.t || ' ' }}</span>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Changes {
  protected readonly ws = inject(WorkspaceStore);
  protected readonly ui = inject(UiStore);
  protected readonly prefs = inject(PrefsStore);
  protected readonly kindLabel = KIND_LABEL;

  protected readonly summary = computed(() => plural(this.ws.changes().length, 'file') + ' pending · nothing written to disk yet');

  /** The picked file, or the first change when nothing (or something stale) is picked. */
  protected readonly current = computed(() => {
    const all = this.ws.changes();
    return all.find((c) => c.id === this.ui.chSel()) ?? all[0] ?? null;
  });
}
