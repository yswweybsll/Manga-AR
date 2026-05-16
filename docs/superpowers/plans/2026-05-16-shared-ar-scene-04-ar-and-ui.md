# AR Marker And UI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把移动端加入场景后的占位 UI 替换为 marker-space 共享 AR 场景，并让桌面端 renderer 具备基础场景/资产/连接状态工作台。

**Architecture:** 共享文档中的 transform 永远是 marker space；移动端 AR scene 负责把 marker-space transform 转成 device AR world transform 渲染，并把拖拽结果反算回 marker space 形成 `SceneOp`。第一版使用简化水平 marker 原点模型，保留未来接入 Viro image marker 完整矩阵的边界。

**Tech Stack:** Expo React Native、Viro AR、react-native-paper、Electron renderer、shadcn/ui、Three.js 后续可接入。

---

## Precondition

先完成：

- `01-contract-and-repo-cleanup`
- `02-desktop-host`
- `03-mobile-client`

本阶段默认 `App.tsx` 已经能走到 joined scene payload，但 joined 后仍是占位 UI。

## Task 1: 创建 markerAlignmentService

**Files:**
- Create: `apps/mobile/src/services/markerAlignmentService.ts`

- [ ] **Step 1: 新增 marker 坐标换算服务**

第一版先实现水平 marker 的平移 + Y 轴旋转换算。后续接入 `ViroARImageMarker` 时，把识别到的 marker pose 填入 `MarkerAlignment` 即可。

新增 `apps/mobile/src/services/markerAlignmentService.ts`：

```ts
import type { SceneTransform } from '@manga-ar/shared';

export type Vector3 = [number, number, number];

export type MarkerAlignment = {
  markerWorldPosition: Vector3;
  markerWorldRotationY: number;
  stable: boolean;
  updatedAt: number;
};

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

function rotateY([x, y, z]: Vector3, degrees: number): Vector3 {
  const rad = degToRad(degrees);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    x * cos - z * sin,
    y,
    x * sin + z * cos,
  ];
}

function add(a: Vector3, b: Vector3): Vector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vector3, b: Vector3): Vector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function markerTransformToWorld(
  alignment: MarkerAlignment,
  transform: SceneTransform
): SceneTransform {
  const rotated = rotateY([transform.x, transform.y, transform.z], alignment.markerWorldRotationY);
  const position = add(alignment.markerWorldPosition, rotated);
  return {
    x: Number(position[0].toFixed(4)),
    y: Number(position[1].toFixed(4)),
    z: Number(position[2].toFixed(4)),
    rotationY: Number((((transform.rotationY + alignment.markerWorldRotationY) % 360) + 360) % 360),
    scaleValue: transform.scaleValue,
  };
}

export function worldTransformToMarker(
  alignment: MarkerAlignment,
  transform: SceneTransform
): SceneTransform {
  const translated = subtract([transform.x, transform.y, transform.z], alignment.markerWorldPosition);
  const markerPosition = rotateY(translated, -alignment.markerWorldRotationY);
  return {
    x: Number(markerPosition[0].toFixed(4)),
    y: Number(markerPosition[1].toFixed(4)),
    z: Number(markerPosition[2].toFixed(4)),
    rotationY: Number((((transform.rotationY - alignment.markerWorldRotationY) % 360) + 360) % 360),
    scaleValue: transform.scaleValue,
  };
}

export function createDevelopmentAlignment(position: Vector3): MarkerAlignment {
  return {
    markerWorldPosition: position,
    markerWorldRotationY: 0,
    stable: true,
    updatedAt: Date.now(),
  };
}
```

- [ ] **Step 2: 运行 mobile typecheck**

Run:

