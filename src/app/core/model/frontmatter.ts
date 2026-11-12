import { parse, stringify } from 'yaml';
import { Kind, ResourcePatch } from './types';

/** A markdown file split so that joining the parts gives back the exact original text. */
export interface Doc {
  /** Lines between the `---` fences, or null when the file has no frontmatter. */
  head: string[] | null;
  /** Newline after the closing fence ("" when the file ends on the fence). */
  sep: string;
  /** Blank lines between the frontmatter and the body. */
  lead: string;
  body: string;
  /** Trailing whitespace of the file. */
  tail: string;
}

export function splitDoc(text: string): Doc {
  const lines = text.split('\n');
  let head: string[] | null = null;
  let sep = '';
  let rest = text;
  if (lines[0].trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end > 0) {
      head = lines.slice(1, end);
      sep = end + 1 < lines.length ? '\n' : '';
      rest = lines.slice(end + 1).join('\n');
    }
  }
  const lead = /^\n*/.exec(rest)![0];
  const tail = /\s*$/.exec(rest.slice(lead.length))![0];
  return { head, sep, lead, body: rest.slice(lead.length, rest.length - tail.length), tail };
}

export function joinDoc(d: Doc): string {
  const head = d.head ? ['---', ...d.head, '---'].join('\n') + (d.sep || (d.lead + d.body + d.tail ? '\n' : '')) : '';
  return head + d.lead + d.body + d.tail;
}

/** Frontmatter values. Invalid YAML gives an empty record and the parser's message. */
export function readHead(head: string[] | null): { data: Record<string, unknown>; error?: string } {
  if (!head) return { data: {} };
  try {
    const data: unknown = parse(head.join('\n'));
    return { data: data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {} };
  } catch (e) {
    return { data: {}, error: (e as Error).message.split('\n')[0] };
  }
}

/**
 * Sets or removes (value undefined) one top-level key. Only that key's lines are replaced;
 * every other line, including comments and unknown keys, is kept as written.
 */
export function patchHead(head: string[], key: string, value: unknown): string[] {
  const start = head.findIndex((l) => l.startsWith(key) && /^\s*:/.test(l.slice(key.length)));
  let end = start + 1;
  if (start >= 0) {
    // The value continues over indented lines and same-level list items.
    while (end < head.length && (head[end] === '' || /^[ \t]/.test(head[end]) || /^-(\s|$)/.test(head[end]))) end++;
    while (end > start + 1 && head[end - 1].trim() === '') end--;
  }
  const lines = value === undefined ? [] : stringify({ [key]: value }, { lineWidth: 0 }).trimEnd().split('\n');
  if (start < 0) return head.concat(lines);
  return [...head.slice(0, start), ...lines, ...head.slice(end)];
}

/** A frontmatter list written either as a YAML sequence or as a comma-separated string. */
export function toList(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' || typeof x === 'number').map(String);
  // Commas inside parentheses belong to one entry: Bash(git diff:*, git log:*).
  return String(v)
    .split(/,(?![^()]*\))/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface Parsed {
  doc: Doc;
  data: Record<string, unknown>;
  /** Resource fields as the file states them; edits are detected by comparing against these. */
  fields: ResourcePatch;
  error?: string;
}

const firstText = (body: string): string =>
  body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#')) ?? '';

const str = (v: unknown): string | undefined => (typeof v === 'string' || typeof v === 'number' ? String(v) : undefined);

const cache = new Map<string, Parsed>();

/** Reads a scanned agent, skill, command or rule file into resource fields. */
export function parseResource(type: Kind, raw: string): Parsed {
  const key = type + '\n' + raw;
  const hit = cache.get(key);
  if (hit) return hit;
  const doc = splitDoc(raw);
  const { data, error } = readHead(doc.head);
  const fields: ResourcePatch = {};
  const name = str(data['name']);
  if (name) fields.name = name;
  if (type === 'agent') {
    fields.desc = str(data['description']) ?? '';
    fields.model = str(data['model']) ?? 'inherit';
    fields.tools = toList(data['tools']);
    fields.perm = str(data['permissionMode']) ?? 'default';
    fields.body = doc.body;
  } else if (type === 'skill') {
    fields.desc = str(data['description']) ?? '';
    fields.tools = toList(data['allowed-tools']);
    fields.body = doc.body;
  } else if (type === 'cmd') {
    const hint = data['argument-hint'];
    fields.desc = str(data['description']) ?? firstText(doc.body);
    // An unquoted "[ticket-key]" is a YAML sequence; show it the way it was typed.
    fields.hint = Array.isArray(hint) ? '[' + hint.join(', ') + ']' : (str(hint) ?? '');
  } else if (type === 'rule') {
    fields.desc = str(data['description']) ?? firstText(doc.body);
    fields.paths = (toList(data['paths']) ?? []).join(', ');
  }
  const parsed: Parsed = { doc, data, fields, error };
  if (cache.size > 2000) cache.clear();
  cache.set(key, parsed);
  return parsed;
}
