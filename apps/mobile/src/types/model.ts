export type ModelFormat = 'GLB' | 'GLTF' | 'OBJ' | 'VRX';

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
  /** World-space XZ (meters), AR anchor coordinates */
  x: number;
  z: number;
  /** World-space Y of model center (meters) */
  y: number;
  rotationY: number;
  scaleValue: number;
};
