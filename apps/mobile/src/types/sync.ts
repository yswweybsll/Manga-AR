export type {
  SyncConnectionStatus,
  HostSnapshotMessage,
  ClientOpsMessage,
  HostEventMessage,
} from '@manga-ar/shared';

import type { SyncMessage as HostSyncMessage } from '@manga-ar/shared';
import type { SceneModelInstance } from './model';

export type LegacySyncModelInstance = SceneModelInstance & {
  lockedBy?: 'phone' | 'desktop';
  syncVersion: number;
};

export type LegacyInstanceUpdateMessage = {
  type: 'instance_update';
  sessionId: string;
  timestamp: number;
  instance: LegacySyncModelInstance;
};

export type LegacyLockMessage = {
  type: 'lock_acquire' | 'lock_release';
  sessionId: string;
  timestamp: number;
  instanceId: string;
  owner: 'phone' | 'desktop';
};

export type SyncMessage =
  | HostSyncMessage
  | LegacyInstanceUpdateMessage
  | LegacyLockMessage;

export type SyncServiceConfig = {
  serverUrl: string;
  sessionId: string;
  reconnectIntervalMs?: number;
  pingIntervalMs?: number;
  snapshotThrottleMs?: number;
};
