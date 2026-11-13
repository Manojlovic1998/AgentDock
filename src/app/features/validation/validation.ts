import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { plural } from '../../core/model/graph';
import { SEVERITY_ICON } from '../../core/model/icons';
import { Severity } from '../../core/model/types';
import { Commands } from '../../core/state/commands';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { Icon } from '../../ui/icon';

const GROUPS: [Severity, string][] = [
  ['err', 'Errors'],
  ['warn', 'Warnings'],
  ['info', 'Information'],
];

/** Validation results grouped by severity. */
@Component({
  selector: 'ad-validation',
  imports: [Icon],
  template: `
    <div class="flex min-h-11 flex-none flex-wrap items-center gap-2.5 border-b border-line bg-bg1 px-4 py-2">
      <h1 class="m-0 text-sm font-semibold">Validation</h1>
      <span class="st"><span class="dot err"></span>{{ labels().err }}</span>
      <span class="st"><span class="dot warn"></span>{{ labels().warn }}</span>
      <span class="st"><span class="dot" style="background: var(--info)"></span>{{ labels().info }}</span>
      <span class="flex-1"></span>
      <span class="text-tx3 max-wide:hidden">Checked against 27 rules · last run 2 minutes ago</span>
      <button class="bt" (click)="cmd.runValidation()"><svg adIcon="undo"></svg>Re-run</button>
    </div>
    <div class="scr min-h-0 flex-1 overflow-y-auto p-4">
      <div class="mx-auto flex max-w-[1000px] flex-col gap-3.5">
        @for (g of groups(); track g.sev) {
          <section class="pnl">
            <div class="ph">
              <svg [adIcon]="g.icon" [class]="'c-' + g.sev"></svg>
              <span class="flex-1 font-semibold">{{ g.label }}</span>
              <span class="font-mono text-tx3">{{ g.items.length }}</span>
            </div>
            @for (p of g.items; track $index) {
              <div class="flex flex-wrap items-center gap-3 border-b border-line px-3 py-[9px]" data-tour="problem-row">
                <div class="min-w-[260px] flex-1">
                  <div class="leading-[1.45]">{{ p.msg }}</div>
                  <div class="mt-1 flex items-center gap-2">
                    <span class="chip">{{ p.res }}</span>
                    <span class="font-mono text-[11px] text-tx3">{{ p.file }}</span>
                  </div>
                </div>
                <button class="bt" (click)="cmd.openProblem(p)">
                  {{ p.target ? 'Go to resource' : 'Open in Hooks' }}<svg adIcon="arrowUR" class="s"></svg>
                </button>
              </div>
            }
          </section>
        }
      </div>
    </div>
  `,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Validation {
  protected readonly cmd = inject(Commands);
  private readonly ws = inject(WorkspaceStore);

  protected readonly labels = computed(() => ({
    err: plural(this.ws.errorCount(), 'error'),
    warn: plural(this.ws.warnCount(), 'warning'),
    info: this.ws.infoCount() + ' info',
  }));

  protected readonly groups = computed(() =>
    GROUPS.map(([sev, label]) => ({
      sev,
      label,
      icon: SEVERITY_ICON[sev],
      items: this.ws.problems().filter((p) => p.sev === sev),
    })).filter((g) => g.items.length),
  );
}