```bash
pnpm --filter @manga-ar/mobile typecheck
```

Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/services/markerAlignmentService.ts
git commit -m "feat(mobile): 添加 marker 坐标换算服务"
```

## Task 2: 创建共享 AR scene 组件

**Files:**
- Create: `apps/mobile/src/components/scenes/SharedMarkerScene.tsx`

- [ ] **Step 1: 新增 SharedMarkerScene**

新增 `apps/mobile/src/components/scenes/SharedMarkerScene.tsx`：

```tsx
import React, { useMemo, useRef, useState } from 'react';
import {
  Viro3DObject,
  ViroAmbientLight,
  ViroARScene,
  ViroDirectionalLight,
  ViroImage,
  ViroNode,
  ViroQuad,
  ViroText,
} from '@reactvision/react-viro';
import type { SceneDocument, SceneTransform } from '@manga-ar/shared';

import type { LocalAssetRecord } from '../../services/assetSyncService';
import {
  createDevelopmentAlignment,
  markerTransformToWorld,
  type MarkerAlignment,
} from '../../services/markerAlignmentService';

const aimPng = require('../../../assets/aim.png');

type ArHitResult = {
  type?: string;
  transform?: {
    position?: number[];
  };
};

const HIT_PRIORITY = [
  'ExistingPlaneUsingExtent',
  'ExistingPlane',
  'EstimatedHorizontalPlane',
  'DepthPoint',
  'FeaturePoint',
] as const;

function pickHitPosition(results: ArHitResult[]): [number, number, number] | null {
  for (const type of HIT_PRIORITY) {
    const hit = results.find((item) => item.type === type);
    const position = hit?.transform?.position;
    if (position && position.length >= 3) {
      return [position[0], position[1], position[2]];
    }
  }
  const fallback = results[0]?.transform?.position;
  return fallback && fallback.length >= 3 ? [fallback[0], fallback[1], fallback[2]] : null;
}

type SharedMarkerSceneProps = {
  sceneNavigator?: {
    viroAppProps?: {
      document?: SceneDocument;
      assetsById?: Record<string, LocalAssetRecord>;
      selectedInstanceId?: string | null;
      onAlignmentChanged?: (alignment: MarkerAlignment) => void;
      onInstanceSelected?: (instanceId: string) => void;
      onInstanceDragged?: (instanceId: string, worldTransform: SceneTransform) => void;
    };
  };
};

