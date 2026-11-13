import { buildModel, fileOps, findChanges, findProblems, isDerived, validName } from '../model/analysis';
import { splitCommand } from '../model/mcp';
import { makeCmd, makeMcp, makeMemory, makeRule } from './mock-data';
import { joinDoc, normalizeHead, normalizeSource, patchHead, splitDoc, toList } from '../model/frontmatter';
import { sourceOf } from '../model/source';
import { ResourcePatch, WorkspaceSnapshot, WorkspaceState } from '../model/types';
import { ago, buildSnapshot, hookScripts, scriptOf } from './build-snapshot';
import { ScanFile, ScanResult } from './scan';

const NOW = Date.UTC(2026, 10, 12, 12);
const HOUR = 3600_000;

const AGENT = `---
name: reviewer
# keep this comment
description: "Reviews code: carefully"
tools: Read, Grep, mcp__github__get_pr, Bash(git diff:*, git log:*)
color: purple
skills:
  - review-checklist
  - changelog-format
---

You review changes.

Report findings by severity.
`;

const SKILL = `---
name: review-checklist
description: Checklist for reviews.
---

## Steps
1. Read the diff.
`;

const file = (kind: ScanFile['kind'], path: string, text: string, scope: ScanFile['scope'] = 'project', age = HOUR): ScanFile => ({
  kind,
  scope,
  file: path,
  text,
  mtime: NOW - age,
});

const scan = (files: ScanFile[], patch: Partial<ScanResult> = {}): ScanResult => ({
  root: 'C:\\Users\\dev\\code\\shop',
  home: 'C:\\Users\\dev',
  name: 'shop',
  branch: 'feature/x',
  files,
  plugins: [],
  unsetEnv: [],
  ...patch,
});

