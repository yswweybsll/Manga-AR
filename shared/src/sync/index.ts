import type { AssetRecord } from '../models/index.js';
import type { Revision, SceneDocument, SceneOp } from '../scene/index.js';
import type { ClientRole } from '../host/index.js';

export type SyncConnectionStatus =
  | 'disconnected'
  | 'discovering'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'error';

export type HostSnapshotMessage = {
  type: 'host_snapshot';
  sceneId: string;
  timestamp: number;
  document: SceneDocument;
  assets: AssetRecord[];
};

export type ClientOpsMessage = {
  type: 'client_ops';
  sceneId: string;
  timestamp: number;
  clientId: string;
  role: ClientRole;
  ops: SceneOp[];
};

export type HostOpAcceptedEvent = {
  type: 'op_accepted';
  opId: string;
  revision: Revision;
};

export type HostOpRejectedEvent = {
  type: 'op_rejected';
  opId: string;
  reason: 'stale_revision' | 'missing_instance' | 'missing_asset' | 'invalid_op';
  authoritativeRevision: Revision;
};

export type HostSceneChangedEvent = {
  type: 'scene_changed';
  sceneId: string;
  revision: Revision;
  document: SceneDocument;
};

export type HostEventMessage = {
  type: 'host_events';
  sceneId: string;
  timestamp: number;
  events: Array<HostOpAcceptedEvent | HostOpRejectedEvent | HostSceneChangedEvent>;
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
  | HostSnapshotMessage
  | ClientOpsMessage
  | HostEventMessage
  | PingMessage
  | PongMessage;
