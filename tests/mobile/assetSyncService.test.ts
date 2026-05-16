import assert from 'node:assert/strict';
import test from 'node:test';

import type { AssetRecord } from '../../shared/src/index.js';
import { syncSceneAssets } from '../../apps/mobile/src/services/assetSyncService.ts';

type ExpoFileSystemState = {
  __expoFileSystemFiles: Map<string, Uint8Array>;
  __expoFileSystemDownloads: Record<string, string | Uint8Array>;
};

function resetFileSystem(): void {
  const state = globalThis as unknown as ExpoFileSystemState;
  state.__expoFileSystemFiles = new Map();
  state.__expoFileSystemDownloads = {};
}

function assetRecord(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    assetId: 'asset-1',
    name: 'Asset 1',
    version: 1,
    fileName: 'asset.glb',
    fileSize: 11,
    checksum: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    contentType: 'model/gltf-binary',
    format: 'GLB',
    ...overrides,
  };
}

test.beforeEach(() => {
  resetFileSystem();
});

test('rejects downloaded asset when sha256 checksum does not match and deletes target file', async () => {
  const endpoint = { address: '127.0.0.1', port: 19100 };
  const state = globalThis as unknown as ExpoFileSystemState;
  state.__expoFileSystemDownloads['http://127.0.0.1:19100/assets/asset-1/file'] = 'hello world';

  await assert.rejects(
    () =>
      syncSceneAssets(endpoint, [
        assetRecord({
          checksum: '0000000000000000000000000000000000000000000000000000000000000000',
        }),
      ]),
    /同步资产校验失败: asset-1 \(asset\.glb\)/,
  );

  assert.deepEqual([...state.__expoFileSystemFiles.keys()], []);
});

test('accepts downloaded asset when file size and sha256 checksum match', async () => {
  const endpoint = { address: '127.0.0.1', port: 19100 };
  const state = globalThis as unknown as ExpoFileSystemState;
  state.__expoFileSystemDownloads['http://127.0.0.1:19100/assets/asset-1/file'] = 'hello world';

  const synced = await syncSceneAssets(endpoint, [assetRecord()]);

  assert.equal(synced['asset-1'].localUri, 'memory://document/host-assets/asset-1-1-asset.glb');
  assert.deepEqual([...state.__expoFileSystemFiles.keys()], [
    'memory://document/host-assets/asset-1-1-asset.glb',
  ]);
});
