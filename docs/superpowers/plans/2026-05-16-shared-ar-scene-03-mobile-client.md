# Mobile Host Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让移动端从“选择 mock 模型直接进 AR”改为“发现电脑端 host、选择场景、同步资产、建立 WebSocket 场景 draft”。

**Architecture:** 移动端服务层分为 discovery、hostApi、assetSyncService、sceneSyncClient、sceneDraftStore。UI 先用 react-native-paper 建立非 AR 的 host/scene/asset 流程，AR 坐标换算在下一阶段接入。

**Tech Stack:** Expo React Native、react-native-paper、expo-file-system、WebSocket、TypeScript。

---

## 实现说明

完成日期：2026-05-17。

本阶段已在当前工作区完成并通过验收。实现范围包括 mobile host HTTP client、host discovery 服务边界、场景资产同步、scene draft 本地持久化、WebSocket scene sync client、HostDiscovery/ScenePicker/AssetSync 三个移动端界面，以及 `App.tsx` 的 host 加入流程接入。

实际实现相对初版计划做了以下必要加固：

- `assetSyncService` 不再只按文件存在判断缓存命中，而是对 host manifest 派生的本地文件名做 path segment 清洗，校验文件大小和 desktop host 生成的 SHA-256 checksum；缓存损坏时会在同一次同步中删除并重新下载。
- `sceneDraftStore` 对 `sceneId` 做安全文件名派生，并在读取 draft 时容忍空文件、损坏 JSON 和错误 shape；`sceneId` 与 `lastSnapshot.sceneId` 不匹配时返回 `null`。
- `sceneSyncClient` 会在连接前读取本地 draft，合并 draft pending ops 与连接前/连接期间新提交的 ops；`host_snapshot` 不再清空 pending ops，pending 只由 `op_accepted` / `op_rejected` 解析；入站 WebSocket 消息做 sceneId 和基础 shape 校验，避免错场景或 malformed payload 污染本地 draft。
- `AssetSyncScreen` 会校验 manifest 覆盖 `scene.assetRefs` 与 `document.instances[].asset`，缺失必需资产时不会进入 ready 状态。
- `App.tsx` 在资产同步完成后使用明确的“共享场景已同步”临时占位页，显示 scene name、revision 和同步资产数量，并提供返回场景列表入口；下一阶段再替换为正式 `ARSceneScreen`。
- 新增 `pnpm run test:mobile`，覆盖 scene sync draft/replay/pending 行为和 asset checksum/cache 行为。

当前已知验收缺口：

- 自动 mDNS/Bonjour 发现尚未完成。`discoveryService.discover()` 当前返回空数组，并保留手动 IP/端口连接入口；这项仍需后续接入 React Native 可用的 mDNS/Bonjour native module 后才能通过手动联调验收。

已通过验证：

```bash
pnpm run test:mobile
pnpm --filter @manga-ar/mobile typecheck
pnpm run check:structure
pnpm run typecheck
```

## Precondition

先完成：

- `01-contract-and-repo-cleanup`
- `02-desktop-host`

本阶段默认 desktop host 已提供：

- `GET /host/info`
- `GET /scenes`
- `GET /scenes/:sceneId`
- `GET /scenes/:sceneId/assets`
- `GET /assets/:assetId/file`
- `POST /scenes/:sceneId/ops`
- `ws://host:port/sync?sceneId=<sceneId>`

## Task 1: 创建 hostApi

**Files:**
- Create: `apps/mobile/src/services/hostApi.ts`

- [x] **Step 1: 新增 hostApi**

新增 `apps/mobile/src/services/hostApi.ts`：

```ts
import type {
  AssetManifestResponse,
  HostInfoResponse,
  SceneListResponse,
  SceneResponse,
  SubmitSceneOpsRequest,
  SubmitSceneOpsResponse,
} from '@manga-ar/shared';

export type HostEndpoint = {
  address: string;
  port: number;
};

function baseUrl(endpoint: HostEndpoint): string {
  return `http://${endpoint.address}:${endpoint.port}`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`请求失败 ${response.status}: ${url}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchHostInfo(endpoint: HostEndpoint): Promise<HostInfoResponse> {
  return getJson<HostInfoResponse>(`${baseUrl(endpoint)}/host/info`);
}

