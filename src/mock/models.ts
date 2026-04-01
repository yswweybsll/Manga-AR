import type { RemoteModel } from '../types/model';

// 还没有真实后端时，先用公开 GLB 样例打通首阶段流程。
export const mockModels: RemoteModel[] = [
  {
    id: 'duck-demo',
    name: 'Duck Demo',
    modelUrl:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb',
    format: 'GLB',
    defaultScale: 0.02,
    width: 0.4,
    height: 0.3,
    depth: 0.4,
    surfaceOffset: 0.08,
  },
  {
    id: 'toy-car-demo',
    name: 'Toy Car Demo',
    modelUrl:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ToyCar/glTF-Binary/ToyCar.glb',
    format: 'GLB',
    defaultScale: 0.3,
    width: 0.8,
    height: 0.35,
    depth: 1.3,
    surfaceOffset: 0.12,
  },
];
