import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AssetRepository } from '../../apps/studio-desktop/electron/main/host/assetRepository.js';

async function withTempDir(run: (rootDir: string) => Promise<void>): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manga-ar-assets-'));
  try {
    await run(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

test('importAsset stores a manifest and downloadable file metadata', async () => {
  await withTempDir(async (rootDir) => {
    const sourcePath = path.join(rootDir, 'model.glb');
    const fileBuffer = Buffer.from('fake-glb');
    await fs.writeFile(sourcePath, fileBuffer);

    const repository = new AssetRepository({ rootDir: path.join(rootDir, 'assets') });
    const imported = await repository.importAsset(sourcePath, '测试模型');
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    assert.equal(imported.assetId, `asset-${checksum.slice(0, 16)}`);
    assert.equal(imported.name, '测试模型');
    assert.equal(imported.fileName, 'model.glb');
    assert.equal(imported.fileSize, fileBuffer.byteLength);
    assert.equal(imported.contentType, 'model/gltf-binary');
    assert.equal(imported.format, 'GLB');

    const manifest = await repository.getAsset(imported.assetId);
    const assetFile = await repository.getAssetFile(imported.assetId);
    assert.deepEqual(manifest, imported);
    assert.equal(assetFile?.record.assetId, imported.assetId);
    assert.deepEqual(await fs.readFile(assetFile?.filePath ?? ''), fileBuffer);
  });
});

test('getAssets only returns matching asset versions', async () => {
  await withTempDir(async (rootDir) => {
    const sourcePath = path.join(rootDir, 'model.obj');
    await fs.writeFile(sourcePath, 'fake-obj');

    const repository = new AssetRepository({ rootDir: path.join(rootDir, 'assets') });
    const imported = await repository.importAsset(sourcePath);

    const records = await repository.getAssets([
      { assetId: imported.assetId, version: 1 },
      { assetId: imported.assetId, version: 2 },
      { assetId: 'missing', version: 1 },
    ]);

    assert.deepEqual(records, [imported]);
    assert.equal(records[0].contentType, 'text/plain');
    assert.equal(records[0].format, 'OBJ');
  });
});