export async function fetchScenes(endpoint: HostEndpoint): Promise<SceneListResponse> {
  return getJson<SceneListResponse>(`${baseUrl(endpoint)}/scenes`);
}

export async function fetchScene(endpoint: HostEndpoint, sceneId: string): Promise<SceneResponse> {
  return getJson<SceneResponse>(`${baseUrl(endpoint)}/scenes/${encodeURIComponent(sceneId)}`);
}

export async function fetchSceneAssets(endpoint: HostEndpoint, sceneId: string): Promise<AssetManifestResponse> {
  return getJson<AssetManifestResponse>(`${baseUrl(endpoint)}/scenes/${encodeURIComponent(sceneId)}/assets`);
}

export async function submitSceneOps(
  endpoint: HostEndpoint,
  sceneId: string,
  request: SubmitSceneOpsRequest
): Promise<SubmitSceneOpsResponse> {
  const response = await fetch(`${baseUrl(endpoint)}/scenes/${encodeURIComponent(sceneId)}/ops`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`提交场景操作失败 ${response.status}`);
  }

  return response.json() as Promise<SubmitSceneOpsResponse>;
}

export function assetFileUrl(endpoint: HostEndpoint, assetId: string): string {
  return `${baseUrl(endpoint)}/assets/${encodeURIComponent(assetId)}/file`;
}

export function syncWebSocketUrl(endpoint: HostEndpoint, sceneId: string): string {
  return `ws://${endpoint.address}:${endpoint.port}/sync?sceneId=${encodeURIComponent(sceneId)}`;
}
```

- [x] **Step 2: 运行 mobile typecheck**

Run:

```bash
pnpm --filter @manga-ar/mobile typecheck
```

Expected: PASS。

- [x] **Step 3: Commit**

```bash
git add apps/mobile/src/services/hostApi.ts
git commit -m "feat(mobile): 添加 desktop host HTTP 客户端"
```

## Task 2: 创建 discoveryService

**Files:**
- Create: `apps/mobile/src/services/discoveryService.ts`

- [x] **Step 1: 新增简化发现服务**

第一版先提供统一 discovery 接口，并保留手动连接作为调试入口。正式 mDNS/Bonjour 自动发现仍是本功能的验收目标；如果当前 React Native 环境缺少可用 mDNS native module，执行者必须在本任务记录阻塞原因，并在最终总结中把“自动发现未完成”列为未通过验收项。

新增 `apps/mobile/src/services/discoveryService.ts`：

```ts
import type { DiscoveredHost } from '@manga-ar/shared';

import { fetchHostInfo, type HostEndpoint } from './hostApi';

export type DiscoveryService = {
  discover: () => Promise<DiscoveredHost[]>;
  rememberManualHost: (endpoint: HostEndpoint) => Promise<DiscoveredHost>;
};

export function createDiscoveryService(): DiscoveryService {
  return {
    async discover() {
      return [];
    },

    async rememberManualHost(endpoint) {
      const response = await fetchHostInfo(endpoint);
      return {
        ...response.host,
        address: endpoint.address,
        lastSeenAt: Date.now(),
      };
    },
  };
}
```

- [x] **Step 2: 运行 typecheck**

Run:

```bash
pnpm --filter @manga-ar/mobile typecheck
```

Expected: PASS。

- [x] **Step 3: Commit**

```bash
git add apps/mobile/src/services/discoveryService.ts
git commit -m "feat(mobile): 添加 host 发现服务边界"
```

## Task 3: 创建 assetSyncService

**Files:**
- Create: `apps/mobile/src/services/assetSyncService.ts`

- [x] **Step 1: 新增资产同步服务**

新增 `apps/mobile/src/services/assetSyncService.ts`：

```ts
import { Directory, File, Paths } from 'expo-file-system';

import type { AssetRecord } from '@manga-ar/shared';

import { assetFileUrl, type HostEndpoint } from './hostApi';

export type LocalAssetRecord = AssetRecord & {
  localUri: string;
};

const ASSET_DIRECTORY = new Directory(Paths.document, 'host-assets');

function ensureAssetDirectory(): void {
  if (!ASSET_DIRECTORY.exists) {
    ASSET_DIRECTORY.create({ idempotent: true, intermediates: true });
  }
}

function localAssetFile(asset: AssetRecord): File {
  return new File(ASSET_DIRECTORY, `${asset.assetId}-${asset.version}-${asset.fileName}`);
}

