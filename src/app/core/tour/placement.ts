import { Side } from './tour.types';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  x: number;
  y: number;
  /** Side of the target the card sits on; "center" when it does not point at an edge. */
  side: Side | 'center';
  /** Offset of the arrow along the card edge that faces the target. */
  arrow: number;
}

/** Distance between the target and the card. */
export const GAP = 12;
/** Space kept between the card and the viewport edge. */
export const MARGIN = 8;
/** Closest the arrow gets to a card corner. */
const ARROW_INSET = 16;

const ORDER: Record<Side, Side[]> = {
  bottom: ['bottom', 'top', 'right', 'left'],
  top: ['top', 'bottom', 'right', 'left'],
  right: ['right', 'left', 'bottom', 'top'],
  left: ['left', 'right', 'bottom', 'top'],
};

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(v, Math.max(min, max)));

/**
 * Position of a coach mark card next to its target, in viewport coordinates.
 * Tries the preferred side, then the opposite one, then the other axis. A target that leaves
 * no room on any side (the canvas) gets the card inside it, along its bottom edge.
 */
export function placeCard(target: Box | null, card: Size, viewport: Size, preferred: Side = 'bottom'): Placement {
  const fitX = (x: number) => Math.round(clamp(x, MARGIN, viewport.width - card.width - MARGIN));
  const fitY = (y: number) => Math.round(clamp(y, MARGIN, viewport.height - card.height - MARGIN));

  if (!target) {
    return { x: fitX((viewport.width - card.width) / 2), y: fitY((viewport.height - card.height) / 2), side: 'center', arrow: 0 };
  }

  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const cx = target.left + target.width / 2;
  const cy = target.top + target.height / 2;
  const room: Record<Side, number> = {
    top: target.top - card.height,
    bottom: viewport.height - bottom - card.height,
    left: target.left - card.width,
    right: viewport.width - right - card.width,
  };
  const side = ORDER[preferred].find((s) => room[s] >= GAP + MARGIN);

  if (!side) return { x: fitX(cx - card.width / 2), y: fitY(bottom - card.height - 16), side: 'center', arrow: 0 };

  if (side === 'top' || side === 'bottom') {
    const x = fitX(cx - card.width / 2);
    const y = Math.round(side === 'bottom' ? bottom + GAP : target.top - GAP - card.height);
    return { x, y, side, arrow: Math.round(clamp(cx - x, ARROW_INSET, card.width - ARROW_INSET)) };
  }
  const y = fitY(cy - card.height / 2);
  const x = Math.round(side === 'right' ? right + GAP : target.left - GAP - card.width);
  return { x, y, side, arrow: Math.round(clamp(cy - y, ARROW_INSET, card.height - ARROW_INSET)) };
}
