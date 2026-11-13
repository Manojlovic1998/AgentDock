import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { TourCtx, TourDef } from '../tour/tour.types';
import { TOURS } from '../tour/tours';
import { Commands } from './commands';
import { PrefsStore } from './prefs.store';
import { UiStore } from './ui.store';
import { WorkspaceStore } from './workspace.store';

/** Pause after an action step is satisfied, so the user sees the result of what they did. */
const SETTLE_MS = 450;

/**
 * The running product tour or walkthrough. Steps are data (`core/tour/tours.ts`); this store
 * moves through them and advances action steps when the user has done what they ask.
 */
@Injectable({ providedIn: 'root' })
export class TourStore {
  private readonly ui = inject(UiStore);
  private readonly prefs = inject(PrefsStore);
  private readonly ctx: TourCtx = { ui: this.ui, ws: inject(WorkspaceStore), cmd: inject(Commands) };

  /** Tours the user can start, in menu order. */
  readonly list = TOURS.filter((t) => t.kind !== 'offer');

  readonly active = signal<TourDef | null>(null);
  readonly index = signal(0);
  readonly step = computed(() => this.active()?.steps[this.index()] ?? null);
  readonly isLast = computed(() => this.index() === (this.active()?.steps.length ?? 0) - 1);

  /** Baseline of the current step, see `TourStep.snapshot`. */
  private snapshot: unknown;
  /** Bumped whenever a step is entered, so the watcher below starts over. */
  private readonly entered = signal(0);
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Action steps: every store is a signal, so "has the user done it yet" is an effect.
    effect(() => {
      this.entered();
      const step = this.step();
      clearTimeout(this.timer);
      if (!step?.done?.(this.ctx, this.snapshot)) return;
      this.timer = setTimeout(() => this.next(), step.settle ?? SETTLE_MS);
    });
  }

  isDone(id: string): boolean {
    return this.prefs.prefs().toursDone.indexOf(id) >= 0;
  }

  /** Why a tour cannot run in the current workspace, or null. */
  blocked(def: TourDef): string | null {
    return def.available?.(this.ctx) ?? null;
  }

  /** Starts a tour from its first step. Returns false, with a note, when it cannot run. */
  start(id: string): boolean {
    const def = TOURS.find((t) => t.id === id);
    if (!def) return false;
    const reason = this.blocked(def);
    if (reason) {
      this.ui.note(reason);
      return false;
    }
    this.active.set(def);
    this.enter(0, 1);
    return true;
  }

  next(): void {
    if (this.active()) this.enter(this.index() + 1, 1);
  }

  back(): void {
    if (this.active() && this.index() > 0) this.enter(this.index() - 1, -1);
  }

  /** Ends the tour without marking it completed. */
  stop(): void {
    clearTimeout(this.timer);
    this.active.set(null);
  }

  /** Closes the first-run invitation, for example when the user opens Help themselves. */
  dismissOffer(): void {
    if (this.active()?.kind === 'offer') this.stop();
  }

  /** Shows the invitation to take the tour, the first time the app is used. */
  offerOnce(): void {
    if (this.prefs.prefs().tourOffered) return;
    this.prefs.set('tourOffered', true);
    this.start('welcome');
  }

  /**
   * Moves to step `i`, or past it in direction `dir` while steps are already satisfied
   * (the user is on the Changes screen when a step asks to open it).
   */
  private enter(i: number, dir: 1 | -1): void {
    const def = this.active();
    if (!def) return;
    clearTimeout(this.timer);
    this.ui.closeOverlays();
    for (; i >= 0 && i < def.steps.length; i += dir) {
      const step = def.steps[i];
      step.prepare?.(this.ctx);
      const snapshot = step.snapshot?.(this.ctx);
      if (step.done?.(this.ctx, snapshot)) continue;
      this.snapshot = snapshot;
      this.index.set(i);
      this.entered.update((n) => n + 1);
      return;
    }
    if (dir === 1) this.finish(def);
  }

  private finish(def: TourDef): void {
    this.stop();
    if (def.kind === 'offer') {
      if (def.then) this.start(def.then);
      return;
    }
    if (!this.isDone(def.id)) this.prefs.set('toursDone', this.prefs.prefs().toursDone.concat([def.id]));
    this.ui.note(def.kind === 'tour' ? 'Tour finished. Walkthroughs are in the Help menu' : `Walkthrough finished: ${def.title}`);
    if (def.then) this.start(def.then);
  }
}
