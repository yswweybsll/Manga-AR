import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  MarkerAnchorDefinition,
  SceneDocument,
  SceneOp,
  SceneRecord,
  SceneTransform,
} from '@manga-ar/shared';

type SceneBundle = {
  record: SceneRecord;
  document: SceneDocument;
};

type SceneRepositoryOptions = {
  rootDir: string;
};

type RejectedSceneOp = {
  opId: string;
  reason: 'stale_revision' | 'missing_instance' | 'missing_asset' | 'invalid_op';
};

function now(): number {
  return Date.now();
}

function createDefaultAnchor(sceneId: string): MarkerAnchorDefinition {
  return {
    anchorType: 'marker',
    markerId: `${sceneId}-marker`,
    physicalWidthMeters: 0.16,
    referenceImageChecksum: 'development-marker',
    displayName: 'Development Marker',
  };
}

function createEmptyBundle(name: string): SceneBundle {
  const timestamp = now();
  const sceneId = `scene-${timestamp}`;
  const record: SceneRecord = {
    sceneId,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
    anchorDefinition: createDefaultAnchor(sceneId),
    assetRefs: [],
  };

  return {
    record,
    document: {
      sceneId,
      revision: 0,
      selectedInstanceId: null,
      instances: [],
    },
  };
}

function sceneDir(rootDir: string, sceneId: string): string {
  return path.join(rootDir, sceneId);
}

function sceneFile(rootDir: string, sceneId: string): string {
  return path.join(sceneDir(rootDir, sceneId), 'scene.json');
}

function applyTransform(_current: SceneTransform, next: SceneTransform): SceneTransform {
  return {
    x: next.x,
    y: next.y,
    z: next.z,
    rotationY: next.rotationY,
    scaleValue: next.scaleValue,
  };
}

export class SceneRepository {
  private readonly rootDir: string;

  constructor(options: SceneRepositoryOptions) {
    this.rootDir = options.rootDir;
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  async listScenes(): Promise<SceneRecord[]> {
    await this.ensureReady();
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
    const records: SceneRecord[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const bundle = await this.readScene(entry.name);
      if (bundle) {
        records.push(bundle.record);
      }
    }

    return records.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async createScene(name: string): Promise<SceneBundle> {
    await this.ensureReady();
    const bundle = createEmptyBundle(name);
    await this.writeBundle(bundle);
    return bundle;
  }

  async getScene(sceneId: string): Promise<SceneBundle | null> {
    return this.readScene(sceneId);
  }

  async applyOps(sceneId: string, ops: SceneOp[]): Promise<{
    acceptedOpIds: string[];
    rejected: RejectedSceneOp[];
    document: SceneDocument;
  }> {
    const bundle = await this.readScene(sceneId);
    if (!bundle) {
      throw new Error(`Scene not found: ${sceneId}`);
    }

    const acceptedOpIds: string[] = [];
    const rejected: RejectedSceneOp[] = [];
    const document: SceneDocument = {
      ...bundle.document,
      instances: bundle.document.instances.map((instance) => ({
        ...instance,
        asset: { ...instance.asset },
        transform: { ...instance.transform },
      })),
    };

    for (const op of ops) {
      if (op.baseRevision !== document.revision) {
        rejected.push({ opId: op.opId, reason: 'stale_revision' });
        continue;
      }

      if (op.type === 'add_instance') {
        if (document.instances.some((item) => item.instanceId === op.instance.instanceId)) {
          rejected.push({ opId: op.opId, reason: 'invalid_op' });
          continue;
        }
        document.revision += 1;
        document.instances.push({
          ...op.instance,
          asset: { ...op.instance.asset },
          transform: { ...op.instance.transform },
          instanceRevision: document.revision,
        });
        acceptedOpIds.push(op.opId);
        continue;
      }

      if (op.type === 'update_transform') {
        const target = document.instances.find((item) => item.instanceId === op.instanceId);
        if (!target) {
          rejected.push({ opId: op.opId, reason: 'missing_instance' });
          continue;
        }
        document.revision += 1;
        target.transform = applyTransform(target.transform, op.transform);
        target.instanceRevision = document.revision;
        acceptedOpIds.push(op.opId);
        continue;
      }

      if (op.type === 'delete_instance') {
        const before = document.instances.length;
        document.instances = document.instances.filter((item) => item.instanceId !== op.instanceId);
        if (document.instances.length === before) {
          rejected.push({ opId: op.opId, reason: 'missing_instance' });
          continue;
        }
        document.revision += 1;
        if (document.selectedInstanceId === op.instanceId) {
          document.selectedInstanceId = null;
        }
        acceptedOpIds.push(op.opId);
        continue;
      }

      if (op.type === 'replace_asset') {
        const target = document.instances.find((item) => item.instanceId === op.instanceId);
        if (!target) {
          rejected.push({ opId: op.opId, reason: 'missing_instance' });
          continue;
        }
        document.revision += 1;
        target.asset = { ...op.asset };
        target.instanceRevision = document.revision;
        acceptedOpIds.push(op.opId);
        continue;
      }

      if (op.type === 'select_instance') {
        if (op.instanceId && !document.instances.some((item) => item.instanceId === op.instanceId)) {
          rejected.push({ opId: op.opId, reason: 'missing_instance' });
          continue;
        }
        document.revision += 1;
        document.selectedInstanceId = op.instanceId;
        acceptedOpIds.push(op.opId);
      }
    }

    const nextRecord: SceneRecord = {
      ...bundle.record,
      updatedAt: now(),
      revision: document.revision,
      assetRefs: Array.from(
        new Map(document.instances.map((instance) => [`${instance.asset.assetId}@${instance.asset.version}`, instance.asset])).values()
      ),
    };

    await this.writeBundle({ record: nextRecord, document });

    return { acceptedOpIds, rejected, document };
  }

  private async readScene(sceneId: string): Promise<SceneBundle | null> {
    try {
      const contents = await fs.readFile(sceneFile(this.rootDir, sceneId), 'utf8');
      return JSON.parse(contents) as SceneBundle;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async writeBundle(bundle: SceneBundle): Promise<void> {
    await fs.mkdir(sceneDir(this.rootDir, bundle.record.sceneId), { recursive: true });
    await fs.writeFile(sceneFile(this.rootDir, bundle.record.sceneId), JSON.stringify(bundle, null, 2), 'utf8');
  }
}
