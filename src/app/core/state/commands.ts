import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { plural } from '../model/graph';
import { Kind, Problem } from '../model/types';
import { PrefsStore } from './prefs.store';
import { InspectorTab, UiStore } from './ui.store';
import { WorkspaceStore } from './workspace.store';

/** Resource list screen for each graph kind. */
export const KIND_SCREEN: Record<Kind, string> = {
  agent: 'agents',
  skill: 'skills',
  cmd: 'commands',
  rule: 'rules',
  mcp: 'mcp',
  mem: 'claudemd',
};

const TOP_LEVEL = ['overview', 'workspace', 'validation', 'changes', 'settings'];

/** Application commands that combine navigation with store updates. */
@Injectable({ providedIn: 'root' })
export class Commands {
  private readonly router = inject(Router);
  private readonly ui = inject(UiStore);
  private readonly ws = inject(WorkspaceStore);
  private readonly prefs = inject(PrefsStore);

  private readonly url = signal(this.router.url);
  /** Navigation id of the current screen: "workspace", "agents", "settings", ... */
  readonly screen = computed(() => {
    const path = this.url().split(/[?#]/)[0].replace(/^\//, '');
    return path.startsWith('resources/') ? path.slice('resources/'.length) : path || 'workspace';
  });

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.url.set(e.urlAfterRedirects);
    });
  }

  /** Route for a navigation id such as "overview" or "agents". */
  link(screen: string): string {
    return TOP_LEVEL.indexOf(screen) >= 0 ? '/' + screen : '/resources/' + screen;
  }

  go(screen: string): void {
    this.ui.closeOverlays();
    void this.router.navigateByUrl(this.link(screen));
  }

  /** Opens the visual workspace with one resource selected and shown in the inspector. */
  focusNode(id: string, tab: InspectorTab = 'ov'): void {
    this.ui.view.set('graph');
    this.ui.sel.set([id]);
    this.ui.inspOpen.set(true);
    this.ui.tab.set(tab);
    this.ui.q.set('');
    this.go('workspace');
  }

  openProblem(p: Problem): void {
    if (p.target && this.ws.model().by[p.target]) this.focusNode(p.target);
    else this.go(p.screen ?? 'validation');
  }

  addNode(type: 'agent' | 'skill'): void {
    const id = this.ws.addNode(type);
    this.focusNode(id, 'cf');
  }

  askDelete(id: string): void {
    this.ui.ctx.set(null);
    if (this.ws.confirmDelete) this.ui.dialog.set(id);
    else this.ws.remove(id);
  }

  runValidation(): void {
    this.go('validation');
    this.ws.announce(
      `Validation finished: ${plural(this.ws.errorCount(), 'error')}, ${plural(this.ws.warnCount(), 'warning')}`,
    );
  }

  openChange(id: string): void {
    this.ui.chSel.set(id);
    this.go('changes');
  }

  /** Opens the resource context menu at the pointer, kept inside the window. */
  openContext(id: string, e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (!this.ui.isSelected(id)) this.ui.sel.set([id]);
    this.ui.ctx.set({
      id,
      x: Math.max(4, Math.min(e.clientX, window.innerWidth - 240)),
      y: Math.max(4, Math.min(e.clientY, window.innerHeight - 250)),
    });
  }

  saveAll(): void {
    void this.ws.saveAll();
  }

  rescan(): void {
    void this.ws.rescan();
  }

  openFolder(): void {
    void this.ws.openFolder();
  }

  openPalette(): void {
    this.ui.ctx.set(null);
    this.ui.palette.set(true);
  }

  autoLayout(): void {
    this.ui.view.set('graph');
    this.go('workspace');
    this.ws.tidyLayout();
  }

  toggleTheme(): void {
    this.prefs.toggleTheme();
  }
}
