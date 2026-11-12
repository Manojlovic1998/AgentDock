import { Injectable, signal } from '@angular/core';
import { ActivityEntry } from '../model/types';

export interface Toast {
  msg: string;
  undo: boolean;
}

export type InspectorTab = 'ov' | 'cf' | 'sk' | 'src';
export type BottomTab = 'problems' | 'changes' | 'activity';

/** Transient interface state: selection, panels, overlays and toasts. */
@Injectable({ providedIn: 'root' })
export class UiStore {
  /** Selected resource ids. */
  readonly sel = signal<string[]>(['angular-developer']);
  readonly tab = signal<InspectorTab>('ov');
  readonly view = signal<'graph' | 'source'>('graph');
  /** Find-on-canvas query. */
  readonly q = signal('');
  /** Kind filters; a kind is visible unless explicitly set to false. */
  readonly filt = signal<Record<string, boolean>>({});

  readonly sideCollapsed = signal(false);
  readonly secOpen = signal<Record<string, boolean>>({ ws: true, res: true, tools: true });
  readonly inspOpen = signal(true);
  readonly inspW = signal(316);
  readonly bottomOpen = signal(false);
  readonly btab = signal<BottomTab>('problems');

  readonly palette = signal(false);
  readonly ctx = signal<{ id: string; x: number; y: number } | null>(null);
  readonly dialog = signal<string | null>(null);
  readonly toast = signal<Toast | null>(null);
  /** Selected file on the Changes screen. */
  readonly chSel = signal<string | null>(null);
  /** Session activity, newest first. */
  readonly log = signal<ActivityEntry[]>([]);

  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  isSelected(id: string): boolean {
    return this.sel().indexOf(id) >= 0;
  }

  /** Click selection; shift toggles membership. Re-selecting the same node keeps its tab. */
  select(id: string, shift = false): void {
    const cur = this.sel();
    const same = cur.length === 1 && cur[0] === id;
    if (shift) this.sel.set(cur.indexOf(id) >= 0 ? cur.filter((x) => x !== id) : cur.concat([id]));
    else this.sel.set([id]);
    this.inspOpen.set(true);
    this.ctx.set(null);
    if (!same) this.tab.set('ov');
  }

  showToast(msg: string, undo: boolean, ms: number): void {
    clearTimeout(this.toastTimer);
    this.toast.set({ msg, undo });
    this.toastTimer = setTimeout(() => this.toast.set(null), ms);
  }

  /** Short message without an undo affordance. */
  note(msg: string): void {
    this.ctx.set(null);
    this.showToast(msg, false, 4500);
  }

  record(msg: string): void {
    this.log.update((l) => [{ t: 'just now', msg }, ...l].slice(0, 30));
  }

  closeOverlays(): void {
    this.ctx.set(null);
    this.palette.set(false);
    this.dialog.set(null);
  }
}
