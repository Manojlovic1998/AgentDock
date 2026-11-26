import { buildModel, findProblems, statusMap, validName } from './analysis';
import { diff } from './diff';
import { Problem, Resource, WorkspaceState } from './types';

const state = (rel: string[]): WorkspaceState => ({
  rel,
  baseRel: rel,
  over: {},
  baseOver: {},
  added: [],
  addedSaved: [],
  deleted: [],
  deletedSaved: [],
  presets: [],
  docs: {},
  baseDocs: {},
});

const skill = (name: string, desc: string, extra: Partial<Resource> = {}): Resource => ({
  id: name,
  type: 'skill',
  name,
  desc,
  file: '.claude/skills/' + name + '/SKILL.md',
  mod: '',
  ...extra,
});

describe('validation', () => {
  const nodes: Resource[] = [
    { id: 'a', type: 'agent', name: 'a', desc: '', file: '.claude/agents/a.md', mod: '' },
    skill('ok', 'x'.repeat(1024)),
    skill('big', 'x'.repeat(1025)),
    skill('gone', 'Not found.', { missing: true, file: '(not found)' }),
  ];
  const extra: Problem[] = [
    { sev: 'info', msg: 'extra info', res: 'x', file: 'f' },
    { sev: 'warn', msg: 'about a deleted resource', res: 'y', file: 'f', target: 'deleted-id' },
  ];

  it('orders errors, warnings and notes, and drops findings about resources that are gone', () => {
    const problems = findProblems(buildModel(nodes, state(['a>ok', 'a>gone'])), extra);
    expect(problems.map((p) => [p.sev, p.msg])).toEqual([
      ['err', 'Agent a references skill gone, which was not found in project, user or plugin scope.'],
      ['warn', 'Skill big has a 1,025 character description. Descriptions are limited to 1,024 characters.'],
      ['info', 'Skill big is not preloaded by any agent. Claude can still invoke it from its description.'],
      ['info', 'extra info'],
    ]);
    // Sample resources have no file of their own, so the line of the reference is added.
    expect(problems[0]).toMatchObject({ file: '.claude/agents/a.md:8', target: 'a', also: 'gone' });
  });

  it('gives each resource its worst severity, ignoring notes', () => {
    const problems = findProblems(buildModel(nodes, state(['a>ok', 'a>gone'])), extra);
    expect(statusMap(problems)).toEqual({ a: 'err', gone: 'err', big: 'warn' });
  });

  it('has nothing to say once the missing skill is detached and the description shortened', () => {
    const fixed = nodes.map((n) => (n.id === 'big' ? { ...n, desc: 'Short.' } : n));
    const problems = findProblems(buildModel(fixed, state(['a>ok', 'a>big'])));
    expect(problems).toEqual([]);
  });

  it('rejects names that cannot be a file name', () => {
    expect(validName({ ...nodes[0], name: 'a:b' })).toBe(false);
    expect(validName({ ...nodes[0], name: '..' })).toBe(false);
    expect(validName({ ...nodes[0], name: '  ' })).toBe(false);
    expect(validName({ ...nodes[0], name: 'reviewer' })).toBe(true);
    expect(validName({ ...nodes[0], type: 'mem', name: '' })).toBe(true);
  });
});

describe('diff edge cases', () => {
  it('handles empty input on either side', () => {
    expect(diff([], [])).toEqual([]);
    expect(diff([], ['a', 'b']).map((l) => [l.c, l.o, l.n])).toEqual([
      ['add', '', 1],
      ['add', '', 2],
    ]);
    expect(diff(['a', 'b'], []).map((l) => [l.c, l.o, l.n])).toEqual([
      ['del', 1, ''],
      ['del', 2, ''],
    ]);
  });

  it('shows a replaced line as removed, then added', () => {
    expect(diff(['x'], ['y']).map((l) => l.s + l.t)).toEqual(['−x', '+y']);
  });
});
