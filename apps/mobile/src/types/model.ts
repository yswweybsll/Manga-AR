import type { ModelAssetRef, ModelFormat, SceneInstance } from '@manga-ar/shared';

export type { ModelAssetRef, ModelFormat };

export type RemoteModel = ModelAssetRef;

export type CachedModelAsset = ModelAssetRef & {
  localUri: string;
};

export type SceneModelInstance = Omit<SceneInstance, 'asset'> & {
  asset: CachedModelAsset;
};
