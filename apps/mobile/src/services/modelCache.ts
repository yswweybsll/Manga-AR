import { Directory, File, Paths } from 'expo-file-system';

import type { CachedModelAsset, RemoteModel } from '../types/model';

const MODELS_DIRECTORY = new Directory(Paths.cache, 'models');

function ensureModelsDirectory() {
  if (!MODELS_DIRECTORY.exists) {
    MODELS_DIRECTORY.create({ idempotent: true, intermediates: true });
  }
}

function getFileExtension(model: RemoteModel) {
  switch (model.format) {
    case 'GLB':
      return 'glb';
    case 'GLTF':
      return 'gltf';
    case 'OBJ':
      return 'obj';
    case 'VRX':
      return 'vrx';
    default:
      return 'bin';
  }
}

export async function cacheModelAsset(
  model: RemoteModel
): Promise<CachedModelAsset> {
  ensureModelsDirectory();

  const targetFile = new File(
    MODELS_DIRECTORY,
    `${model.id}.${getFileExtension(model)}`
  );

  if (targetFile.exists && targetFile.size > 0) {
    return {
      ...model,
      localUri: targetFile.uri,
    };
  }

  const downloadedFile = await File.downloadFileAsync(model.modelUrl, targetFile, {
    idempotent: true,
  });

  return {
    ...model,
    localUri: downloadedFile.uri,
  };
}
