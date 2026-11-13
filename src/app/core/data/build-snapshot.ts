import { derivedRel } from '../model/analysis';
import { parseResource, toList } from '../model/frontmatter';
import { McpConfig, mcpFields } from '../model/mcp';
import { plural } from '../model/graph';
import { nameFromFile } from '../model/source';
import { FileDoc, Kind, Problem, Resource, StaticTable, Status, WorkspaceSnapshot } from '../model/types';
import { ScanFile, ScanResult, ScanScope } from './scan';

type Row = StaticTable['rows'][number];

const SCOPE_RANK: Record<ScanScope, number> = { managed: -1, project: 0, local: 1, user: 2, plugin: 3 };
const LONG_MEMORY = 200;

const lineCount = (text: string): number => (text ? text.replace(/\n$/, '').split('\n').length : 0);
const baseName = (file: string): string => file.slice(file.lastIndexOf('/') + 1);

/** Relative age in the short form the lists use: "18m ago", "yesterday", "3mo ago". */
export function ago(then: number, now: number): string {
  const min = Math.floor((now - then) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + 'm ago';
  const h = Math.floor(min / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return d + 'd ago';
  if (d < 30) return Math.floor(d / 7) + 'w ago';
  if (d < 365) return Math.floor(d / 30) + 'mo ago';
  return Math.floor(d / 365) + 'y ago';
}

function tables(): Record<string, StaticTable> {
  const t = (title: string, sub: string, c: [string, string, string]): StaticTable => ({ title, sub, c, rows: [] });
  return {
    claudemd: t('CLAUDE.md', 'Memory files loaded at session start.', ['File', 'Scope', 'Size']),
    settingsres: t('Settings', 'settings.json files by scope, highest precedence first.', ['File', 'Scope', 'Keys']),
    hooks: t('Hooks', 'Shell commands that run on lifecycle events.', ['Hook', 'Event', 'Matcher']),
    styles: t('Output Styles', 'Alternate system prompt styles.', ['Style', 'Scope', 'Size']),
    plugins: t('Plugins', 'Installed plugins and what they contribute.', ['Plugin', 'Version', 'Provides']),
    memory: t('Memory', 'Auto memory written by Claude for this project.', ['File', 'Kind', 'Size']),
    other: t('Other Resources', 'Files Claude Code reads that fit no other category.', ['File', 'Kind', 'Scope']),
  };
}

/** A workspace with nothing in it: shown before the first load and when a folder cannot be read. */
export function emptySnapshot(name = '', path = ''): WorkspaceSnapshot {
  return { name, path, branch: '', nodes: [], docs: [], rel: [], presets: [], tables: tables(), activity: [], problems: [], scanned: 'just now' };
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const INTERPRETERS = /^(bash|sh|zsh|node|python3?|pwsh|powershell|deno|bun|tsx)(\.exe)?$/;
const SCRIPT = /\.(sh|js|mjs|cjs|ts|py|ps1|cmd|bat)$/;

/** The script file a hook command runs, if it names one that can be checked on disk. */
export function scriptOf(command: string): string | null {
  const tokens = (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) => t.replace(/^["']|["']$/g, ''));
  const first = tokens.findIndex((t) => !/^\w+=/.test(t));
  if (first < 0) return null;
  const head = baseName(tokens[first].replace(/\\/g, '/'));
  const token = INTERPRETERS.test(head) ? tokens.slice(first + 1).find((t) => !t.startsWith('-')) : tokens[first];
  if (!token) return null;
  const path = token.replace(/^\$\{?CLAUDE_PROJECT_DIR\}?[\\/]/, '').replace(/\\/g, '/');
  return SCRIPT.test(path) && path.indexOf('$') < 0 ? path : null;
}

interface Hook {
  name: string;
  command: string;
  event: string;
  matcher: string;
  src: ScanFile;
  script: string | null;
}

function hooksOf(scan: ScanResult): Hook[] {
  const out: Hook[] = [];
  scan.files
    .filter((f) => f.kind === 'settings')
    .forEach((src) => {
      const events = parseJson(src.text)?.['hooks'];
      if (!events || typeof events !== 'object') return;
      Object.entries(events as Record<string, unknown>).forEach(([event, groups]) => {
        (Array.isArray(groups) ? groups : []).forEach((g: { matcher?: unknown; hooks?: unknown }) => {
          (Array.isArray(g?.hooks) ? g.hooks : []).forEach((h: { command?: unknown }) => {
            if (typeof h?.command !== 'string') return;
            const script = scriptOf(h.command);
            const name = script ? baseName(script).replace(SCRIPT, '') : h.command.trim().split(/\s+/)[0];
            out.push({ name, command: h.command, event, matcher: typeof g.matcher === 'string' ? g.matcher : '', src, script });
          });
        });
      });
    });
  return out;
}

/** Script paths referenced by hooks; the caller checks which exist and passes the missing ones back. */
export function hookScripts(scan: ScanResult): string[] {
  return [...new Set(hooksOf(scan).flatMap((h) => (h.script ? [h.script] : [])))];
}

const MEMORY_DESC: Record<ScanScope, string> = {
  managed: 'Memory deployed by your organization.',
  project: 'Project memory shared with the team.',
  local: 'Local notes for this checkout, not committed.',
  user: 'Personal preferences across projects.',
  plugin: 'Memory contributed by a plugin.',
};

const SETTINGS_DESC: Record<ScanScope, string> = {
  managed: 'Deployed by your organization. Overrides every other scope.',
  local: 'Personal overrides, not committed.',
  project: 'Shared permissions, hooks and environment.',
  user: 'User defaults for every project.',
  plugin: 'Settings contributed by a plugin.',
};

/**
 * Turns scanned files into the snapshot the UI renders: graph nodes, relationships, the static
 * lists and the findings that depend on the file system. Pure, so it can be tested with fixtures.
 */
export function buildSnapshot(scan: ScanResult, now: number, missingScripts: string[] = []): WorkspaceSnapshot {
  const files = scan.files.slice().sort((a, b) => SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope]);
  const nodes: Resource[] = [];
  const by: Record<string, Resource> = {};
  const data: Record<string, Record<string, unknown>> = {};
  const problems: Problem[] = [];
  const rel: string[] = [];
  const snap = emptySnapshot(scan.name, scan.root.replace(scan.home, '~').replace(/\\/g, '/'));
  const T = snap.tables;
  const mod = (f: { mtime: number }): string => ago(f.mtime, now);
  const scopeOf = (f: ScanFile): string => (f.scope === 'local' ? 'project' : f.scope);

  /** Adds a node unless a higher-precedence scope already defines it. */
  const add = (n: Resource, kindLabel: string, f: ScanFile): boolean => {
    const first = by[n.id];
    if (first) {
      problems.push({
        sev: 'info',
        msg: `${kindLabel} ${n.name} exists in ${first.scope} and ${f.scope} scope. The ${first.scope} copy takes precedence.`,
        res: n.name,
        file: f.file,
        target: n.id,
      });
      return false;
    }
    by[n.id] = n;
    nodes.push(n);
    return true;
  };

  const markdown = (kind: Kind, label: string, f: ScanFile, nameOf: (n: Resource) => string): void => {
    const p = parseResource(kind, f.text);
    const n: Resource = { id: '', type: kind, name: '', desc: '', file: f.file, mod: mod(f), scope: scopeOf(f), raw: f.text, mtime: f.mtime };
    Object.assign(n, p.fields);
    if (!p.fields.name || kind === 'cmd' || kind === 'rule') n.name = nameOf(n);
    n.id = kind + ':' + n.name;
    if (!add(n, label, f)) return;
    data[n.id] = p.data;
    if (p.error) problems.push({ sev: 'warn', msg: `${label} ${n.name} has frontmatter that could not be read: ${p.error}`, res: n.name, file: f.file, target: n.id });
  };

  /** Name from the path below a folder: commands/git/commit.md is the command "git:commit". */
  const nested = (folder: string) => (n: Resource): string => {
    const at = n.file.lastIndexOf('/' + folder + '/');
    return n.file.slice(at < 0 ? n.file.lastIndexOf('/') + 1 : at + folder.length + 2).replace(/\.md$/, '').replace(/\//g, ':');
  };

  const of = (kind: ScanFile['kind']): ScanFile[] => files.filter((f) => f.kind === kind);

  of('agent').forEach((f) => markdown('agent', 'Agent', f, nameFromFile));
  of('skill').forEach((f) => markdown('skill', 'Skill', f, nameFromFile));
  of('cmd').forEach((f) => markdown('cmd', 'Command', f, nested('commands')));

  of('mcp').forEach((f) => {
    const json = parseJson(f.text);
    const servers = json?.['mcpServers'];
    if (!json) problems.push({ sev: 'err', msg: `${f.file} is not valid JSON.`, res: baseName(f.file), file: f.file, screen: 'mcp' });
    if (!servers || typeof servers !== 'object') return;
    Object.entries(servers as Record<string, Record<string, unknown>>).forEach(([name, cfg]) => {
      const { transport, url } = mcpFields(cfg as McpConfig);
      const raw = JSON.stringify({ mcpServers: { [name]: cfg } }, null, 2);
      const n: Resource = {
        id: 'mcp:' + name,
        type: 'mcp',
        name,
        desc: url,
        transport,
        url,
        file: f.file,
        mod: mod(f),
        scope: scopeOf(f),
        raw,
        mtime: f.mtime,
      };
      if (!add(n, 'MCP server', f)) return;
      const unset = [...raw.matchAll(/\$\{([A-Za-z_]\w*)\}/g)].map((m) => m[1]).filter((v) => scan.unsetEnv.indexOf(v) >= 0);
      [...new Set(unset)].forEach((v) =>
        problems.push({ sev: 'warn', msg: `MCP server ${name} expands \${${v}}, which is not set in this environment.`, res: name, file: f.file, target: n.id }),
      );
    });
  });

  // The project's own CLAUDE.md is the memory node on the graph; other memory files are listed.
  const memories = of('claudemd');
  const main = memories.find((f) => f.scope === 'project');
  if (main) {
    const lines = lineCount(main.text);
    add(
      { id: 'mem:claude', type: 'mem', name: 'CLAUDE.md', desc: 'Project memory loaded into every session.', file: main.file, mod: mod(main), scope: 'project', raw: main.text, body: main.text, mtime: main.mtime, lines },
      'Memory file',
      main,
    );
    if (lines > LONG_MEMORY)
      problems.push({ sev: 'info', msg: `CLAUDE.md is ${lines} lines. Path-specific guidance loads faster from .claude/rules/.`, res: 'CLAUDE.md', file: main.file, target: 'mem:claude' });
  }
  memories.filter((f) => f !== main).forEach((f) => T['claudemd'].rows.push([f.file, MEMORY_DESC[f.scope], f.scope, plural(lineCount(f.text), 'line'), 'ok', mod(f), f.file]));

  of('rule').forEach((f) => markdown('rule', 'Rule', f, nested('rules')));

  /* ---------- relationships ---------- */

  const link = (from: string, to: string): void => {
    const key = from + '>' + to;
    if (rel.indexOf(key) < 0) rel.push(key);
  };

  nodes
    .filter((n) => n.type === 'agent')
    .forEach((a) => {
      const d = data[a.id] ?? {};
      (toList(d['skills']) ?? []).forEach((name) => {
        const id = 'skill:' + name;
        if (!by[id])
          add(
            { id, type: 'skill', name, desc: `Referenced by ${a.name} but not found in project, user or plugin scope.`, scope: 'missing', mod: '', missing: true, file: '(not found)' },
            'Skill',
            files[0],
          );
        link(a.id, id);
      });
      const servers = (Array.isArray(d['mcpServers']) ? (d['mcpServers'] as unknown[]) : []).filter((s): s is string => typeof s === 'string');
      const fromTools = (a.tools ?? []).flatMap((t) => /^mcp__(.+?)(?:__.*)?$/.exec(t)?.[1] ?? []);
      servers.concat(fromTools).forEach((name) => {
        if (by['mcp:' + name]) link(a.id, 'mcp:' + name);
      });
    });

  // Command → agent and CLAUDE.md → rule follow from content. The model derives them again while editing.
  derivedRel(nodes).forEach(([from, to]) => link(from, to));

  nodes.forEach((n) => {
    if (n.type === 'agent') n.linked = rel.filter((r) => r.startsWith(n.id + '>')).map((r) => r.slice(n.id.length + 1));
  });

  /* ---------- lists without graph nodes ---------- */

  of('settings').forEach((f) => {
    const json = parseJson(f.text);
    const st: Status = json ? 'ok' : 'err';
    T['settingsres'].rows.push([f.file, SETTINGS_DESC[f.scope], f.scope, json ? plural(Object.keys(json).length, 'key') : 'invalid JSON', st, mod(f), f.file]);
    if (!json) problems.push({ sev: 'err', msg: `${f.file} is not valid JSON.`, res: baseName(f.file), file: f.file, screen: 'settingsres' });
  });
  const precedence = ['managed', 'local', 'project', 'user'];
  T['settingsres'].rows.sort((a, b) => precedence.indexOf(a[2]) - precedence.indexOf(b[2]));

  hooksOf(scan).forEach((h) => {
    const missing = !!h.script && missingScripts.indexOf(h.script) >= 0;
    T['hooks'].rows.push([h.name, h.command, h.event, h.matcher, missing ? 'err' : 'ok', mod(h.src)]);
    if (missing)
      problems.push({ sev: 'err', msg: `Hook ${h.name} runs ${h.script}, but that file does not exist.`, res: h.name, file: h.src.file, screen: 'hooks' });
  });

  of('style').forEach((f) => {
    const p = parseResource('rule', f.text);
    const name = typeof p.data['name'] === 'string' ? p.data['name'] : baseName(f.file).replace(/\.md$/, '');
    T['styles'].rows.push([name, p.fields.desc ?? '', f.scope, plural(lineCount(f.text), 'line'), 'ok', mod(f), f.file]);
  });

  scan.plugins.forEach((pl) => {
    const count = (kind: ScanFile['kind'], word: string): string[] => {
      const n = files.filter((f) => f.plugin === pl.name && f.kind === kind).length;
      return n ? [plural(n, word)] : [];
    };
    const provides = [...count('skill', 'skill'), ...count('agent', 'agent'), ...count('cmd', 'command'), ...count('mcp', 'MCP file')];
    T['plugins'].rows.push([pl.name, pl.description, pl.version, provides.join(', ') || 'nothing scanned', 'ok', mod(pl)]);
  });

  of('memory').forEach((f) => {
    const p = parseResource('rule', f.text);
    T['memory'].rows.push([baseName(f.file), p.fields.desc ?? '', 'auto', plural(lineCount(f.text), 'line'), 'ok', mod(f), f.file]);
  });

  of('other').forEach((f) => {
    const name = baseName(f.file);
    const kind = /\.json$/.test(name) ? 'config' : SCRIPT.test(name) ? 'script' : 'file';
    T['other'].rows.push([name, f.file, kind, f.scope, 'ok', mod(f)]);
  });

  // Files edited as text: everything scanned with content that is not a node on the graph.
  snap.docs = files
    .filter((f) => f !== main && (f.kind === 'settings' || f.kind === 'style' || f.kind === 'memory' || f.kind === 'claudemd'))
    .map((f) => ({ file: f.file, kind: f.kind as FileDoc['kind'], scope: f.scope, text: f.text, mtime: f.mtime, writable: f.scope !== 'managed' && f.scope !== 'plugin' }));

  snap.branch = scan.branch || 'no branch';
  snap.nodes = nodes;
  snap.rel = rel;
  snap.problems = problems;
  snap.scanned = 'at ' + new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  snap.activity = [{ t: 'just now', msg: `Scanned ${plural(files.length, 'file')} in ${scan.name}` }];
  return snap;
}
