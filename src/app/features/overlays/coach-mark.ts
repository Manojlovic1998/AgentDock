import { ChangeDetectionStrategy, Component, ElementRef, afterEveryRender, computed, input, output, signal, viewChild } from '@angular/core';
import { Box, Size, placeCard } from '../../core/tour/placement';
import { Side } from '../../core/tour/tour.types';
import { Icon } from '../../ui/icon';

/** Space between the target and the ring drawn around it. */
const RING_PAD = 4;

const viewportSize = (): Size => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * A highlight ring around one element with a card that explains it.
 * Presentational: it is told where the target is and reports which button was pressed.
 */
@Component({
  selector: 'ad-coach-mark',
  imports: [Icon],
  template: `
    @if (dim()) {
      <div class="cm-block no-drag"></div>
      <div class="cm-dim" [style.clip-path]="hole()"></div>
    }
    @if (ring(); as r) {
      <div
        class="cm-ring"
        [class.pulse]="pulse()"
        [style.left.px]="r.left"
        [style.top.px]="r.top"
        [style.width.px]="r.width"
        [style.height.px]="r.height"
      ></div>
    }
    <div
      #card
      class="cm-card no-drag"
      role="dialog"
      aria-labelledby="coach-title"
      aria-describedby="coach-body"
      [style.left.px]="place().x"
      [style.top.px]="place().y"
      [style.visibility]="measured() ? 'visible' : 'hidden'"
    >
      @if (place().side !== 'center') {
        <span
          class="cm-arrow"
          [class]="place().side"
          [style.left.px]="vertical() ? place().arrow : null"
          [style.top.px]="vertical() ? null : place().arrow"
        ></span>
      }
      <div class="flex items-start gap-2">
        <div id="coach-title" class="min-w-0 flex-1 text-[13px] leading-[1.35] font-semibold">{{ title() }}</div>
        <button class="ib -mt-1.5 -mr-1.5" aria-label="Close" (click)="dismiss.emit()"><svg adIcon="x"></svg></button>
      </div>
      <p id="coach-body" class="mt-1 mb-0 leading-normal text-tx2" aria-live="polite">{{ body() }}</p>
      <div class="mt-3 flex min-h-[26px] items-center gap-1.5">
        <span class="font-mono text-[11px] whitespace-nowrap text-tx3">{{ progress() }}</span>
        <span class="flex-1"></span>
        @if (hint()) {
          <span class="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-tx3"><span class="cm-wait"></span>{{ hint() }}</span>
        }
        @if (backLabel()) {
          <button class="bt gh" (click)="back.emit()">{{ backLabel() }}</button>
        }
        @if (skipLabel()) {
          <button class="bt gh" (click)="skip.emit()">{{ skipLabel() }}</button>
        }
        @if (nextLabel()) {
          <button #primary class="bt pr" (click)="next.emit()">{{ nextLabel() }}</button>
        }
      </div>
    </div>
  `,
  host: { '(window:resize)': 'viewport.set(size())' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoachMark {
  /** Target in viewport coordinates; null centres the card with nothing highlighted. */
  readonly rect = input<Box | null>(null);
  /** Places the card next to this box instead of the target, to keep the target's surroundings free. */
  readonly beside = input<Box | null>(null);
  readonly title = input.required<string>();
  readonly body = input.required<string>();
  /** Step counter, such as "2 of 9". */
  readonly progress = input('');
  readonly placement = input<Side>('bottom');
  /** Darkens everything but the target and blocks clicks outside the card. */
  readonly dim = input(false);
  /** Animates the ring to invite a click on the target. */
  readonly pulse = input(false);
  /** Shown instead of a primary button while waiting for the user to act. */
  readonly hint = input('');
  /** Button labels; an empty label hides the button. */
  readonly nextLabel = input('');
  readonly backLabel = input('');
  readonly skipLabel = input('');
  /** Moves keyboard focus to the primary button once the card is shown. */
  readonly autoFocus = input(false);

  readonly next = output<void>();
  readonly back = output<void>();
  readonly skip = output<void>();
  readonly dismiss = output<void>();

  private readonly card = viewChild.required<ElementRef<HTMLElement>>('card');
  private readonly primary = viewChild<ElementRef<HTMLElement>>('primary');
  private readonly cardSize = signal<Size>({ width: 0, height: 0 });
  protected readonly viewport = signal<Size>(viewportSize());
  protected readonly size = viewportSize;
  private focused = false;

  protected readonly ring = computed<Box | null>(() => {
    const r = this.rect();
    return r && { left: r.left - RING_PAD, top: r.top - RING_PAD, width: r.width + 2 * RING_PAD, height: r.height + 2 * RING_PAD };
  });
  /** The dim layer with the target cut out of it; everything is dimmed when there is no target. */
  protected readonly hole = computed(() => {
    const r = this.ring();
    if (!r) return null;
    const [l, t, rt, b] = [r.left, r.top, r.left + r.width, r.top + r.height].map((v) => v + 'px');
    return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l} ${t}, ${rt} ${t}, ${rt} ${b}, ${l} ${b}, ${l} ${t})`;
  });
  /** With `beside`, the card sits next to that box and does not point at the target. */
  private readonly anchor = computed(() => this.beside() ?? this.ring());
  protected readonly place = computed(() => {
    const p = placeCard(this.anchor(), this.cardSize(), this.viewport(), this.placement());
    return this.beside() ? { ...p, side: 'center' as const } : p;
  });
  /** The card is positioned from its own size, so it stays hidden until that is known. */
  protected readonly measured = computed(() => this.cardSize().width > 0);
  protected readonly vertical = computed(() => this.place().side === 'top' || this.place().side === 'bottom');

  constructor() {
    afterEveryRender(() => {
      const el = this.card().nativeElement;
      const size = this.cardSize();
      if (el.offsetWidth !== size.width || el.offsetHeight !== size.height) {
        this.cardSize.set({ width: el.offsetWidth, height: el.offsetHeight });
      } else if (this.autoFocus() && !this.focused && size.width) {
        this.focused = true;
        this.primary()?.nativeElement.focus({ preventScroll: true });
      }
    });
  }
}
