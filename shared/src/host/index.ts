import type { AssetRecord } from '../models/index.js';
import type { SceneDocument, SceneOp, SceneRecord } from '../scene/index.js';

export type HostProtocolVersion = '2026-05-16';

export type HostInfo = {
  hostId: string;
  hostName: string;
  protocolVersion: HostProtocolVersion;
  httpPort: number;
  wsPath: '/sync';
};

export type DiscoveredHost = HostInfo & {
  address: string;
  lastSeenAt: number;
};

export type ClientRole = 'desktop' | 'mobile';

export type HostInfoResponse = {
  host: HostInfo;
};

export type SceneListResponse = {
  scenes: SceneRecord[];
};

export type SceneResponse = {
  scene: SceneRecord;
  document: SceneDocument;
};

export type AssetManifestResponse = {
  assets: AssetRecord[];
};

export type SubmitSceneOpsRequest = {
  clientId: string;
  role: ClientRole;
  ops: SceneOp[];
};

export type SubmitSceneOpsResponse = {
  acceptedOpIds: string[];
  rejected: Array<{
    opId: string;
    reason: 'stale_revision' | 'missing_instance' | 'missing_asset' | 'invalid_op';
  }>;
  document: SceneDocument;
};
