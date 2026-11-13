import { listHooks, removeHook, setHook } from './hooks';

const SETTINGS = `{
    "permissions": { "deny": ["Read(./.env)"] },
    "hooks": {
        "PostToolUse": [
            { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "bash lint.sh", "timeout": 30 }] }
        ],
        "Stop": [{ "hooks": [{ "type": "command", "command": "echo done" }] }]
    }
}
`;

describe('hooks', () => {
  it('lists command hooks with their position', () => {
    expect(listHooks(SETTINGS)).toEqual([
      { event: 'PostToolUse', matcher: 'Edit|Write', command: 'bash lint.sh', at: { event: 'PostToolUse', group: 0, index: 0 } },
      { event: 'Stop', matcher: '', command: 'echo done', at: { event: 'Stop', group: 0, index: 0 } },
    ]);
    expect(listHooks('{ broken')).toEqual([]);
    expect(listHooks('')).toEqual([]);
    expect(listHooks('{}')).toEqual([]);
  });

  it('changes a hook in place, keeping its other keys and the file indentation', () => {
    const at = { event: 'PostToolUse', group: 0, index: 0 };
    const out = setHook(SETTINGS, at, { event: 'PostToolUse', matcher: 'Edit|Write', command: 'bash lint.sh --fix' })!;
    expect(JSON.parse(out).hooks.PostToolUse[0].hooks[0]).toEqual({ type: 'command', command: 'bash lint.sh --fix', timeout: 30 });
    expect(out.startsWith('{\n    "permissions"')).toBe(true);
    expect(out.endsWith('}\n')).toBe(true);
  });

  it('adds a hook to an existing group, a new group, a new event, and an empty file', () => {
    const sameGroup = JSON.parse(setHook(SETTINGS, null, { event: 'PostToolUse', matcher: 'Edit|Write', command: 'tsc' })!);
    expect(sameGroup.hooks.PostToolUse).toHaveLength(1);
    expect(sameGroup.hooks.PostToolUse[0].hooks.map((h: { command: string }) => h.command)).toEqual(['bash lint.sh', 'tsc']);

    const newGroup = JSON.parse(setHook(SETTINGS, null, { event: 'PostToolUse', matcher: 'Bash', command: 'audit' })!);
    expect(newGroup.hooks.PostToolUse[1]).toEqual({ matcher: 'Bash', hooks: [{ type: 'command', command: 'audit' }] });

    const newEvent = JSON.parse(setHook(SETTINGS, null, { event: 'SessionStart', matcher: ' ', command: 'git pull' })!);
    expect(newEvent.hooks.SessionStart).toEqual([{ hooks: [{ type: 'command', command: 'git pull' }] }]);
    expect(newEvent.permissions).toEqual({ deny: ['Read(./.env)'] });

    expect(setHook('', null, { event: 'Stop', matcher: '', command: 'echo hi' })).toBe(
      '{\n  "hooks": {\n    "Stop": [\n      {\n        "hooks": [\n          {\n            "type": "command",\n            "command": "echo hi"\n          }\n        ]\n      }\n    ]\n  }\n}\n',
    );
  });

  it('moves a hook when its event or matcher changes, keeping its other keys', () => {
    const at = { event: 'PostToolUse', group: 0, index: 0 };
    const json = JSON.parse(setHook(SETTINGS, at, { event: 'PreToolUse', matcher: 'Bash', command: 'bash lint.sh' })!);
    expect(json.hooks.PostToolUse).toBeUndefined();
    expect(json.hooks.PreToolUse).toEqual([{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash lint.sh', timeout: 30 }] }]);
    expect(json.hooks.Stop).toBeDefined();
  });

  it('removes a hook and the empty groups, events and hooks key it leaves behind', () => {
    const one = JSON.parse(removeHook(SETTINGS, { event: 'Stop', group: 0, index: 0 })!);
    expect(Object.keys(one.hooks)).toEqual(['PostToolUse']);
    const none = JSON.parse(removeHook(removeHook(SETTINGS, { event: 'Stop', group: 0, index: 0 })!, { event: 'PostToolUse', group: 0, index: 0 })!);
    expect(none).toEqual({ permissions: { deny: ['Read(./.env)'] } });
    expect(removeHook(SETTINGS, { event: 'Nope', group: 3, index: 1 })).toBe(SETTINGS);
  });

  it('refuses text that is not a JSON object', () => {
    expect(setHook('{ broken', null, { event: 'Stop', matcher: '', command: 'x' })).toBeNull();
    expect(setHook('[1]', null, { event: 'Stop', matcher: '', command: 'x' })).toBeNull();
    expect(removeHook('{ broken', { event: 'Stop', group: 0, index: 0 })).toBeNull();
  });
});
