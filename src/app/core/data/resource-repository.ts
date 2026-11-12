import { Injectable, inject } from '@angular/core';
import { FileOp, SaveResult, WorkspaceSnapshot } from '../model/types';
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
}
