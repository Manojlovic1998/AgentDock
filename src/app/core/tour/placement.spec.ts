import { GAP, MARGIN, placeCard } from './placement';

const viewport = { width: 1000, height: 700 };
const card = { width: 300, height: 120 };

describe('placeCard', () => {
  it('centres the card when there is no target', () => {
    expect(placeCard(null, card, viewport)).toEqual({ x: 350, y: 290, side: 'center', arrow: 0 });
  });

  it('puts the card on the preferred side, centred on the target', () => {
    const p = placeCard({ left: 450, top: 100, width: 100, height: 30 }, card, viewport, 'bottom');
    expect(p).toEqual({ x: 350, y: 130 + GAP, side: 'bottom', arrow: 150 });
  });

  it('flips to the opposite side when the preferred one has no room', () => {
    const p = placeCard({ left: 450, top: 640, width: 100, height: 30 }, card, viewport, 'bottom');
    expect(p.side).toBe('top');
    expect(p.y).toBe(640 - GAP - card.height);
  });

  it('falls back to the other axis for a target as tall as the window', () => {
    const p = placeCard({ left: 0, top: 38, width: 220, height: 640 }, card, viewport, 'bottom');
    expect(p.side).toBe('right');
    expect(p.x).toBe(220 + GAP);
  });

  it('keeps the card inside the viewport and the arrow on the target', () => {
    const p = placeCard({ left: 960, top: 6, width: 26, height: 26 }, card, viewport, 'bottom');
    expect(p.x).toBe(viewport.width - card.width - MARGIN);
    expect(p.x + p.arrow).toBe(973);
  });

  it('keeps the arrow away from the card corners', () => {
    const p = placeCard({ left: 990, top: 300, width: 8, height: 8 }, card, viewport, 'bottom');
    expect(p.arrow).toBe(card.width - 16);
  });

  it('places the card inside a target that fills the window', () => {
    const p = placeCard({ left: 100, top: 60, width: 880, height: 620 }, card, viewport, 'bottom');
    expect(p.side).toBe('center');
    expect(p.y + card.height).toBeLessThan(680);
    expect(p.x).toBe(390);
  });
});
