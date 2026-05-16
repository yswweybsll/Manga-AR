export type ModelFormat = 'GLB' | 'GLTF' | 'OBJ' | 'VRX';

export type AssetBounds = {
  width: number;
  height: number;
  depth: number;
};

export type AssetPreview = {
  thumbnailUrl?: string;
  dominantColor?: string;
};

export type AssetRecord = {
  assetId: string;
  name: string;
  version: number;
  fileName: string;
  fileSize: number;
  checksum: string;
  contentType: string;
  format: ModelFormat;
  bounds?: AssetBounds;
  preview?: AssetPreview;
  defaultScale?: number;
  surfaceOffset?: number;
};

export type ModelAssetRef = {
  assetId: string;
  version: number;
};
