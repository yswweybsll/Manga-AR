import type { SceneInstance } from '../scene';

export type SyncLockOwner = 'phone' | 'desktop';

export type SyncModelInstance = SceneInstance & {
  lockedBy?: SyncLockOwner;
  syncVersion: number;
};

export type SyncMessageType =
  | 'scene_snapshot'
  | 'instance_update'
  | 'instance_delete'
  | 'lock_acquire'
  | 'lock_release'
  | 'ping'
  | 'pong';

export type SceneSnapshotMessage = {
  type: 'scene_snapshot';
  sessionId: string;
  timestamp: number;
  instances: SyncModelInstance[];
  selectedInstanceId: string | null;
};

export type InstanceUpdateMessage = {
  type: 'instance_update';
  sessionId: string;
  timestamp: number;
  instance: SyncModelInstance;
};

export type InstanceDeleteMessage = {
  type: 'instance_delete';
  sessionId: string;
  timestamp: number;
  instanceId: string;
};

export type LockMessage = {
  type: 'lock_acquire' | 'lock_release';
  sessionId: string;
  timestamp: number;
  instanceId: string;
  owner: SyncLockOwner;
};

export type PingMessage = {
  type: 'ping';
  timestamp: number;
};

export type PongMessage = {
  type: 'pong';
  timestamp: number;
};

export type SyncMessage =
  | SceneSnapshotMessage
  | InstanceUpdateMessage
  | InstanceDeleteMessage
  | LockMessage
  | PingMessage
  | PongMessage;

export type SyncConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export type SyncServiceConfig = {
  serverUrl: string;
  sessionId: string;
  reconnectIntervalMs?: number;
  pingIntervalMs?: number;
  snapshotThrottleMs?: number;
};
