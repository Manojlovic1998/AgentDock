import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { SourceLine } from '../core/model/types';
import { PrefsStore } from '../core/state/prefs.store';

/** Read-only highlighted source with optional line numbers and wrapping. */
@Component({
  selector: 'ad-source-code',
  template: `
    @for (l of lines(); track l.no) {
      <div class="cl">
        <span class="ln" [style.width.px]="gutter()">{{ l.no }}</span>
        <span>
          @for (t of l.toks; track $index) {
            <span [class]="t.c">{{ t.t }}</span>
          }
        </span>
      </div>
    }
  `,
  host: {
    class: 'code block',
    '[class.wrap]': 'prefs.prefs().wrap',
    '[class.noln]': '!prefs.prefs().lineNo',
    '[style.font-size.px]': 'size()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceCode {
  protected readonly prefs = inject(PrefsStore);
  readonly lines = input.required<SourceLine[]>();
  readonly gutter = input(34);
  /** Fixed font size; when omitted the editor font size preference applies. */
  readonly fontSize = input<number | null>(null);

  protected readonly size = computed(() => this.fontSize() ?? this.prefs.codeSize());
}
