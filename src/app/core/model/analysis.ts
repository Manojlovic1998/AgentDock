import { diff } from './diff';
import { normalizeSource } from './frontmatter';
import { mcpConfig } from './mcp';
import { sourceOf } from './source';
import { Change, FileDoc, FileOp, Model, Preset, Problem, RelPair, Resource, Status, WorkspaceState, docChangeId } from './types';

const splitRel = (r: string): RelPair => r.split('>') as RelPair;

/** Whether the relationship string touches the given resource on either side. */
export function relTouches(r: string, id: string): boolean {
  return splitRel(r).indexOf(id) >= 0;
}

/**
 * Whether a relationship follows from file content instead of being configured: a command
 * points at the agents its text names, and CLAUDE.md at the project rules loaded with it.
 * Such a relationship cannot be attached or detached, only changed by editing the text.
 *
 * @param from - Id of the resource the relationship starts at.
 * @param by - Resources by id.
 */
export function isDerived(from: string, by: Record<string, Resource>): boolean {
  const type = by[from]?.type;
  return type === 'cmd' || type === 'mem';
}

/**
 * Relationships that follow from content.
 *
 * @param nodes - Resources to look at. Sample resources, which have no text, yield nothing.
 * @returns Command → agent pairs for every agent a command body names, and CLAUDE.md → rule
 * pairs for every project rule.
 */
export function derivedRel(nodes: Resource[]): RelPair[] {
  const out: RelPair[] = [];
  // Very short agent names would match ordinary words.
  const agents = nodes.filter((n) => n.type === 'agent' && !n.missing && n.name.length > 2);
  nodes.forEach((c) => {
    if (c.type !== 'cmd' || c.body === undefined) return;
    agents.forEach((a) => {
      const name = a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('(^|[^\\w-])' + name + '($|[^\\w-])').test(c.body!)) out.push([c.id, a.id]);
    });
  });
  const memory = nodes.find((n) => n.type === 'mem' && n.body !== undefined);
  if (memory) nodes.forEach((r) => r.type === 'rule' && r.scope === 'project' && out.push([memory.id, r.id]));
  return out;
}

/** Resolves base resources + pending edits into the current (or last saved) model. */
export function buildModel(nodes: Resource[], s: WorkspaceState, useBase = false): Model {
  const ov = useBase ? s.baseOver : s.over;
  const all = nodes.concat(s.added).map((n) => ({ ...n, ...(ov[n.id] ?? {}) }));
  const allBy: Record<string, Resource> = {};
  all.forEach((n) => (allBy[n.id] = n));
  const list = all.filter((n) => s.deleted.indexOf(n.id) < 0);
  const by: Record<string, Resource> = {};
  list.forEach((n) => (by[n.id] = n));
  // Stored pairs of a resource that has text are replaced by what its current text says.
  const textual = (id: string): boolean => isDerived(id, allBy) && allBy[id].body !== undefined;
  const relAll = (useBase ? s.baseRel : s.rel)
    .map(splitRel)
    .filter((r) => !textual(r[0]))
    .concat(derivedRel(all));
  return { all, allBy, list, by, rel: relAll.filter((r) => by[r[0]] && by[r[1]]), relAll };
}

const DESCRIPTION_LIMIT = 1024;

/**
 * Validation rules over the current model, merged with the findings the snapshot brought along
 * (`extra`). A finding about a resource that no longer exists is dropped.
 */
export function findProblems(m: Model, extra: Problem[] = []): Problem[] {
  const P: Problem[] = [];
  const known = extra.filter((p) => !p.target || m.by[p.target]);
  m.rel.forEach((r) => {
    const a = m.by[r[0]];
    const b = m.by[r[1]];
    if (b.missing)
      P.push({
        sev: 'err',
        msg: `Agent ${a.name} references skill ${b.name}, which was not found in project, user or plugin scope.`,
        res: a.name,
        file: a.file + (a.raw === undefined ? ':8' : ''),
        target: a.id,
        also: b.id,
      });
  });
  P.push(...known.filter((p) => p.sev !== 'info'));
  m.list.forEach((n) => {
    if (n.type === 'skill' && !n.missing && n.desc.length > DESCRIPTION_LIMIT)
      P.push({
        sev: 'warn',
        msg: `Skill ${n.name} has a ${n.desc.length.toLocaleString('en-US')} character description. Descriptions are limited to 1,024 characters.`,
        res: n.name,
        file: n.file,
        target: n.id,
      });
  });
  m.list.forEach((n) => {
    if (n.type === 'skill' && !n.missing && !m.rel.some((r) => r[1] === n.id))
      P.push({
        sev: 'info',
        msg: `Skill ${n.name} is not preloaded by any agent. Claude can still invoke it from its description.`,
        res: n.name,
        file: n.file,
        target: n.id,
      });
  });
  P.push(...known.filter((p) => p.sev === 'info'));
  return P;
}

/** Worst non-info severity per resource id. */
export function statusMap(problems: Problem[]): Record<string, Status> {
  const rank: Record<string, number> = { ok: 0, info: 0, warn: 1, err: 2 };
  const stat: Record<string, Status> = {};
  problems.forEach((p) => {
    if (p.sev === 'info') return;
    [p.target, p.also].forEach((id) => {
      if (id && rank[p.sev] > rank[stat[id] ?? 'ok']) stat[id] = p.sev as Status;
    });
  });
  return stat;
}

