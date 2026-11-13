import { joinDoc, parseResource, patchHead, toList } from './frontmatter';
import { FileOp, Resource } from './types';
import { validName } from './analysis';

/** What renaming a resource would do on disk. */
export interface RenamePlan {
  /** Operations to apply together, or none. */
  ops: FileOp[];
  /** Display paths of the files the rename changes, for the confirmation dialog. */
  files: string[];
  /** Other resources whose text mentions the old name. Those mentions are plain text and are not rewritten. */
  mentions: string[];
}

export type RenameResult = { plan: RenamePlan } | { error: string };

/** Kinds a rename moves a file or re-keys an entry for. Agents and skills are renamed in their frontmatter instead. */
export const RENAMABLE: readonly string[] = ['cmd', 'rule', 'mcp'];

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether the rename of this resource can be written: user and project files, not plugin, managed or `~/.claude.json`. */
export function renameBlocker(n: Resource): string | undefined {
  if (!RENAMABLE.includes(n.type)) return 'Only commands, rules and MCP servers are renamed here';
  if (n.raw === undefined) return 'Save the resource first: it has no file yet';
  if (n.scope === 'plugin' || n.scope === 'managed') return `A ${n.scope} resource is read-only`;
  if (n.type === 'mcp' && n.file.startsWith('~/') && !n.file.startsWith('~/.claude/'))
    return 'User-scope servers live in ~/.claude.json, which Claude Code rewrites constantly and is not edited here';
  return undefined;
}

/** Path a command or rule has under a new name: "git:commit" is `commands/git/commit.md`. */
function pathFor(n: Resource, name: string): string {
  const dir = n.file.startsWith('~/') ? '~/.claude/' : '.claude/';
  return dir + (n.type === 'cmd' ? 'commands/' : 'rules/') + name.split(':').join('/') + '.md';
}

/** Rewrites a server name in an agent file: its `mcpServers` list and its `mcp__server__tool` entries. */
function renameInAgent(raw: string, from: string, to: string): string | undefined {
  const p = parseResource('agent', raw);
  if (!p.doc.head) return undefined;
  let head = p.doc.head;
  let touched = false;

  const servers = p.data['mcpServers'];
  if (Array.isArray(servers) && servers.includes(from)) {
    head = patchHead(
      head,
      'mcpServers',
      servers.map((s) => (s === from ? to : s)),
    );
    touched = true;
  }
  const tools = toList(p.data['tools']);
  const prefix = 'mcp__' + from;
  if (tools?.some((t) => t === prefix || t.startsWith(prefix + '__'))) {
    const next = tools.map((t) => (t === prefix || t.startsWith(prefix + '__') ? 'mcp__' + to + t.slice(prefix.length) : t));
    head = patchHead(head, 'tools', Array.isArray(p.data['tools']) ? next : next.join(', '));
    touched = true;
  }
  return touched ? joinDoc({ ...p.doc, head }) : undefined;
}

/**
 * Plans the rename of a command, rule or MCP server.
 *
 * @remarks
 * A command or rule is moved to the path its new name gives. A server is re-keyed in its JSON file,
 * and every agent that lists it in `mcpServers` or grants its tools is rewritten, so no agent is
 * left pointing at a name that no longer exists. Command → agent and CLAUDE.md → rule links follow
 * from file text, not from the name of the command or rule, so they need no rewriting.
 *
 * @param n - The resource to rename, as scanned.
 * @param name - The new name.
 * @param all - Every resource of the workspace, for collisions, agents to rewrite and mentions.
 * @returns The operations, or the reason the rename is not possible.
 */
export function planRename(n: Resource, name: string, all: Resource[]): RenameResult {
  const blocker = renameBlocker(n);
  if (blocker) return { error: blocker };
  const next = name.trim();
  if (!next) return { error: 'Enter a name' };
  if (next === n.name) return { error: 'That is already the name' };
  if (!validName({ ...n, name: next })) {
    return { error: n.type === 'mcp' ? 'A server name cannot contain spaces' : 'A name cannot contain / \\ : * ? " < > | here, except : for a subfolder' };
  }
  const id = n.type + ':' + next;
  if (all.some((x) => x.id === id)) return { error: `A ${n.type === 'mcp' ? 'server' : n.type === 'cmd' ? 'command' : 'rule'} named ${next} already exists` };

  const ops: FileOp[] = [];
  const files: string[] = [];
  const touchedAgents = new Set<string>();

  if (n.type === 'mcp') {
    let value: unknown;
    try {
      value = (JSON.parse(n.raw!) as { mcpServers: Record<string, unknown> }).mcpServers[n.name];
    } catch {
      return { error: 'The server definition could not be read' };
    }
    // Every operation on the file carries the scan time, so a change made on disk since is refused.
    ops.push({ op: 'jsonRemove', file: n.file, path: ['mcpServers', n.name], mtime: n.mtime });
    ops.push({ op: 'jsonSet', file: n.file, path: ['mcpServers', next], value, mtime: n.mtime });
    files.push(n.file);
    for (const a of all) {
      if (a.type !== 'agent' || a.raw === undefined) continue;
      const text = renameInAgent(a.raw, n.name, next);
      if (text === undefined) continue;
      if (a.scope === 'plugin' || a.scope === 'managed') continue;
      ops.push({ op: 'write', file: a.file, text, mtime: a.mtime });
      files.push(a.file);
      touchedAgents.add(a.id);
    }
  } else {
    ops.push({ op: 'move', file: n.file, to: pathFor(n, next), mtime: n.mtime ?? 0 });
    files.push(n.file + ' → ' + pathFor(n, next));
  }

  // A command is called as /name and a rule is imported as @path. Neither is tracked, so only count them.
  const needle = n.type === 'mcp' ? undefined : new RegExp('(^|[^\\w-])' + (n.type === 'cmd' ? '/' : '') + escape(n.type === 'cmd' ? n.name :n.file.replace(/^~?\/?\.claude\//, '')) + '($|[^\\w-])');
  const mentions = needle ? all.filter((x) => x.id !== n.id && x.body !== undefined && needle.test(x.body)).map((x) => x.name) : [];

  return { plan: { ops, files, mentions } };
}
