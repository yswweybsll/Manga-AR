# Shared Contract And Repo Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 desktop host 所需的 shared contract，并彻底删除独立 `apps/relay`。

**Architecture:** `shared` 只保留平台无关类型和纯函数；旧的 `scene_snapshot/sessionId/lock` 协议被替换为 host snapshot、client ops、host events 和 revision contract。仓库结构、脚本和文档同步移除 relay，使后续实现只有 desktop host 一条同步主线。

**Tech Stack:** TypeScript、pnpm workspace、Node 文件结构检查脚本。

---

## 已实现说明

**实现日期:** 2026-05-17

**提交记录:**

- `2b12887 feat(shared): 定义 desktop host 场景同步协议`
- `e9d6f6f refactor(mobile): 隔离旧 AR 本地类型`
- `663011d refactor(repo): 移除独立 relay 应用`

**实现结果:**

- `shared` 已切换为 desktop host 所需的资产、场景、host 和 sync contract。
- mobile 暂时保留本地 legacy AR 类型，避免第一阶段连带重构现有 `ARPlacementScreen`。
- `apps/relay` 已删除，根脚本、结构检查、README 和 AGENTS.md 不再提供独立 relay 入口。
- 已补清理本地残留的 `apps/relay/node_modules` 目录，并从 `pnpm-lock.yaml` 移除 `apps/relay` importer。
- `apps/studio-desktop/src/renderer/App.tsx` 的占位 `SceneDocument` 已同步到新 contract，保证根 `typecheck` 通过。

**验证结果:**

- `Test-Path apps\relay` 输出 `False`。
- `rg -n "apps/relay|@manga-ar/relay" pnpm-lock.yaml` 无命中。
- `pnpm run check:structure` 通过，输出 `Workspace structure check passed.`。
- `pnpm run typecheck` 通过，覆盖 shared、mobile 和 studio-desktop。

**实现备注:**

- Task 3 的 Step 6 实际还需要在 mobile sync 类型中保留 `instance_update` 与 `lock_*` 的 legacy 消息类型，因为 `ARPlacementScreen` 当前仍会消费这些旧 relay 消息。
- Task 4 的 Step 7 首次运行时发现 desktop 占位场景仍使用旧 `SceneDocument.id/updatedAt/pendingModelId` 字段；已改为 `sceneId/revision/selectedInstanceId/instances` 后通过。
- 2026-05-17 复核时发现 `apps/relay` 仍因被忽略的 `node_modules/ws` 目录存在，且 `pnpm-lock.yaml` 还保留 `apps/relay` importer；已删除残留目录并刷新 lockfile。`pnpm install --lockfile-only` 曾引入无关 `optional: true` 元数据变更，最终已撤掉，只保留 relay importer 删除。

## Task 1: 重写 shared 模型与场景类型

**Files:**
- Modify: `shared/src/models/index.ts`
- Modify: `shared/src/scene/index.ts`
- Modify: `shared/src/index.ts`

- [x] **Step 1: 替换模型资产 contract**

把 `shared/src/models/index.ts` 改为：

```ts
export type ModelFormat = 'GLB' | 'GLTF' | 'OBJ' | 'VRX';

export type AssetBounds = {
  width: number;
  height: number;
  depth: number;
};

export type AssetPreview = {
  thumbnailUrl?: string;
  dominantColor?: string;
};

export type AssetRecord = {
  assetId: string;
  name: string;
  version: number;
  fileName: string;
  fileSize: number;
  checksum: string;
  contentType: string;
  format: ModelFormat;
  bounds?: AssetBounds;
  preview?: AssetPreview;
  defaultScale?: number;
  surfaceOffset?: number;
};

export type ModelAssetRef = {
  assetId: string;
  version: number;
};
```

- [x] **Step 2: 替换场景 contract**

把 `shared/src/scene/index.ts` 改为：

