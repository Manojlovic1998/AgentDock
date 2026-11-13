import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { UpdateStore } from '../../core/state/update.store';
import { Icon } from '../../ui/icon';

/** Asks whether to download a new version, shows the download and asks to restart once it is ready. */
@Component({
  selector: 'ad-update-dialog',
  imports: [Icon, CdkTrapFocus],
  template: `
    @if (up.state(); as s) {
      <button class="absolute inset-0 z-[46] cursor-default bg-black/45" tabindex="-1" aria-label="Close" (click)="up.later()"></button>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-title"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
        class="absolute top-[22%] left-1/2 z-[47] w-[440px] max-w-[calc(100%-32px)] -translate-x-1/2 rounded-[10px] border border-line2 bg-bg3 p-4 shadow-[0_24px_60px_var(--shd)]"
      >
        <div class="flex items-start gap-2.5">
          <span class="tile" style="--k: var(--acc)"><svg adIcon="zap"></svg></span>
          <div class="min-w-0 flex-1">
            @switch (s.status) {
              @case ('downloaded') {
                <div id="update-title" class="text-[13px] font-semibold">AgentDock {{ s.version }} is ready to install</div>
                <p class="mt-1 leading-normal text-tx2">Restart now to finish the update, or it installs the next time you close AgentDock.</p>
              }
              @case ('downloading') {
                <div id="update-title" class="text-[13px] font-semibold">Downloading AgentDock {{ s.version }}…</div>
                <div class="mt-2.5 h-1.5 overflow-hidden rounded-full bg-bg4" role="progressbar" [attr.aria-valuenow]="s.percent ?? 0" aria-valuemin="0" aria-valuemax="100">
                  <div class="h-full bg-acc transition-[width]" [style.width.%]="s.percent ?? 0"></div>
                </div>
                <p class="mt-1.5 text-[11.5px] text-tx3">{{ s.percent ?? 0 }}%</p>
              }
              @case ('error') {
                <div id="update-title" class="text-[13px] font-semibold">The update did not finish</div>
                <p class="mt-1 leading-normal text-tx2">{{ s.error }}</p>
              }
              @default {
                <div id="update-title" class="text-[13px] font-semibold">AgentDock {{ s.version }} is available</div>
                <p class="mt-1 leading-normal text-tx2">
                  You have {{ s.current }}.
                  @if (s.manualInstall) {
                    Downloading opens the release page, where you can get the new installer.
                  }
                </p>
                @if (s.notes) {
                  <div class="scr mt-2 max-h-[140px] overflow-y-auto rounded-md border border-line bg-bg1 p-2 text-[11.5px] whitespace-pre-line text-tx2">{{ s.notes }}</div>
                }
              }
            }
          </div>
        </div>
        <div class="mt-4 flex items-center justify-end gap-2">
          @switch (s.status) {
            @case ('downloaded') {
              <button class="bt" (click)="up.later()">On next launch</button>
              <button class="bt pr" cdkFocusInitial (click)="up.install()">Restart now</button>
            }
            @case ('downloading') {
              <button class="bt" cdkFocusInitial (click)="up.later()">Hide</button>
            }
            @case ('error') {
              <button class="bt" (click)="up.later()">Close</button>
              <button class="bt pr" cdkFocusInitial (click)="up.check()">Try again</button>
            }
            @default {
              <button class="bt gh" (click)="up.skip()">Skip this version</button>
              <button class="bt" (click)="up.later()">Later</button>
              <button class="bt pr" cdkFocusInitial (click)="up.download()">{{ s.manualInstall ? 'Open release page' : 'Download' }}</button>
            }
          }
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpdateDialog {
  protected readonly up = inject(UpdateStore);
}
