import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { AssetRecord, ModelAssetRef, ModelFormat } from '@manga-ar/shared';

type AssetRepositoryOptions = {
  rootDir: string;
};

function detectFormat(fileName: string): ModelFormat {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.glb') return 'GLB';
  if (ext === '.gltf') return 'GLTF';
  if (ext === '.obj') return 'OBJ';
  if (ext === '.vrx') return 'VRX';
  return 'GLB';
}

function contentTypeFor(format: ModelFormat): string {
  if (format === 'GLB') return 'model/gltf-binary';
  if (format === 'GLTF') return 'model/gltf+json';
  if (format === 'OBJ') return 'text/plain';
  return 'application/octet-stream';
}

export class AssetRepository {
  private readonly rootDir: string;

  constructor(options: AssetRepositoryOptions) {
    this.rootDir = options.rootDir;
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  async listAssets(): Promise<AssetRecord[]> {
    await this.ensureReady();
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
    const assets: AssetRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const asset = await this.getAsset(entry.name);
      if (asset) assets.push(asset);
    }
    return assets.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getAsset(assetId: string): Promise<AssetRecord | null> {
    try {
      const contents = await fs.readFile(path.join(this.rootDir, assetId, 'manifest.json'), 'utf8');
      return JSON.parse(contents) as AssetRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async getAssets(refs: ModelAssetRef[]): Promise<AssetRecord[]> {
    const records: AssetRecord[] = [];
    for (const ref of refs) {
      const record = await this.getAsset(ref.assetId);
      if (record && record.version === ref.version) {
        records.push(record);
      }
    }
    return records;
  }

  async importAsset(sourcePath: string, name?: string): Promise<AssetRecord> {
    await this.ensureReady();
    const fileBuffer = await fs.readFile(sourcePath);
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const assetId = `asset-${checksum.slice(0, 16)}`;
    const fileName = path.basename(sourcePath);
    const format = detectFormat(fileName);
    const targetDir = path.join(this.rootDir, assetId);

    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, fileName), fileBuffer);

    const record: AssetRecord = {
      assetId,
      name: name ?? path.basename(fileName, path.extname(fileName)),
      version: 1,
      fileName,
      fileSize: fileBuffer.byteLength,
      checksum,
      contentType: contentTypeFor(format),
      format,
      defaultScale: 1,
    };

    await fs.writeFile(path.join(targetDir, 'manifest.json'), JSON.stringify(record, null, 2), 'utf8');
    return record;
  }

  async getAssetFile(assetId: string): Promise<{ record: AssetRecord; filePath: string } | null> {
    const record = await this.getAsset(assetId);
    if (!record) return null;
    return {
      record,
      filePath: path.join(this.rootDir, assetId, record.fileName),
    };
  }
}
