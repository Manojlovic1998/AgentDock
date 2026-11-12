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
  /** name, description, column a, column b, status, modified */
  rows: [string, string, string, string, Status, string][];
}

export interface ActivityEntry {
  t: string;
  msg: string;
}

export interface WorkspaceSnapshot {
  name: string;
  path: string;
  branch: string;
  nodes: Resource[];
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
  | { op: 'jsonRemove'; file: string; path: string[] };

export interface SaveResult {
  ok: boolean;
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
}

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
