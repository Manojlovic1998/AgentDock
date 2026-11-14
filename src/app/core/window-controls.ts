import { Injectable, signal } from '@angular/core';
import { ScanOptions, ScanResult } from './data/scan';
import { CopyItem, CopyResult, FileOp, SaveResult } from './model/types';

/** Where an update is in its life cycle. `idle` means there is nothing to show. */
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'uptodate' | 'error';

/** Update progress pushed by the main process (electron/updater.ts). */
export interface UpdateState {
  status: UpdateStatus;
  /** Version of the running app. */
  current: string;
  /** Version offered by the update, once one is found. */
  version?: string;
  /** Release notes as plain text. */
  notes?: string;
  /** Download progress from 0 to 100. */
  percent?: number;
  /** Message to show when `status` is `error`. */
  error?: string;
  /** The update cannot be installed in place: "download" opens the release page. */
  manualInstall: boolean;
  /** Whether the app looks for updates by itself after it starts. */
  autoCheck: boolean;
}

/** What electron/preload.ts exposes on `window.agentDock`. */
export interface AgentDockBridge {
  platform: string;
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  onMaximized(listener: (maximized: boolean) => void): void;
  pickFolder(): Promise<string | null>;
  scan(root: string, options: ScanOptions): Promise<ScanResult>;
  /** Whether each path (relative to the project root, absolute or "~/…") is an existing file. */
  exists(root: string, paths: string[]): Promise<boolean[]>;
  /** Whether the project at `root` already has each resource: its file, or for an MCP server its key in `.mcp.json`. */
  has(root: string, items: CopyItem[]): Promise<boolean[]>;
  apply(root: string, ops: FileOp[]): Promise<SaveResult>;
  /**
   * Copies agents and skills from the project at `from` into the project at `to`.
   * Existing ones in the destination are skipped unless `replace` is true.
   */
  copy(from: string, to: string, items: CopyItem[], replace: boolean): Promise<CopyResult>;
  /** Starts watching the configuration of a project, replacing any earlier watch. */
  watch(root: string, user: boolean): Promise<void>;
  unwatch(): Promise<void>;
  /** Registers a listener for configuration changes made outside the app. */
  onChanged(listener: () => void): void;
  /** Current update state, without checking. */
  getUpdateState(): Promise<UpdateState>;
  /** Looks for a new version now. Resolves with the state once the check has finished. */
  checkForUpdates(): Promise<UpdateState>;
  /** Downloads the offered update, or opens its release page when it cannot be installed in place. */
  downloadUpdate(): Promise<UpdateState>;
  /** Quits and installs a downloaded update. */
  installUpdate(): Promise<void>;
  /** Stops automatic checks from offering the version that is currently offered. */
  skipUpdate(): Promise<UpdateState>;
  /** Turns the automatic check after startup on or off. */
  setAutoUpdateCheck(on: boolean): Promise<UpdateState>;
  /** Registers a listener for update state changes. */
  onUpdateState(listener: (state: UpdateState) => void): void;
}

declare global {
  interface Window {
    agentDock?: AgentDockBridge;
  }
}

/** Window controls for the frameless Electron window. Inert when running in a browser. */
@Injectable({ providedIn: 'root' })
export class WindowControls {
  private readonly bridge = window.agentDock;
  readonly available = !!this.bridge;
  readonly maximized = signal(false);

  constructor() {
    this.bridge?.onMaximized((m) => this.maximized.set(m));
  }

  minimize(): void {
    this.bridge?.minimize();
  }

  toggleMaximize(): void {
    this.bridge?.toggleMaximize();
  }

  close(): void {
    this.bridge?.close();
  }
}