```ts
import type { ModelAssetRef } from '../models/index.js';

export type Revision = number;

export type SceneTransform = {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scaleValue: number;
};

export type MarkerAnchorDefinition = {
  anchorType: 'marker';
  markerId: string;
  physicalWidthMeters: number;
  referenceImageChecksum: string;
  displayName?: string;
};

export type SceneAnchorDefinition = MarkerAnchorDefinition;

export type SceneInstance = {
  instanceId: string;
  asset: ModelAssetRef;
  transform: SceneTransform;
  instanceRevision: Revision;
};

export type SceneRecord = {
  sceneId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  revision: Revision;
  anchorDefinition: SceneAnchorDefinition;
  assetRefs: ModelAssetRef[];
  thumbnailUrl?: string;
};

export type SceneDocument = {
  sceneId: string;
  revision: Revision;
  selectedInstanceId: string | null;
  instances: SceneInstance[];
};

export type AddInstanceOp = {
  opId: string;
  type: 'add_instance';
  baseRevision: Revision;
  instance: SceneInstance;
};

export type UpdateTransformOp = {
  opId: string;
  type: 'update_transform';
  baseRevision: Revision;
  instanceId: string;
  transform: SceneTransform;
};

export type DeleteInstanceOp = {
  opId: string;
  type: 'delete_instance';
  baseRevision: Revision;
  instanceId: string;
};

export type ReplaceAssetOp = {
  opId: string;
  type: 'replace_asset';
  baseRevision: Revision;
  instanceId: string;
  asset: ModelAssetRef;
};

export type SelectInstanceOp = {
  opId: string;
  type: 'select_instance';
  baseRevision: Revision;
  instanceId: string | null;
};

export type SceneOp =
  | AddInstanceOp
  | UpdateTransformOp
  | DeleteInstanceOp
  | ReplaceAssetOp
  | SelectInstanceOp;
```

- [x] **Step 3: 确认统一导出**

确保 `shared/src/index.ts` 是：

```ts
export * from './models/index.js';
export * from './scene/index.js';
export * from './sync/index.js';
export * from './host/index.js';
```

如果 `host/index.ts` 还不存在，下一任务会创建；此时 typecheck 会失败是预期。

- [x] **Step 4: 运行 typecheck 并确认当前失败点**

Run:

```bash
pnpm --filter @manga-ar/shared typecheck
```

Expected: FAIL，错误只应来自 `./host/index.js` 不存在或旧 sync 类型引用字段变化。下一任务修复。

## Task 2: 新增 host 与 sync contract

**Files:**
- Create: `shared/src/host/index.ts`
- Modify: `shared/src/sync/index.ts`

- [x] **Step 1: 创建 host contract**

新增 `shared/src/host/index.ts`：

```ts
import type { AssetRecord } from '../models/index.js';
import type { SceneDocument, SceneOp, SceneRecord } from '../scene/index.js';

export type HostProtocolVersion = '2026-05-16';

export type HostInfo = {
  hostId: string;
  hostName: string;
  protocolVersion: HostProtocolVersion;
  httpPort: number;
  wsPath: '/sync';
};

export type DiscoveredHost = HostInfo & {
  address: string;
  lastSeenAt: number;
};

export type ClientRole = 'desktop' | 'mobile';

export type HostInfoResponse = {
  host: HostInfo;
};

export type SceneListResponse = {
  scenes: SceneRecord[];
};

export type SceneResponse = {
  scene: SceneRecord;
  document: SceneDocument;
};

export type AssetManifestResponse = {
  assets: AssetRecord[];
};

export type SubmitSceneOpsRequest = {
  clientId: string;
  role: ClientRole;
  ops: SceneOp[];
};

export type SubmitSceneOpsResponse = {
  acceptedOpIds: string[];
  rejected: Array<{
    opId: string;
    reason: 'stale_revision' | 'missing_instance' | 'missing_asset' | 'invalid_op';
  }>;
  document: SceneDocument;
};
```

- [x] **Step 2: 替换 sync contract**

把 `shared/src/sync/index.ts` 改为：

```ts
import type { AssetRecord } from '../models/index.js';
import type { Revision, SceneDocument, SceneOp } from '../scene/index.js';
import type { ClientRole } from '../host/index.js';

export type SyncConnectionStatus =
  | 'disconnected'
  | 'discovering'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'error';

export type HostSnapshotMessage = {
  type: 'host_snapshot';
  sceneId: string;
  timestamp: number;
  document: SceneDocument;
  assets: AssetRecord[];
};

export type ClientOpsMessage = {
  type: 'client_ops';
  sceneId: string;
  timestamp: number;
  clientId: string;
  role: ClientRole;
  ops: SceneOp[];
};

export type HostOpAcceptedEvent = {
  type: 'op_accepted';
  opId: string;
  revision: Revision;
};

export type HostOpRejectedEvent = {
  type: 'op_rejected';
  opId: string;
  reason: 'stale_revision' | 'missing_instance' | 'missing_asset' | 'invalid_op';
  authoritativeRevision: Revision;
};

export type HostSceneChangedEvent = {
  type: 'scene_changed';
  sceneId: string;
  revision: Revision;
  document: SceneDocument;
};

export type HostEventMessage = {
  type: 'host_events';
  sceneId: string;
  timestamp: number;
  events: Array<HostOpAcceptedEvent | HostOpRejectedEvent | HostSceneChangedEvent>;
};

export type PingMessage = {
  type: 'ping';
  timestamp: number;
};

export type PongMessage = {
  type: 'pong';
  timestamp: number;
};

export type SyncMessage =
  | HostSnapshotMessage
  | ClientOpsMessage
  | HostEventMessage
  | PingMessage
  | PongMessage;
```

