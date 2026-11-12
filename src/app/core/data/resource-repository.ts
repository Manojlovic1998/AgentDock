import { Injectable } from '@angular/core';
import { WorkspaceSnapshot } from '../model/types';
import { ACME_SNAPSHOT } from './mock-data';

/**
 * Source of workspace configuration. The UI only depends on this contract, so the mock
 * can later be replaced by an implementation that scans .claude/ through Electron IPC.
 */
export abstract class ResourceRepository {
  abstract load(): WorkspaceSnapshot;
}

@Injectable()
export class MockResourceRepository extends ResourceRepository {
  load(): WorkspaceSnapshot {
    return ACME_SNAPSHOT;
  }
}
