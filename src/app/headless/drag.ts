import { DOCUMENT } from '@angular/common';
import { Directive, OnDestroy, inject, input, output } from '@angular/core';

export interface DragDelta {
  /** Pointer travel since the press, in screen pixels. */
  dx: number;
  dy: number;
  shift: boolean;
}

/**
 * Headless pointer drag. Distinguishes a drag from a click with a movement threshold
 * and reports deltas; what moves, and how, is up to the host.
 */
@Directive({
  selector: '[adDrag]',
  host: { '(mousedown)': 'down($event)' },
})
export class Drag implements OnDestroy {
  private readonly doc = inject(DOCUMENT);

  readonly threshold = input(4);
  /** Stop the press from reaching ancestors (e.g. a node inside a pannable canvas). */
  readonly stopPress = input(true);

  readonly dragStart = output<DragDelta>();
  readonly dragMove = output<DragDelta>();
  readonly dragEnd = output<DragDelta>();
  /** Press and release without crossing the threshold. */
  readonly tap = output<DragDelta>();

  private origin: { x: number; y: number; shift: boolean; moved: boolean } | null = null;

  private readonly onMove = (e: MouseEvent) => {
    const o = this.origin;
    if (!o) return;
    const delta = { dx: e.clientX - o.x, dy: e.clientY - o.y, shift: o.shift };
    if (!o.moved) {
      if (Math.abs(delta.dx) + Math.abs(delta.dy) < this.threshold()) return;
      o.moved = true;
      this.dragStart.emit(delta);
    }
    this.dragMove.emit(delta);
  };

  private readonly onUp = (e: MouseEvent) => {
    const o = this.origin;
    this.release();
    if (!o) return;
    const delta = { dx: e.clientX - o.x, dy: e.clientY - o.y, shift: o.shift };
    if (o.moved) this.dragEnd.emit(delta);
    else this.tap.emit(delta);
  };

  down(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (this.stopPress()) e.stopPropagation();
    this.origin = { x: e.clientX, y: e.clientY, shift: e.shiftKey, moved: false };
    this.doc.addEventListener('mousemove', this.onMove);
    this.doc.addEventListener('mouseup', this.onUp);
  }

  private release(): void {
    this.origin = null;
    this.doc.removeEventListener('mousemove', this.onMove);
    this.doc.removeEventListener('mouseup', this.onUp);
  }

  ngOnDestroy(): void {
    this.release();
  }
}
