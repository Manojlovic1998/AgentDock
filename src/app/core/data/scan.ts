/**
 * What the Electron main process returns from a scan: file contents and a few facts only it can
 * know. Parsing happens in the renderer (build-snapshot.ts). Mirrored in electron/workspace.ts.
 */
export type ScanScope = 'managed' | 'project' | 'local' | 'user' | 'plugin';

export type ScanKind = 'agent' | 'skill' | 'cmd' | 'rule' | 'style' | 'settings' | 'claudemd' | 'mcp' | 'memory' | 'other';

export interface ScanFile {
  kind: ScanKind;
  scope: ScanScope;
  /** Plugin the file belongs to, for plugin scope. */
  plugin?: string;
  /** Display path: project-relative, "~/…" for user scope, "<plugin>/…" for plugins. */
  file: string;
  /** Content with LF line endings. Empty for kinds that are only listed. */
  text: string;
  mtime: number;
}

export interface ScanPlugin {
  name: string;
  version: string;
  description: string;
  mtime: number;
}

export interface ScanResult {
  /** Absolute project folder. */
  root: string;
  home: string;
  name: string;
  /** Current git branch, or "" outside a repository. */
  branch: string;
  files: ScanFile[];
  plugins: ScanPlugin[];
  /** Variables referenced as ${NAME} in MCP configuration that are not set. */
  unsetEnv: string[];
}

export interface ScanOptions {
  user: boolean;
  plugins: boolean;
  /** Read the settings and MCP servers an organization deployed to this machine. */
  managed: boolean;
  /** Folder names skipped during discovery. */
  ignore: string[];
}
