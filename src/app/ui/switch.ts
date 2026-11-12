import { Directive, input } from '@angular/core';

/** On/off switch: `<button adSwitch [checked]="on" (click)="toggle()">`. */
@Directive({
  selector: 'button[adSwitch]',
  host: {
    class: 'sw',
    type: 'button',
    role: 'switch',
    '[class.on]': 'checked()',
    '[attr.aria-checked]': 'checked()',
  },
})
export class Switch {
  readonly checked = input.required<boolean>();
}