const FILES: ScanFile[] = [
  file('agent', '.claude/agents/reviewer.md', AGENT),
  file('skill', '.claude/skills/review-checklist/SKILL.md', SKILL),
  file('skill', '~/.claude/skills/review-checklist/SKILL.md', SKILL, 'user'),
  file('skill', '.claude/skills/unused/SKILL.md', '---\ndescription: Not attached.\n---\nBody\n'),
  file('cmd', '.claude/commands/git/review.md', '---\ndescription: Review the PR.\nargument-hint: [pr-number]\n---\n\nUse the reviewer subagent on $ARGUMENTS.\n'),
  file('rule', '.claude/rules/testing.md', '---\npaths:\n  - "**/*.spec.ts"\n---\n\n# Testing\n\nName specs after the unit.\n'),
  file('claudemd', 'CLAUDE.md', '# Shop\n\nAngular storefront.\n'),
  file('claudemd', '~/.claude/CLAUDE.md', 'Be brief.\n', 'user'),
  file('mcp', '.mcp.json', JSON.stringify({ mcpServers: { github: { type: 'http', url: 'https://mcp.example/gh', headers: { Authorization: 'Bearer ${GH_TOKEN}' } }, pw: { command: 'npx', args: ['@playwright/mcp'] } } })),
  file(
    'settings',
    '.claude/settings.json',
    JSON.stringify({
      permissions: {},
      hooks: { PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/scripts/lint.sh" --fix' }] }], Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] },
    }),
  ),
  file('settings', '.claude/settings.local.json', '{ broken', 'local'),
];

const snapshot = (): WorkspaceSnapshot => buildSnapshot(scan(FILES, { unsetEnv: ['GH_TOKEN'] }), NOW, ['scripts/lint.sh']);

const state = (snap: WorkspaceSnapshot, patch: Partial<WorkspaceState> = {}): WorkspaceState => ({
  rel: snap.rel,
  baseRel: snap.rel,
  over: {},
  baseOver: {},
  added: [],
  addedSaved: [],
  deleted: [],
  deletedSaved: [],
  presets: [],
  docs: {},
  baseDocs: {},
  ...patch,
});

describe('frontmatter', () => {
  it('splits and rejoins files without changing a byte', () => {
    for (const text of [AGENT, SKILL, '# No frontmatter\n\nText\n', '---\nname: x\n---', '---\nname: x\n---\n', 'plain', '']) {
      expect(joinDoc(splitDoc(text))).toBe(text);
    }
    expect(splitDoc(AGENT).body).toBe('You review changes.\n\nReport findings by severity.');
  });

  it('replaces only the lines of the patched key', () => {
    const head = splitDoc(AGENT).head!;
    const patched = patchHead(head, 'skills', ['review-checklist']);
    expect(patched).toEqual(head.filter((l) => l !== '  - changelog-format'));
    expect(patchHead(head, 'color', undefined)).toEqual(head.filter((l) => l !== 'color: purple'));
    expect(patchHead(head, 'model', 'opus')).toEqual([...head, 'model: opus']);
    expect(patchHead(head, 'description', 'a: b')[2]).toBe('description: "a: b"');
  });

  it('normalizes key order and indentation, keeping comments and unknown keys', () => {
    const head = ['# who', 'tools: Read, Grep', 'color: purple', 'skills:', '    - a', '    - b', '# what it does', 'description: "Reviews: code"', 'name: reviewer'];
    expect(normalizeHead(head)).toEqual(['name: reviewer', '# what it does', 'description: "Reviews: code"', '# who', 'tools: Read, Grep', 'skills:', '  - a', '  - b', 'color: purple']);
    const broken = ['name: [unclosed'];
    expect(normalizeHead(broken)).toBe(broken);
    const text = '# No frontmatter\n\nText\n'.split('\n');
    expect(normalizeSource(text)).toBe(text);
    expect(normalizeSource('---\ndescription: d\nname: n\n---\n\nBody\n'.split('\n')).join('\n')).toBe('---\nname: n\ndescription: d\n---\n\nBody\n');
  });

  it('reads comma lists without splitting inside parentheses', () => {
    expect(toList('Read, Bash(git diff:*, git log:*), Grep')).toEqual(['Read', 'Bash(git diff:*, git log:*)', 'Grep']);
    expect(toList(['a', 'b'])).toEqual(['a', 'b']);
    expect(toList(undefined)).toBeUndefined();
  });
});

describe('buildSnapshot', () => {
  it('describes the workspace', () => {
    const s = snapshot();
    expect(s).toMatchObject({ name: 'shop', path: '~/code/shop', branch: 'feature/x', presets: [] });
    expect(ago(NOW - 5 * 60_000, NOW)).toBe('5m ago');
    expect(ago(NOW - 26 * HOUR, NOW)).toBe('yesterday');
    expect(ago(NOW - 70 * 24 * HOUR, NOW)).toBe('2mo ago');
  });

  it('creates nodes from files, with project scope winning over user scope', () => {
    const s = snapshot();
    const by = Object.fromEntries(s.nodes.map((n) => [n.id, n]));
    expect(by['agent:reviewer']).toMatchObject({
      name: 'reviewer',
      desc: 'Reviews code: carefully',
      model: 'inherit',
      perm: 'default',
      tools: ['Read', 'Grep', 'mcp__github__get_pr', 'Bash(git diff:*, git log:*)'],
      file: '.claude/agents/reviewer.md',
      mod: '1h ago',
    });
    expect(by['skill:review-checklist']).toMatchObject({ scope: 'project', file: '.claude/skills/review-checklist/SKILL.md' });
    expect(by['skill:unused'].name).toBe('unused');
    expect(by['cmd:git:review']).toMatchObject({ name: 'git:review', hint: '[pr-number]', desc: 'Review the PR.' });
    expect(by['rule:testing']).toMatchObject({ paths: '**/*.spec.ts', desc: 'Name specs after the unit.' });
    expect(by['mcp:github']).toMatchObject({ transport: 'http', url: 'https://mcp.example/gh' });
    expect(by['mcp:pw']).toMatchObject({ transport: 'stdio', url: 'npx @playwright/mcp' });
    expect(by['mem:claude']).toMatchObject({ lines: 3, file: 'CLAUDE.md' });
    expect(by['skill:changelog-format']).toMatchObject({ missing: true });
  });

  it('derives relationships from frontmatter, tool names, command text and rules', () => {
    const s = snapshot();
    expect(s.rel.slice().sort()).toEqual(
      ['agent:reviewer>skill:review-checklist', 'agent:reviewer>skill:changelog-format', 'agent:reviewer>mcp:github', 'cmd:git:review>agent:reviewer', 'mem:claude>rule:testing'].sort(),
    );
    expect(s.nodes.find((n) => n.id === 'agent:reviewer')!.linked).toHaveLength(3);
  });

  it('fills the lists that have no graph node', () => {
    const t = snapshot().tables;
    expect(t['claudemd'].rows).toEqual([['~/.claude/CLAUDE.md', 'Personal preferences across projects.', 'user', '1 line', 'ok', '1h ago', '~/.claude/CLAUDE.md']]);
    expect(t['settingsres'].rows.map((r) => [r[0], r[3], r[4]])).toEqual([
      ['.claude/settings.local.json', 'invalid JSON', 'err'],
      ['.claude/settings.json', '2 keys', 'ok'],
    ]);
    expect(t['hooks'].rows.map((r) => [r[0], r[2], r[3], r[4]])).toEqual([
      ['lint', 'PostToolUse', 'Edit|Write', 'err'],
      ['echo', 'Stop', '', 'ok'],
    ]);
    expect(Object.keys(t)).toEqual(['claudemd', 'settingsres', 'hooks', 'styles', 'plugins', 'memory', 'other']);
  });

  it('puts managed settings and MCP servers above every other scope', () => {
    const managed = [
      file('settings', 'C:/Program Files/ClaudeCode/managed-settings.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'audit --log' }] }] } }), 'managed'),
      file('mcp', 'C:/Program Files/ClaudeCode/managed-mcp.json', JSON.stringify({ mcpServers: { github: { type: 'http', url: 'https://corp.example/gh' } } }), 'managed'),
    ];
    const s = buildSnapshot(scan(FILES.concat(managed)), NOW);
    expect(s.tables['settingsres'].rows.map((r) => r[2])).toEqual(['managed', 'local', 'project']);
    expect(s.tables['hooks'].rows.map((r) => r[0])).toContain('audit');
    expect(s.nodes.find((n) => n.id === 'mcp:github')).toMatchObject({ scope: 'managed', url: 'https://corp.example/gh' });
    expect(s.problems.map((p) => p.msg)).toContain('MCP server github exists in managed and project scope. The managed copy takes precedence.');
  });

  it('reports what only a scan can know, and the model rules still apply', () => {
    const s = snapshot();
    const problems = findProblems(buildModel(s.nodes, state(s)), s.problems);
    const messages = problems.map((p) => p.sev + ': ' + p.msg);
    expect(messages).toContain('err: Agent reviewer references skill changelog-format, which was not found in project, user or plugin scope.');
    expect(messages).toContain('err: Hook lint runs scripts/lint.sh, but that file does not exist.');
    expect(messages).toContain('err: .claude/settings.local.json is not valid JSON.');
    expect(messages).toContain('warn: MCP server github expands ${GH_TOKEN}, which is not set in this environment.');
    expect(messages).toContain('info: Skill review-checklist exists in project and user scope. The project copy takes precedence.');
    expect(messages).toContain('info: Skill unused is not preloaded by any agent. Claude can still invoke it from its description.');
  });

  it('finds the script a hook runs', () => {
    expect(hookScripts(scan(FILES))).toEqual(['scripts/lint.sh']);
    expect(scriptOf('node .claude/hooks/check.mjs')).toBe('.claude/hooks/check.mjs');
    expect(scriptOf('./scripts/a.sh arg')).toBe('./scripts/a.sh');
    expect(scriptOf('npx prettier --write .')).toBeNull();
  });
});

describe('scanned sources', () => {
  const edited = (over: Record<string, ResourcePatch>, patch: Partial<WorkspaceState> = {}) => {
    const s = snapshot();
    const st = state(s, { over, ...patch });
    return { s, st, changes: findChanges(s.nodes, [], st), model: buildModel(s.nodes, st) };
  };

  it('reproduces every scanned file exactly, so a fresh scan has no changes', () => {
    const { s, changes, model } = edited({});
    expect(changes).toEqual([]);
    for (const n of s.nodes.filter((x) => x.raw !== undefined && x.type !== 'mcp')) {
      expect(sourceOf(n, model.rel, model.by).join('\n')).toBe(n.raw);
    }
  });

  it('changes one line for one edited field and keeps unknown keys and comments', () => {
    const { changes } = edited({ 'agent:reviewer': { model: 'opus' } });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: 'agent:reviewer', kind: 'M', add: 1, del: 0, file: '.claude/agents/reviewer.md' });
    expect(changes[0].text).toBe(AGENT.replace('skills:\n  - review-checklist\n  - changelog-format\n', 'skills:\n  - review-checklist\n  - changelog-format\nmodel: opus\n'));
  });

  it('rewrites the description and the body in place', () => {
    const { changes } = edited({ 'agent:reviewer': { desc: 'Plain text', body: 'New body.' } });
    expect(changes[0].text).toBe(
      AGENT.replace('description: "Reviews code: carefully"', 'description: Plain text').replace('You review changes.\n\nReport findings by severity.', 'New body.'),
    );
  });

  it('writes relationship edits as a delta and drops the tools of a detached MCP server', () => {
    const s = snapshot();
    const rel = s.rel.filter((r) => r !== 'agent:reviewer>mcp:github' && r !== 'agent:reviewer>skill:changelog-format').concat(['agent:reviewer>skill:unused', 'agent:reviewer>mcp:pw']);
    const [change] = findChanges(s.nodes, [], state(s, { rel }));
    expect(change.text).toBe(
      AGENT.replace('tools: Read, Grep, mcp__github__get_pr, Bash(git diff:*, git log:*)', 'tools: Read, Grep, Bash(git diff:*, git log:*)').replace(
        'skills:\n  - review-checklist\n  - changelog-format\n',
        'skills:\n  - review-checklist\n  - unused\nmcpServers:\n  - pw\n',
      ),
    );
  });

  it('turns changes into disk operations', () => {
    const s = snapshot();
    const added = { id: 'untitled-agent', type: 'agent' as const, name: 'helper', desc: 'd', model: 'inherit', tools: ['Read'], perm: 'default', body: 'Hi', file: '.claude/agents/untitled-agent.md', mod: 'just now' };
    const st = state(s, {
      over: { 'skill:unused': { desc: 'Now described.' } },
      added: [added],
      deleted: ['skill:review-checklist', 'mcp:pw', 'cmd:git:review'],
      rel: s.rel.filter((r) => r.indexOf('skill:review-checklist') < 0 && r.indexOf('cmd:git:review') < 0),
    });
    const model = buildModel(s.nodes, st);
    const ops = fileOps(findChanges(s.nodes, [], st), model.allBy);
    const mtime = NOW - HOUR;
    expect(ops).toContainEqual({ op: 'write', file: '.claude/skills/unused/SKILL.md', text: '---\ndescription: Now described.\n---\nBody\n', mtime });
    expect(ops).toContainEqual({ op: 'trash', file: '.claude/skills/review-checklist' });
    expect(ops).toContainEqual({ op: 'trash', file: '.claude/commands/git/review.md' });
    expect(ops).toContainEqual({ op: 'jsonRemove', file: '.mcp.json', path: ['mcpServers', 'pw'], mtime });
    const created = ops.find((o) => o.op === 'write' && o.file === '.claude/agents/helper.md');
    expect(created).toMatchObject({ mtime: undefined });
    expect((created as { text: string }).text).toMatch(/^---\nname: helper\n[\s\S]*\n\nHi\n$/);
    // Detaching the deleted skill also rewrites the agent that listed it.
    expect(ops.filter((o) => o.op === 'write')).toHaveLength(3);
  });
});

