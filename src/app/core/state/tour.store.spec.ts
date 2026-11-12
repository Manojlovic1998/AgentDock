import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { MockResourceRepository, ResourceRepository } from '../data/resource-repository';
import { Commands } from './commands';
import { PrefsStore } from './prefs.store';
import { TourStore } from './tour.store';
import { UiStore } from './ui.store';
import { WorkspaceStore } from './workspace.store';

@Component({ template: '' })
class Blank {}

describe('TourStore', () => {
  let tour: TourStore;
  let ws: WorkspaceStore;
  let ui: UiStore;
  let prefs: PrefsStore;
  let cmd: Commands;

  /** Lets the action-step watcher run, then lets its settle delay pass. */
  const settle = (ms: number) => {
    TestBed.tick();
    vi.advanceTimersByTime(ms);
  };

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        { provide: ResourceRepository, useClass: MockResourceRepository },
        provideRouter([{ path: '**', component: Blank }]),
      ],
    });
    ws = TestBed.inject(WorkspaceStore);
    ui = TestBed.inject(UiStore);
    prefs = TestBed.inject(PrefsStore);
    cmd = TestBed.inject(Commands);
    tour = TestBed.inject(TourStore);
    await ws.init();
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  it('steps forward and back through the product tour', () => {
    expect(tour.start('product')).toBe(true);
    expect(tour.active()?.id).toBe('product');
    expect(tour.index()).toBe(0);

    tour.next();
    tour.next();
    expect(tour.index()).toBe(2);
    expect(tour.step()?.target).toBe('sidebar');

    tour.back();
    expect(tour.index()).toBe(1);
    tour.back();
    tour.back();
    expect(tour.index()).toBe(0);
  });

  it('stopping a tour does not mark it as done', () => {
    tour.start('product');
    tour.stop();
    expect(tour.active()).toBeNull();
    expect(tour.isDone('product')).toBe(false);
  });

  it('finishing a tour records it in the preferences', () => {
    tour.start('product');
    const steps = tour.active()!.steps.length;
    for (let i = 0; i < steps; i++) tour.next();

    expect(tour.active()).toBeNull();
    expect(tour.isDone('product')).toBe(true);
    expect(prefs.prefs().toursDone).toEqual(['product']);
    expect(ui.toast()?.msg).toContain('Tour finished');
  });

  it('survives the overlays being closed, as every navigation does', () => {
    tour.start('product');
    ui.closeOverlays();
    expect(tour.active()?.id).toBe('product');
  });

  it('advances an action step once the user has done what it asks', () => {
    tour.start('create-agent');
    expect(tour.step()?.target).toBe('new');

    settle(5000);
    expect(tour.index()).toBe(0);

    cmd.addNode('agent');
    settle(400);
    expect(tour.index()).toBe(0);
    settle(100);
    expect(tour.index()).toBe(1);
    expect(tour.step()?.target).toBe('insp-name');
  });

  it('waits for typing to pause before leaving the rename step', () => {
    tour.start('create-agent');
    cmd.addNode('agent');
    settle(500);
    const id = ui.sel()[0];

    ws.edit(id, { name: 'code' });
    settle(1000);
    ws.edit(id, { name: 'code-reviewer' });
    settle(1000);
    expect(tour.index()).toBe(1);

    settle(300);
    expect(tour.index()).toBe(2);
  });

  it('does not advance when the action is undone in time', () => {
    tour.start('create-agent');
    cmd.addNode('agent');
    TestBed.tick();
    ws.undo();
    settle(1000);
    expect(tour.index()).toBe(0);
  });

  it('skips a step that is already satisfied', () => {
    ui.sel.set(['angular-developer']);
    ui.tab.set('sk');
    tour.start('attach-skill');
    expect(tour.step()?.target).toBe('node-agent');

    // Selecting the same agent keeps the Skills tab open, so "Open its skills" has nothing to ask.
    ui.select('angular-developer');
    ui.tab.set('sk');
    settle(500);
    expect(tour.step()?.target).toBe('insp-add-skill');
  });

  it('refuses a walkthrough that has nothing to work on', () => {
    ws.discardAll();
    expect(tour.blocked(tour.list.find((t) => t.id === 'save-changes')!)).toBeTruthy();
    expect(tour.start('save-changes')).toBe(false);
    expect(tour.active()).toBeNull();
  });

  it('offers the tour once and starts it from the offer', () => {
    tour.offerOnce();
    expect(tour.active()?.kind).toBe('offer');
    expect(prefs.prefs().tourOffered).toBe(true);

    tour.next();
    expect(tour.active()?.id).toBe('product');
    expect(tour.isDone('welcome')).toBe(false);

    tour.stop();
    tour.offerOnce();
    expect(tour.active()).toBeNull();
  });

  it('closes the offer when the user opens Help themselves', () => {
    tour.offerOnce();
    tour.dismissOffer();
    expect(tour.active()).toBeNull();

    tour.start('product');
    tour.dismissOffer();
    expect(tour.active()?.id).toBe('product');
  });
});
