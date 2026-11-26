import { firstText, joinDoc, normalizeHead, normalizeSource, parseResource, patchHead, readHead, splitDoc, toList } from './frontmatter';

describe('splitDoc and joinDoc', () => {
  it('keeps a missing final newline when a key is patched', () => {
    const doc = splitDoc('---\nname: x\ndescription: old\n---\nBody');
    expect(doc).toEqual({ head: ['name: x', 'description: old'], sep: '\n', lead: '', body: 'Body', tail: '' });
    expect(joinDoc({ ...doc, head: patchHead(doc.head!, 'description', 'new') })).toBe('---\nname: x\ndescription: new\n---\nBody');
  });

  it('keeps blank lines around the body when a key is patched', () => {
    const text = '---\nname: x\n---\n\n\nBody\n\n\n';
    const doc = splitDoc(text);
    expect(doc).toMatchObject({ lead: '\n\n', body: 'Body', tail: '\n\n\n' });
    expect(joinDoc({ ...doc, head: patchHead(doc.head!, 'name', 'y') })).toBe(text.replace('name: x', 'name: y'));
  });

  it('treats an unclosed fence as body text', () => {
    const text = '---\nname: x\nBody\n';
    expect(splitDoc(text).head).toBeNull();
    expect(joinDoc(splitDoc(text))).toBe(text);
  });
});

describe('readHead', () => {
  it('reads a mapping and ignores anything else', () => {
    expect(readHead(null)).toEqual({ data: {} });
    expect(readHead(['name: x', 'tools: [Read]'])).toEqual({ data: { name: 'x', tools: ['Read'] } });
    expect(readHead(['- a', '- b'])).toEqual({ data: {} });
  });

  it('reports invalid YAML with an empty record', () => {
    const out = readHead(['name: [unclosed']);
    expect(out.data).toEqual({});
    expect(typeof out.error).toBe('string');
    expect(out.error).not.toContain('\n');
  });
});

describe('patchHead', () => {
  it('removes every line of a multi-line value and nothing after it', () => {
    const head = ['name: a', 'tools:', '  - Read', '  - Grep', '# trailing comment', 'color: red'];
    expect(patchHead(head, 'tools', undefined)).toEqual(['name: a', '# trailing comment', 'color: red']);
  });

  it('replaces a list written without indentation', () => {
    expect(patchHead(['skills:', '- a', '- b', 'model: x'], 'skills', ['c'])).toEqual(['skills:', '  - c', 'model: x']);
  });

  it('keeps the blank line that separates a block scalar from the next key', () => {
    const head = ['description: |', '  line one', '', '  line two', '', 'model: x'];
    expect(patchHead(head, 'description', 'z')).toEqual(['description: z', '', 'model: x']);
  });

  it('matches whole keys only', () => {
    expect(patchHead(['name-extra: 1', 'name: a'], 'name', 'b')).toEqual(['name-extra: 1', 'name: b']);
  });

  it('leaves the head alone when removing a key that is not there', () => {
    expect(patchHead(['name: a'], 'model', undefined)).toEqual(['name: a']);
  });
});

describe('normalizeHead', () => {
  it('puts known keys in a fixed order and keeps unknown keys in their own order after them', () => {
    const head = ['zeta: 1', 'paths: x', 'alpha: 2', 'model: opus', 'argument-hint: h', 'name: n'];
    expect(normalizeHead(head)).toEqual(['name: n', 'argument-hint: h', 'model: opus', 'paths: x', 'zeta: 1', 'alpha: 2']);
  });

  it('returns an empty head as it is', () => {
    const head: string[] = [];
    expect(normalizeHead(head)).toBe(head);
  });

  it('leaves the body byte for byte as it was', () => {
    const lines = '---\nmodel: x\nname: n\n---\n\n  indented body\n\n'.split('\n');
    expect(normalizeSource(lines).join('\n')).toBe('---\nname: n\nmodel: x\n---\n\n  indented body\n\n');
  });
});

describe('toList', () => {
  it('drops empty entries and values that are not text', () => {
    expect(toList('a, , b,')).toEqual(['a', 'b']);
    expect(toList([1, 'x', null, {}])).toEqual(['1', 'x']);
    expect(toList(5)).toEqual(['5']);
    expect(toList(null)).toBeUndefined();
  });
});

describe('firstText', () => {
  it('skips blank lines and headings', () => {
    expect(firstText('# H\n\n  first line  \nsecond')).toBe('first line');
    expect(firstText('# Only a heading\n')).toBe('');
  });
});

describe('parseResource', () => {
  it('reads an agent without frontmatter with defaults', () => {
    const p = parseResource('agent', 'Just text\n');
    expect(p.doc.head).toBeNull();
    expect(p.fields).toEqual({ desc: '', model: 'inherit', tools: undefined, perm: 'default', body: 'Just text' });
  });

  it('reads the allowed tools of a skill', () => {
    expect(parseResource('skill', '---\nname: s\nallowed-tools:\n  - Read\n  - Bash\n---\nDo it.\n').fields).toEqual({
      name: 's',
      desc: '',
      tools: ['Read', 'Bash'],
      body: 'Do it.',
    });
  });

  it('describes a command by its first line and shows an unquoted hint as typed', () => {
    expect(parseResource('cmd', '---\nargument-hint: [ticket-key]\n---\n\n# Title\n\nFix $ARGUMENTS.\n').fields).toEqual({
      desc: 'Fix $ARGUMENTS.',
      hint: '[ticket-key]',
      body: '# Title\n\nFix $ARGUMENTS.',
    });
  });

  it('reads the paths of a rule written as a comma-separated string', () => {
    expect(parseResource('rule', '---\npaths: src/**/*.ts, test/**\n---\nUse strict mode.\n').fields).toEqual({
      desc: 'Use strict mode.',
      paths: 'src/**/*.ts, test/**',
      body: 'Use strict mode.',
    });
  });

  it('keeps the body readable when the frontmatter is not', () => {
    const p = parseResource('skill', '---\nname: [x\n---\nBody\n');
    expect(p.error).toBeTruthy();
    expect(p.fields).toMatchObject({ desc: '', body: 'Body' });
  });

  it('returns the same result for the same file', () => {
    const text = '---\npaths: a/**\n---\nText\n';
    expect(parseResource('rule', text)).toBe(parseResource('rule', text));
  });
});
