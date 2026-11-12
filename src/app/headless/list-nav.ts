import { Directive, effect, input, model, output } from '@angular/core';

/**
 * Headless keyboard navigation for a result list driven from a text input:
 * arrows move the active index, Enter commits it, Escape dismisses.
 */
@Directive({
  selector: 'input[adListNav]',
  host: {
    role: 'combobox',
    'aria-autocomplete': 'list',
    '[attr.aria-expanded]': 'count() > 0',
    '[attr.aria-activedescendant]': 'count() ? idPrefix() + active() : null',
    '(keydown)': 'key($event)',
  },
})
export class ListNav {
  /** Number of items currently in the list. */
  readonly count = input.required<number>({ alias: 'adListNav' });
  readonly idPrefix = input('opt-');
  readonly active = model(0);
  readonly commit = output<number>();
  readonly dismiss = output<void>();

  constructor() {
    // Keep the active index inside the list when it shrinks.
    effect(() => {
      const n = this.count();
      if (this.active() >= n) this.active.set(Math.max(0, n - 1));
    });
  }

  key(e: KeyboardEvent): void {
    const n = this.count();
    const move = (i: number) => {
      e.preventDefault();
      if (n) this.active.set((i + n) % n);
    };
    if (e.key === 'ArrowDown') move(this.active() + 1);
    else if (e.key === 'ArrowUp') move(this.active() - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(n - 1);
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (n) this.commit.emit(this.active());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.dismiss.emit();
    }
  }
}