export async function syncSceneAssets(
  endpoint: HostEndpoint,
  assets: AssetRecord[],
  onProgress?: (completed: number, total: number) => void
): Promise<Record<string, LocalAssetRecord>> {
  ensureAssetDirectory();
  const result: Record<string, LocalAssetRecord> = {};

  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    const target = localAssetFile(asset);
    if (!target.exists) {
      await File.downloadFileAsync(assetFileUrl(endpoint, asset.assetId), target);
    }
    result[asset.assetId] = {
      ...asset,
      localUri: target.uri,
    };
    onProgress?.(index + 1, assets.length);
  }

  return result;
}
```

- [x] **Step 2: 运行 typecheck**

Run:

```bash
pnpm --filter @manga-ar/mobile typecheck
```

Expected: PASS。

- [x] **Step 3: Commit**

```bash
git add apps/mobile/src/services/assetSyncService.ts
git commit -m "feat(mobile): 添加场景资产同步服务"
```

## Task 4: 创建 sceneDraftStore

**Files:**
- Create: `apps/mobile/src/services/sceneDraftStore.ts`

- [x] **Step 1: 新增 draft store**

新增 `apps/mobile/src/services/sceneDraftStore.ts`：

```ts
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

function draftFile(sceneId: string): File {
  return new File(DRAFT_DIRECTORY, `${sceneId}.json`);
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
  return JSON.parse(text) as SceneDraft;
}
```

- [x] **Step 2: 运行 typecheck**

Run:

```bash
pnpm --filter @manga-ar/mobile typecheck
```

Expected: PASS。

- [x] **Step 3: Commit**

```bash
git add apps/mobile/src/services/sceneDraftStore.ts
git commit -m "feat(mobile): 添加共享场景 draft 存储"
```

## Task 5: 创建 sceneSyncClient

**Files:**
- Create: `apps/mobile/src/services/sceneSyncClient.ts`

- [x] **Step 1: 新增同步客户端**

新增 `apps/mobile/src/services/sceneSyncClient.ts`：

```ts
import type {
  ClientOpsMessage,
  HostEventMessage,
  HostSnapshotMessage,
  SceneDocument,
  SceneOp,
  SyncConnectionStatus,
  SyncMessage,
} from '@manga-ar/shared';

import { syncWebSocketUrl, type HostEndpoint } from './hostApi';
import { saveSceneDraft } from './sceneDraftStore';

export type SceneSyncClient = {
  connect: () => void;
  disconnect: () => void;
  submitOps: (ops: SceneOp[]) => void;
  onSnapshot: (handler: (snapshot: HostSnapshotMessage) => void) => () => void;
  onEvents: (handler: (events: HostEventMessage) => void) => () => void;
  onStatusChange: (handler: (status: SyncConnectionStatus) => void) => () => void;
  getPendingOps: () => SceneOp[];
};

export type SceneSyncClientOptions = {
  endpoint: HostEndpoint;
  sceneId: string;
  clientId: string;
  initialDocument: SceneDocument;
};

