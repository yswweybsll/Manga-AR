import { Directory, File, Paths } from 'expo-file-system';

import type { AssetRecord } from '@manga-ar/shared';

import { assetFileUrl, type HostEndpoint } from './hostApi';

export type LocalAssetRecord = AssetRecord & {
  localUri: string;
};

const ASSET_DIRECTORY = new Directory(Paths.document, 'host-assets');

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, '_');
  return sanitized.replace(/^\.+$/, '_');
}

function ensureAssetDirectory(): void {
  if (!ASSET_DIRECTORY.exists) {
    ASSET_DIRECTORY.create({ idempotent: true, intermediates: true });
  }
}

function localAssetFile(asset: AssetRecord): File {
  return new File(
    ASSET_DIRECTORY,
    `${sanitizePathSegment(asset.assetId)}-${sanitizePathSegment(String(asset.version))}-${sanitizePathSegment(asset.fileName)}`
  );
}

function removeAssetFileIfExists(file: File): void {
  if (file.exists) {
    file.delete();
  }
}

async function downloadAsset(endpoint: HostEndpoint, asset: AssetRecord, target: File): Promise<void> {
  try {
    await File.downloadFileAsync(assetFileUrl(endpoint, asset.assetId), target);
  } catch (error) {
    removeAssetFileIfExists(target);
    throw new Error(`同步资产失败: ${asset.assetId} (${asset.fileName})`, { cause: error });
  }
}

function ensureAssetFileSize(asset: AssetRecord, target: File): void {
  if (!target.exists || target.size !== asset.fileSize) {
    removeAssetFileIfExists(target);
    throw new Error(`同步资产大小不匹配: ${asset.assetId} (${asset.fileName})`);
  }
}

export async function syncSceneAssets(
  endpoint: HostEndpoint,
  assets: AssetRecord[],
  onProgress?: (completed: number, total: number) => void
): Promise<Record<string, LocalAssetRecord>> {
  ensureAssetDirectory();
  const result: Record<string, LocalAssetRecord> = {};

  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    const target = localAssetFile(asset);
    if (target.exists && target.size !== asset.fileSize) {
      target.delete();
    }
    if (!target.exists) {
      await downloadAsset(endpoint, asset, target);
      ensureAssetFileSize(asset, target);
    }
    result[asset.assetId] = {
      ...asset,
      localUri: target.uri,
    };
    onProgress?.(index + 1, assets.length);
  }

  return result;
}
