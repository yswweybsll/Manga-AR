import { Directory, File, Paths } from 'expo-file-system';

import type { SceneDocument, SceneOp } from '@manga-ar/shared';

export type SceneDraft = {
  sceneId: string;
  updatedAt: number;
  lastSnapshot: SceneDocument;
  pendingOps: SceneOp[];
};

const DRAFT_DIRECTORY = new Directory(Paths.document, 'scene-drafts');

function ensureDraftDirectory(): void {
  if (!DRAFT_DIRECTORY.exists) {
    DRAFT_DIRECTORY.create({ idempotent: true, intermediates: true });
  }
}

function safeDraftFileName(sceneId: string): string {
  const encodedSceneId = encodeURIComponent(sceneId).replace(/[!'()*.-]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );

  return `${encodedSceneId || '%00'}.json`;
}

function draftFile(sceneId: string): File {
  return new File(DRAFT_DIRECTORY, safeDraftFileName(sceneId));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSceneDraft(value: unknown, sceneId: string): value is SceneDraft {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.sceneId !== sceneId ||
    typeof value.updatedAt !== 'number' ||
    !Array.isArray(value.pendingOps) ||
    !isRecord(value.lastSnapshot)
  ) {
    return false;
  }

  return value.lastSnapshot.sceneId === sceneId;
}

export async function saveSceneDraft(draft: SceneDraft): Promise<void> {
  ensureDraftDirectory();
  const file = draftFile(draft.sceneId);
  if (!file.exists) {
    file.create({ overwrite: true });
  }
  file.write(JSON.stringify(draft, null, 2));
}

export async function loadSceneDraft(sceneId: string): Promise<SceneDraft | null> {
  const file = draftFile(sceneId);
  if (!file.exists) {
    return null;
  }
  const text = file.textSync();
  if (!text.trim()) {
    return null;
  }

  try {
    const draft = JSON.parse(text);
    return isSceneDraft(draft, sceneId) ? draft : null;
  } catch {
    return null;
  }
}
