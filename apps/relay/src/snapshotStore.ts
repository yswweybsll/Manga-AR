import type { SceneSnapshotMessage } from '@manga-ar/shared';

const snapshots = new Map<string, SceneSnapshotMessage>();

export function getSnapshot(sessionId: string): SceneSnapshotMessage | undefined {
  return snapshots.get(sessionId);
}

export function rememberSnapshot(sessionId: string, message: SceneSnapshotMessage): void {
  snapshots.set(sessionId, message);
}
