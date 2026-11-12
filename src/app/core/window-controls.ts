import { Injectable, signal } from '@angular/core';
import { ScanOptions, ScanResult } from './data/scan';
import { FileOp, SaveResult } from './model/types';

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
  apply(root: string, ops: FileOp[]): Promise<SaveResult>;
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
