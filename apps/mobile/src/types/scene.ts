export type SavedSceneModelInstance = {
  instanceId: string;
  modelId: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scaleValue: number;
};

export type SavedSceneDocument = {
  id: string;
  updatedAt: number;
  selectedInstanceId: string | null;
  pendingModelId: string | null;
  instances: SavedSceneModelInstance[];
};
