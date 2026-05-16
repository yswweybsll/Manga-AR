import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { SceneInstance, SceneTransform } from '../../shared/src/index.js';

import { SceneRepository } from '../../apps/studio-desktop/electron/main/host/sceneRepository.js';

async function withTempDir(run: (rootDir: string) => Promise<void>): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manga-ar-scenes-'));
  try {
    await run(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

function transform(overrides: Partial<SceneTransform> = {}): SceneTransform {
  return {
    x: 0,
    y: 0,
    z: 0,
    rotationY: 0,
    scaleValue: 1,
    ...overrides,
  };
}

function instance(instanceId: string): SceneInstance {
  return {
    instanceId,
    asset: {
      assetId: 'asset-1',
      version: 1,
    },
    transform: transform(),
    instanceRevision: 0,
  };
}

test('createScene persists a default marker anchored scene record', async () => {
  await withTempDir(async (rootDir) => {
    const repository = new SceneRepository({ rootDir });

    const created = await repository.createScene('测试场景');
    const scenes = await repository.listScenes();
    const loaded = await repository.getScene(created.record.sceneId);

    assert.equal(created.record.name, '测试场景');
    assert.equal(created.record.revision, 0);
    assert.equal(created.record.anchorDefinition.anchorType, 'marker');
    assert.equal(created.document.instances.length, 0);
    assert.deepEqual(scenes.map((scene) => scene.sceneId), [created.record.sceneId]);
    assert.deepEqual(loaded, created);
  });
});

test('applyOps accepts sequential scene changes and updates revisions', async () => {
  await withTempDir(async (rootDir) => {
    const repository = new SceneRepository({ rootDir });
    const created = await repository.createScene('同步场景');
    const sceneId = created.record.sceneId;

    const addResult = await repository.applyOps(sceneId, [
      {
        opId: 'op-add',
        type: 'add_instance',
        baseRevision: 0,
        instance: instance('instance-1'),
      },
    ]);

    assert.deepEqual(addResult.acceptedOpIds, ['op-add']);
    assert.equal(addResult.document.revision, 1);
    assert.equal(addResult.document.instances[0].instanceRevision, 1);

    const updateResult = await repository.applyOps(sceneId, [
      {
        opId: 'op-update',
        type: 'update_transform',
        baseRevision: 1,
        instanceId: 'instance-1',
        transform: transform({ x: 1.5, y: 0.25, z: -2, rotationY: 45, scaleValue: 1.2 }),
      },
      {
        opId: 'op-select',
        type: 'select_instance',
        baseRevision: 2,
        instanceId: 'instance-1',
      },
    ]);

    assert.deepEqual(updateResult.acceptedOpIds, ['op-update', 'op-select']);
    assert.equal(updateResult.document.revision, 3);
    assert.equal(updateResult.document.selectedInstanceId, 'instance-1');
    assert.deepEqual(
      updateResult.document.instances[0].transform,
      transform({ x: 1.5, y: 0.25, z: -2, rotationY: 45, scaleValue: 1.2 })
    );

    const loaded = await repository.getScene(sceneId);
    assert.equal(loaded?.record.revision, 3);
    assert.deepEqual(loaded?.record.assetRefs, [{ assetId: 'asset-1', version: 1 }]);
  });
});

test('applyOps rejects stale or missing-instance operations without advancing revision', async () => {
  await withTempDir(async (rootDir) => {
    const repository = new SceneRepository({ rootDir });
    const created = await repository.createScene('冲突场景');

    const result = await repository.applyOps(created.record.sceneId, [
      {
        opId: 'op-stale',
        type: 'select_instance',
        baseRevision: 1,
        instanceId: null,
      },
      {
        opId: 'op-missing',
        type: 'delete_instance',
        baseRevision: 0,
        instanceId: 'missing',
      },
    ]);

    assert.deepEqual(result.acceptedOpIds, []);
    assert.deepEqual(result.rejected, [
      { opId: 'op-stale', reason: 'stale_revision' },
      { opId: 'op-missing', reason: 'missing_instance' },
    ]);
    assert.equal(result.document.revision, 0);
  });
});
