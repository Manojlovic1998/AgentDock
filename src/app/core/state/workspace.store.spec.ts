import { TestBed } from '@angular/core/testing';
import { MockResourceRepository, ResourceRepository } from '../data/resource-repository';
import { UiStore } from './ui.store';
import { ViewportStore } from './viewport.store';
import { WorkspaceStore } from './workspace.store';

describe('WorkspaceStore', () => {
  let ws: WorkspaceStore;
  let ui: UiStore;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [{ provide: ResourceRepository, useClass: MockResourceRepository }] });
    ws = TestBed.inject(WorkspaceStore);
    ui = TestBed.inject(UiStore);
    await ws.init();
  });

  it('starts with the sample problems and the preset changes', () => {
    expect(ws.errorCount()).toBe(2);
    expect(ws.warnCount()).toBe(2);
    expect(ws.changes()).toHaveLength(ws.snapshot.presets.length);
    expect(ws.selectedOne()?.id).toBe('angular-developer');
  });

  it('attaches a skill once, records the change and undoes it', () => {
    const before = ws.changes().length;
    expect(ws.attach('angular-developer', 'testing-strategy')).toBe(true);
    expect(ws.attach('angular-developer', 'testing-strategy')).toBe(false);
    expect(ws.skillsOf('angular-developer').map((s) => s.id)).toContain('testing-strategy');
    expect(ws.changes()).toHaveLength(before + 1);
    expect(ui.toast()).toEqual({ msg: 'Added testing-strategy to angular-developer', undo: true });

    ws.undo();
    expect(ws.skillsOf('angular-developer').map((s) => s.id)).not.toContain('testing-strategy');
    expect(ws.changes()).toHaveLength(before);
  });

  it('detaching the missing skill clears its error', () => {
    ws.detach('release-scribe', 'changelog-format');
    expect(ws.errorCount()).toBe(1);
    expect(ws.statusOf('release-scribe')).toBe('ok');
  });

  it('deletes a resource with its relationships and restores both on discard', () => {
    const refs = ws.referenceCount('code-reviewer');
    expect(refs).toBeGreaterThan(0);
    ui.sel.set(['code-reviewer']);
    ws.remove('code-reviewer');
    expect(ws.model().by['code-reviewer']).toBeUndefined();
    expect(ws.referenceCount('code-reviewer')).toBe(0);
    expect(ui.sel()).toEqual([]);

    const change = ws.changes().find((c) => c.id === 'code-reviewer');
    expect(change?.kind).toBe('D');
    ws.discardOne(change!);
    expect(ws.model().by['code-reviewer']).toBeDefined();
    expect(ws.referenceCount('code-reviewer')).toBe(refs);
    expect(ws.changes().some((c) => c.id === 'code-reviewer')).toBe(false);
  });

  it('creates uniquely named resources and removes them when discarded', () => {
    const first = ws.addNode('agent');
    const second = ws.addNode('agent');
    expect([first, second]).toEqual(['untitled-agent', 'untitled-agent-2']);
    const change = ws.changes().find((c) => c.id === first);
    expect(change?.kind).toBe('A');
    ws.discardOne(change!);
    expect(ws.model().by[first]).toBeUndefined();
    expect(ws.model().by[second]).toBeDefined();
  });

  it('tracks field edits as a modification', () => {
    ws.edit('angular-developer', { perm: 'plan' });
    const change = ws.changes().find((c) => c.id === 'angular-developer');
    expect(change).toMatchObject({ kind: 'M', add: 1, del: 1 });
  });

  it('saves everything as the new baseline, then discards later edits back to it', async () => {
    ws.edit('angular-developer', { desc: 'Saved description' });
    await ws.saveAll();
    expect(ws.changes()).toEqual([]);

    ws.edit('angular-developer', { desc: 'Unsaved description' });
    ws.detach('angular-developer', 'angular-patterns');
    expect(ws.changes()).toHaveLength(1);
    ws.discardAll();
    expect(ws.changes()).toEqual([]);
    expect(ws.model().by['angular-developer'].desc).toBe('Saved description');
    expect(ws.skillsOf('angular-developer').map((s) => s.id)).toContain('angular-patterns');
  });

  it('applies kind filters to the visible set', () => {
    ui.filt.set({ skill: false });
    expect(ws.visible().some((n) => n.type === 'skill')).toBe(false);
    expect(ws.filters().find((f) => f.type === 'skill')).toMatchObject({ on: false });
    expect(ws.filters().find((f) => f.type === 'rule')?.n).toBe(4);
  });

  it('fits the canvas to the graph bounds', () => {
    const viewport = TestBed.inject(ViewportStore);
    viewport.setSize(1000, 800);
    ws.fit();
    expect(viewport.fitted).toBe(true);
    expect(viewport.zoom()).toBeGreaterThanOrEqual(0.35);
    expect(viewport.zoom()).toBeLessThanOrEqual(1.2);
  });
});
