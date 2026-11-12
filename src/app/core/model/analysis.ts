import { diff } from './diff';
import { sourceOf } from './source';
import { Change, Model, Preset, Problem, RelPair, Resource, Status, WorkspaceState } from './types';

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

/** Validation rules. Mirrors the checks shown in the design. */
export function findProblems(m: Model): Problem[] {
  const P: Problem[] = [];
  m.rel.forEach((r) => {
    const a = m.by[r[0]];
    const b = m.by[r[1]];
    if (b.missing)
      P.push({
        sev: 'err',
        msg: `Agent ${a.name} references skill ${b.name}, which was not found in project, user or plugin scope.`,
        res: a.name,
        file: a.file + ':8',
        target: a.id,
        also: b.id,
      });
  });
  P.push({
    sev: 'err',
    msg: 'Hook lint-staged runs scripts/lint-staged.sh, but that file does not exist.',
    res: 'lint-staged',
    file: '.claude/settings.json:14',
    screen: 'hooks',
  });
  if (m.by['mcp:jira'])
    P.push({
      sev: 'warn',
      msg: 'MCP server jira expands ${JIRA_API_TOKEN}, which is not set in this environment.',
      res: 'jira',
      file: '.mcp.json:6',
      target: 'mcp:jira',
    });
  if (m.by['legacy-migration'])
    P.push({
      sev: 'warn',
      msg: 'Skill legacy-migration has a 1,180 character description. Descriptions are limited to 1,024 characters.',
      res: 'legacy-migration',
      file: '.claude/skills/legacy-migration/SKILL.md:3',
      target: 'legacy-migration',
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
  if (m.by['mem:claude'])
    P.push({
      sev: 'info',
      msg: 'CLAUDE.md is 412 lines. Path-specific guidance loads faster from .claude/rules/.',
      res: 'CLAUDE.md',
      file: 'CLAUDE.md',
      target: 'mem:claude',
    });
  if (m.by['typescript-best-practices'])
    P.push({
      sev: 'info',
      msg: 'Skill typescript-best-practices exists in user and project scope. The project copy takes precedence.',
      res: 'typescript-best-practices',
      file: '~/.claude/skills/typescript-best-practices/SKILL.md',
      target: 'typescript-best-practices',
    });
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
    out.push({ id: n.id, kind: isAdded ? 'A' : isDel ? 'D' : 'M', file: n.file, lines: diff(a, b), add: 0, del: 0 });
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
