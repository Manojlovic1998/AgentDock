export type Kind = 'agent' | 'skill' | 'cmd' | 'mcp' | 'rule' | 'mem';
/** Kind plus the neutral "x" used by rows that have no graph node. */
export type KindOrNone = Kind | 'x';
export type Severity = 'err' | 'warn' | 'info';
export type Status = 'ok' | 'warn' | 'err';
export type ChangeKind = 'M' | 'A' | 'D';

export interface Resource {
  id: string;
  type: Kind;
  name: string;
  desc: string;
  file: string;
  mod: string;
  model?: string;
  tools?: string[];
  perm?: string;
  body?: string;
  scope?: string;
  missing?: boolean;
  hint?: string;
  transport?: string;
  url?: string;
  paths?: string;
  /** File content as scanned from disk. Absent for sample data and resources created in the app. */
  raw?: string;
  /** Modification time of the scanned file, used to detect external edits before writing. */
  mtime?: number;
  lines?: number;
  /** Ids this resource pointed to when it was scanned; relationship edits are written as a delta to these. */
  linked?: string[];
}

export type ResourcePatch = Partial<Omit<Resource, 'id' | 'type'>>;

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  w: number;
  h: number;
}

/** A relationship pair: [source id, target id]. Stored as "source>target". */
export type RelPair = [string, string];

export interface Preset {
  id: string;
  kind: ChangeKind;
  file: string;
  a: string[];
  b: string[];
}

export interface StaticTable {
  title: string;
  sub: string;
  c: [string, string, string];
  /** name, description, column a, column b, status, modified, and the file when it can be opened as text */
  rows: [string, string, string, string, Status, string, string?][];
}

export interface ActivityEntry {
  t: string;
  msg: string;
}

/**
 * A configuration file that has no node on the graph but can be read and edited as text:
 * a settings file, an output style, an auto-memory file, or a CLAUDE.md other than the project's.
 */
export interface FileDoc {
  /** Display path: project-relative, or starting with "~/" for user scope. */
  file: string;
  kind: 'settings' | 'style' | 'memory' | 'claudemd';
  scope: string;
  /** Content as scanned, with LF line endings. */
  text: string;
  /** Modification time at the scan; undefined for a file that does not exist yet. */
  mtime?: number;
  /** False for files AgentDock never writes: managed and plugin files. */
  writable: boolean;
}

export interface WorkspaceSnapshot {
  name: string;
  path: string;
  branch: string;
  nodes: Resource[];
  /** Editable files without a graph node. */
  docs: FileDoc[];
  rel: string[];
  presets: Preset[];
  tables: Record<string, StaticTable>;
  activity: ActivityEntry[];
  /** Findings that need the file system or environment, or that belong to the sample data. */
  problems: Problem[];
  /** When the snapshot was taken, phrased to follow "scanned": "2 minutes ago", "at 14:05". */
  scanned: string;
}

/** A change to apply on disk. Paths are project-relative, or start with "~/" for user scope. */
export type FileOp =
  | { op: 'write'; file: string; text: string; mtime?: number }
  | { op: 'trash'; file: string }
  | { op: 'jsonRemove'; file: string; path: string[]; mtime?: number }
  /** Sets one value inside a JSON file, creating the file and the objects on the way when missing. */
  | { op: 'jsonSet'; file: string; path: string[]; value: unknown; mtime?: number };

export interface SaveResult {
  ok: boolean;
  errors: { file: string; error: string }[];
}

/**
 * One resource to copy into another project: an agent, skill, command or rule, or an MCP server.
 */
export interface CopyItem {
  kind: 'agent' | 'skill' | 'cmd' | 'rule' | 'mcp';
  /**
   * Project-relative path of the file, or of the skill's `SKILL.md`, or `.mcp.json` for a server.
   * A skill is copied as the whole folder that contains this file.
   */
  file: string;
  /** Key of the server in `.mcp.json`. Set for `mcp` only: the file alone does not say which server. */
  name?: string;
}

/** Kinds of resource that can be copied to another project. */
export const COPYABLE: readonly CopyItem['kind'][] = ['agent', 'skill', 'cmd', 'rule', 'mcp'];

/**
 * Outcome of copying resources into another project. Every requested file is in exactly one list.
 */
export interface CopyResult {
  /** Files written to the destination. */
  copied: string[];
  /** Files left alone because the destination already had them and replacing was not asked for. */
  skipped: string[];
  /** Files that could not be copied. When checks fail before writing, nothing is copied at all. */
  errors: { file: string; error: string }[];
}

/** Editable workspace state: current values next to the last saved baseline. */
export interface WorkspaceState {
  rel: string[];
  baseRel: string[];
  over: Record<string, ResourcePatch>;
  baseOver: Record<string, ResourcePatch>;
  added: Resource[];
  addedSaved: string[];
  deleted: string[];
  deletedSaved: string[];
  presets: string[];
  /** Edited text of files without a graph node, by display path. A path the scan did not find is a new file. */
  docs: Record<string, string>;
  baseDocs: Record<string, string>;
}

/** Id of the pending change for a file without a graph node. */
export const docChangeId = (file: string): string => 'doc:' + file;

export interface Model {
  all: Resource[];
  allBy: Record<string, Resource>;
  list: Resource[];
  by: Record<string, Resource>;
  rel: RelPair[];
  relAll: RelPair[];
}

export interface Problem {
  sev: Severity;
  msg: string;
  res: string;
  file: string;
  target?: string;
  also?: string;
  screen?: string;
}

export interface DiffLine {
  c: 'ctx' | 'add' | 'del';
  o: number | '';
  n: number | '';
  s: string;
  t: string;
}

export interface Change {
  id: string;
  kind: ChangeKind;
  file: string;
  lines: DiffLine[];
  add: number;
  del: number;
  preset?: boolean;
  /** New file content; absent for deletions and presets. */
  text?: string;
}

export interface Token {
  c: string;
  t: string;
}

export interface SourceLine {
  no: number;
  toks: Token[];
}
