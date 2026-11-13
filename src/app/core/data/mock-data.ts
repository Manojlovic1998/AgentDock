import { Resource, WorkspaceSnapshot } from '../model/types';

export function makeAgent(
  id: string,
  desc: string,
  model: string,
  tools: string[],
  perm: string,
  mod: string,
  body: string,
): Resource {
  return { id, type: 'agent', name: id, desc, model, tools, perm, mod, body, file: '.claude/agents/' + id + '.md' };
}

export function makeSkill(id: string, desc: string, scope: string, mod: string, extra: Partial<Resource> = {}): Resource {
  const dir = scope === 'user' ? '~/.claude/skills/' : scope === 'plugin' ? 'kendo-toolkit/skills/' : '.claude/skills/';
  return {
    id,
    type: 'skill',
    name: id,
    desc,
    scope,
    mod,
    tools: ['Read', 'Grep', 'Glob'],
    body:
      '## When to use\n' +
      desc +
      '\n\n## Instructions\n1. Read the relevant files before proposing changes.\n2. Follow the examples in `reference/`.\n3. State assumptions when context is missing.',
    file: dir + id + '/SKILL.md',
    ...extra,
  };
}

/** A new slash command with text of its own, as created in the app. */
export function makeCmd(id: string): Resource {
  return {
    id,
    type: 'cmd',
    name: id,
    desc: 'Describe what this command does.',
    hint: '',
    scope: 'project',
    mod: 'just now',
    body: 'Describe the task for Claude. $ARGUMENTS holds what was typed after the command.',
    file: '.claude/commands/' + id + '.md',
  };
}

/** A new project rule with text of its own, as created in the app. */
export function makeRule(id: string): Resource {
  const body = '# ' + id + '\n\nDescribe the convention Claude should follow.';
  return { id, type: 'rule', name: id, desc: 'Describe the convention Claude should follow.', paths: '', scope: 'project', mod: 'just now', body, file: '.claude/rules/' + id + '.md' };
}

/** A new MCP server entry for the project's `.mcp.json`, as created in the app. */
export function makeMcp(id: string): Resource {
  const url = 'https://example.com/mcp';
  return { id, type: 'mcp', name: id, desc: url, transport: 'http', url, scope: 'project', mod: 'just now', file: '.mcp.json' };
}

/** The project's CLAUDE.md, for a project that has none yet. */
export function makeMemory(project: string): Resource {
  const body = '# ' + (project || 'Project') + '\n\nDescribe the project, its commands and its conventions.';
  return { id: 'mem:claude', type: 'mem', name: 'CLAUDE.md', desc: 'Project memory loaded into every session.', scope: 'project', mod: 'just now', body, lines: 3, file: 'CLAUDE.md' };
}

const cmd = (name: string, desc: string, hint: string, mod: string): Resource => ({
  id: 'cmd:' + name,
  type: 'cmd',
  name,
  desc,
  hint,
  mod,
  file: '.claude/commands/' + name + '.md',
});

const mcp = (name: string, transport: string, url: string, mod: string): Resource => ({
  id: 'mcp:' + name,
  type: 'mcp',
  name,
  desc: url,
  transport,
  url,
  mod,
  file: '.mcp.json',
});

const rule = (name: string, paths: string, desc: string, mod: string): Resource => ({
  id: 'rule:' + name,
  type: 'rule',
  name,
  paths,
  desc,
  mod,
  file: '.claude/rules/' + name + '.md',
});

