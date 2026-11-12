import { RelPair, Resource, SourceLine, Token } from './types';

/** Generates the on-disk source of a resource from its fields and outgoing relationships. */
export function sourceOf(n: Resource, rel: RelPair[], by: Record<string, Resource>): string[] {
  const out = rel.filter((r) => r[0] === n.id && by[r[1]]).map((r) => by[r[1]]);
  const L: string[] = [];
  if (n.type === 'agent') {
    L.push(
      '---',
      'name: ' + n.name,
      'description: ' + n.desc,
      'model: ' + n.model,
      'tools: ' + (n.tools ?? []).join(', '),
      'permissionMode: ' + n.perm,
    );
    const sk = out.filter((t) => t.type === 'skill');
    const mc = out.filter((t) => t.type === 'mcp');
    if (sk.length) {
      L.push('skills:');
      sk.forEach((t) => L.push('  - ' + t.name));
    }
    if (mc.length) {
      L.push('mcpServers:');
      mc.forEach((t) => L.push('  - ' + t.name));
    }
    L.push('---', '', ...(n.body ?? '').split('\n'));
  } else if (n.type === 'skill') {
    L.push('---', 'name: ' + n.name, 'description: ' + n.desc, 'allowed-tools: ' + (n.tools ?? []).join(', '), '---', '');
    L.push(...(n.body ?? '').split('\n'));
  } else if (n.type === 'cmd') {
    L.push('---', 'description: ' + n.desc, 'argument-hint: ' + n.hint, '---', '');
    L.push(
      out.length ? 'Use the ' + out[0].name + ' subagent to handle $ARGUMENTS.' : 'Handle $ARGUMENTS in the main conversation.',
      'Summarize the outcome in five lines or fewer.',
    );
  } else if (n.type === 'rule') {
    L.push('---');
    if (n.paths) L.push('paths:', '  - "' + n.paths + '"');
    else L.push('# no paths: always loaded');
    L.push('---', '', '# ' + n.name, '', n.desc);
  } else if (n.type === 'mcp') {
    L.push('{', '  "mcpServers": {', '    "' + n.name + '": {');
    if (n.transport === 'http') {
      L.push('      "type": "http",', '      "url": "' + n.url + '"' + (n.name === 'jira' ? ',' : ''));
      if (n.name === 'jira') L.push('      "headers": { "Authorization": "Bearer ${JIRA_API_TOKEN}" }');
    } else {
      L.push('      "command": "npx",', '      "args": ["@playwright/mcp@latest"]');
    }
    L.push('    }', '  }', '}');
  } else {
    L.push(
      '# Acme Platform',
      '',
      'Nx monorepo with an Angular app, Kendo UI, Jest and Playwright.',
      '',
      '## Commands',
      '- `nx serve platform` starts the dev server',
      '- `nx affected -t lint test` before every commit',
      '',
      '## Rules',
    );
    out.forEach((t) => L.push('- @.claude/rules/' + t.name + '.md'));
  }
  return L;
}

/** Splits source lines into styled tokens (frontmatter keys, headings, JSON keys, list items). */
export function highlight(lines: string[]): SourceLine[] {
  return lines.map((t, i) => {
    let toks: Token[];
    let m: RegExpExecArray | null;
    if (t === '---') toks = [{ c: 'tk-p', t }];
    else if (/^(#+ .*)$/.test(t)) toks = [{ c: 'tk-h', t }];
    else if ((m = /^(\s*)("[^"]+")(:\s*)(.*)$/.exec(t)))
      toks = [
        { c: 'tk-n', t: m[1] },
        { c: 'tk-k', t: m[2] },
        { c: 'tk-p', t: m[3] },
        { c: 'tk-s', t: m[4] },
      ];
    else if ((m = /^(\s*-\s)(.*)$/.exec(t)))
      toks = [
        { c: 'tk-p', t: m[1] },
        { c: 'tk-s', t: m[2] },
      ];
    else if ((m = /^([A-Za-z-]+)(:)(.*)$/.exec(t)))
      toks = [
        { c: 'tk-k', t: m[1] },
        { c: 'tk-p', t: m[2] },
        { c: 'tk-s', t: m[3] },
      ];
    else toks = [{ c: 'tk-n', t: t || ' ' }];
    return { no: i + 1, toks };
  });
}
