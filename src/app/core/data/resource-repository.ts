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
   * @returns One flag per item, in the same order: true when the destination has that agent or skill.
   */
  abstract existsIn(dest: string, items: CopyItem[]): Promise<boolean[]>;
  /**
   * Copies agents and skills of the loaded workspace, as they are on disk, into another project.
   *
   * @param dest - Folder of the other project.
   * @param items - Resources to copy.
   * @param replace - Replace resources the destination already has, instead of skipping them.
   * @returns Which files were copied, skipped or failed. Rejects when the workspace has no files.
   */
  abstract copyTo(dest: string, items: CopyItem[], replace: boolean): Promise<CopyResult>;
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
    const scan = await this.bridge.scan(root, { user: p.scanUser, plugins: p.scanPlugins, ignore });
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
    return this.bridge.exists(dest, items.map((i) => i.file));
  }

  copyTo(dest: string, items: CopyItem[], replace: boolean): Promise<CopyResult> {
    if (!this.root) return Promise.reject(new Error('the sample workspace has no files to copy'));
    return this.bridge.copy(this.root, dest, items, replace);
  }
}