export function SharedMarkerScene({ sceneNavigator }: SharedMarkerSceneProps) {
  const appProps = sceneNavigator?.viroAppProps;
  const document = appProps?.document;
  const assetsById = appProps?.assetsById ?? {};
  const selectedInstanceId = appProps?.selectedInstanceId ?? null;
  const [alignment, setAlignment] = useState<MarkerAlignment | null>(null);
  const [reticlePosition, setReticlePosition] = useState<[number, number, number] | null>(null);
  const alignmentLockedRef = useRef(false);

  const renderInstances = useMemo(() => {
    if (!document || !alignment?.stable) return [];
    return document.instances.map((instance) => ({
      instance,
      asset: assetsById[instance.asset.assetId],
      worldTransform: markerTransformToWorld(alignment, instance.transform),
    }));
  }, [alignment, assetsById, document]);

  return (
    <ViroARScene
      anchorDetectionTypes={['PlanesHorizontal']}
      onCameraARHitTest={(event) => {
        const position = pickHitPosition(event.hitTestResults as ArHitResult[]);
        setReticlePosition(position);
        if (position && !alignmentLockedRef.current) {
          alignmentLockedRef.current = true;
          const nextAlignment = createDevelopmentAlignment(position);
          setAlignment(nextAlignment);
          appProps?.onAlignmentChanged?.(nextAlignment);
        }
      }}
    >
      <ViroAmbientLight color="#ffffff" intensity={900} />
      <ViroDirectionalLight color="#ffffff" direction={[0, -1, -0.2]} />

      {reticlePosition ? (
        <ViroNode position={reticlePosition}>
          <ViroImage
            source={aimPng}
            position={[0, 0.004, 0]}
            rotation={[-90, 0, 0]}
            width={0.22}
            height={0.22}
            opacity={0.95}
          />
        </ViroNode>
      ) : null}

      {alignment ? (
        <ViroQuad
          position={alignment.markerWorldPosition}
          rotation={[-90, 0, 0]}
          width={0.36}
          height={0.36}
          opacity={0.35}
          materials="ViroARPlaneSelector_Translucent"
        />
      ) : null}

      {renderInstances.map(({ instance, asset, worldTransform }) => {
        if (!asset) return null;
        const isSelected = selectedInstanceId === instance.instanceId;
        return (
          <ViroNode key={instance.instanceId}>
            {isSelected ? (
              <ViroQuad
                position={[worldTransform.x, worldTransform.y + 0.002, worldTransform.z]}
                rotation={[-90, 0, 0]}
                width={0.42}
                height={0.42}
                opacity={0.24}
                materials="ViroARPlaneSelector_Translucent"
              />
            ) : null}
            <Viro3DObject
              dragType="FixedToWorld"
              source={{ uri: asset.localUri }}
              type={asset.format}
              position={[worldTransform.x, worldTransform.y, worldTransform.z]}
              rotation={[0, worldTransform.rotationY, 0]}
              scale={[worldTransform.scaleValue, worldTransform.scaleValue, worldTransform.scaleValue]}
              onClick={() => appProps?.onInstanceSelected?.(instance.instanceId)}
              onDrag={(dragToPos) => {
                appProps?.onInstanceDragged?.(instance.instanceId, {
                  ...worldTransform,
                  x: dragToPos[0],
                  y: dragToPos[1],
                  z: dragToPos[2],
                });
              }}
            />
          </ViroNode>
        );
      })}

      <ViroText
        text={alignment ? '共享 marker 已锁定' : '对准桌面 marker 或水平面以建立共享原点'}
        position={[0, 0, -1]}
        width={2.8}
        height={0.35}
        style={{ fontSize: 18, color: '#ffffff', textAlign: 'center' }}
      />
    </ViroARScene>
  );
}
```

- [ ] **Step 2: 运行 typecheck**

Run:

```bash
pnpm --filter @manga-ar/mobile typecheck
```

Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/scenes/SharedMarkerScene.tsx
git commit -m "feat(ar): 添加共享 marker AR scene"
```

## Task 3: 创建 ARSceneScreen

**Files:**
- Create: `apps/mobile/src/components/screens/ARSceneScreen.tsx`

- [ ] **Step 1: 新增 ARSceneScreen**

新增 `apps/mobile/src/components/screens/ARSceneScreen.tsx`：

