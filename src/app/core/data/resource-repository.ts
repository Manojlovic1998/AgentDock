import { Injectable, inject } from '@angular/core';
import { CopyItem, CopyResult, FileOp, SaveResult, WorkspaceSnapshot } from '../model/types';
import { PrefsStore } from '../state/prefs.store';
import { AgentDockBridge } from '../window-controls';
import { buildSnapshot, hookScripts } from './build-snapshot';
import { ACME_SNAPSHOT } from './mock-data';

/**
 * Source of workspace configuration. The UI only depends on this contract: the sample data and
 * the real `.claude/` scan through Electron are two implementations of it.
 */
export abstract class ResourceRepository {
  /** Whether a native folder picker is available. */
  abstract readonly desktop: boolean;
  /** Whether the loaded snapshot is backed by files, so that saving writes to disk. */
  abstract readonly persistent: boolean;
  abstract load(): Promise<WorkspaceSnapshot>;
  abstract save(ops: FileOp[]): Promise<SaveResult>;
  /** Asks for a project folder. Resolves to null when cancelled or unavailable. */
  abstract pickFolder(): Promise<string | null>;
  /**
   * Checks which resources another project already has.
   *
   * @param dest - Folder of the other project.
   * @param items - Resources about to be copied there.
   * @returns One flag per item, in the same order: true when the destination has that resource.
   */
  abstract existsIn(dest: string, items: CopyItem[]): Promise<boolean[]>;
  /**
   * Copies agents, skills, commands, rules and MCP servers of the loaded workspace, as they are on disk, into another project.
   *
   * @param dest - Folder of the other project.
   * @param items - Resources to copy.
   * @param replace - Replace resources the destination already has, instead of skipping them.
   * @returns Which files were copied, skipped or failed. Rejects when the workspace has no files.
   */
  abstract copyTo(dest: string, items: CopyItem[], replace: boolean): Promise<CopyResult>;
  /**
   * Starts or stops watching the files of the loaded workspace for changes made outside the app.
   * Called again after every load, because the set of folders to watch follows the scan.
   *
   * @param enabled - False stops watching. Nothing is watched for a workspace without files.
   * @returns Whether files are being watched now.
   */
  abstract watch(enabled: boolean): Promise<boolean>;
  /**
   * Registers the listener called when watched files change. Saves made through {@link save}
   * do not trigger it.
   */
  abstract onExternalChange(listener: () => void): void;
}

@Injectable()
export class MockResourceRepository extends ResourceRepository {
  readonly desktop = false;
  readonly persistent = false;

  load(): Promise<WorkspaceSnapshot> {
    return Promise.resolve(ACME_SNAPSHOT);
  }

  save(): Promise<SaveResult> {
    return Promise.resolve({ ok: true, errors: [] });
  }

  pickFolder(): Promise<string | null> {
    return Promise.resolve(null);
  }

  existsIn(_dest: string, items: CopyItem[]): Promise<boolean[]> {
    return Promise.resolve(items.map(() => false));
  }

  copyTo(): Promise<CopyResult> {
    return Promise.reject(new Error('the sample workspace has no files to copy'));
  }

  watch(): Promise<boolean> {
    return Promise.resolve(false);
  }

  onExternalChange(): void {
    /* the sample workspace has no files that could change */
  }
}

/** Reads and writes real configuration through the Electron bridge. Shows the sample until a folder is chosen. */
@Injectable()
export class ElectronResourceRepository extends ResourceRepository {
  private readonly bridge: AgentDockBridge = window.agentDock!;
  private readonly prefs = inject(PrefsStore);
  /** Folder the current snapshot was scanned from; "" while the sample is shown. */
  private root = '';

  readonly desktop = true;

  get persistent(): boolean {
    return !!this.root;
  }

  async load(): Promise<WorkspaceSnapshot> {
    const p = this.prefs.prefs();
    const root = p.root.trim();
    this.root = '';
    if (!root) return ACME_SNAPSHOT;
    const ignore = p.ignore.split(',').map((s) => s.trim()).filter(Boolean);
    const scan = await this.bridge.scan(root, { user: p.scanUser, plugins: p.scanPlugins, managed: p.managed, ignore });
    const scripts = hookScripts(scan);
    const found = scripts.length ? await this.bridge.exists(scan.root, scripts) : [];
    this.root = scan.root;
    return buildSnapshot(scan, Date.now(), scripts.filter((_, i) => !found[i]));
  }

  save(ops: FileOp[]): Promise<SaveResult> {
    return this.bridge.apply(this.root, ops);
  }

  pickFolder(): Promise<string | null> {
    return this.bridge.pickFolder();
  }

  existsIn(dest: string, items: CopyItem[]): Promise<boolean[]> {
    return this.bridge.has(dest, items);
  }

  copyTo(dest: string, items: CopyItem[], replace: boolean): Promise<CopyResult> {
    if (!this.root) return Promise.reject(new Error('the sample workspace has no files to copy'));
    return this.bridge.copy(this.root, dest, items, replace);
  }

  async watch(enabled: boolean): Promise<boolean> {
    // A bridge from an older preload script has no watcher: the app then simply does not watch.
    if (!this.bridge.watch) return false;
    if (!enabled || !this.root) {
      await this.bridge.unwatch();
      return false;
    }
    await this.bridge.watch(this.root, this.prefs.prefs().scanUser);
    return true;
  }

  onExternalChange(listener: () => void): void {
    this.bridge.onChanged?.(listener);
  }
}
