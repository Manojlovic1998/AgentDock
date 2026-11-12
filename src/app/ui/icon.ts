import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ICONS, IconName } from '../core/model/icons';

/** Stroke icon: `<svg adIcon="bot"></svg>`. Add class `s` for the 12px size. */
@Component({
  selector: 'svg[adIcon]',
  template: '<svg:path [attr.d]="d()" />',
  host: { class: 'ic', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Icon {
  readonly adIcon = input.required<IconName>();
  protected readonly d = computed(() => ICONS[this.adIcon()]);
}
