import { copyBlocker, copyPlan, copySummary } from './copy';
import { Change, Model, RelPair, Resource } from './types';

/** A scanned project resource; `over` changes what the case is about. */
function res(id: string, type: Resource['type'], over: Partial<Resource> = {}): Resource {
  const file = type === 'skill' ? `.claude/skills/${id}/SKILL.md` : `.claude/agents/${id}.md`;
  return { id, type, name: id, desc: '', file, mod: '', scope: 'project', raw: '---\n---\n', ...over };
}

function model(nodes: Resource[], rel: RelPair[] = []): Model {
  const by = Object.fromEntries(nodes.map((n) => [n.id, n]));
  return { all: nodes, allBy: by, list: nodes, by, rel, relAll: rel };
}

const change = (id: string): Change => ({ id, kind: 'M', file: '', lines: [], add: 0, del: 0 });

describe('copyBlocker', () => {
  it('allows project agents, skills, commands, rules and MCP servers that are on disk', () => {
    expect(copyBlocker(res('reviewer', 'agent'))).toBeNull();
    expect(copyBlocker(res('testing', 'skill'))).toBeNull();
    expect(copyBlocker(res('deploy', 'cmd'))).toBeNull();
    expect(copyBlocker(res('testing', 'rule'))).toBeNull();
    expect(copyBlocker(res('github', 'mcp', { file: '.mcp.json' }))).toBeNull();
  });

  it('explains why everything else cannot be copied', () => {
    expect(copyBlocker(res('claude', 'mem', { file: 'CLAUDE.md' }))).toContain('specific to its project');
    expect(copyBlocker(res('corp', 'mcp', { scope: 'managed' }))).toContain('your organization');
    expect(copyBlocker(res('new-agent', 'agent', { raw: undefined }))).toContain('Save it first');
    expect(copyBlocker(res('global', 'skill', { scope: 'user' }))).toContain('user scope');
    expect(copyBlocker(res('kendo', 'skill', { scope: 'plugin' }))).toContain('plugin scope');
    expect(copyBlocker(res('ghost', 'skill', { missing: true, scope: 'missing' }))).toContain('does not exist');
  });
});

describe('copyPlan', () => {
  const agent = res('reviewer', 'agent');
  const other = res('tester', 'agent');
  const style = res('style', 'skill');
  const testing = res('testing', 'skill');
  const global = res('global', 'skill', { scope: 'user' });
  const m = model([agent, other, style, testing, global], [
    ['reviewer', 'style'],
    ['reviewer', 'global'],
    ['tester', 'style'],
    ['tester', 'testing'],
  ]);

  it('copies an agent as its file and a skill by its SKILL.md', () => {
    const plan = copyPlan(['reviewer', 'testing'], m, [], false);
    expect(plan.items.map(({ kind, file }) => ({ kind, file }))).toEqual([
      { kind: 'agent', file: '.claude/agents/reviewer.md' },
      { kind: 'skill', file: '.claude/skills/testing/SKILL.md' },
    ]);
    expect(plan.blocked).toEqual([]);
  });

  it('copies commands and rules by their file, and an MCP server by its key in .mcp.json', () => {
    const cmd = res('deploy', 'cmd', { file: '.claude/commands/ops/deploy.md' });
    const rule = res('api', 'rule', { file: '.claude/rules/api.md' });
    const server = res('github', 'mcp', { file: '.mcp.json', raw: '{}' });
    const plan = copyPlan(['deploy', 'api', 'github'], model([cmd, rule, server]), [], true);
    expect(plan.items.map(({ kind, file, name }) => ({ kind, file, name }))).toEqual([
      { kind: 'cmd', file: '.claude/commands/ops/deploy.md', name: undefined },
      { kind: 'rule', file: '.claude/rules/api.md', name: undefined },
      { kind: 'mcp', file: '.mcp.json', name: 'github' },
    ]);
  });

  it('does not add the MCP servers an agent uses', () => {
    const server = res('github', 'mcp', { file: '.mcp.json', raw: '{}' });
    const plan = copyPlan(['reviewer'], model([agent, server], [['reviewer', 'github']]), [], true);
    expect(plan.items.map((i) => i.id)).toEqual(['reviewer']);
  });

  it('adds the project skills an agent uses, and only those', () => {
    const plan = copyPlan(['reviewer'], m, [], true);
    expect(plan.items.map((i) => [i.id, i.viaAgent])).toEqual([
      ['reviewer', false],
      ['style', true],
    ]);
    expect(plan.agentSkills).toBe(1);
  });

  it('counts the skills it could add even when they are left out', () => {
    const plan = copyPlan(['reviewer', 'tester'], m, [], false);
    expect(plan.items.map((i) => i.id)).toEqual(['reviewer', 'tester']);
    expect(plan.agentSkills).toBe(2);
  });

  it('lists a skill once when it is selected and also used by a selected agent', () => {
    const plan = copyPlan(['style', 'reviewer', 'tester'], m, [], true);
    expect(plan.items.map((i) => i.id)).toEqual(['style', 'reviewer', 'tester', 'testing']);
    expect(plan.items[0].viaAgent).toBe(false);
    expect(plan.agentSkills).toBe(1);
  });

  it('sets aside what cannot be copied and ignores unknown ids', () => {
    const plan = copyPlan(['global', 'reviewer', 'nope'], m, [], false);
    expect(plan.items.map((i) => i.id)).toEqual(['reviewer']);
    expect(plan.blocked).toEqual([{ label: 'global', reason: expect.stringContaining('user scope') }]);
  });

  it('flags resources with pending edits', () => {
    const plan = copyPlan(['reviewer', 'tester'], m, [change('tester')], false);
    expect(plan.items.map((i) => i.unsaved)).toEqual([false, true]);
  });
});

describe('copySummary', () => {
  it('reports what was copied and what was skipped', () => {
    expect(copySummary(3, 0, 'billing-api')).toBe('Copied 3 resources to billing-api');
    expect(copySummary(1, 2, 'billing-api')).toBe('Copied 1 resource to billing-api (2 skipped: already there)');
    expect(copySummary(0, 1, 'billing-api')).toBe('Nothing copied to billing-api: it is already there');
    expect(copySummary(0, 3, 'billing-api')).toBe('Nothing copied to billing-api: all 3 are already there');
  });
});