```tsx
import React, { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { ViroARSceneNavigator } from '@reactvision/react-viro';
import { Button, Text } from 'react-native-paper';
import type { DiscoveredHost, SceneDocument, SceneOp, SceneResponse, SceneTransform } from '@manga-ar/shared';

import { SharedMarkerScene } from '../scenes/SharedMarkerScene';
import type { LocalAssetRecord } from '../../services/assetSyncService';
import { createSceneSyncClient, type SceneSyncClient } from '../../services/sceneSyncClient';
import {
  worldTransformToMarker,
  type MarkerAlignment,
} from '../../services/markerAlignmentService';

type ARSceneScreenProps = {
  host: DiscoveredHost;
  sceneResponse: SceneResponse;
  assetsById: Record<string, LocalAssetRecord>;
  onLeave: () => void;
};

function createOpId(): string {
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ARSceneScreen({ host, sceneResponse, assetsById, onLeave }: ARSceneScreenProps) {
  const [document, setDocument] = useState<SceneDocument>(sceneResponse.document);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [alignment, setAlignment] = useState<MarkerAlignment | null>(null);
  const syncClientRef = useRef<SceneSyncClient | null>(null);

  const syncClient = useMemo(() => {
    const client = createSceneSyncClient({
      endpoint: { address: host.address, port: host.httpPort },
      sceneId: sceneResponse.scene.sceneId,
      clientId: `mobile-${Date.now()}`,
      initialDocument: sceneResponse.document,
    });
    syncClientRef.current = client;
    client.onSnapshot((snapshot) => setDocument(snapshot.document));
    client.onEvents((message) => {
      const changed = message.events.find((event) => event.type === 'scene_changed');
      if (changed?.type === 'scene_changed') {
        setDocument(changed.document);
      }
    });
    client.connect();
    return client;
  }, [host.hostId, sceneResponse.scene.sceneId]);

  function submitOps(ops: SceneOp[]) {
    syncClient.submitOps(ops);
  }

  function handleInstanceDragged(instanceId: string, worldTransform: SceneTransform) {
    if (!alignment?.stable) return;
    const markerTransform = worldTransformToMarker(alignment, worldTransform);
    const op: SceneOp = {
      opId: createOpId(),
      type: 'update_transform',
      baseRevision: document.revision,
      instanceId,
      transform: markerTransform,
    };
    submitOps([op]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b' }}>
      <ViroARSceneNavigator
        autofocus
        initialScene={{ scene: SharedMarkerScene as unknown as () => React.JSX.Element }}
        viroAppProps={{
          document,
          assetsById,
          selectedInstanceId,
          onAlignmentChanged: setAlignment,
          onInstanceSelected: setSelectedInstanceId,
          onInstanceDragged: handleInstanceDragged,
        }}
        style={{ flex: 1 }}
      />
      <View style={{ position: 'absolute', left: 16, right: 16, top: 16, gap: 8 }}>
        <Text variant="labelLarge">场景：{sceneResponse.scene.name}</Text>
        <Text>revision {document.revision} · {alignment?.stable ? 'marker 已锁定' : '等待 marker'}</Text>
        <Button mode="contained-tonal" onPress={onLeave}>
          退出场景
        </Button>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: 运行 typecheck**

Run:

```bash
pnpm --filter @manga-ar/mobile typecheck
```

Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/screens/ARSceneScreen.tsx
git commit -m "feat(ar): 添加共享 AR 场景屏幕"
```

## Task 4: App 接入 ARSceneScreen

**Files:**
- Modify: `apps/mobile/App.tsx`

- [ ] **Step 1: 替换 joined scene 占位 UI**

在 `apps/mobile/App.tsx` 中：

删除 `ModelLibraryScreen` 占位导入。新增：

```ts
import { ARSceneScreen } from './src/components/screens/ARSceneScreen';
```

把 joined scene 分支替换为：

```tsx
{host && joinedScene ? (
  <ARSceneScreen
    host={host}
    sceneResponse={joinedScene.sceneResponse}
    assetsById={joinedScene.assetsById}
    onLeave={() => {
      setJoinedScene(null);
      setScene(null);
    }}
  />
) : null}
```

- [ ] **Step 2: 运行 typecheck**

Run:

```bash
pnpm --filter @manga-ar/mobile typecheck
```

Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/App.tsx
git commit -m "feat(mobile): 进入共享 AR 场景"
```

## Task 5: Desktop renderer 添加基础工作台结构

**Files:**
- Modify: `apps/studio-desktop/src/renderer/App.tsx`

- [ ] **Step 1: 扩展 App 工作台布局**

把 `apps/studio-desktop/src/renderer/App.tsx` 扩展为三栏基础结构。保留上一阶段 host 状态代码，增加场景、资产、设备区域：

```tsx
import { useEffect, useState } from 'react';

import { Button } from './components/ui/button';

type RendererHostServerState = Awaited<ReturnType<typeof window.mangaArStudio.host.getState>>;

