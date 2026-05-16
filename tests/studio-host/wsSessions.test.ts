import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { HostEventMessage, HostSnapshotMessage, SyncMessage } from '../../shared/src/index.js';
import WebSocket, { type RawData } from 'ws';

import { AssetRepository } from '../../apps/studio-desktop/electron/main/host/assetRepository.js';
import { SceneRepository } from '../../apps/studio-desktop/electron/main/host/sceneRepository.js';
import { WsSessions } from '../../apps/studio-desktop/electron/main/host/wsSessions.js';

type TestSyncServer = {
  baseWsUrl: string;
  sceneRepository: SceneRepository;
  close: () => Promise<void>;
};

async function withTempDir(run: (rootDir: string) => Promise<void>): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manga-ar-ws-'));
  try {
    await run(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString('utf8') });
    });
  });
}

function waitForMessage<T extends SyncMessage>(ws: WebSocket, type: T['type']): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`Timed out waiting for ${type}`));
    }, 3000);

    function onMessage(data: RawData): void {
      const message = JSON.parse(data.toString()) as SyncMessage;
      if (message.type !== type) {
        return;
      }
      clearTimeout(timeout);
      ws.off('message', onMessage);
      resolve(message as T);
    }

    ws.on('message', onMessage);
  });
}

async function startTestSyncServer(rootDir: string): Promise<TestSyncServer> {
  const server = http.createServer();
  const sceneRepository = new SceneRepository({ rootDir: path.join(rootDir, 'scenes') });
  const assetRepository = new AssetRepository({ rootDir: path.join(rootDir, 'assets') });
  await sceneRepository.ensureReady();
  await assetRepository.ensureReady();

  const sessions = new WsSessions({
    server,
    sceneRepository,
    assetRepository,
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert.ok(address);
  assert.notEqual(typeof address, 'string');
  const { port } = address as AddressInfo;

  return {
    baseWsUrl: `ws://127.0.0.1:${port}/sync`,
    sceneRepository,
    close: async () => {
      sessions.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

test('WebSocket sync rejects clients that do not provide a sceneId', async () => {
  await withTempDir(async (rootDir) => {
    const server = await startTestSyncServer(rootDir);
    try {
      const ws = new WebSocket(server.baseWsUrl);
      await waitForOpen(ws);

      const closed = await waitForClose(ws);

      assert.equal(closed.code, 1008);
      assert.equal(closed.reason, 'sceneId is required');
    } finally {
      await server.close();
    }
  });
});

test('WebSocket sync sends a scene snapshot and broadcasts accepted client ops', async () => {
  await withTempDir(async (rootDir) => {
    const server = await startTestSyncServer(rootDir);
    try {
      const scene = await server.sceneRepository.createScene('WS 场景');
      const sceneUrl = `${server.baseWsUrl}?sceneId=${encodeURIComponent(scene.record.sceneId)}`;
      const wsA = new WebSocket(sceneUrl);
      const wsB = new WebSocket(sceneUrl);
      await Promise.all([waitForOpen(wsA), waitForOpen(wsB)]);

      const snapshot = await waitForMessage<HostSnapshotMessage>(wsA, 'host_snapshot');
      assert.equal(snapshot.sceneId, scene.record.sceneId);
      assert.equal(snapshot.document.revision, 0);

      const eventPromise = waitForMessage<HostEventMessage>(wsB, 'host_events');
      wsA.send(
        JSON.stringify({
          type: 'client_ops',
          sceneId: scene.record.sceneId,
          timestamp: Date.now(),
          clientId: 'client-a',
          role: 'mobile',
          ops: [
            {
              opId: 'op-select-null',
              type: 'select_instance',
              baseRevision: 0,
              instanceId: null,
            },
          ],
        } satisfies SyncMessage)
      );

      const event = await eventPromise;
      assert.equal(event.sceneId, scene.record.sceneId);
      assert.deepEqual(
        event.events.map((item) => item.type),
        ['op_accepted', 'scene_changed']
      );
      assert.equal(event.events[0].type, 'op_accepted');
      assert.equal(event.events[0].revision, 1);

      wsA.close();
      wsB.close();
    } finally {
      await server.close();
    }
  });
});
