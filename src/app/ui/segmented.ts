import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconName } from '../core/model/icons';
import { Icon } from './icon';

export interface SegOption<T extends string = string> {
  value: T;
  label: string;
  icon?: IconName;
}

/** Single-choice segmented control with arrow-key navigation. */
@Component({
  selector: 'ad-segmented',
  imports: [Icon],
  template: `
    @for (o of options(); track o.value) {
      <button
        type="button"
        role="radio"
        [class.on]="o.value === value()"
        [class.font-mono]="mono()"
        [attr.aria-checked]="o.value === value()"
        [attr.tabindex]="o.value === value() ? 0 : -1"
        (click)="valueChange.emit(o.value)"
        (keydown)="key($event, $index)"
      >
        @if (o.icon) {
          <svg [adIcon]="o.icon" class="s"></svg>
        }
        {{ o.label }}
      </button>
    }
  `,
  host: { class: 'seg', role: 'radiogroup' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Segmented<T extends string = string> {
  readonly options = input.required<SegOption<T>[]>();
  readonly value = input.required<T>();
  readonly mono = input(false);
  readonly valueChange = output<T>();

  protected key(e: KeyboardEvent, i: number): void {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const opts = this.options();
    const next = (i + step + opts.length) % opts.length;
    this.valueChange.emit(opts[next].value);
    const buttons = (e.currentTarget as HTMLElement).parentElement?.querySelectorAll('button');
    (buttons?.[next] as HTMLElement | undefined)?.focus();
  }
}