export function createSceneSyncClient(options: SceneSyncClientOptions): SceneSyncClient {
  let ws: WebSocket | null = null;
  let status: SyncConnectionStatus = 'disconnected';
  let currentDocument = options.initialDocument;
  let pendingOps: SceneOp[] = [];

  const snapshotHandlers = new Set<(snapshot: HostSnapshotMessage) => void>();
  const eventHandlers = new Set<(events: HostEventMessage) => void>();
  const statusHandlers = new Set<(status: SyncConnectionStatus) => void>();

  function setStatus(next: SyncConnectionStatus): void {
    if (status === next) return;
    status = next;
    statusHandlers.forEach((handler) => handler(next));
  }

  function send(message: SyncMessage): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function flushPending(): void {
    if (pendingOps.length === 0) return;
    const message: ClientOpsMessage = {
      type: 'client_ops',
      sceneId: options.sceneId,
      timestamp: Date.now(),
      clientId: options.clientId,
      role: 'mobile',
      ops: pendingOps,
    };
    send(message);
  }

  function rememberDraft(): void {
    void saveSceneDraft({
      sceneId: options.sceneId,
      updatedAt: Date.now(),
      lastSnapshot: currentDocument,
      pendingOps,
    });
  }

  return {
    connect() {
      setStatus('connecting');
      ws = new WebSocket(syncWebSocketUrl(options.endpoint, options.sceneId));

      ws.onopen = () => {
        setStatus('connected');
        flushPending();
      };

      ws.onclose = () => {
        setStatus('disconnected');
      };

      ws.onerror = () => {
        setStatus('error');
      };

      ws.onmessage = (event: MessageEvent) => {
        const message = JSON.parse(event.data as string) as SyncMessage;
        if (message.type === 'host_snapshot') {
          currentDocument = message.document;
          pendingOps = [];
          rememberDraft();
          snapshotHandlers.forEach((handler) => handler(message));
          return;
        }

        if (message.type === 'host_events') {
          const acceptedIds = new Set(
            message.events
              .filter((item) => item.type === 'op_accepted')
              .map((item) => item.opId)
          );
          pendingOps = pendingOps.filter((op) => !acceptedIds.has(op.opId));
          const changed = message.events.find((item) => item.type === 'scene_changed');
          if (changed?.type === 'scene_changed') {
            currentDocument = changed.document;
          }
          rememberDraft();
          eventHandlers.forEach((handler) => handler(message));
        }
      };
    },

    disconnect() {
      ws?.close();
      ws = null;
      setStatus('disconnected');
    },

    submitOps(ops) {
      pendingOps = [...pendingOps, ...ops];
      rememberDraft();
      flushPending();
    },

    onSnapshot(handler) {
      snapshotHandlers.add(handler);
      return () => snapshotHandlers.delete(handler);
    },

    onEvents(handler) {
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    },

    onStatusChange(handler) {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    },

    getPendingOps() {
      return pendingOps;
    },
  };
}
```

- [x] **Step 2: 运行 typecheck**

Run:

```bash
pnpm --filter @manga-ar/mobile typecheck
```

Expected: PASS。

- [x] **Step 3: Commit**

```bash
git add apps/mobile/src/services/sceneSyncClient.ts
git commit -m "feat(mobile): 添加共享场景同步客户端"
```

## Task 6: 添加 host discovery UI

**Files:**
- Create: `apps/mobile/src/components/screens/HostDiscoveryScreen.tsx`

- [x] **Step 1: 新增 HostDiscoveryScreen**

新增 `apps/mobile/src/components/screens/HostDiscoveryScreen.tsx`：

```tsx
import React, { useState } from 'react';
import { FlatList, View } from 'react-native';
import { Button, Card, Text, TextInput } from 'react-native-paper';
import type { DiscoveredHost } from '@manga-ar/shared';

import { createDiscoveryService } from '../../services/discoveryService';

type HostDiscoveryScreenProps = {
  onSelectHost: (host: DiscoveredHost) => void;
};

const discoveryService = createDiscoveryService();

