import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { copyPlan } from '../../core/model/copy';
import { plural } from '../../core/model/graph';
import { iconFor } from '../../core/model/icons';
import { PrefsStore } from '../../core/state/prefs.store';
import { UiStore } from '../../core/state/ui.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { Icon } from '../../ui/icon';
import { Switch } from '../../ui/switch';

/** Last folder of a path, which is how a project is named in the app. */
const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/**
 * Dialog for copying the chosen agents and skills into another project.
 *
 * @remarks
 * Open while {@link UiStore.copy} holds resource ids. The user picks a destination among the
 * recent folders or browses for one, sees which resources that project already has, and decides
 * whether those are replaced. Files are copied as saved on disk; the open workspace is untouched.
 */
@Component({
  selector: 'ad-copy-dialog',
  imports: [Icon, Switch, CdkTrapFocus],
  template: `
    <button class="absolute inset-0 z-[46] cursor-default bg-black/45" tabindex="-1" aria-label="Cancel" (click)="cancel()"></button>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="copy-title"
      cdkTrapFocus
      [cdkTrapFocusAutoCapture]="true"
      class="absolute top-[14%] left-1/2 z-[47] flex max-h-[76%] w-[460px] max-w-[calc(100%-32px)] -translate-x-1/2 flex-col rounded-[10px] border border-line2 bg-bg3 shadow-[0_24px_60px_var(--shd)]"
    >
      <div class="flex flex-none items-center gap-2.5 px-4 pt-4 pb-3">
        <span class="tile"><svg adIcon="copy"></svg></span>
        <div class="min-w-0 flex-1">
          <div id="copy-title" class="text-[13px] font-semibold">Copy to another project</div>
          <div class="text-tx3">{{ summary() }}</div>
        </div>
      </div>

      <div class="scr min-h-0 flex-1 overflow-y-auto px-4">
        <div class="lb pb-1">Resources</div>
        @for (r of rows(); track r.id) {
          <div class="flex h-[30px] items-center gap-2" [class]="'k-' + r.kind">
            <span class="tile sm"><svg [adIcon]="r.icon" class="s"></svg></span>
            <span class="el min-w-0 flex-1 font-mono text-[11.5px]">{{ r.label }}</span>
            @if (r.unsaved) {
              <span class="chip" title="This resource has unsaved edits. The version saved on disk is copied.">saved version</span>
            }
            @if (r.viaAgent) {
              <span class="text-[11px] text-tx3">used by agent</span>
            }
            @if (dest()) {
              <span class="text-[11px]" [class]="r.exists ? 'c-warn' : 'text-tx3'">{{ r.status }}</span>
            }
          </div>
        }
        @for (b of plan().blocked; track b.label) {
          <div class="flex min-h-[30px] items-center gap-2 text-tx3">
            <svg adIcon="info" class="mx-[3px]"></svg>
            <span class="min-w-0 flex-1"><span class="font-mono text-[11.5px]">{{ b.label }}</span> {{ b.reason }}.</span>
          </div>
        }
        @if (plan().agentSkills) {
          <label class="mt-1 flex h-[30px] cursor-pointer items-center gap-2.5">
            <button adSwitch [checked]="withSkills()" aria-labelledby="copy-skills" (click)="withSkills.set(!withSkills())"></button>
            <span id="copy-skills">Also copy the {{ skillsLabel() }}</span>
          </label>
        }

        <div class="lb pt-3 pb-1" id="copy-dest">Destination</div>
        <div role="radiogroup" aria-labelledby="copy-dest">
          @for (d of destinations(); track d.path) {
            <button class="lr" role="radio" [attr.aria-checked]="d.on" (click)="dest.set(d.path)">
              <svg [adIcon]="d.on ? 'check' : 'folder'" [class]="d.on ? 'text-acc' : 'text-tx3'"></svg>
              <span class="flex-none font-medium">{{ d.name }}</span>
              <span class="el min-w-0 flex-1 font-mono text-[10.5px] text-tx3">{{ d.path }}</span>
            </button>
          } @empty {
            <div class="py-1 leading-normal text-tx3">No other project has been opened yet. Choose its folder below.</div>
          }
        </div>
        <button class="lr text-tx2" (click)="browse()"><svg adIcon="plus" class="text-tx3"></svg>Choose folder…</button>

        @if (conflicts()) {
          <label class="mt-2 flex min-h-[30px] cursor-pointer items-center gap-2.5">
            <button adSwitch [checked]="replace()" aria-labelledby="copy-replace" (click)="replace.set(!replace())"></button>
            <span id="copy-replace" class="leading-normal">
              Replace the {{ conflictsLabel() }} already there
              <span class="text-tx3">· the old version goes to the Recycle Bin</span>
            </span>
          </label>
        }
      </div>

      <div class="flex flex-none items-center justify-end gap-2 p-4">
        <button class="bt" cdkFocusInitial (click)="cancel()">Cancel</button>
        <button class="bt pr" [disabled]="!ready()" [class.opacity-50]="!ready()" (click)="copy()">{{ action() }}</button>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopyDialog {
  private readonly ui = inject(UiStore);
  private readonly ws = inject(WorkspaceStore);
  private readonly prefs = inject(PrefsStore);

  /** Folder of the project to copy into; empty until one is chosen. */
  protected readonly dest = signal('');
  /** Whether skills used by the chosen agents are copied with them. */
  protected readonly withSkills = signal(true);
  /** Whether resources the destination already has are replaced. */
  protected readonly replace = signal(false);
  /** Folders picked with the native dialog while this dialog is open. */
  private readonly browsed = signal<string[]>([]);
  /** For each planned item, whether the destination already has it. Empty until checked. */
  private readonly existing = signal<boolean[]>([]);
  /** True while files are being copied, so the action cannot be started twice. */
  private readonly busy = signal(false);

  /** What will be copied, recomputed when the selection or the "with skills" switch changes. */
  protected readonly plan = computed(() => copyPlan(this.ui.copy() ?? [], this.ws.model(), this.ws.changes(), this.withSkills()));

  /** Planned items with their icon and whether the destination already has them. */
  protected readonly rows = computed(() => {
    const existing = this.existing();
    const replace = this.replace();
    return this.plan().items.map((item, i) => {
      const exists = !!existing[i];
      return { ...item, icon: iconFor(item.kind), exists, status: !exists ? 'new' : replace ? 'will be replaced' : 'already there, skipped' };
    });
  });

  /** Recent and browsed folders other than the open project, with the chosen one marked. */
  protected readonly destinations = computed(() => {
    const p = this.prefs.prefs();
    const open = p.root;
    const paths = this.browsed().concat(p.recent.filter((r) => this.browsed().indexOf(r) < 0));
    return paths.filter((path) => path !== open).map((path) => ({ path, name: folderName(path), on: path === this.dest() }));
  });

  /** Number of planned items the destination already has. */
  protected readonly conflicts = computed(() => this.rows().filter((r) => r.exists).length);
  protected readonly conflictsLabel = computed(() => plural(this.conflicts(), 'resource'));
  protected readonly skillsLabel = computed(() => {
    const n = this.plan().agentSkills;
    return n === 1 ? 'project skill it uses' : `${n} project skills they use`;
  });

  /** Number of files the Copy button will write with the current choices. */
  private readonly willCopy = computed(() => (this.replace() ? this.rows().length : this.rows().length - this.conflicts()));
  protected readonly ready = computed(() => !!this.dest() && this.willCopy() > 0 && !this.busy());
  protected readonly action = computed(() => (this.dest() && this.willCopy() ? `Copy ${plural(this.willCopy(), 'resource')}` : 'Copy'));
  protected readonly summary = computed(() => `From ${this.ws.snapshot.name}, as saved on disk`);

  constructor() {
    // Ask the destination what it already has whenever the destination or the list of items changes.
    let request = 0;
    effect(() => {
      const dest = this.dest();
      const items = this.plan().items;
      const mine = ++request;
      untracked(() => this.existing.set([]));
      if (!dest || !items.length) return;
      void this.ws.existsIn(dest, items).then((flags) => {
        if (mine === request) this.existing.set(flags);
      });
    });
  }

  /** Opens the native folder picker and selects the chosen folder as the destination. */
  protected async browse(): Promise<void> {
    const path = await this.ws.chooseFolder();
    if (!path) return;
    if (path === this.prefs.prefs().root) return this.ui.note('That is the project that is already open');
    this.browsed.update((list) => [path, ...list.filter((p) => p !== path)]);
    this.dest.set(path);
  }

  /** Copies the planned items and closes the dialog unless the copy failed. */
  protected async copy(): Promise<void> {
    if (!this.ready()) return;
    this.busy.set(true);
    const items = this.plan().items.map(({ kind, file }) => ({ kind, file }));
    const done = await this.ws.copyTo(this.dest(), items, this.replace());
    this.busy.set(false);
    if (done) this.cancel();
  }

  protected cancel(): void {
    this.ui.copy.set(null);
  }
}
