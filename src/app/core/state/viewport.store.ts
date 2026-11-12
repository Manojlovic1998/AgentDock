import { Injectable, signal } from '@angular/core';
import { Point, Rect } from '../model/types';

export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 2;

const clampZoom = (z: number): number => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

/** Canvas camera (zoom + pan), manual node positions and in-flight drag state. */
@Injectable({ providedIn: 'root' })
export class ViewportStore {
  readonly zoom = signal(0.83);
  readonly px = signal(4);
  readonly py = signal(12);
  /** Manually placed nodes; everything else follows the automatic layout. */
  readonly pos = signal<Record<string, Point>>({});
  readonly dragId = signal<string | null>(null);
  readonly dropId = signal<string | null>(null);
  readonly panning = signal(false);
  /** Size of the canvas viewport in pixels. */
  readonly vw = signal(900);
  readonly vh = signal(780);
  /** Whether the canvas has been fitted to its content once. */
  fitted = false;

  setSize(w: number, h: number): void {
    if (w > 0 && h > 0) {
      this.vw.set(w);
      this.vh.set(h);
    }
  }

  fit(b: Rect): void {
    const vw = this.vw();
    const vh = this.vh();
    this.fitted = true;
    const z = Math.max(ZOOM_MIN, Math.min((vw - 16) / b.w, (vh - 56) / b.h, 1.2));
    this.zoom.set(z);
    this.px.set((vw - b.w * z) / 2 - b.x * z);
    this.py.set((vh - 30 - b.h * z) / 2 - b.y * z);
  }

  /** Zooms around the viewport centre. A factor of 0 resets to 100%. */
  zoomBy(f: number): void {
    this.zoomAt(this.vw() / 2, this.vh() / 2, f === 0 ? 1 : this.zoom() * f);
  }

  /** Zooms around a viewport point so the content under the cursor stays put. */
  zoomAt(x: number, y: number, target: number): void {
    const z0 = this.zoom();
    const z1 = clampZoom(target);
    this.px.set(x - ((x - this.px()) * z1) / z0);
    this.py.set(y - ((y - this.py()) * z1) / z0);
    this.zoom.set(z1);
  }

  panTo(x: number, y: number): void {
    this.px.set(x);
    this.py.set(y);
  }

  place(id: string, p: Point): void {
    this.pos.update((all) => ({ ...all, [id]: p }));
  }

  /** Restores a node to a previous manual position, or back to the automatic layout. */
  restore(id: string, p: Point | undefined): void {
    this.pos.update((all) => {
      const next = { ...all };
      if (p) next[id] = p;
      else delete next[id];
      return next;
    });
  }

  endDrag(): void {
    this.dragId.set(null);
    this.dropId.set(null);
  }
}
