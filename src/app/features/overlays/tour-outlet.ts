import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { TourStore } from '../../core/state/tour.store';
import { Box } from '../../core/tour/placement';
import { CoachMark } from './coach-mark';

/** How long a step waits for its target to render before it is shown centred instead. */
const MISSING_MS = 600;

const same = (a: Box | null, b: Box | null): boolean =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

const box = (r: DOMRect): Box => ({ left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });

/** Scrolls the app's own scroll containers so the target is visible. */
function reveal(el: Element): void {
  const scroller = el.parentElement?.closest('.scr');
  if (!scroller) return;
  const a = el.getBoundingClientRect();
  const b = scroller.getBoundingClientRect();
  if (a.top < b.top) scroller.scrollTop -= b.top - a.top + 8;
  else if (a.bottom > b.bottom) scroller.scrollTop += a.bottom - b.bottom + 8;
}

/** Shows the current tour step as a coach mark and keeps it on its target. */
@Component({
  selector: 'ad-tour-outlet',
  imports: [CoachMark],
  template: `
    @if (tour.step(); as s) {
      @if (shown(); as v) {
        <ad-coach-mark
          [rect]="v.rect"
          [beside]="v.beside"
          [title]="s.title"
          [body]="s.body"
          [placement]="s.placement ?? 'bottom'"
          [progress]="labels().progress"
          [dim]="labels().modal"
          [pulse]="!!s.done || labels().offer"
          [hint]="s.done ? 'Your turn' : ''"
          [nextLabel]="labels().next"
          [backLabel]="labels().back"
          [skipLabel]="labels().skip"
          [autoFocus]="labels().modal"
          (next)="tour.next()"
          (back)="tour.back()"
          (skip)="labels().offer ? tour.stop() : tour.next()"
          (dismiss)="tour.stop()"
        />
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TourOutlet {
  protected readonly tour = inject(TourStore);
  private readonly doc = inject(DOCUMENT);

  /** Where the target is. Null until it is found or given up on, so the card does not jump. */
  protected readonly shown = signal<{ rect: Box | null; beside: Box | null } | null>(null);

  protected readonly labels = computed(() => {
    const def = this.tour.active();
    const step = this.tour.step();
    if (!def || !step) return { progress: '', modal: false, offer: false, next: '', back: '', skip: '' };
    const offer = def.kind === 'offer';
    const n = def.steps.length;
    return {
      progress: n > 1 ? `${this.tour.index() + 1} of ${n}` : '',
      modal: def.kind === 'tour',
      offer,
      next: step.done ? '' : (step.nextLabel ?? (this.tour.isLast() ? 'Done' : 'Next')),
      back: this.tour.index() > 0 ? 'Back' : '',
      skip: offer ? 'Not now' : step.done ? 'Skip step' : '',
    };
  });

  constructor() {
    // Follow the target every frame: it moves when the canvas pans, a panel resizes or a route renders.
    effect((onCleanup) => {
      const step = this.tour.step();
      untracked(() => this.shown.set(null));
      if (!step) return;
      const selector = step.target ? `[data-tour="${step.target}"]` : null;
      let frame = 0;
      let lastSeen = performance.now();
      let revealed = false;
      const tick = () => {
        frame = requestAnimationFrame(tick);
        const el = selector ? this.doc.querySelector(selector) : null;
        const r = el?.getBoundingClientRect();
        if (el && r && (r.width || r.height)) {
          lastSeen = performance.now();
          if (!revealed) {
            revealed = true;
            reveal(el);
            return;
          }
          const side = step.beside ? this.doc.querySelector(`[data-tour="${step.beside}"]`)?.getBoundingClientRect() : null;
          this.show(box(r), side ? box(side) : null);
        } else if (!selector || performance.now() - lastSeen > MISSING_MS) {
          this.show(null, null);
        }
      };
      // Untracked: the loop reads and writes `shown`, which must not re-run this effect.
      untracked(tick);
      onCleanup(() => cancelAnimationFrame(frame));
    });
  }

  private show(rect: Box | null, beside: Box | null): void {
    const cur = this.shown();
    if (!cur || !same(cur.rect, rect) || !same(cur.beside, beside)) this.shown.set({ rect, beside });
  }
}
