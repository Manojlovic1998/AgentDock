/**
 * Reading and editing the `hooks` key of a settings file as text, so the rest of the file,
 * its indentation included, stays as it is.
 */

/** Lifecycle events a hook can run on, in the order the dialog offers them. */
export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'SessionStart',
  'SessionEnd',
];

/** Where a hook sits inside the `hooks` key of one settings file. */
export interface HookAt {
  event: string;
  /** Index of the matcher group within the event. */
  group: number;
  /** Index of the hook within the group. */
  index: number;
}

/** What the app edits of a hook. */
export interface HookFields {
  event: string;
  /** Tool name pattern; empty runs the hook for every tool. */
  matcher: string;
  command: string;
}

/** A command hook found in a settings file. */
export interface HookEntry extends HookFields {
  at: HookAt;
}

type Json = Record<string, any>;

function parse(text: string): Json | null {
  try {
    const v: unknown = JSON.parse(text.trim() ? text : '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
  } catch {
    return null;
  }
}

/** Writes the object back with the indentation and final newline the text had. */
function print(json: Json, text: string): string {
  const indent = /^\{\r?\n([ \t]+)/.exec(text)?.[1] ?? '  ';
  return JSON.stringify(json, null, indent) + (text.trim() && !text.endsWith('\n') ? '' : '\n');
}

/**
 * The command hooks of a settings file.
 *
 * @param text - Content of the settings file.
 * @returns One entry per hook that runs a command, in file order. Empty for invalid JSON.
 */
export function listHooks(text: string): HookEntry[] {
  const events = parse(text)?.['hooks'];
  const out: HookEntry[] = [];
  if (!events || typeof events !== 'object') return out;
  Object.entries(events as Json).forEach(([event, groups]) => {
    (Array.isArray(groups) ? groups : []).forEach((g: Json, group: number) => {
      (Array.isArray(g?.['hooks']) ? g['hooks'] : []).forEach((h: Json, index: number) => {
        if (typeof h?.['command'] !== 'string') return;
        out.push({ event, matcher: typeof g['matcher'] === 'string' ? g['matcher'] : '', command: h['command'], at: { event, group, index } });
      });
    });
  });
  return out;
}

/** Removes the hook at a position, and the group, event and `hooks` key it leaves empty. */
function drop(json: Json, at: HookAt): Json | undefined {
  const groups = json['hooks']?.[at.event];
  const group = Array.isArray(groups) ? groups[at.group] : undefined;
  if (!group || !Array.isArray(group['hooks'])) return undefined;
  const [removed] = group['hooks'].splice(at.index, 1);
  if (!group['hooks'].length) groups.splice(at.group, 1);
  if (!groups.length) delete json['hooks'][at.event];
  if (!Object.keys(json['hooks']).length) delete json['hooks'];
  return removed as Json | undefined;
}

/**
 * Removes one hook from a settings file.
 *
 * @param text - Content of the settings file.
 * @param at - Position of the hook, as {@link listHooks} reported it.
 * @returns The new content, or null when the file is not a JSON object.
 */
export function removeHook(text: string, at: HookAt): string | null {
  const json = parse(text);
  if (!json) return null;
  // A hook that is not there leaves the file exactly as it was, formatting included.
  if (!drop(json, at)) return text;
  return print(json, text);
}

/**
 * Adds a hook to a settings file, or changes one.
 *
 * @remarks
 * A hook whose event and matcher stay the same is changed in place, so keys such as `timeout`
 * survive. Otherwise it moves to the group for its new event and matcher, which is created when
 * there is none.
 *
 * @param text - Content of the settings file; empty for a file that does not exist yet.
 * @param at - Position of the hook to change, or null to add one.
 * @param hook - The values to write.
 * @returns The new content, or null when the file is not a JSON object.
 */
export function setHook(text: string, at: HookAt | null, hook: HookFields): string | null {
  const json = parse(text);
  if (!json) return null;
  const matcher = hook.matcher.trim();
  let entry: Json = { type: 'command', command: hook.command };
  if (at) {
    const group = json['hooks']?.[at.event]?.[at.group];
    const existing = group?.['hooks']?.[at.index] as Json | undefined;
    if (existing && at.event === hook.event && (typeof group['matcher'] === 'string' ? group['matcher'] : '') === matcher) {
      existing['command'] = hook.command;
      return print(json, text);
    }
    entry = { ...(drop(json, at) ?? entry), command: hook.command };
  }
  const hooks: Json = (json['hooks'] ??= {});
  const groups: Json[] = Array.isArray(hooks[hook.event]) ? hooks[hook.event] : (hooks[hook.event] = []);
  const target = groups.find((g) => (typeof g['matcher'] === 'string' ? g['matcher'] : '') === matcher && Array.isArray(g['hooks']));
  if (target) target['hooks'].push(entry);
  else groups.push(matcher ? { matcher, hooks: [entry] } : { hooks: [entry] });
  return print(json, text);
}
