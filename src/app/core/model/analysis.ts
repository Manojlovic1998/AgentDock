import { diff } from './diff';
import { sourceOf } from './source';
import { Change, FileOp, Model, Preset, Problem, RelPair, Resource, Status, WorkspaceState } from './types';

const splitRel = (r: string): RelPair => r.split('>') as RelPair;

/** Whether the relationship string touches the given resource on either side. */
export function relTouches(r: string, id: string): boolean {
  return splitRel(r).indexOf(id) >= 0;
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
  const relAll = (useBase ? s.baseRel : s.rel).map(splitRel);
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
  if (!name || /[\\/:*?"<>|]/.test(name)) return n.file;
  if (n.type === 'agent') return dir + 'agents/' + name + '.md';
  if (n.type === 'skill') return dir + 'skills/' + name + '/SKILL.md';
  return n.file;
}

/** Turns pending changes into disk operations. Sample presets have no file behind them and are skipped. */
export function fileOps(changes: Change[], allBy: Record<string, Resource>): FileOp[] {
  const ops: FileOp[] = [];
  changes.forEach((c) => {
    const n = allBy[c.id];
    if (c.preset || !n) return;
    if (n.type === 'mcp') {
      // Servers share one JSON file, so a deletion removes a key instead of the file.
      if (c.kind === 'D') ops.push({ op: 'jsonRemove', file: c.file, path: ['mcpServers', n.name] });
    } else if (c.kind === 'D') {
      ops.push({ op: 'trash', file: n.type === 'skill' ? c.file.replace(/\/SKILL\.md$/, '') : c.file });
    } else if (c.text !== undefined) {
      ops.push({ op: 'write', file: c.file, text: c.text, mtime: n.mtime });
    }
  });
  return ops;
}

/** Pending file changes: generated source of the current model against the saved baseline. */
export function findChanges(nodes: Resource[], presets: Preset[], s: WorkspaceState): Change[] {
  const cur = buildModel(nodes, s, false);
  const base = buildModel(nodes, s, true);
  const out: Change[] = [];
  cur.all.forEach((n) => {
    if (n.missing || s.deletedSaved.indexOf(n.id) >= 0) return;
    const isAdded = s.added.some((a) => a.id === n.id) && s.addedSaved.indexOf(n.id) < 0;
    const isDel = s.deleted.indexOf(n.id) >= 0;
    if (isAdded && isDel) return;
    const a = isAdded ? [] : sourceOf(base.allBy[n.id], base.relAll, base.allBy);
    const b = isDel ? [] : sourceOf(n, cur.rel, cur.by);
    if (a.join('\n') === b.join('\n')) return;
    const change: Change = { id: n.id, kind: isAdded ? 'A' : isDel ? 'D' : 'M', file: isAdded ? newFile(n) : n.file, lines: diff(a, b), add: 0, del: 0 };
    // Scanned files carry their own final newline; generated ones need it added.
    if (!isDel) change.text = b.join('\n') + (n.raw === undefined ? '\n' : '');
    out.push(change);
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
