import type { Commands } from '../state/commands';
import type { UiStore } from '../state/ui.store';
import type { WorkspaceStore } from '../state/workspace.store';

export type Side = 'top' | 'bottom' | 'left' | 'right';

/** What a step may read and drive: the same stores and commands the screens use. */
export interface TourCtx {
  ui: UiStore;
  ws: WorkspaceStore;
  cmd: Commands;
}

export interface TourStep {
  title: string;
  body: string;
  /** `data-tour` id of the element to point at; without one the card is centred. */
  target?: string;
  /** Preferred side of the target for the card. It flips when there is no room. */
  placement?: Side;
  /**
   * `data-tour` id of an element to put the card next to instead of the target, for a target
   * that opens a menu the card would otherwise cover.
   */
  beside?: string;
  /** Brings the app into the state the step describes: navigate, open a panel, select. */
  prepare?(ctx: TourCtx): void;
  /** Baseline taken when the step is entered, handed to `done`. */
  snapshot?(ctx: TourCtx): unknown;
  /**
   * Makes this an action step: it has no Next button and advances once this returns true.
   * A step that is already satisfied when it is entered is skipped.
   */
  done?(ctx: TourCtx, snapshot: unknown): boolean;
  /** Quiet time in ms after `done` turns true before advancing (longer for typing). */
  settle?: number;
  /** Label of the primary button; defaults to "Next", or "Done" on the last step. */
  nextLabel?: string;
}

export interface TourDef {
  id: string;
  title: string;
  /**
   * tour: read-only, dims the app and blocks clicks outside the card.
   * walkthrough: the app stays usable and action steps wait for the user.
   * offer: a single non-blocking card, such as the first-run invitation.
   */
  kind: 'tour' | 'walkthrough' | 'offer';
  steps: TourStep[];
  /** Why the tour cannot run right now, or null when it can. */
  available?(ctx: TourCtx): string | null;
  /** Tour started when this one is finished with its primary button. */
  then?: string;
}
