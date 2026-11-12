import { Menu } from '@angular/aria/menu';
import { DOCUMENT } from '@angular/common';
import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/**
 * Closes an Angular Aria menu when the pointer goes down outside it.
 * Presses on a menu trigger are left alone so the trigger can toggle its own menu.
 */
@Directive({ selector: '[ngMenu][adMenuDismiss]' })
export class MenuDismiss {
  private readonly menu = inject<Menu<unknown>>(Menu);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    const doc = inject(DOCUMENT);
    const onPress = (e: MouseEvent) => {
      if (!this.menu.visible()) return;
      const target = e.target as Element | null;
      if (target && (this.el.contains(target) || target.closest('[ngMenuTrigger]'))) return;
      this.menu.close();
    };
    // Capture phase: canvas nodes stop mousedown from bubbling while they are dragged.
    doc.addEventListener('mousedown', onPress, true);
    inject(DestroyRef).onDestroy(() => doc.removeEventListener('mousedown', onPress, true));
  }
}
