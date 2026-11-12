import { joinDoc, parseResource, patchHead, toList } from './frontmatter';
import { RelPair, Resource, SourceLine, Token } from './types';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Whether a tool entry grants access to the named MCP server: mcp__name or mcp__name__tool. */
const isMcpTool = (tool: string, server: string): boolean => tool === 'mcp__' + server || tool.startsWith('mcp__' + server + '__');

/**
 * Source of a scanned agent or skill: the file as read, with only the edited keys rewritten.
 * An untouched resource gives back its file unchanged, so unknown keys and comments survive a save.
 */
function patchedSource(n: Resource, out: Resource[], by: Record<string, Resource>): string[] {
  const p = parseResource(n.type, n.raw!);
  const was = p.fields;
  let head = p.doc.head ?? [];
  let touched = false;
  const set = (key: string, value: unknown): void => {
    head = patchHead(head, key, value);
    touched = true;
  };
  /** Lists keep the style the file used: a YAML sequence stays one, otherwise comma-separated. */
  const setList = (key: string, list: string[] | undefined): void =>
    set(key, list === undefined ? undefined : Array.isArray(p.data[key]) ? list : list.join(', '));

  if (n.name !== (was.name ?? nameFromFile(n))) set('name', n.name);
  if (n.desc !== was.desc) set('description', n.desc);

  let tools = n.tools;
  if (n.type === 'agent') {
    if (n.model !== was.model) set('model', n.model);
    if (n.perm !== was.perm) set('permissionMode', n.perm);

    // Relationships are written as a delta against the scan, so entries AgentDock did not link stay put.
    const base = n.linked ?? [];
    const cur = out.map((t) => t.id);
    const gone = base.filter((id) => cur.indexOf(id) < 0);
    const added = out.filter((t) => base.indexOf(t.id) < 0);
    const nameOf = (id: string): string => by[id]?.name ?? id.slice(id.indexOf(':') + 1);
    const goneNames = (prefix: string): string[] => gone.filter((id) => id.startsWith(prefix)).map(nameOf);

    const skillsGone = goneNames('skill:');
    const skillsAdded = added.filter((t) => t.type === 'skill').map((t) => t.name);
    if (skillsGone.length || skillsAdded.length) {
      const list = (toList(p.data['skills']) ?? []).filter((s) => skillsGone.indexOf(s) < 0).concat(skillsAdded);
      set('skills', list.length ? list : undefined);
    }

    const mcpGone = goneNames('mcp:');
    const mcpAdded = added.filter((t) => t.type === 'mcp').map((t) => t.name);
    if (mcpGone.length || mcpAdded.length) {
      const cfg = p.data['mcpServers'];
      // Inline server definitions (objects) are kept; only names are added or removed.
      const list: unknown[] = (Array.isArray(cfg) ? cfg : []).filter((s) => typeof s !== 'string' || mcpGone.indexOf(s) < 0);
      set('mcpServers', list.concat(mcpAdded).length ? list.concat(mcpAdded) : undefined);
      tools = tools?.filter((t) => !mcpGone.some((s) => isMcpTool(t, s)));
    }
    if (!same(tools, was.tools)) setList('tools', tools);
  } else if (!same(tools, was.tools)) {
    setList('allowed-tools', tools);
  }

  const doc = { ...p.doc, head: touched || p.doc.head ? head : null };
  if (n.body !== undefined && n.body !== was.body) doc.body = n.body;
  if (doc.head && !p.doc.head && !doc.lead) doc.lead = '\n';
  return joinDoc(doc).split('\n');
}

/** Name a resource has when its frontmatter does not state one: the file or skill folder name. */
export function nameFromFile(n: Resource): string {
  const parts = n.file.split('/');
  return n.type === 'skill' ? (parts[parts.length - 2] ?? '') : parts[parts.length - 1].replace(/\.md$/, '');
}

/** The on-disk source of a resource: its scanned file with pending edits applied, or generated when there is no file yet. */
export function sourceOf(n: Resource, rel: RelPair[], by: Record<string, Resource>): string[] {
  const out = rel.filter((r) => r[0] === n.id && by[r[1]]).map((r) => by[r[1]]);
  if (n.raw !== undefined) return n.type === 'agent' || n.type === 'skill' ? patchedSource(n, out, by) : n.raw.split('\n');
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