export function HostDiscoveryScreen({ onSelectHost }: HostDiscoveryScreenProps) {
  const [hosts, setHosts] = useState<DiscoveredHost[]>([]);
  const [manualAddress, setManualAddress] = useState('127.0.0.1');
  const [manualPort, setManualPort] = useState('3001');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function discoverHosts() {
    setLoading(true);
    setError(null);
    try {
      setHosts(await discoveryService.discover());
    } catch (err) {
      setError(err instanceof Error ? err.message : '发现主机失败');
    } finally {
      setLoading(false);
    }
  }

  async function connectManualHost() {
    setLoading(true);
    setError(null);
    try {
      const host = await discoveryService.rememberManualHost({
        address: manualAddress.trim(),
        port: Number(manualPort),
      });
      onSelectHost(host);
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接主机失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, gap: 16, padding: 16, backgroundColor: '#09090b' }}>
      <Text variant="headlineSmall">选择 Studio 主机</Text>
      <Button mode="contained" loading={loading} onPress={() => void discoverHosts()}>
        搜索局域网主机
      </Button>
      {error ? <Text style={{ color: '#fda4af' }}>{error}</Text> : null}

      <Card>
        <Card.Title title="手动连接" />
        <Card.Content style={{ gap: 12 }}>
          <TextInput label="电脑 IP" value={manualAddress} onChangeText={setManualAddress} />
          <TextInput label="端口" value={manualPort} onChangeText={setManualPort} keyboardType="number-pad" />
          <Button mode="contained-tonal" loading={loading} onPress={() => void connectManualHost()}>
            连接
          </Button>
        </Card.Content>
      </Card>

      <FlatList
        data={hosts}
        keyExtractor={(item) => item.hostId}
        renderItem={({ item }) => (
          <Card style={{ marginBottom: 12 }} onPress={() => onSelectHost(item)}>
            <Card.Title title={item.hostName} subtitle={`${item.address}:${item.httpPort}`} />
          </Card>
        )}
      />
    </View>
  );
}
```

- [x] **Step 2: 运行 typecheck**

Run:

```bash
pnpm --filter @manga-ar/mobile typecheck
```

Expected: PASS。

- [x] **Step 3: Commit**

```bash
git add apps/mobile/src/components/screens/HostDiscoveryScreen.tsx
git commit -m "feat(mobile): 添加 Studio 主机发现界面"
```

## Task 7: 添加 ScenePicker 和 AssetSync UI

**Files:**
- Create: `apps/mobile/src/components/screens/ScenePickerScreen.tsx`
- Create: `apps/mobile/src/components/screens/AssetSyncScreen.tsx`

- [x] **Step 1: 新增 ScenePickerScreen**

新增 `apps/mobile/src/components/screens/ScenePickerScreen.tsx`：

```tsx
import React, { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import type { DiscoveredHost, SceneRecord } from '@manga-ar/shared';

import { fetchScenes } from '../../services/hostApi';

type ScenePickerScreenProps = {
  host: DiscoveredHost;
  onBack: () => void;
  onSelectScene: (scene: SceneRecord) => void;
};

export function ScenePickerScreen({ host, onBack, onSelectScene }: ScenePickerScreenProps) {
  const [scenes, setScenes] = useState<SceneRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadScenes() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchScenes({ address: host.address, port: host.httpPort });
      setScenes(response.scenes);
    } catch (err) {
      setError(err instanceof Error ? err.message : '场景列表加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadScenes();
  }, [host.hostId]);

  return (
    <View style={{ flex: 1, gap: 16, padding: 16, backgroundColor: '#09090b' }}>
      <Button onPress={onBack}>返回主机列表</Button>
      <Text variant="headlineSmall">{host.hostName}</Text>
      {error ? <Text style={{ color: '#fda4af' }}>{error}</Text> : null}
      <Button mode="contained-tonal" loading={loading} onPress={() => void loadScenes()}>
        刷新场景
      </Button>
      <FlatList
        data={scenes}
        keyExtractor={(item) => item.sceneId}
        renderItem={({ item }) => (
          <Card style={{ marginBottom: 12 }} onPress={() => onSelectScene(item)}>
            <Card.Title title={item.name} subtitle={`revision ${item.revision}`} />
          </Card>
        )}
      />
    </View>
  );
}
```

- [x] **Step 2: 新增 AssetSyncScreen**

新增 `apps/mobile/src/components/screens/AssetSyncScreen.tsx`：

```tsx
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, ProgressBar, Text } from 'react-native-paper';
import type { DiscoveredHost, SceneRecord, SceneResponse } from '@manga-ar/shared';

import { syncSceneAssets, type LocalAssetRecord } from '../../services/assetSyncService';
import { fetchScene, fetchSceneAssets } from '../../services/hostApi';

type AssetSyncScreenProps = {
  host: DiscoveredHost;
  scene: SceneRecord;
  onBack: () => void;
  onReady: (payload: {
    sceneResponse: SceneResponse;
    assetsById: Record<string, LocalAssetRecord>;
  }) => void;
};