/** Path of a resource created in the app. It follows the name, which can still change before the first save. */
function newFile(n: Resource): string {
  const dir = n.file.startsWith('~/') ? '~/.claude/' : '.claude/';
  const name = n.name.trim();
  // A command or rule name can be nested: "git:commit" is commands/git/commit.md.
  if (n.type === 'cmd' || n.type === 'rule') {
    const parts = name.split(':');
    if (parts.some((p) => !p.trim() || /[\\/*?"<>|]/.test(p) || /^\.+$/.test(p))) return n.file;
    return dir + (n.type === 'cmd' ? 'commands/' : 'rules/') + parts.join('/') + '.md';
  }
  if (!name || /[\\/:*?"<>|]/.test(name) || /^\.+$/.test(name)) return n.file;
  if (n.type === 'agent') return dir + 'agents/' + name + '.md';
  if (n.type === 'skill') return dir + 'skills/' + name + '/SKILL.md';
  return n.file;
}

/** Whether a name can be used for a new resource of that kind: it becomes a file name or a JSON key. */
export function validName(n: Resource): boolean {
  const name = n.name.trim();
  if (n.type === 'mcp') return !!name && !/\s/.test(name);
  if (n.type === 'mem') return true;
  const parts = n.type === 'cmd' || n.type === 'rule' ? name.split(':') : [name];
  return parts.every((p) => !!p.trim() && !/[\\/:*?"<>|]/.test(p) && !/^\.+$/.test(p));
}

/** Turns pending changes into disk operations. Sample presets have no file behind them and are skipped. */
export function fileOps(changes: Change[], allBy: Record<string, Resource>, docs: FileDoc[] = []): FileOp[] {
  const ops: FileOp[] = [];
  changes.forEach((c) => {
    if (c.id === docChangeId(c.file) && c.text !== undefined) {
      // A file without a graph node is written whole. One the scan did not find is new: no scan time.
      ops.push({ op: 'write', file: c.file, text: c.text, mtime: docs.find((d) => d.file === c.file)?.mtime });
      return;
    }
    const n = allBy[c.id];
    if (c.preset || !n) return;
    if (n.type === 'mcp') {
      // Servers share one JSON file, so a change touches one key instead of the file. A new server
      // has no scan time of its own: it borrows that of a server already in the same file.
      const mtime = n.mtime ?? Object.values(allBy).find((x) => x.type === 'mcp' && x.file === c.file && x.mtime !== undefined)?.mtime;
      if (c.kind === 'D') ops.push({ op: 'jsonRemove', file: c.file, path: ['mcpServers', n.name], mtime });
      else ops.push({ op: 'jsonSet', file: c.file, path: ['mcpServers', n.name.trim()], value: mcpConfig(n), mtime });
    } else if (c.kind === 'D') {
      ops.push({ op: 'trash', file: n.type === 'skill' ? c.file.replace(/\/SKILL\.md$/, '') : c.file });
    } else if (c.text !== undefined) {
      ops.push({ op: 'write', file: c.file, text: c.text, mtime: n.mtime });
    }
  });
  return ops;
}

/**
 * Pending file changes: generated source of the current model against the saved baseline.
 *
 * @param nodes - Resources as scanned.
 * @param presets - Sample changes that have no file behind them.
 * @param s - Editing state.
 * @param normalize - Rewrite the frontmatter of every changed markdown file in canonical form.
 * @param docs - Scanned files without a graph node, as the baseline for the texts edited in `s.docs`.
 * @returns One change per file that would be written or removed.
 */
export function findChanges(nodes: Resource[], presets: Preset[], s: WorkspaceState, normalize = false, docs: FileDoc[] = []): Change[] {
  const cur = buildModel(nodes, s, false);
  const base = buildModel(nodes, s, true);
  const out: Change[] = [];
  cur.all.forEach((n) => {
    if (n.missing || s.deletedSaved.indexOf(n.id) >= 0) return;
    const isAdded = s.added.some((a) => a.id === n.id) && s.addedSaved.indexOf(n.id) < 0;
    const isDel = s.deleted.indexOf(n.id) >= 0;
    if (isAdded && isDel) return;
    const a = isAdded ? [] : sourceOf(base.allBy[n.id], base.relAll, base.allBy);
    let b = isDel ? [] : sourceOf(n, cur.rel, cur.by);
    if (a.join('\n') === b.join('\n')) return;
    // Only files that change anyway are normalized, so the setting never creates changes of its own.
    if (normalize && !isDel && n.type !== 'mcp' && n.type !== 'mem') b = normalizeSource(b);
    const change: Change = { id: n.id, kind: isAdded ? 'A' : isDel ? 'D' : 'M', file: isAdded ? newFile(n) : n.file, lines: diff(a, b), add: 0, del: 0 };
    // Scanned files carry their own final newline; generated ones need it added.
    if (!isDel) change.text = b.join('\n') + (n.raw === undefined ? '\n' : '');
    out.push(change);
  });
  Object.entries(s.docs).forEach(([file, text]) => {
    const scanned = docs.find((d) => d.file === file);
    const before = s.baseDocs[file] ?? scanned?.text;
    if (before === text) return;
    const lines = (t: string): string[] => t.replace(/\n$/, '').split('\n');
    out.push({ id: docChangeId(file), kind: before === undefined ? 'A' : 'M', file, lines: diff(before === undefined ? [] : lines(before), lines(text)), add: 0, del: 0, text });
  });
  presets.forEach((p) => {
    if (s.presets.indexOf(p.id) >= 0)
      out.push({ id: p.id, kind: p.kind, file: p.file, lines: diff(p.a, p.b), add: 0, del: 0, preset: true });
  });
  out.forEach((c) => {
    c.add = c.lines.filter((l) => l.c === 'add').length;
    c.del = c.lines.filter((l) => l.c === 'del').length;
  });
  return out;
}
