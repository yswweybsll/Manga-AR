import type { ModelAssetRef } from '../models/index.js';

export type Revision = number;

export type SceneTransform = {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scaleValue: number;
};

export type MarkerAnchorDefinition = {
  anchorType: 'marker';
  markerId: string;
  physicalWidthMeters: number;
  referenceImageChecksum: string;
  displayName?: string;
};

export type SceneAnchorDefinition = MarkerAnchorDefinition;

export type SceneInstance = {
  instanceId: string;
  asset: ModelAssetRef;
  transform: SceneTransform;
  instanceRevision: Revision;
};

export type SceneRecord = {
  sceneId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  revision: Revision;
  anchorDefinition: SceneAnchorDefinition;
  assetRefs: ModelAssetRef[];
  thumbnailUrl?: string;
};

export type SceneDocument = {
  sceneId: string;
  revision: Revision;
  selectedInstanceId: string | null;
  instances: SceneInstance[];
};

export type AddInstanceOp = {
  opId: string;
  type: 'add_instance';
  baseRevision: Revision;
  instance: SceneInstance;
};

export type UpdateTransformOp = {
  opId: string;
  type: 'update_transform';
  baseRevision: Revision;
  instanceId: string;
  transform: SceneTransform;
};

export type DeleteInstanceOp = {
  opId: string;
  type: 'delete_instance';
  baseRevision: Revision;
  instanceId: string;
};

export type ReplaceAssetOp = {
  opId: string;
  type: 'replace_asset';
  baseRevision: Revision;
  instanceId: string;
  asset: ModelAssetRef;
};

export type SelectInstanceOp = {
  opId: string;
  type: 'select_instance';
  baseRevision: Revision;
  instanceId: string | null;
};

export type SceneOp =
  | AddInstanceOp
  | UpdateTransformOp
  | DeleteInstanceOp
  | ReplaceAssetOp
  | SelectInstanceOp;
