import { Directive, input } from '@angular/core';

/** Tooltip on hover. Placement: below (default), above, and optionally right-aligned. */
@Directive({
  selector: '[adTip]',
  host: {
    class: 'tp',
    '[attr.data-tip]': 'adTip()',
    '[class.tu]': 'tipAbove()',
    '[class.tr]': 'tipEnd()',
  },
})
export class Tip {
  readonly adTip = input.required<string>();
  readonly tipAbove = input(false);
  readonly tipEnd = input(false);
}
