import { planRename, renameBlocker } from './rename';
import { FileOp, Resource } from './types';

function res(type: Resource['type'], name: string, over: Partial<Resource> = {}): Resource {
  const dir = { agent: 'agents', cmd: 'commands', rule: 'rules', skill: 'skills', mcp: '', mem: '' }[type];
  const file = type === 'mcp' ? '.mcp.json' : `.claude/${dir}/${name.replace(/:/g, '/')}.md`;
  return { id: `${type}:${name}`, type, name, desc: '', file, mod: '', scope: 'project', raw: '---\n---\n', mtime: 100, ...over };
}

const server = (name: string, over: Partial<Resource> = {}): Resource =>
  res('mcp', name, { raw: JSON.stringify({ mcpServers: { [name]: { command: 'x' } } }), ...over });

const plan = (r: ReturnType<typeof planRename>) => {
  if (!('plan' in r)) throw new Error(r.error);
  return r.plan;
};

describe('renameBlocker', () => {
  it('allows saved project and user-folder commands, rules and servers', () => {
    expect(renameBlocker(res('cmd', 'a'))).toBeUndefined();
    expect(renameBlocker(res('rule', 'a', { scope: 'user', file: '~/.claude/rules/a.md' }))).toBeUndefined();
    expect(renameBlocker(server('a'))).toBeUndefined();
  });

  it('refuses everything that cannot be written back', () => {
    expect(renameBlocker(res('cmd', 'a', { raw: undefined }))).toContain('Save');
    expect(renameBlocker(res('cmd', 'a', { scope: 'plugin' }))).toContain('read-only');
    expect(renameBlocker(res('rule', 'a', { scope: 'managed' }))).toContain('read-only');
    expect(renameBlocker(server('a', { scope: 'user', file: '~/.claude.json' }))).toContain('.claude.json');
    expect(renameBlocker(res('agent', 'a'))).toContain('commands, rules');
  });
});

describe('planRename: commands and rules', () => {
  it('moves the file to the path of the new name, with a colon as a subfolder', () => {
    const cmd = res('cmd', 'commit');
    const p = plan(planRename(cmd, 'git:commit', [cmd]));
    expect(p.ops).toEqual([{ op: 'move', file: '.claude/commands/commit.md', to: '.claude/commands/git/commit.md', mtime: 100 }]);
  });

  it('keeps user scope under ~/.claude and rules in the rules folder', () => {
    const rule = res('rule', 'style', { scope: 'user', file: '~/.claude/rules/style.md' });
    const p = plan(planRename(rule, 'code-style', [rule]));
    expect(p.ops).toEqual([{ op: 'move', file: '~/.claude/rules/style.md', to: '~/.claude/rules/code-style.md', mtime: 100 }]);
  });

  it('rejects an empty, unchanged, invalid or taken name', () => {
    const a = res('cmd', 'a');
    const b = res('cmd', 'b');
    const all = [a, b];
    expect(planRename(a, '  ', all)).toEqual({ error: 'Enter a name' });
    expect(planRename(a, 'a', all)).toEqual({ error: 'That is already the name' });
    expect(planRename(a, 'x/y', all)).toHaveProperty('error');
    expect(planRename(a, 'x::y', all)).toHaveProperty('error');
    expect(planRename(a, 'b', all)).toHaveProperty('error');
  });

  it('only counts mentions in other texts, without rewriting them', () => {
    const cmd = res('cmd', 'deploy');
    const other = res('cmd', 'release', { body: 'Run /deploy first.' });
    const rule = res('rule', 'style');
    const ref = res('mem', 'CLAUDE.md', { body: 'See @.claude/rules/style.md' });
    expect(plan(planRename(cmd, 'ship', [cmd, other])).mentions).toEqual(['release']);
    expect(plan(planRename(rule, 'format', [rule, ref])).mentions).toEqual(['CLAUDE.md']);
    expect(plan(planRename(cmd, 'ship', [cmd, res('cmd', 'x', { body: 'redeploy' })])).mentions).toEqual([]);
  });
});

describe('planRename: MCP servers', () => {
  const agent = (name: string, head: string): Resource => res('agent', name, { raw: `---\n${head}\n---\nBody\n`, mtime: 200 });

  it('re-keys the server with its definition and the scan time of the file', () => {
    const s = server('github', { mtime: 50 });
    const ops = plan(planRename(s, 'gh', [s])).ops;
    expect(ops).toEqual([
      { op: 'jsonRemove', file: '.mcp.json', path: ['mcpServers', 'github'], mtime: 50 },
      { op: 'jsonSet', file: '.mcp.json', path: ['mcpServers', 'gh'], value: { command: 'x' }, mtime: 50 },
    ]);
  });

  it('rewrites mcpServers lists and mcp__ tool entries of every agent that uses it', () => {
    const s = server('github');
    const listed = agent('a', 'mcpServers:\n  - github\n  - other');
    const tooled = agent('b', 'tools: Read, mcp__github__create_issue, mcp__github, mcp__githubx__t');
    const unrelated = agent('c', 'mcpServers: [other]');
    const p = plan(planRename(s, 'gh', [s, listed, tooled, unrelated]));
    const writes = p.ops.filter((o): o is Extract<FileOp, { op: 'write' }> => o.op === 'write');
    expect(writes.map((w) => w.file)).toEqual([listed.file, tooled.file]);
    expect(writes[0].text).toContain('- gh');
    expect(writes[0].text).toContain('- other');
    expect(writes[0].text).not.toContain('github');
    expect(writes[1].text).toContain('mcp__gh__create_issue');
    expect(writes[1].text).toContain('mcp__gh,');
    expect(writes[1].text).toContain('mcp__githubx__t');
    expect(writes.every((w) => w.mtime === 200)).toBe(true);
    expect(p.files).toEqual(['.mcp.json', listed.file, tooled.file]);
  });

  it('refuses a name with spaces or one a server already has', () => {
    const s = server('a');
    expect(planRename(s, 'a b', [s])).toHaveProperty('error');
    expect(planRename(s, 'b', [s, server('b')])).toHaveProperty('error');
  });
});
