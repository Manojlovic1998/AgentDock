import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HOOK_EVENTS } from '../../core/model/hooks';
import { UiStore } from '../../core/state/ui.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { Icon } from '../../ui/icon';

/** Add a hook to a settings file, or change one. The edit is pending until saved, like any other. */
@Component({
  selector: 'ad-hook-dialog',
  imports: [Icon, CdkTrapFocus],
  template: `
    <button class="absolute inset-0 z-[46] cursor-default bg-black/45" tabindex="-1" aria-label="Cancel" (click)="cancel()"></button>
    <form
      role="dialog"
      aria-modal="true"
      aria-labelledby="hook-title"
      cdkTrapFocus
      [cdkTrapFocusAutoCapture]="true"
      class="absolute top-[20%] left-1/2 z-[47] w-[460px] max-w-[calc(100%-32px)] -translate-x-1/2 rounded-[10px] border border-line2 bg-bg3 p-4 shadow-[0_24px_60px_var(--shd)]"
      (submit)="$event.preventDefault(); save()"
    >
      <div class="flex items-center gap-2.5">
        <span class="tile" style="--k: var(--acc)"><svg adIcon="hook"></svg></span>
        <div id="hook-title" class="flex-1 text-[13px] font-semibold">{{ editing ? 'Edit hook' : 'New hook' }}</div>
      </div>
      <div class="mt-3 flex flex-col gap-2.5">
        <label class="flex flex-col gap-1">
          <span class="text-[11px] text-tx2">Settings file</span>
          <select class="inp font-mono !text-[11.5px]" [value]="file()" (change)="file.set($any($event.target).value)">
            @for (f of files(); track f) {
              <option [value]="f" [selected]="f === file()">{{ f }}</option>
            }
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-[11px] text-tx2">Event</span>
          <select class="inp font-mono !text-[11.5px]" [value]="event()" (change)="event.set($any($event.target).value)">
            @for (e of events; track e) {
              <option [value]="e" [selected]="e === event()">{{ e }}</option>
            }
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-[11px] text-tx2">Matcher</span>
          <input class="inp font-mono !text-[11.5px]" placeholder="Edit|Write" [value]="matcher()" (input)="matcher.set($any($event.target).value)" />
          <span class="text-[11px] text-tx3">Tool names the hook applies to. Leave empty for every tool.</span>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-[11px] text-tx2">Command</span>
          <input
            class="inp font-mono !text-[11.5px]"
            placeholder='bash "$CLAUDE_PROJECT_DIR/scripts/lint.sh"'
            [value]="command()"
            (input)="command.set($any($event.target).value)"
          />
        </label>
      </div>
      <div class="mt-4 flex items-center justify-end gap-2">
        <button type="button" class="bt" (click)="cancel()">Cancel</button>
        <button type="submit" class="bt pr" [disabled]="!command().trim()">{{ editing ? 'Apply' : 'Add hook' }}</button>
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HookDialog {
  private readonly ui = inject(UiStore);
  private readonly ws = inject(WorkspaceStore);

  protected readonly events = HOOK_EVENTS;
  private readonly target = this.ui.hook();
  private readonly current = this.target?.at ? this.ws.hooks().find((h) => h.file === this.target!.file && h.at.event === this.target!.at!.event && h.at.group === this.target!.at!.group && h.at.index === this.target!.at!.index) : undefined;

  protected readonly editing = !!this.current;
  protected readonly file = signal(this.target?.file ?? this.ws.hookFiles()[0]);
  protected readonly event = signal(this.current?.event ?? 'PostToolUse');
  protected readonly matcher = signal(this.current?.matcher ?? '');
  protected readonly command = signal(this.current?.command ?? '');

  /** Files the hook can go to: the usual three, plus any other writable settings file. */
  protected readonly files = computed(() => {
    const extra = this.ws.docs().filter((d) => d.kind === 'settings' && d.writable).map((d) => d.file);
    return [...new Set([...this.ws.hookFiles(), ...extra, this.target?.file ?? ''].filter(Boolean))];
  });

  protected save(): void {
    const command = this.command().trim();
    if (!command) return;
    const ok = this.ws.saveHook(this.file(), this.current?.at ?? null, { event: this.event(), matcher: this.matcher(), command }, this.target?.file);
    if (ok) this.ui.hook.set(null);
  }

  protected cancel(): void {
    this.ui.hook.set(null);
  }
}
