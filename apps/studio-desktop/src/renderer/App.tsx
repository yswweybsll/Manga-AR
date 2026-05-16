import type { SceneDocument } from '@manga-ar/shared';

const emptyScene: SceneDocument = {
  sceneId: 'desktop-empty-scene',
  revision: 0,
  selectedInstanceId: null,
  instances: [],
};

export function App() {
  return (
    <main>
      <h1>Manga AR Studio</h1>
      <p>当前场景模型数：{emptyScene.instances.length}</p>
    </main>
  );
}
