import { Injectable, computed, signal } from '@angular/core';
import { UpdateState } from '../window-controls';

/**
 * Update flow of the desktop app: mirrors the state kept by the main process and decides when the
 * update dialog shows. Inert in a browser, where `window.agentDock` does not exist.
 */
@Injectable({ providedIn: 'root' })
export class UpdateStore {
  private readonly bridge = window.agentDock;

  /** Whether this build can update itself, which is only the case inside the desktop app. */
  readonly supported = !!this.bridge?.checkForUpdates;
  readonly state = signal<UpdateState | null>(null);
  readonly dialogOpen = signal(false);

  /** A new version is waiting for the user: found, being downloaded or ready to install. */
  readonly pending = computed(() => {
    const s = this.state()?.status;
    return s === 'available' || s === 'downloading' || s === 'downloaded';
  });

  constructor() {
    if (!this.supported) return;
    void this.bridge!.getUpdateState().then((s) => this.state.set(s));
    this.bridge!.onUpdateState((s) => this.apply(s));
  }

  /** Takes a state from the main process and opens or closes the dialog to match. */
  apply(next: UpdateState): void {
    const prev = this.state()?.status;
    this.state.set(next);
    const s = next.status;
    // A found or finished update asks for a decision. A failed download needs a retry. A failed
    // check stays on the Settings page, which started it.
    if (s === 'available' || s === 'downloaded' || (s === 'error' && prev === 'downloading')) this.dialogOpen.set(true);
    else if (s === 'idle') this.dialogOpen.set(false);
  }

  /** Checks now, as the user asked. The outcome shows in Settings, and the dialog opens if there is an update. */
  check(): void {
    void this.bridge?.checkForUpdates();
  }

  /** Starts the download, or opens the release page where updates cannot install in place. */
  download(): void {
    void this.bridge?.downloadUpdate();
  }

  /** Restarts the app into the downloaded version. */
  install(): void {
    void this.bridge?.installUpdate();
  }

  /** Stops offering this version after automatic checks and closes the dialog. */
  skip(): void {
    this.dialogOpen.set(false);
    void this.bridge?.skipUpdate();
  }

  /** Closes the dialog and keeps the update available from the status bar. */
  later(): void {
    this.dialogOpen.set(false);
  }

  /** Turns the automatic check after startup on or off. */
  setAutoCheck(on: boolean): void {
    void this.bridge?.setAutoUpdateCheck(on);
  }
}
