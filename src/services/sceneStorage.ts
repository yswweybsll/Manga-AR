import { Directory, File, Paths } from 'expo-file-system';

import type { SceneModelInstance } from '../types/model';
import type { SavedSceneDocument } from '../types/scene';

const SCENES_DIRECTORY = new Directory(Paths.document, 'scenes');
const RECENT_SCENE_FILE = new File(SCENES_DIRECTORY, 'recent-scene.json');

function ensureScenesDirectory() {
  if (!SCENES_DIRECTORY.exists) {
    SCENES_DIRECTORY.create({ idempotent: true, intermediates: true });
  }
}

export function buildSavedSceneDocument(
  instances: SceneModelInstance[],
  selectedInstanceId: string | null,
  pendingModelId: string | null
): SavedSceneDocument {
  return {
    id: `scene-${Date.now()}`,
    updatedAt: Date.now(),
    selectedInstanceId,
    pendingModelId,
    instances: instances.map((instance) => ({
      instanceId: instance.instanceId,
      modelId: instance.asset.id,
      x: instance.x,
      y: instance.y,
      z: instance.z,
      rotationY: instance.rotationY,
      scaleValue: instance.scaleValue,
    })),
  };
}

export async function saveRecentScene(document: SavedSceneDocument): Promise<void> {
  ensureScenesDirectory();

  if (!RECENT_SCENE_FILE.exists) {
    RECENT_SCENE_FILE.create({ overwrite: true });
  }

  RECENT_SCENE_FILE.write(JSON.stringify(document, null, 2));
}

export async function loadRecentScene(): Promise<SavedSceneDocument | null> {
  if (!RECENT_SCENE_FILE.exists) {
    return null;
  }

  const contents = RECENT_SCENE_FILE.textSync();
  if (!contents.trim()) {
    return null;
  }

  return JSON.parse(contents) as SavedSceneDocument;
}