export const ACME_SNAPSHOT: WorkspaceSnapshot = {
  name: 'Acme Platform',
  path: '~/code/acme-platform',
  branch: 'main',
  nodes: [
    makeAgent(
      'ticket-analyst',
      'Analyzes development tickets and identifies requirements.',
      'sonnet',
      ['Read', 'Grep', 'Glob'],
      'plan',
      '2h ago',
      'You analyze Jira tickets for the Acme Platform team.\n\n## Process\n1. Fetch the ticket and linked issues through the jira MCP server.\n2. Map each acceptance criterion to the modules it touches.\n3. List open questions before proposing any implementation.\n\nNever modify files. Report findings as a requirements brief.',
    ),
    makeAgent(
      'angular-developer',
      'Implements Angular features following project conventions.',
      'opus',
      ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'],
      'acceptEdits',
      '18m ago',
      'You implement features in the Acme Platform Angular workspace.\n\n## Conventions\n- Standalone components with OnPush change detection.\n- Signals for local state; NgRx only for shared state.\n- Use Kendo UI components before writing custom controls.\n\nRun `nx affected -t lint test` before reporting work as done.',
    ),
    makeAgent(
      'test-engineer',
      'Creates and maintains automated tests.',
      'sonnet',
      ['Read', 'Edit', 'Write', 'Bash', 'Grep'],
      'acceptEdits',
      'yesterday',
      'You write and maintain automated tests.\n\n## Priorities\n1. Unit tests with Jest and Angular Testing Library.\n2. End-to-end flows with Playwright for critical paths.\n3. Keep fixtures small and colocated with specs.\n\nA failing test must be reproduced before it is changed.',
    ),
    makeAgent(
      'code-reviewer',
      'Reviews implementation quality and identifies potential issues.',
      'opus',
      ['Read', 'Grep', 'Glob', 'Bash'],
      'default',
      '3d ago',
      'You review changes before they are merged.\n\n## Review order\n1. Correctness and regressions.\n2. Adherence to Angular and TypeScript conventions.\n3. Test coverage for changed behavior.\n\nReport findings by severity. Do not rewrite code yourself.',
    ),
    makeAgent(
      'release-scribe',
      'Drafts release notes from merged pull requests.',
      'haiku',
      ['Read', 'Grep'],
      'default',
      '5d ago',
      'You draft release notes for each platform release.\n\nGroup merged pull requests by area, lead with user-facing changes, and link every entry to its pull request.',
    ),
    makeSkill('jira-analysis', 'Extract requirements, acceptance criteria and dependencies from Jira tickets.', 'project', '2h ago'),
    makeSkill('codebase-exploration', 'Locate modules, trace data flow and summarize unfamiliar code before changing it.', 'user', '2w ago'),
    makeSkill('angular-patterns', 'Standalone components, signals, routing and state patterns used in this workspace.', 'project', '4d ago'),
    makeSkill('kendo-components', 'Choose and configure Kendo UI for Angular grids, forms and dialogs.', 'plugin', '1w ago'),
    makeSkill('typescript-best-practices', 'Strict typing, narrowing and API design rules for TypeScript code.', 'project', '6d ago'),
    makeSkill('testing-strategy', 'Decide what to cover with unit, integration and end-to-end tests.', 'project', 'yesterday'),
    makeSkill('code-review', 'Checklist-driven review for correctness, readability and risk.', 'project', '3d ago'),
    makeSkill('changelog-format', 'Referenced by release-scribe but not found in project, user or plugin scope.', 'missing', '', {
      missing: true,
      file: '(not found)',
    }),
    makeSkill('legacy-migration', 'Migrate AngularJS-era modules to standalone Angular components.', 'project', '3mo ago'),
    cmd('analyze-ticket', 'Analyze a Jira ticket and produce a requirements brief.', '[ticket-key]', '2h ago'),
    cmd('implement', 'Implement a ticket end to end with the Angular developer.', '[ticket-key]', '4d ago'),
    cmd('write-tests', 'Add or update tests for the current change.', '[path]', 'yesterday'),
    cmd('review-pr', 'Review the open pull request for the current branch.', '[pr-number]', '3d ago'),
    mcp('jira', 'http', 'https://jira.acme.dev/mcp', '1w ago'),
    mcp('playwright', 'stdio', 'npx @playwright/mcp@latest', '2w ago'),
    mcp('github', 'http', 'https://mcp.acme.dev/github', '1mo ago'),
    {
      id: 'mem:claude',
      type: 'mem',
      name: 'CLAUDE.md',
      desc: 'Project memory loaded into every session: stack, commands and imported rules.',
      mod: '1h ago',
      file: 'CLAUDE.md',
      lines: 412,
    },
    rule('angular-style', 'src/app/**/*.ts', 'Component, template and naming conventions for Angular code.', '4d ago'),
    rule('testing', '**/*.spec.ts', 'Structure and naming for Jest and Playwright specs.', '1w ago'),
    rule('commit-conventions', '', 'Conventional Commits with ticket keys in the scope.', '2mo ago'),
  ],
  rel: [
    'cmd:analyze-ticket>ticket-analyst',
    'cmd:implement>angular-developer',
    'cmd:write-tests>test-engineer',
    'cmd:review-pr>code-reviewer',
    'ticket-analyst>jira-analysis',
    'ticket-analyst>codebase-exploration',
    'ticket-analyst>mcp:jira',
    'angular-developer>codebase-exploration',
    'angular-developer>angular-patterns',
    'angular-developer>kendo-components',
    'angular-developer>typescript-best-practices',
    'test-engineer>typescript-best-practices',
    'test-engineer>testing-strategy',
    'test-engineer>mcp:playwright',
    'code-reviewer>angular-patterns',
    'code-reviewer>typescript-best-practices',
    'code-reviewer>code-review',
    'code-reviewer>mcp:github',
    'release-scribe>changelog-format',
    'release-scribe>mcp:github',
    'mem:claude>rule:angular-style',
    'mem:claude>rule:testing',
    'mem:claude>rule:commit-conventions',
  ],
  docs: [],
  presets: [
    {
      id: 'p:settings',
      kind: 'M',
      file: '.claude/settings.json',
      a: ['{', '  "permissions": {', '    "allow": [', '      "Bash(nx:*)",', '      "Bash(git diff:*)"', '    ],', '    "deny": [', '      "Read(./.env)"', '    ]', '  }', '}'],
      b: ['{', '  "permissions": {', '    "allow": [', '      "Bash(nx:*)",', '      "Bash(git diff:*)",', '      "Bash(npx playwright test:*)"', '    ],', '    "deny": [', '      "Read(./.env)",', '      "Read(./secrets/**)"', '    ]', '  }', '}'],
    },
    {
      id: 'p:style',
      kind: 'A',
      file: '.claude/output-styles/concise-review.md',
      a: [],
      b: ['---', 'name: concise-review', 'description: Terse findings ordered by severity.', '---', '', 'Lead with the verdict. List findings as', 'severity, file and line, then a one-line fix.', 'Skip praise and restating the diff.'],
    },
    {
      id: 'p:deploy',
      kind: 'D',
      file: '.claude/commands/deploy-preview.md',
      a: ['---', 'description: Deploy the current branch to a preview environment.', 'argument-hint: [environment]', '---', '', 'Run `nx run platform:deploy --env=$ARGUMENTS`.'],
      b: [],
    },
  ],
  tables: {
    claudemd: {
      title: 'CLAUDE.md',
      sub: 'Memory files loaded at session start.',
      c: ['File', 'Scope', 'Size'],
      rows: [
        ['~/.claude/CLAUDE.md', 'Personal preferences across projects.', 'user', '27 lines', 'ok', '2mo ago'],
        ['CLAUDE.local.md', 'Local sandbox URLs and test accounts.', 'local', '12 lines', 'ok', '3w ago'],
      ],
    },
    settingsres: {
      title: 'Settings',
      sub: 'settings.json files by scope, highest precedence first.',
      c: ['File', 'Scope', 'Keys'],
      rows: [
        ['.claude/settings.local.json', 'Personal overrides, not committed.', 'local', '2 keys', 'ok', '1w ago'],
        ['.claude/settings.json', 'Shared permissions, hooks and environment.', 'project', '4 keys', 'err', 'today'],
        ['~/.claude/settings.json', 'User defaults for every project.', 'user', '6 keys', 'ok', '1mo ago'],
      ],
    },
    hooks: {
      title: 'Hooks',
      sub: 'Shell commands that run on lifecycle events.',
      c: ['Hook', 'Event', 'Matcher'],
      rows: [
        ['lint-staged', 'Runs lint-staged after file edits.', 'PostToolUse', 'Edit|Write', 'err', '2d ago'],
        ['protect-env', 'Blocks reads of .env and secrets.', 'PreToolUse', 'Read', 'ok', '3w ago'],
        ['notify-done', 'Desktop notification when Claude finishes.', 'Stop', '', 'ok', '1mo ago'],
      ],
    },
    styles: {
      title: 'Output Styles',
      sub: 'Alternate system prompt styles.',
      c: ['Style', 'Scope', 'Based on'],
      rows: [
        ['concise-review', 'Terse findings ordered by severity.', 'project', 'default', 'ok', 'today'],
        ['teaching-mode', 'Explains reasoning while implementing.', 'user', 'default', 'ok', '2mo ago'],
      ],
    },
    plugins: {
      title: 'Plugins',
      sub: 'Installed plugins and what they contribute.',
      c: ['Plugin', 'Version', 'Provides'],
      rows: [
        ['kendo-toolkit', 'Kendo UI skills and component references.', '1.4.0', '1 skill', 'ok', '1w ago'],
        ['commit-commands', 'Git commit, push and pull request commands.', '2.1.0', '3 commands', 'ok', '3w ago'],
      ],
    },
    memory: {
      title: 'Memory',
      sub: 'Auto memory written by Claude for this project.',
      c: ['File', 'Kind', 'Size'],
      rows: [
        ['MEMORY.md', 'Auto memory index for this project.', 'auto', '38 lines', 'ok', '1h ago'],
        ['debugging.md', 'Notes on flaky Playwright runs.', 'auto', '64 lines', 'ok', 'yesterday'],
        ['api-conventions.md', 'Observed REST naming patterns.', 'auto', '41 lines', 'ok', '4d ago'],
      ],
    },
    other: {
      title: 'Other Resources',
      sub: 'Files Claude Code reads that fit no other category.',
      c: ['File', 'Kind', 'Scope'],
      rows: [
        ['statusline.sh', 'Custom status line script.', 'script', 'project', 'ok', '2mo ago'],
        ['keybindings.json', 'Keyboard shortcut overrides.', 'config', 'user', 'ok', '4mo ago'],
      ],
    },
  },
  activity: [
    { t: '18m ago', msg: 'Edited agent angular-developer: model changed to opus' },
    { t: '32m ago', msg: 'Validation run finished with 2 errors and 2 warnings' },
    { t: '1h ago', msg: 'External change detected in .claude/settings.json' },
    { t: '2h ago', msg: 'Created command /analyze-ticket' },
    { t: '1w ago', msg: 'Skill kendo-components discovered from plugin kendo-toolkit' },
  ],
  problems: [
    {
      sev: 'err',
      msg: 'Hook lint-staged runs scripts/lint-staged.sh, but that file does not exist.',
      res: 'lint-staged',
      file: '.claude/settings.json:14',
      screen: 'hooks',
    },
    {
      sev: 'warn',
      msg: 'MCP server jira expands ${JIRA_API_TOKEN}, which is not set in this environment.',
      res: 'jira',
      file: '.mcp.json:6',
      target: 'mcp:jira',
    },
    {
      sev: 'warn',
      msg: 'Skill legacy-migration has a 1,180 character description. Descriptions are limited to 1,024 characters.',
      res: 'legacy-migration',
      file: '.claude/skills/legacy-migration/SKILL.md:3',
      target: 'legacy-migration',
    },
    {
      sev: 'info',
      msg: 'CLAUDE.md is 412 lines. Path-specific guidance loads faster from .claude/rules/.',
      res: 'CLAUDE.md',
      file: 'CLAUDE.md',
      target: 'mem:claude',
    },
    {
      sev: 'info',
      msg: 'Skill typescript-best-practices exists in user and project scope. The project copy takes precedence.',
      res: 'typescript-best-practices',
      file: '~/.claude/skills/typescript-best-practices/SKILL.md',
      target: 'typescript-best-practices',
    },
  ],
  scanned: '2 minutes ago',
};