export function AssetSyncScreen({ host, scene, onBack, onReady }: AssetSyncScreenProps) {
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('准备同步资产');
  const [error, setError] = useState<string | null>(null);

  async function syncAssets() {
    setError(null);
    try {
      const endpoint = { address: host.address, port: host.httpPort };
      const sceneResponse = await fetchScene(endpoint, scene.sceneId);
      const manifest = await fetchSceneAssets(endpoint, scene.sceneId);
      setMessage(`需要同步 ${manifest.assets.length} 个资产`);
      const assetsById = await syncSceneAssets(endpoint, manifest.assets, (completed, total) => {
        setProgress(total === 0 ? 1 : completed / total);
        setMessage(`已同步 ${completed}/${total}`);
      });
      onReady({ sceneResponse, assetsById });
    } catch (err) {
      setError(err instanceof Error ? err.message : '资产同步失败');
    }
  }

  useEffect(() => {
    void syncAssets();
  }, [host.hostId, scene.sceneId]);

  return (
    <View style={{ flex: 1, gap: 16, padding: 16, backgroundColor: '#09090b' }}>
      <Button onPress={onBack}>返回场景列表</Button>
      <Text variant="headlineSmall">同步资产</Text>
      <Text>{scene.name}</Text>
      <ProgressBar progress={progress} />
      <Text>{message}</Text>
      {error ? <Text style={{ color: '#fda4af' }}>{error}</Text> : null}
      {error ? (
        <Button mode="contained" onPress={() => void syncAssets()}>
          重试
        </Button>
      ) : null}
    </View>
  );
}
```

- [x] **Step 3: 运行 typecheck**

Run:

```bash
pnpm --filter @manga-ar/mobile typecheck
```

Expected: PASS。

- [x] **Step 4: Commit**

```bash
git add apps/mobile/src/components/screens/ScenePickerScreen.tsx apps/mobile/src/components/screens/AssetSyncScreen.tsx
git commit -m "feat(mobile): 添加场景选择与资产同步界面"
```

## Task 8: App 接入 host 加入流程

**Files:**
- Modify: `apps/mobile/App.tsx`

- [x] **Step 1: 替换 App flow**

把 `apps/mobile/App.tsx` 改为保留 PaperProvider，但主流程改为：

```tsx
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { MD3DarkTheme, PaperProvider, type MD3Theme } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { DiscoveredHost, SceneRecord, SceneResponse } from '@manga-ar/shared';

import { AssetSyncScreen } from './src/components/screens/AssetSyncScreen';
import { HostDiscoveryScreen } from './src/components/screens/HostDiscoveryScreen';
import { ScenePickerScreen } from './src/components/screens/ScenePickerScreen';
import { ModelLibraryScreen } from './src/components/screens/ModelLibraryScreen';
import type { LocalAssetRecord } from './src/services/assetSyncService';

const appTheme: MD3Theme = {
  ...MD3DarkTheme,
  roundness: 3,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#7dd3fc',
    secondary: '#c4b5fd',
    tertiary: '#fda4af',
    background: '#09090b',
    surface: '#111318',
    surfaceVariant: '#1f2430',
    outline: '#3f3f46',
  },
};

type JoinedScenePayload = {
  sceneResponse: SceneResponse;
  assetsById: Record<string, LocalAssetRecord>;
};

export default function App() {
  const [host, setHost] = useState<DiscoveredHost | null>(null);
  const [scene, setScene] = useState<SceneRecord | null>(null);
  const [joinedScene, setJoinedScene] = useState<JoinedScenePayload | null>(null);

  return (
    <SafeAreaProvider>
      <PaperProvider theme={appTheme}>
        <View style={styles.container}>
          <StatusBar style="light" />
          {!host ? <HostDiscoveryScreen onSelectHost={setHost} /> : null}
          {host && !scene ? (
            <ScenePickerScreen
              host={host}
              onBack={() => setHost(null)}
              onSelectScene={setScene}
            />
          ) : null}
          {host && scene && !joinedScene ? (
            <AssetSyncScreen
              host={host}
              scene={scene}
              onBack={() => setScene(null)}
              onReady={setJoinedScene}
            />
          ) : null}
          {joinedScene ? (
            <ModelLibraryScreen
              models={[]}
              loading={false}
              error={null}
              preparingModelId={null}
              onRetry={() => undefined}
              onSelectModel={() => undefined}
            />
          ) : null}
        </View>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
});
```

这是临时占位：下一阶段用 `ARSceneScreen` 替换 joined 后的 `ModelLibraryScreen`。

- [x] **Step 2: 运行 typecheck**

Run:

```bash
pnpm --filter @manga-ar/mobile typecheck
```

Expected: PASS。

- [x] **Step 3: Commit**

```bash
git add apps/mobile/App.tsx
git commit -m "feat(mobile): 接入 host 场景加入流程"
```

## Task 9: 阶段验收

**Files:**
- Verify only.

- [x] **Step 1: 运行 mobile typecheck**

Run:

```bash
pnpm --filter @manga-ar/mobile typecheck
```

Expected: PASS。

- [x] **Step 2: 运行根验证**

Run:

```bash
pnpm run check:structure
pnpm run typecheck
```

Expected: PASS。
