export type ModelFormat = 'GLB' | 'GLTF' | 'OBJ' | 'VRX';

export type ModelAssetRef = {
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