- [x] **Step 3: 运行 shared typecheck**

Run:

```bash
pnpm --filter @manga-ar/shared typecheck
```

Expected: PASS for `shared`。如果 mobile 因旧类型失败，暂不处理，本阶段后续任务会加兼容层或调整引用。

- [x] **Step 4: Commit**

```bash
git add shared/src/models/index.ts shared/src/scene/index.ts shared/src/sync/index.ts shared/src/host/index.ts shared/src/index.ts
git commit -m "feat(shared): 定义 desktop host 场景同步协议"
```

## Task 3: 临时修复 mobile 对旧 shared shape 的编译依赖

**Files:**
- Modify: `apps/mobile/src/types/model.ts`
- Modify: `apps/mobile/src/types/scene.ts`
- Modify: `apps/mobile/src/types/sync.ts`

- [x] **Step 1: 检查当前 mobile 类型 re-export**

Run:

```bash
Get-Content apps\mobile\src\types\model.ts
Get-Content apps\mobile\src\types\scene.ts
Get-Content apps\mobile\src\types\sync.ts
```

Expected: 看到这些文件从 `@manga-ar/shared` 或本地定义旧字段。下一步保留 mobile 当前 UI 所需 legacy 类型，避免第一阶段把 AR 大屏同时改坏。

- [x] **Step 2: 在 mobile model 类型中补 legacy shape**

如果 `apps/mobile/src/types/model.ts` 依赖旧 `ModelAssetRef.id/modelUrl`，改成显式 mobile-local 类型：

```ts
import type { ModelFormat } from '@manga-ar/shared';

export type RemoteModel = {
  id: string;
  name: string;
  thumbnailUrl?: string;
  modelUrl: string;
  format: ModelFormat;
  defaultScale?: number;
  width?: number;
  height?: number;
  depth?: number;
  surfaceOffset?: number;
};

export type CachedModelAsset = RemoteModel & {
  localUri: string;
};

export type SceneModelInstance = {
  instanceId: string;
  asset: CachedModelAsset;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scaleValue: number;
};
```

- [x] **Step 3: 在 mobile scene 类型中保留 recent scene local format**

把 `apps/mobile/src/types/scene.ts` 调整为：

```ts
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
```

- [x] **Step 4: 在 mobile sync 类型中过渡到 shared 新类型**

把 `apps/mobile/src/types/sync.ts` 改成：

```ts
export type {
  SyncConnectionStatus,
  SyncMessage,
  HostSnapshotMessage,
  ClientOpsMessage,
  HostEventMessage,
} from '@manga-ar/shared';

export type SyncServiceConfig = {
  serverUrl: string;
  sessionId: string;
  reconnectIntervalMs?: number;
  pingIntervalMs?: number;
  snapshotThrottleMs?: number;
};
```

这里保留 `SyncServiceConfig` 是为了让现有 `ARPlacementScreen` 暂时编译；后续阶段会删除固定 relay 配置。

- [x] **Step 5: 运行 mobile typecheck**

Run:

```bash
pnpm --filter @manga-ar/mobile typecheck
```

Expected: 可能仍 FAIL，错误集中在 `syncService.ts` 的旧消息类型。若失败，继续 Step 6。

- [x] **Step 6: 给旧 syncService 加本地 legacy 类型**

如果 `apps/mobile/src/services/syncService.ts` 因 `SceneSnapshotMessage` 不存在失败，在该文件内临时定义：

```ts
type LegacySceneSnapshotMessage = {
  type: 'scene_snapshot';
  sessionId: string;
  timestamp: number;
  instances: Array<SceneModelInstance & { syncVersion: number }>;
  selectedInstanceId: string | null;
};
```

并把 `buildSnapshotMessage` 的返回类型从 `SceneSnapshotMessage` 改为 `LegacySceneSnapshotMessage`。这是过渡兼容，阶段 03 会删除旧 syncService。

- [x] **Step 7: Commit**

```bash
git add apps/mobile/src/types/model.ts apps/mobile/src/types/scene.ts apps/mobile/src/types/sync.ts apps/mobile/src/services/syncService.ts
git commit -m "refactor(mobile): 隔离旧 AR 本地类型"
```

## Task 4: 删除 apps/relay 并更新 workspace 脚本

**Files:**
- Delete: `apps/relay/**`
- Modify: `package.json`
- Modify: `scripts/check-workspace-structure.mjs`
- Modify: `README.md`
- Modify: `AGENTS.md`

