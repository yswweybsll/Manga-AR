import type { ModelFormat } from '@manga-ar/shared';

export type RemoteModel = {
  id: string;
  name: string;
  thumbnailUrl?: string;
  modelUrl: string;
  format: ModelFormat;
  defaultScale?: number;
  width?: number;
  height?: number;
  depth?: number;
  surfaceOffset?: number;
};

export type CachedModelAsset = RemoteModel & {
  localUri: string;
};

export type SceneModelInstance = {
  instanceId: string;
  asset: CachedModelAsset;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scaleValue: number;
};
