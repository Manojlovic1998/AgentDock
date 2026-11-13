import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AgentDockBridge, UpdateState } from '../window-controls';
import { UpdateStore } from './update.store';

const state = (patch: Partial<UpdateState>): UpdateState => ({
  status: 'idle',
  current: '0.1.0-beta.1',
  manualInstall: false,
  autoCheck: true,
  ...patch,
});

describe('UpdateStore', () => {
  let push: (s: UpdateState) => void;
  let bridge: Partial<AgentDockBridge>;

  /** Installs a stub bridge, then creates the store the way the app does. */
  const create = (initial: UpdateState = state({})) => {
    bridge = {
      getUpdateState: vi.fn().mockResolvedValue(initial),
      checkForUpdates: vi.fn().mockResolvedValue(initial),
      downloadUpdate: vi.fn().mockResolvedValue(initial),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      skipUpdate: vi.fn().mockResolvedValue(initial),
      setAutoUpdateCheck: vi.fn().mockResolvedValue(initial),
      onUpdateState: (l) => (push = l),
    };
    window.agentDock = bridge as AgentDockBridge;
    return TestBed.inject(UpdateStore);
  };

  afterEach(() => {
    delete window.agentDock;
    TestBed.resetTestingModule();
  });

  it('does nothing in a browser', () => {
    const up = TestBed.inject(UpdateStore);
    expect(up.supported).toBe(false);
    up.check();
    expect(up.state()).toBeNull();
    expect(up.dialogOpen()).toBe(false);
  });

  it('opens the dialog when an update is found and keeps it in the status bar after "Later"', () => {
    const up = create();
    push(state({ status: 'available', version: '0.1.0-beta.2' }));
    expect(up.dialogOpen()).toBe(true);
    expect(up.pending()).toBe(true);
    up.later();
    expect(up.dialogOpen()).toBe(false);
    expect(up.pending()).toBe(true);
  });

  it('stays closed for a check that finds nothing or fails', () => {
    const up = create();
    push(state({ status: 'checking' }));
    push(state({ status: 'uptodate' }));
    push(state({ status: 'error', error: 'offline' }));
    expect(up.dialogOpen()).toBe(false);
    expect(up.pending()).toBe(false);
  });

  it('does not reopen the dialog for download progress, but asks to restart when it is ready', () => {
    const up = create();
    push(state({ status: 'available', version: '0.1.0-beta.2' }));
    up.later();
    push(state({ status: 'downloading', percent: 30 }));
    expect(up.dialogOpen()).toBe(false);
    push(state({ status: 'downloaded', version: '0.1.0-beta.2' }));
    expect(up.dialogOpen()).toBe(true);
  });

  it('shows a failed download', () => {
    const up = create();
    push(state({ status: 'downloading', percent: 10 }));
    push(state({ status: 'error', error: 'connection lost' }));
    expect(up.dialogOpen()).toBe(true);
  });

  it('skipping closes the dialog and tells the main process', () => {
    const up = create();
    push(state({ status: 'available', version: '0.1.0-beta.2' }));
    up.skip();
    expect(up.dialogOpen()).toBe(false);
    expect(bridge.skipUpdate).toHaveBeenCalled();
  });

  it('passes download, install and the automatic-check choice to the main process', () => {
    const up = create();
    up.download();
    up.install();
    up.setAutoCheck(false);
    expect(bridge.downloadUpdate).toHaveBeenCalled();
    expect(bridge.installUpdate).toHaveBeenCalled();
    expect(bridge.setAutoUpdateCheck).toHaveBeenCalledWith(false);
  });
});
