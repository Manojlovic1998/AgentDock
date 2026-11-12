import { ACME_SNAPSHOT } from '../data/mock-data';
import { buildModel, findChanges, findProblems, statusMap } from './analysis';
import { diff } from './diff';
import { NODE_SIZE, bounds, edgePath, layout, plural } from './graph';
import { highlight, sourceOf } from './source';
import { Resource, WorkspaceState } from './types';

const state = (patch: Partial<WorkspaceState> = {}): WorkspaceState => ({
  rel: ACME_SNAPSHOT.rel,
  baseRel: ACME_SNAPSHOT.rel,
  over: {},
  baseOver: {},
  added: [],
  addedSaved: [],
  deleted: [],
  deletedSaved: [],
  presets: [],
  ...patch,
});

const model = (patch: Partial<WorkspaceState> = {}) => buildModel(ACME_SNAPSHOT.nodes, state(patch));

describe('graph', () => {
  it('lays kinds out in columns', () => {
    const m = model();
    const pos = layout(m.list);
    const agents = m.list.filter((n) => n.type === 'agent');
    const skills = m.list.filter((n) => n.type === 'skill');
    expect(pos[agents[0].id]).toEqual({ x: 268, y: 70 });
    expect(pos[agents[1].id]).toEqual({ x: 268, y: 204 });
    expect(pos[skills[0].id]).toEqual({ x: 568, y: 62 });
    expect(pos['mem:claude']).toEqual({ x: 848, y: 70 });
    expect(Object.keys(pos)).toHaveLength(m.list.length);
  });

  it('draws a curved edge from the right side of the source to the left side of the target', () => {
    const by = model().by;
    const a = by['angular-developer'];
    const b = by['angular-patterns'];
    const d = edgePath(a, b, { x: 0, y: 0 }, { x: 400, y: 100 }, false);
    expect(d).toBe(`M${NODE_SIZE.agent[0]} 41C318 41 318 126 400 126`);
  });

  it('draws orthogonal and memory-to-rule edges', () => {
    const by = model().by;
    expect(edgePath(by['angular-developer'], by['angular-patterns'], { x: 0, y: 0 }, { x: 400, y: 100 }, true)).toBe(
      'M236 41H318V126H400',
    );
    expect(edgePath(by['mem:claude'], by['rule:testing'], { x: 0, y: 0 }, { x: 20, y: 100 }, false)).toBe(
      'M10 52V118Q10 124 16 124H20',
    );
  });

  it('pads the bounding box and falls back when the graph is empty', () => {
    const list = model().list.filter((n) => n.id === 'angular-developer');
    expect(bounds(list, () => ({ x: 100, y: 100 }))).toEqual({ x: 70, y: 54, w: 296, h: 158 });
    expect(bounds([], () => ({ x: 0, y: 0 }))).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it('pluralises counts', () => {
    expect(plural(1, 'file')).toBe('1 file');
    expect(plural(3, 'file')).toBe('3 files');
  });
});

describe('source', () => {
  it('generates agent frontmatter with skills and MCP servers', () => {
    const m = model();
    const lines = sourceOf(m.by['ticket-analyst'], m.rel, m.by);
    expect(lines[0]).toBe('---');
    expect(lines[1]).toBe('name: ticket-analyst');
    expect(lines).toContain('skills:');
    expect(lines).toContain('  - jira-analysis');
    expect(lines).toContain('mcpServers:');
    expect(lines).toContain('  - jira');
  });

  it('generates command, rule and MCP sources', () => {
    const m = model();
    expect(sourceOf(m.by['cmd:implement'], m.rel, m.by)).toContain('Use the angular-developer subagent to handle $ARGUMENTS.');
    expect(sourceOf(m.by['mcp:jira'], m.rel, m.by).join('\n')).toContain('"jira": {');
    expect(sourceOf(m.by['mem:claude'], m.rel, m.by)).toContain('- @.claude/rules/testing.md');
  });

  it('highlights frontmatter, headings and plain text', () => {
    const [fence, key, heading, blank] = highlight(['---', 'name: x', '# Title', '']);
    expect(fence.toks).toEqual([{ c: 'tk-p', t: '---' }]);
    expect(key.toks.map((t) => t.c)).toEqual(['tk-k', 'tk-p', 'tk-s']);
    expect(heading.toks[0].c).toBe('tk-h');
    expect(blank).toEqual({ no: 4, toks: [{ c: 'tk-n', t: ' ' }] });
  });
});

describe('diff', () => {
  it('marks added and removed lines and numbers both sides', () => {
    const d = diff(['a', 'b', 'c'], ['a', 'c', 'd']);
    expect(d.map((l) => l.c)).toEqual(['ctx', 'del', 'ctx', 'add']);
    expect(d[1]).toMatchObject({ o: 2, n: '', t: 'b' });
    expect(d[3]).toMatchObject({ o: '', n: 3, t: 'd' });
  });

  it('is empty of changes for identical input', () => {
    expect(diff(['a'], ['a']).every((l) => l.c === 'ctx')).toBe(true);
  });
});

describe('analysis', () => {
  it('finds two errors and two warnings in the sample workspace', () => {
    const problems = findProblems(model(), ACME_SNAPSHOT.problems);
    expect(problems.filter((p) => p.sev === 'err')).toHaveLength(2);
    expect(problems.filter((p) => p.sev === 'warn')).toHaveLength(2);
    const status = statusMap(problems);
    expect(status['release-scribe']).toBe('err');
    expect(status['changelog-format']).toBe('err');
    expect(status['mcp:jira']).toBe('warn');
    expect(status['angular-developer']).toBeUndefined();
  });

  it('drops problems for deleted resources', () => {
    const problems = findProblems(model({ deleted: ['mcp:jira', 'release-scribe'] }), ACME_SNAPSHOT.problems);
    expect(problems.filter((p) => p.sev === 'err')).toHaveLength(1);
    expect(problems.filter((p) => p.sev === 'warn')).toHaveLength(1);
  });

  it('reports no changes for an untouched workspace and lists presets when enabled', () => {
    expect(findChanges(ACME_SNAPSHOT.nodes, ACME_SNAPSHOT.presets, state())).toEqual([]);
    const withPresets = findChanges(ACME_SNAPSHOT.nodes, ACME_SNAPSHOT.presets, state({ presets: ACME_SNAPSHOT.presets.map((p) => p.id) }));
    expect(withPresets).toHaveLength(ACME_SNAPSHOT.presets.length);
    expect(withPresets.every((c) => c.preset)).toBe(true);
  });

  it('detects modified, added and deleted files', () => {
    const added: Resource = { id: 'new-skill', type: 'skill', name: 'new-skill', desc: 'd', file: '.claude/skills/new-skill/SKILL.md', mod: 'now', tools: [], body: '' };
    const changes = findChanges(
      ACME_SNAPSHOT.nodes,
      [],
      state({
        rel: ACME_SNAPSHOT.rel.concat(['angular-developer>testing-strategy']),
        added: [added],
        deleted: ['cmd:review-pr'],
      }),
    );
    const kinds = Object.fromEntries(changes.map((c) => [c.id, c.kind]));
    expect(kinds).toEqual({ 'angular-developer': 'M', 'new-skill': 'A', 'cmd:review-pr': 'D' });
    const modified = changes.find((c) => c.id === 'angular-developer');
    expect(modified).toMatchObject({ add: 1, del: 0 });
  });
});
