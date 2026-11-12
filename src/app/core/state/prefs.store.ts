import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';

export type Theme = 'dark' | 'light';
export type Accent = 'ember' | 'iris' | 'mint' | 'sky';

export interface Prefs {
  grid: boolean;
  mini: boolean;
  edge: 'curved' | 'orth';
  dim: boolean;
  snap: boolean;
  density: 'compact' | 'roomy';
  fontSize: string;
  wrap: boolean;
  lineNo: boolean;
  fmt: boolean;
  autosave: boolean;
  confirm: boolean;
  /** Project folder to scan; empty shows the sample workspace. */
  root: string;
  /** Previously opened project folders, newest first. */
  recent: string[];
  scanUser: boolean;
  scanPlugins: boolean;
  managed: boolean;
  watch: boolean;
  ignore: string;
}

export type BoolPref = { [K in keyof Prefs]: Prefs[K] extends boolean ? K : never }[keyof Prefs];
export type TextPref = 'fontSize' | 'root' | 'ignore';

const DEFAULTS: Prefs = {
  grid: true,
  mini: true,
  edge: 'curved',
  dim: true,
  snap: false,
  density: 'compact',
  fontSize: '12',
  wrap: false,
  lineNo: true,
  fmt: true,
  autosave: false,
  confirm: true,
  root: '',
  recent: [],
  scanUser: true,
  scanPlugins: true,
  managed: false,
  watch: true,
  ignore: 'node_modules, dist, .nx',
};

const KEY = 'agentdock.prefs.v1';

interface Stored {
  theme: Theme;
  accent: Accent;
  prefs: Prefs;
}

/** Default project root of earlier builds, which only named the sample workspace. */
const SAMPLE_ROOT = '~/code/acme-platform';

function read(): Partial<Stored> {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Stored>;
    if (stored.prefs?.root === SAMPLE_ROOT) stored.prefs.root = '';
    return stored;
  } catch {
    return {};
  }
}

/** User preferences: appearance, editor, graph, workspace and discovery. Persisted locally. */
@Injectable({ providedIn: 'root' })
export class PrefsStore {
  private readonly doc = inject(DOCUMENT);
  private readonly stored = read();

  readonly theme = signal<Theme>(this.stored.theme ?? 'dark');
  readonly accent = signal<Accent>(this.stored.accent ?? 'ember');
  readonly prefs = signal<Prefs>({ ...DEFAULTS, ...(this.stored.prefs ?? {}) });

  /** Source and diff font size in pixels, clamped to a readable range. */
  readonly codeSize = computed(() => Math.max(10, Math.min(18, parseFloat(this.prefs().fontSize) || 12)));

  constructor() {
    effect(() => {
      const root = this.doc.documentElement;
      root.dataset['theme'] = this.theme();
      root.dataset['accent'] = this.accent();
      root.classList.toggle('roomy', this.prefs().density === 'roomy');
      try {
        localStorage.setItem(KEY, JSON.stringify({ theme: this.theme(), accent: this.accent(), prefs: this.prefs() }));
      } catch {
        /* storage unavailable: preferences stay in memory */
      }
    });
  }

  set<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
    this.prefs.update((p) => ({ ...p, [key]: value }));
  }

  toggleTheme(): void {
    this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
  }
}
