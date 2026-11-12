import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { iconFor } from '../../core/model/icons';
import { highlight, sourceOf } from '../../core/model/source';
import { UiStore } from '../../core/state/ui.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { Icon } from '../../ui/icon';
import { SourceCode } from '../../ui/source-code';

/** Configuration files on the left, generated source of the selected one on the right. */
@Component({
  selector: 'ad-source-view',
  imports: [Icon, SourceCode],
  template: `
    <div class="scr w-[250px] flex-none overflow-y-auto border-r border-line bg-bg1 px-1.5 py-2">
      <div class="lb px-2 pt-0.5 pb-1.5">Configuration files</div>
      @for (f of files(); track f.id) {
        <button class="nv" [class]="'k-' + f.type" [class.on]="f.on" [attr.aria-current]="f.on ? 'true' : null" (click)="ui.sel.set([f.id])">
          <svg [adIcon]="f.icon" class="text-k"></svg>
          <span class="el min-w-0 flex-1 font-mono text-[11.5px]">{{ f.label }}</span>
        </button>
      }
    </div>
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div class="flex h-8 flex-none items-center gap-2 border-b border-line px-3">
        <span class="el min-w-0 flex-1 font-mono text-[11.5px] text-tx2">{{ current()?.file ?? 'Select a file' }}</span>
        <span class="chip">read-only preview</span>
        <button class="bt gh" (click)="editFields()"><svg adIcon="pencil"></svg>Edit fields</button>
      </div>
      <div class="scr flex-1 overflow-auto py-2.5 pr-3">
        <ad-source-code [lines]="lines()" />
      </div>
    </div>
  `,
  host: { class: 'flex min-h-0 flex-1' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceView {
  protected readonly ui = inject(UiStore);
  private readonly ws = inject(WorkspaceStore);

  /** The selected resource, falling back to the first agent so the view is never empty. */
  protected readonly current = computed(() => {
    const m = this.ws.model();
    const n = this.ws.selectedOne() ?? m.by['angular-developer'] ?? m.list[0];
    return n && !n.missing ? n : null;
  });

  protected readonly files = computed(() => {
    const cur = this.current();
    return this.ws
      .visible()
      .filter((n) => !n.missing)
      .map((n) => ({
        id: n.id,
        type: n.type,
        icon: iconFor(n.type),
        label: n.type === 'mcp' ? '.mcp.json › ' + n.name : n.file.replace('.claude/', ''),
        on: cur?.id === n.id,
      }));
  });

  protected readonly lines = computed(() => {
    const n = this.current();
    const m = this.ws.model();
    return n ? highlight(sourceOf(n, m.rel, m.by)) : [];
  });

  protected editFields(): void {
    const n = this.current();
    if (!n) return;
    this.ui.view.set('graph');
    this.ui.sel.set([n.id]);
    this.ui.tab.set(n.type === 'agent' || n.type === 'skill' ? 'cf' : 'ov');
    this.ui.inspOpen.set(true);
  }
}