export function App() {
  const [hostState, setHostState] = useState<RendererHostServerState>(null);

  async function refreshHostState() {
    const nextState = await window.mangaArStudio.host.getState();
    setHostState(nextState);
  }

  useEffect(() => {
    void refreshHostState();
  }, []);

  return (
    <main className="grid min-h-screen grid-cols-[280px_1fr_320px] bg-background text-foreground">
      <aside className="border-r p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">Manga AR</h1>
          <Button size="sm" onClick={() => void refreshHostState()}>刷新</Button>
        </div>
        <section className="mt-6">
          <h2 className="text-sm font-medium">场景</h2>
          <p className="mt-2 text-sm text-muted-foreground">场景管理将在 host API 稳定后接入。</p>
        </section>
        <section className="mt-6">
          <h2 className="text-sm font-medium">资产库</h2>
          <p className="mt-2 text-sm text-muted-foreground">模型导入入口由 desktop host 资产库提供；当前面板显示资产库状态。</p>
        </section>
      </aside>

      <section className="p-6">
        <div className="flex h-full min-h-[520px] items-center justify-center rounded-lg border bg-card">
          <div className="text-center">
            <h2 className="text-xl font-semibold">共享场景编辑器</h2>
            <p className="mt-2 text-sm text-muted-foreground">marker 坐标系中的桌面编辑视图。</p>
          </div>
        </div>
      </section>

      <aside className="border-l p-4">
        <h2 className="text-sm font-medium">Host 状态</h2>
        <dl className="mt-4 grid gap-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">运行状态</dt>
            <dd>{hostState?.running ? '运行中' : '未启动'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">端口</dt>
            <dd>{hostState?.hostInfo.httpPort ?? '-'}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-muted-foreground">局域网地址</dt>
            <dd className="break-all">{hostState?.addresses.join(', ') || '-'}</dd>
          </div>
        </dl>
      </aside>
    </main>
  );
}
```

- [ ] **Step 2: 运行 desktop typecheck/build**

Run:

```bash
pnpm --filter @manga-ar/studio-desktop typecheck
pnpm --filter @manga-ar/studio-desktop build
```

Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/studio-desktop/src/renderer/App.tsx
git commit -m "feat(studio): 添加共享场景工作台布局"
```

## Task 6: 文档更新

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: 更新 README 运行说明**

确保 README 说明当前流程：

```md
## 共享场景开发流

1. 启动桌面端 Studio：`pnpm run studio`
2. 在手机端启动 Expo：`pnpm start`
3. 手机连接桌面端 host，选择场景，同步资产后进入 AR

同步主机由桌面端内建，仓库不再提供独立 relay 应用。
```

- [ ] **Step 2: 更新 AGENTS 测试说明**

在 AGENTS 的测试部分补充：

```md
For shared AR scene changes, verify desktop host, mobile host client, and marker-space transform boundaries. Run `pnpm run check:structure`, `pnpm run typecheck`, and `pnpm --filter @manga-ar/studio-desktop build`. Manually test two mobile devices against one Studio host when AR sync behavior changes.
```

- [ ] **Step 3: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: 更新共享 AR 场景开发说明"
```

## Task 7: 最终验收

**Files:**
- Verify only.

- [ ] **Step 1: 运行结构和类型验证**

Run:

```bash
pnpm run check:structure
pnpm run typecheck
pnpm --filter @manga-ar/studio-desktop build
pnpm run test:viro-android-plugin
```

Expected: 全部 PASS。

- [ ] **Step 2: 确认 relay 没有恢复**

Run:

```bash
Test-Path apps\relay
rg -n "@manga-ar/relay|pnpm run relay|apps/relay" package.json README.md AGENTS.md scripts apps shared
```

Expected:

```text
False
```

`rg` 不应在正式源码、脚本或当前开发文档中找到 relay 入口。

- [ ] **Step 3: 手动联调记录**

在最终 PR 或总结中记录：

```text
手动验证：
- Studio host 状态可见：
- 手机可连接 host：
- 手机可选择场景：
- 手机可同步资产：
- AR marker 对齐可进入：
- 两手机共享场景同步：
- 电脑端编辑同步：
```

未能完成的手动项必须明确写出原因。
