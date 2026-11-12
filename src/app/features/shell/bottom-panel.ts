import { Tab, TabContent, TabList, TabPanel, Tabs } from '@angular/aria/tabs';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SEVERITY_ICON } from '../../core/model/icons';
import { Commands } from '../../core/state/commands';
import { BottomTab, UiStore } from '../../core/state/ui.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { Icon } from '../../ui/icon';

@Component({
  selector: 'ad-bottom-panel',
  imports: [Icon, Tabs, TabList, Tab, TabPanel, TabContent],
  template: `
    <div ngTabs class="flex min-h-0 flex-1 flex-col">
      <div class="tabs items-center">
        <div ngTabList class="flex gap-0.5" [selectedTab]="ui.btab()" (selectedTabChange)="pick($event)">
          <div ngTab value="problems" class="tab">Problems<span class="font-mono text-[10.5px] text-tx3">{{ ws.problems().length }}</span></div>
          <div ngTab value="changes" class="tab">Changes<span class="font-mono text-[10.5px] text-tx3">{{ ws.changes().length }}</span></div>
          <div ngTab value="activity" class="tab">Activity</div>
        </div>
        <span class="flex-1"></span>
        <button class="ib" aria-label="Close panel" (click)="ui.bottomOpen.set(false)"><svg adIcon="x"></svg></button>
      </div>
      <div class="scr min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        <div ngTabPanel value="problems">
          <ng-template ngTabContent>
            @for (p of ws.problems(); track $index) {
              <button class="lr !h-[26px]" (click)="cmd.openProblem(p)">
                <svg [adIcon]="sevIcon[p.sev]" [class]="'c-' + p.sev"></svg>
                <span class="el min-w-0 flex-1">{{ p.msg }}</span>
                <span class="chip">{{ p.res }}</span>
                <span class="w-[220px] text-right font-mono text-[11px] text-tx3 max-wide:hidden">{{ p.file }}</span>
              </button>
            }
          </ng-template>
        </div>
        <div ngTabPanel value="changes">
          <ng-template ngTabContent>
            @for (c of ws.changes(); track c.id) {
              <button class="lr !h-[26px]" (click)="cmd.openChange(c.id)">
                <span class="kd" [class]="c.kind">{{ c.kind }}</span>
                <span class="el min-w-0 flex-1 font-mono text-[11.5px]">{{ c.file }}</span>
                <span class="c-ok font-mono text-[11px]">+{{ c.add }}</span>
                <span class="c-err font-mono text-[11px]">−{{ c.del }}</span>
              </button>
            } @empty {
              <div class="p-2 text-tx3">No pending changes.</div>
            }
          </ng-template>
        </div>
        <div ngTabPanel value="activity">
          <ng-template ngTabContent>
            @for (a of activity(); track $index) {
              <div class="lr !h-[26px]">
                <span class="w-[78px] flex-none font-mono text-[11px] text-tx3">{{ a.t }}</span>
                <span class="el min-w-0 flex-1">{{ a.msg }}</span>
              </div>
            }
          </ng-template>
        </div>
      </div>
    </div>
  `,
  host: { class: 'flex h-[196px] flex-none flex-col border-t border-line2 bg-bg1' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BottomPanel {
  protected readonly ws = inject(WorkspaceStore);
  protected readonly ui = inject(UiStore);
  protected readonly cmd = inject(Commands);
  protected readonly sevIcon = SEVERITY_ICON;
  protected readonly activity = computed(() => this.ui.log().concat(this.ws.snapshot.activity));

  protected pick(tab: string | undefined): void {
    if (tab) this.ui.btab.set(tab as BottomTab);
  }
}
