import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { HostInfo } from '../../shared/src/index.js';

import { AssetRepository } from '../../apps/studio-desktop/electron/main/host/assetRepository.js';
import { handleHostHttpRequest } from '../../apps/studio-desktop/electron/main/host/httpRoutes.js';
import { SceneRepository } from '../../apps/studio-desktop/electron/main/host/sceneRepository.js';

type TestServer = {
  baseUrl: string;
  sceneRepository: SceneRepository;
  assetRepository: AssetRepository;
  close: () => Promise<void>;
};

async function withTempDir(run: (rootDir: string) => Promise<void>): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manga-ar-routes-'));
  try {
    await run(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function startTestServer(rootDir: string): Promise<TestServer> {
  const hostInfo: HostInfo = {
    hostId: 'host-test',
    hostName: 'Test Host',
    protocolVersion: '2026-05-16',
    httpPort: 0,
    wsPath: '/sync',
  };
  const sceneRepository = new SceneRepository({ rootDir: path.join(rootDir, 'scenes') });
  const assetRepository = new AssetRepository({ rootDir: path.join(rootDir, 'assets') });
  await sceneRepository.ensureReady();
  await assetRepository.ensureReady();

  const server = http.createServer((req, res) => {
    void handleHostHttpRequest(req, res, {
      hostInfo,
      sceneRepository,
      assetRepository,
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert.ok(address);
  assert.notEqual(typeof address, 'string');
  const { port } = address as AddressInfo;
  hostInfo.httpPort = port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    sceneRepository,
    assetRepository,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

test('host HTTP routes expose host info, scene listing, scene document, and assets', async () => {
  await withTempDir(async (rootDir) => {
    const server = await startTestServer(rootDir);
    try {
      const scene = await server.sceneRepository.createScene('HTTP 场景');
      const sourcePath = path.join(rootDir, 'asset.glb');
      await fs.writeFile(sourcePath, Buffer.from('asset-file'));
      const asset = await server.assetRepository.importAsset(sourcePath, 'HTTP 模型');
      await server.sceneRepository.applyOps(scene.record.sceneId, [
        {
          opId: 'op-add',
          type: 'add_instance',
          baseRevision: 0,
          instance: {
            instanceId: 'instance-1',
            asset: { assetId: asset.assetId, version: asset.version },
            transform: { x: 0, y: 0, z: 0, rotationY: 0, scaleValue: 1 },
            instanceRevision: 0,
          },
        },
      ]);

      const hostInfo = await fetch(`${server.baseUrl}/host/info`).then((response) => response.json());
      const scenes = await fetch(`${server.baseUrl}/scenes`).then((response) => response.json());
      const sceneResponse = await fetch(`${server.baseUrl}/scenes/${scene.record.sceneId}`).then((response) => response.json());
      const assetManifest = await fetch(`${server.baseUrl}/scenes/${scene.record.sceneId}/assets`).then((response) => response.json());
      const assetFile = await fetch(`${server.baseUrl}/assets/${asset.assetId}/file`);

      assert.equal(hostInfo.host.hostId, 'host-test');
      assert.equal(scenes.scenes[0].sceneId, scene.record.sceneId);
      assert.equal(sceneResponse.document.revision, 1);
      assert.deepEqual(assetManifest.assets.map((item: { assetId: string }) => item.assetId), [asset.assetId]);
      assert.equal(assetFile.headers.get('content-type'), 'model/gltf-binary');
      assert.equal(await assetFile.text(), 'asset-file');
    } finally {
      await server.close();
    }
  });
});

test('host HTTP routes apply posted scene ops', async () => {
  await withTempDir(async (rootDir) => {
    const server = await startTestServer(rootDir);
    try {
      const scene = await server.sceneRepository.createScene('Ops 场景');
      const response = await fetch(`${server.baseUrl}/scenes/${scene.record.sceneId}/ops`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: 'client-1',
          role: 'desktop',
          ops: [
            {
              opId: 'op-select-null',
              type: 'select_instance',
              baseRevision: 0,
              instanceId: null,
            },
          ],
        }),
      });

      const body = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(body.acceptedOpIds, ['op-select-null']);
      assert.equal(body.document.revision, 1);
    } finally {
      await server.close();
    }
  });
});
