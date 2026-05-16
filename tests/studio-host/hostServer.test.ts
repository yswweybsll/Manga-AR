import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { HostServer } from '../../apps/studio-desktop/electron/main/host/hostServer.js';

async function withTempDir(run: (rootDir: string) => Promise<void>): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manga-ar-host-server-'));
  try {
    await run(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

test('HostServer starts the embedded HTTP host and creates a default scene', async () => {
  await withTempDir(async (rootDir) => {
    const hostServer = new HostServer({
      hostId: 'studio-test',
      hostName: 'Studio Test',
      dataDir: rootDir,
    });

    try {
      const state = await hostServer.start();

      assert.equal(state.running, true);
      assert.equal(state.hostInfo.hostId, 'studio-test');
      assert.equal(state.hostInfo.hostName, 'Studio Test');
      assert.equal(state.hostInfo.protocolVersion, '2026-05-16');
      assert.equal(state.hostInfo.wsPath, '/sync');
      assert.ok(state.hostInfo.httpPort > 0);

      const hostInfoResponse = await fetch(`http://127.0.0.1:${state.hostInfo.httpPort}/host/info`);
      const hostInfo = await hostInfoResponse.json();
      assert.equal(hostInfoResponse.status, 200);
      assert.equal(hostInfo.host.hostId, 'studio-test');

      const scenes = await hostServer.getSceneRepository().listScenes();
      assert.equal(scenes.length, 1);
      assert.equal(scenes[0].name, '默认共享场景');
    } finally {
      await hostServer.stop();
    }
  });
});

test('HostServer start is idempotent and stop clears the running state', async () => {
  await withTempDir(async (rootDir) => {
    const hostServer = new HostServer({
      hostId: 'studio-repeat',
      dataDir: rootDir,
    });

    const firstState = await hostServer.start();
    const secondState = await hostServer.start();

    assert.equal(secondState.running, true);
    assert.equal(secondState.hostInfo.httpPort, firstState.hostInfo.httpPort);

    await hostServer.stop();
    assert.equal(hostServer.getState().running, false);

    await hostServer.stop();
    assert.equal(hostServer.getState().running, false);
  });
});