describe('editing commands, rules, CLAUDE.md and MCP servers', () => {
  const COMMAND = '---\ndescription: Review the PR.\nargument-hint: [pr-number]\n---\n\nUse the reviewer subagent on $ARGUMENTS.\n';
  const RULE = '---\npaths:\n  - "**/*.spec.ts"\n---\n\n# Testing\n\nName specs after the unit.\n';

  const edited = (over: Record<string, ResourcePatch>, patch: Partial<WorkspaceState> = {}) => {
    const s = snapshot();
    const st = state(s, { over, ...patch });
    const model = buildModel(s.nodes, st);
    const changes = findChanges(s.nodes, [], st);
    return { s, model, changes, ops: fileOps(changes, model.allBy) };
  };

  it('patches a command: description, argument hint and prompt', () => {
    const { changes } = edited({ 'cmd:git:review': { desc: 'Review a pull request.', hint: '', body: 'Review $ARGUMENTS.' } });
    expect(changes).toHaveLength(1);
    expect(changes[0].text).toBe('---\ndescription: Review a pull request.\n---\n\nReview $ARGUMENTS.\n');
    expect(edited({ 'cmd:git:review': { hint: '[pr] [depth]' } }).changes[0].text).toBe(COMMAND.replace('[pr-number]', '"[pr] [depth]"'));
  });

  it('patches a rule: paths and text, without adding a description key', () => {
    const { changes } = edited({ 'rule:testing': { paths: 'src/**/*.ts, e2e/**', body: '# Testing\n\nOne assertion per test.', desc: 'One assertion per test.' } });
    expect(changes[0].text).toBe('---\npaths:\n  - src/**/*.ts\n  - e2e/**\n---\n\n# Testing\n\nOne assertion per test.\n');
    expect(edited({ 'rule:testing': { paths: '' } }).changes[0].text).toBe(RULE.replace('paths:\n  - "**/*.spec.ts"\n', ''));
  });

  it('writes CLAUDE.md as the edited text', () => {
    const { ops } = edited({ 'mem:claude': { body: '# Shop\n\nAngular storefront, strict mode.\n' } });
    expect(ops).toEqual([{ op: 'write', file: 'CLAUDE.md', text: '# Shop\n\nAngular storefront, strict mode.\n', mtime: NOW - HOUR }]);
  });

  it('follows the command text for command → agent relationships', () => {
    expect(edited({}).model.rel).toContainEqual(['cmd:git:review', 'agent:reviewer']);
    const { model } = edited({ 'cmd:git:review': { body: 'Review $ARGUMENTS yourself.' } });
    expect(model.rel.some((r) => r[0] === 'cmd:git:review')).toBe(false);
    expect(isDerived('cmd:git:review', model.by)).toBe(true);
    expect(isDerived('agent:reviewer', model.by)).toBe(false);
  });

  it('rewrites only the edited keys of an MCP server', () => {
    const { ops } = edited({ 'mcp:github': { url: 'https://mcp.example/github' }, 'mcp:pw': { transport: 'http', url: 'https://pw.example/mcp' } });
    expect(ops).toEqual([
      { op: 'jsonSet', file: '.mcp.json', path: ['mcpServers', 'github'], mtime: NOW - HOUR, value: { type: 'http', url: 'https://mcp.example/github', headers: { Authorization: 'Bearer ${GH_TOKEN}' } } },
      { op: 'jsonSet', file: '.mcp.json', path: ['mcpServers', 'pw'], mtime: NOW - HOUR, value: { type: 'http', url: 'https://pw.example/mcp' } },
    ]);
    const local = edited({ 'mcp:github': { transport: 'stdio', url: 'npx -y "@acme/gh server" --stdio' } }).ops[0];
    expect(local).toMatchObject({ value: { type: 'stdio', command: 'npx', args: ['-y', '@acme/gh server', '--stdio'], headers: { Authorization: 'Bearer ${GH_TOKEN}' } } });
    expect(splitCommand('  node  ./a.js ')).toEqual(['node', './a.js']);
  });

  it('gives every new resource a file that follows its name', () => {
    const added = [
      { ...makeCmd('untitled-command'), name: 'git:ship', hint: '[branch]' },
      { ...makeRule('untitled-rule'), name: 'api', paths: 'src/api/**' },
      makeMcp('untitled-server'),
      makeMemory('shop'),
    ];
    const s = buildSnapshot(scan(FILES.filter((f) => f.file !== 'CLAUDE.md')), NOW);
    const st = state(s, { added });
    const model = buildModel(s.nodes, st);
    const ops = fileOps(findChanges(s.nodes, [], st), model.allBy);
    expect(ops).toContainEqual({
      op: 'write',
      file: '.claude/commands/git/ship.md',
      mtime: undefined,
      text: '---\ndescription: Describe what this command does.\nargument-hint: "[branch]"\n---\n\nDescribe the task for Claude. $ARGUMENTS holds what was typed after the command.\n',
    });
    expect(ops).toContainEqual({
      op: 'write',
      file: '.claude/rules/api.md',
      mtime: undefined,
      text: '---\npaths:\n  - src/api/**\n---\n\n# untitled-rule\n\nDescribe the convention Claude should follow.\n',
    });
    expect(ops).toContainEqual({ op: 'jsonSet', file: '.mcp.json', path: ['mcpServers', 'untitled-server'], mtime: NOW - HOUR, value: { type: 'http', url: 'https://example.com/mcp' } });
    expect(ops).toContainEqual({ op: 'write', file: 'CLAUDE.md', mtime: undefined, text: '# shop\n\nDescribe the project, its commands and its conventions.\n' });
    // The new CLAUDE.md is linked to the project rules, old and new.
    expect(model.rel).toContainEqual(['mem:claude', 'rule:testing']);
    expect(model.rel).toContainEqual(['mem:claude', 'untitled-rule']);
  });

  it('accepts only names that work as a file name or a JSON key', () => {
    expect(validName({ ...makeCmd('x'), name: 'git:commit' })).toBe(true);
    expect(validName({ ...makeCmd('x'), name: 'git:' })).toBe(false);
    expect(validName({ ...makeRule('x'), name: 'a/b' })).toBe(false);
    expect(validName({ ...makeMcp('x'), name: 'my server' })).toBe(false);
    expect(validName({ ...makeMcp('x'), name: 'github' })).toBe(true);
  });
});
