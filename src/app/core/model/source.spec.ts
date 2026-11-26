import { makeAgent, makeMemory, makeRule } from '../data/mock-data';
import { parseResource } from './frontmatter';
import { nameFromFile, sourceOf } from './source';
import { Kind, Resource } from './types';

/** A resource as the scan produces it from a file. */
const scanned = (type: Kind, file: string, raw: string, name: string): Resource => ({
  id: type + ':' + name,
  type,
  name,
  desc: '',
  file,
  mod: '',
  raw,
  ...parseResource(type, raw).fields,
});

describe('generated source', () => {
  it('writes a new agent with its frontmatter and prompt', () => {
    const n = makeAgent('helper', 'Helps with work.', 'sonnet', ['Read', 'Grep'], 'plan', 'now', 'Do work.');
    expect(sourceOf(n, [], { helper: n })).toEqual([
      '---',
      'name: helper',
      'description: Helps with work.',
      'model: sonnet',
      'tools: Read, Grep',
      'permissionMode: plan',
      '---',
      '',
      'Do work.',
    ]);
  });

  it('lists the skills and MCP servers a new agent is linked to', () => {
    const n = makeAgent('helper', 'Helps with work.', 'sonnet', ['Read'], 'default', 'now', 'Do work.');
    const skill: Resource = { id: 's1', type: 'skill', name: 'checklist', desc: '', file: '', mod: '' };
    const server: Resource = { id: 'm1', type: 'mcp', name: 'jira', desc: '', file: '.mcp.json', mod: '' };
    const lines = sourceOf(
      n,
      [
        ['helper', 's1'],
        ['helper', 'm1'],
        ['other', 's1'],
      ],
      { helper: n, s1: skill, m1: server },
    );
    expect(lines.slice(lines.indexOf('permissionMode: default') + 1, lines.lastIndexOf('---'))).toEqual(['skills:', '  - checklist', 'mcpServers:', '  - jira']);
  });

  it('writes a new skill with its allowed tools', () => {
    const n: Resource = { id: 's', type: 'skill', name: 's', desc: 'Does s.', tools: ['Read'], body: 'Steps.', file: '.claude/skills/s/SKILL.md', mod: '' };
    expect(sourceOf(n, [], { s: n })).toEqual(['---', 'name: s', 'description: Does s.', 'allowed-tools: Read', '---', '', 'Steps.']);
  });

  it('writes a new rule without paths as text only', () => {
    const n = makeRule('style');
    expect(sourceOf(n, [], { style: n })).toEqual(['# style', '', 'Describe the convention Claude should follow.']);
  });

  it('writes a new CLAUDE.md as its text', () => {
    const n = makeMemory('shop');
    expect(sourceOf(n, [], { [n.id]: n })).toEqual(['# shop', '', 'Describe the project, its commands and its conventions.']);
  });
});

describe('patched source', () => {
  const SKILL = '---\ndescription: d\nallowed-tools:\n  - Read\n---\nBody\n';

  it('keeps a tool list a YAML sequence when it was one', () => {
    const n = { ...scanned('skill', '.claude/skills/s/SKILL.md', SKILL, 's'), tools: ['Read', 'Grep'] };
    expect(sourceOf(n, [], { [n.id]: n }).join('\n')).toBe('---\ndescription: d\nallowed-tools:\n  - Read\n  - Grep\n---\nBody\n');
  });

  it('adds a name key only when the name differs from the folder name', () => {
    const n = scanned('skill', '.claude/skills/s/SKILL.md', SKILL, 's');
    expect(sourceOf(n, [], { [n.id]: n }).join('\n')).toBe(SKILL);
    const renamed = { ...n, name: 't' };
    expect(sourceOf(renamed, [], { [n.id]: renamed }).join('\n')).toBe('---\ndescription: d\nallowed-tools:\n  - Read\nname: t\n---\nBody\n');
  });

  it('adds frontmatter to a file that had none, with a blank line before the text', () => {
    const n = { ...scanned('cmd', '.claude/commands/x.md', 'Body only\n', 'x'), desc: 'New.' };
    expect(sourceOf(n, [], { [n.id]: n }).join('\n')).toBe('---\ndescription: New.\n---\n\nBody only\n');
  });
});

describe('nameFromFile', () => {
  it('names a skill after its folder and other kinds after the file', () => {
    expect(nameFromFile({ id: 'x', type: 'skill', name: '', desc: '', file: '.claude/skills/foo/SKILL.md', mod: '' })).toBe('foo');
    expect(nameFromFile({ id: 'x', type: 'agent', name: '', desc: '', file: '.claude/agents/bar.md', mod: '' })).toBe('bar');
  });
});
