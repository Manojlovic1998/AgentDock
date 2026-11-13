import { Injectable, signal } from '@angular/core';
import { ScanOptions, ScanResult } from './data/scan';
import { CopyItem, CopyResult, FileOp, SaveResult } from './model/types';

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