- [x] **Step 1: 删除 relay 目录**

执行本步骤前确认用户已经明确批准执行本计划。删除前先运行：

```bash
Resolve-Path apps\relay
```

Expected: 解析路径必须是当前仓库下的 `D:\Workspace\projects\Manga-AR\apps\relay`。

Run:

```bash
Remove-Item -Recurse -Force apps\relay
```

Expected: `apps/relay` 不存在。

- [x] **Step 2: 更新根 package scripts**

把根 `package.json` scripts 改成不引用 relay：

```json
{
  "scripts": {
    "start": "pnpm --filter @manga-ar/mobile start",
    "android": "pnpm --filter @manga-ar/mobile android",
    "android:release": "pnpm --filter @manga-ar/mobile android:release",
    "android:install-release": "pnpm --filter @manga-ar/mobile android:install-release",
    "ios": "pnpm --filter @manga-ar/mobile ios",
    "web": "pnpm --filter @manga-ar/mobile web",
    "prebuild": "pnpm --filter @manga-ar/mobile prebuild",
    "prebuild:android": "pnpm --filter @manga-ar/mobile prebuild:android",
    "studio": "pnpm --filter @manga-ar/studio-desktop dev",
    "typecheck": "pnpm --filter @manga-ar/shared typecheck && pnpm --filter @manga-ar/mobile typecheck && pnpm --filter @manga-ar/studio-desktop typecheck",
    "check:structure": "node scripts/check-workspace-structure.mjs",
    "test:viro-android-plugin": "node scripts/test-viro-android-plugin.mjs"
  }
}
```

保留原有 `pnpm.overrides`。

- [x] **Step 3: 更新结构检查脚本**

把 `scripts/check-workspace-structure.mjs` 中 required paths 和 dependency assertions 改为：

```js
const requiredPaths = [
  'apps/mobile/package.json',
  'apps/studio-desktop/package.json',
  'shared/package.json',
  'shared/src/index.ts',
];
```

删除：

```js
assertDependency('apps/relay/package.json', '@manga-ar/shared');
```

- [x] **Step 4: 更新 README**

把 README 开头改为：

```md
Manga AR 是一个 pnpm workspace monorepo。当前包含 Expo React Native 手机端、Electron 桌面端，以及顶层 `shared` 共享类型包。同步主机能力由桌面端 Studio 内建，不再保留独立 relay 应用。
```

删除“中继服务”运行段落和 `pnpm run relay` 示例。

- [x] **Step 5: 更新 AGENTS.md**

删除 `apps/relay` 作为正式项目结构的条目。把 Sync 说明改为：

```md
## Sync and Desktop Host Notes

共享同步 contract 位于 `shared/src/sync/index.ts` 和 `shared/src/host/index.ts`。产品架构不再包含独立 `apps/relay`；电脑端 Studio 的 Electron main process 是唯一 host，负责场景权威状态、资产分发、局域网发现和 WebSocket 同步。
```

删除 relay 测试说明中 `pnpm run relay` 的要求。

- [x] **Step 6: 运行结构检查**

Run:

```bash
pnpm run check:structure
```

Expected: PASS，且输出 `Workspace structure check passed.`

- [x] **Step 7: 运行根 typecheck**

Run:

```bash
pnpm run typecheck
```

Expected: PASS，或只剩后续阶段明确要改的 desktop/mobile 未实现错误。若失败来自 `@manga-ar/relay` not found，说明脚本清理不完整，回到 Step 2。

- [x] **Step 8: Commit**

```bash
git add package.json scripts/check-workspace-structure.mjs README.md AGENTS.md shared apps/mobile
git add -u apps/relay
git commit -m "refactor(repo): 移除独立 relay 应用"
```

## Task 5: 阶段验收

**Files:**
- Verify only.

- [x] **Step 1: 确认 relay 不存在**

Run:

```bash
Test-Path apps\relay
```

Expected:

```text
False
```

- [x] **Step 2: 搜索 relay 正式入口残留**

Run:

```bash
rg -n "@manga-ar/relay|pnpm run relay|apps/relay|relay-served|relay 作为正式" package.json README.md AGENTS.md scripts docs
```

Expected: 只允许在历史 spec/plan 中出现“必须删除 relay”的描述；根脚本和当前开发说明不能再指导运行 relay。

- [x] **Step 3: 搜索 lockfile 中的 relay importer 残留**

Run:

```bash
rg -n "apps/relay|@manga-ar/relay" pnpm-lock.yaml
```

Expected: 无命中。

- [x] **Step 4: 最终命令**

Run:

```bash
pnpm run check:structure
pnpm run typecheck
```

Expected: PASS。
