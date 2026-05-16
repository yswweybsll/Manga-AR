# 多端共享 AR 场景重构设计

## 背景

Manga AR 当前已经是 pnpm workspace monorepo，包含 Expo React Native 手机端、Electron 桌面端骨架、`shared` 共享类型包，以及仍存在的 `apps/relay` 中继服务。现有同步模型以 `scene_snapshot` 和 `sessionId` 为中心，本质是把手机本地 AR 场景快照广播给其他客户端；它还没有解决多台手机共享同一个现实桌面坐标系的问题。

目标产品形态已经明确为只有两个一等客户端：

- 电脑端 Studio：管理多个场景和模型资产，是同步主机与最高控制权来源。
- 移动端 App：发现电脑端、加入场景、下载资产、通过 marker 对齐现实桌面并参与编辑。

独立 relay 不再是目标架构的一部分。`apps/relay` 必须在实现中删除，避免后续实现把独立中继服务当成合法方向。

## 目标

- 让两部手机在同一张桌子上看到一致的模型摆放。
- 让电脑端 Studio 管理多个场景，并作为每个场景的权威状态来源。
- 让电脑端管理模型资产库，并向移动端分发场景所需模型文件。
- 让移动端通过 mDNS/Bonjour 自动发现局域网中的电脑端 Studio。
- 第一版使用单 marker 建立共享 AR 坐标系。
- 手机断开电脑端时可以保留本地副本并继续本地编辑，重连后按电脑端权威规则提交待同步操作。
- 移除 `apps/relay`，同步能力全部内建到 `apps/studio-desktop`。

## 非目标

- 不做云锚点、VPS 或无 marker 空间重定位。
- 不做账号系统、云数据库或跨互联网连接。
- 不做多 marker 拼接或大空间地图同步。
- 不做复杂 CRDT 冲突合并。
- 不把 Three.js、Electron、Expo、React Native、Viro 或 WebSocket 运行时放入 `shared`。

## 推荐架构

采用 `Desktop Host Monolith`。产品层面只有电脑端和移动端；代码层面仍要在电脑端内部保持服务边界。

```text
apps/studio-desktop
  Electron main
    - HostServer
    - DiscoveryService
    - SceneRepository
    - AssetRepository
    - SyncGateway
    - HttpRoutes
    - WsSessions
  Electron renderer
    - Scene Manager UI
    - Asset Library UI
    - Scene Editor UI
    - Connected Devices UI

apps/mobile
  - Host discovery
  - Scene join flow
  - Asset downloader/cache
  - Marker-based AR alignment
  - Mobile scene editing UI

shared
  - SceneDocument contract
  - Scene/asset metadata contract
  - Marker anchor contract
  - Host HTTP/WebSocket message contract
  - Revision and client role types
```

电脑端是唯一 host。Electron main process 持有权威场景状态、资产索引、HTTP/WebSocket 服务和 mDNS 广播。Electron renderer 不直接持有权威状态，所有写操作都通过 preload 暴露的 IPC API 进入 main process。

移动端不是权威源。它可以编辑本地 draft，并向电脑端提交操作；最终以电脑端接受后的 revision 为准。

## 仓库结构调整

最终结构不再包含 `apps/relay`。

```text
apps/
  mobile/
    src/
      components/
        screens/
        scenes/
      services/
      state/
      types/
      api/
      mock/

  studio-desktop/
    electron/
      main/
        host/
        index.ts
      preload/
    src/
      renderer/
        components/
        scenes/
        assets/
        sync/
        panels/
        state/

shared/
  src/
    scene/
    sync/
    models/
    host/
```

实现时必须同步清理：

- 删除 `apps/relay` 目录。
- 从 `pnpm-workspace.yaml` 的实际包集合中移除 relay 结果。
- 删除根 `package.json` 中的 `relay` 脚本。
- 从根 `typecheck` 脚本中移除 `@manga-ar/relay`。
- 更新 `scripts/check-workspace-structure.mjs`，不再要求 `apps/relay/package.json`。
- 更新 README、AGENTS.md 和开发文档，删除 relay 作为正式服务的说明。

## Shared Contract

`shared` 要从当前的 `scene_snapshot/sessionId/lock` 协议，重构为 desktop host contract。它只放平台无关类型和纯函数。

### AssetRecord

模型资源由电脑端资产库管理，移动端按资产清单下载并缓存。

```text
AssetRecord
- assetId
- name
- version
- fileName
- fileSize
- checksum
- contentType
- format
- bounds
- preview
```

移动端的 `localUri` 是缓存实现细节，不能进入 `shared`。

### SceneRecord

用于电脑端管理多个场景。

```text
SceneRecord
- sceneId
- name
- createdAt
- updatedAt
- revision
- anchorDefinition
- assetRefs[]
- thumbnail
```

### MarkerAnchorDefinition

第一版只支持单 marker。

```text
MarkerAnchorDefinition
- anchorType: 'marker'
- markerId
- physicalWidthMeters
- referenceImageChecksum
- displayName
```

一个场景绑定一个 marker 原点。第一版不支持多个 marker。

### SceneDocument

`SceneDocument` 是权威共享文档，所有 transform 都保存为 marker 坐标系。

```text
SceneDocument
- sceneId
- revision
- selectedInstanceId
- instances[]
```

```text
SceneInstance
- instanceId
- assetId
- transform
- instanceRevision
```

当前 `SavedSceneDocument` 仍带有 `pendingModelId` 等 mobile 本地运行态，后续要和共享场景文档分离。

## 同步协议

同步不再以手机持续推送全量快照为主，而采用：

- 初始化拉取全量 snapshot。
- 运行时提交增量 op。
- 必要时由电脑端下发全量覆盖。

消息分三类：

```text
host_snapshot
```

电脑端发送，包含当前权威 `SceneDocument` 和 `revision`。

```text
client_ops
```

手机或桌面 renderer 通过 host 提交，包括：

- `add_instance`
- `update_transform`
- `delete_instance`
- `replace_asset`
- `select_instance`

```text
host_events
```

电脑端广播某个 op 被接受、拒绝或改写后的结果。

所有写入必须经过电脑端 HostServer。桌面 renderer 的编辑也不能直接改本地 React state 后当作权威状态，而是通过 IPC 进入 Electron main process。

## 冲突与离线规则

第一版采用电脑端优先规则，不做 CRDT。

- 电脑端在线时，所有客户端提交都必须带 base revision。
- base revision 过旧且修改同一实例时，电脑端可以拒绝。
- 手机离线期间新增的实例，重连后通常可以按顺序提交。
- 手机离线期间修改了已被电脑端删除的实例，电脑端拒绝该 op。
- 电脑端替换资产后，手机必须先下载新资产，再应用相关实例变更。

电脑端断开时，手机保留最近一次 `host_snapshot` 和本地 `pending ops queue`。手机可以继续本地编辑，但这些编辑只算待提交 draft。电脑端恢复后，手机重新发现主机、连接场景、提交 pending ops，并以最终 `host_snapshot` 为准。

## Marker 坐标系

共享层永远保存 marker-space transform，不保存 device AR world transform。

```text
marker space <-> device AR world
scene instance transform = marker space
render transform = marker space -> device AR world
```

移动端进入共享场景前必须识别该场景绑定的 marker。识别成功后，移动端建立 marker 到当前 AR world 的变换关系：

- 从 host 拉取的实例 transform 先从 marker space 转到当前设备 AR world 后渲染。
- 用户移动模型时，先得到 AR world 中的新姿态，再反算回 marker space 提交给 host。

第一版规则：

- 未识别 marker：不能进入共享编辑。
- marker 暂时丢失：保留当前渲染，但禁止提交新的 transform 编辑。
- marker 重新稳定：恢复编辑。

桌面端不需要真实 AR world。它把 marker 坐标系当作编辑场景坐标系：

- 原点是 marker 中心。
- 单位是米。
- Y 轴向上。
- 网格表示 marker 所在桌面平面。

## Desktop 重构

`apps/studio-desktop` 的 Electron main process 新增 host 模块。

```text
apps/studio-desktop/electron/main/host/
  hostServer.ts
  discoveryService.ts
  sceneRepository.ts
  assetRepository.ts
  syncGateway.ts
  httpRoutes.ts
  wsSessions.ts
```

### HostServer

负责启动和停止内置主机服务，组合 HTTP、WebSocket、mDNS、场景库和资产库。端口可自动选择，启动后把 host 地址、端口、实例 ID 和服务状态发给 renderer。

### DiscoveryService

负责 mDNS/Bonjour 广播。广播内容只包含最小主机信息：

- app name
- host instance id
- host name
- HTTP port
- protocol version

手机发现后再通过 HTTP 拉取详细信息。

### SceneRepository

负责多个场景的 CRUD 和持久化。第一版使用本地 JSON 文件目录，不引入数据库。

```text
userData/
  scenes/
    <sceneId>/
      scene.json
      thumbnail.png
```

### AssetRepository

负责模型导入、索引、校验和下载。

```text
userData/
  assets/
    <assetId>/
      model.glb
      manifest.json
      preview.png
```

### HTTP Routes

移动端使用 HTTP API 拉取主机信息、场景和资产：

- `GET /host/info`
- `GET /scenes`
- `GET /scenes/:sceneId`
- `GET /scenes/:sceneId/assets`
- `GET /assets/:assetId/file`
- `POST /scenes/:sceneId/ops`

### WebSocket Sessions

WebSocket 负责实时同步：

- 维护每个 `sceneId` 的在线客户端集合。
- 新连接先发送当前 `host_snapshot`。
- 接收手机 ops。
- 广播 host events。
- 支持断线重连后按 revision 对齐。

### Renderer

renderer 基于当前已经引入的 shadcn/ui、Tailwind 和 `components/ui` 扩展，不另起一套 UI 基础层。桌面 UI 包括：

- 场景列表：创建、打开、删除、复制场景。
- 资产库：导入模型、预览、删除、查看使用情况。
- 场景编辑器：添加模型、调整 transform、删除实例。
- 连接状态面板：显示已连接手机、当前主机地址、发现服务状态。

## Mobile 重构

移动端当前已经迁移到 `src/components/screens` 和 `src/components/scenes`。新屏幕要沿用该结构。

```text
apps/mobile/src/
  components/
    screens/
      HostDiscoveryScreen.tsx
      ScenePickerScreen.tsx
      AssetSyncScreen.tsx
      ARSceneScreen.tsx
    scenes/
      ModelPlacementScene.tsx
  services/
    discoveryService.ts
    hostApi.ts
    sceneSyncClient.ts
    assetSyncService.ts
    sceneDraftStore.ts
    markerAlignmentService.ts
  state/
    joinedSceneStore.ts
```

### HostDiscoveryScreen

通过 mDNS/Bonjour 发现局域网里的 Studio 主机，展示主机名、IP、端口、在线状态和可加入场景数量。

### ScenePickerScreen

调用电脑端 HTTP API 获取场景列表，展示场景名、更新时间、缩略图和资产同步状态。

### AssetSyncScreen

对比本地缓存和电脑端资产清单，下载缺失或过期资产，生成 `assetId -> localUri` 映射。

### ARSceneScreen

替代当前承担过多职责的 `ARPlacementScreen`。它只负责 marker 对齐后的 AR 展示与交互、本地 draft 展示、发送 op 和接收 host 更新。

### sceneSyncClient

替代当前 `syncService.ts` 的快照推送模式。职责包括：

- 拉取 host snapshot。
- 建立 WebSocket 订阅。
- 发送增量 op。
- 接收 host events 和 host snapshot。
- 维护 pending ops queue。
- 重连后自动重放 pending ops。

### sceneDraftStore

用于离线编辑，保存最近一次 host snapshot、本地 pending ops、当前选中实例和 marker 对齐状态。

## UI 技术约束

最新仓库约束已经明确：

- Desktop React UI 使用 shadcn/ui。
- Mobile React Native UI 使用 react-native-paper。
- Desktop React 代码要遵守 `vercel-react-best-practices`。
- Mobile React Native / Expo 代码要遵守 `vercel-react-native-skills`。
- Paper 组件实现前要查阅官方 LLM index 与对应文档。

这些约束不改变架构，但会影响 implementation plan 的任务拆分和验证顺序。

## 迁移顺序

1. 重构 `shared` contract，引入场景、资产、marker anchor、host API 与 revision 类型。
2. 在 `apps/studio-desktop` 的 Electron main process 建立 HostServer、场景库、资产库、mDNS、HTTP 和 WebSocket。
3. 删除 `apps/relay`，并同步更新 workspace、脚本、README、AGENTS.md、结构检查脚本和测试说明。
4. 移动端接入 mDNS 发现、场景选择、资产清单拉取和资产下载。
5. 移动端重写同步客户端，从 `pushSnapshot` 改为 snapshot + ops + pending queue。
6. 接入 marker 坐标换算，让 AR 放置、拖动和旋转都基于 marker space。
7. 桌面 renderer 接入正式场景管理、资产库、场景编辑器和连接状态面板。

## 测试与验收

### Shared 单元测试

- revision 比较。
- op 应用结果。
- 删除和替换实例规则。
- marker anchor normalize。

### Desktop Host 集成测试

- HostServer 启动和端口分配。
- 场景 CRUD。
- 资产导入与清单返回。
- WebSocket 客户端加入后收到 snapshot。
- 多客户端订阅同一场景时广播一致。
- 旧 revision op 被拒绝。

### Mobile 服务层测试

- mDNS 发现结果解析。
- 场景列表拉取。
- 资产下载与缓存命中。
- pending ops queue 重放。
- 断线重连后的状态恢复。

### 手动联调

- 电脑端创建场景并导入模型。
- 手机自动发现电脑端。
- 手机选择场景并下载资产。
- 两部手机识别同一个 marker 后看到一致摆放。
- 手机 A 放置模型后，手机 B 与电脑端可见。
- 电脑端移动、删除或替换模型后，两部手机同步更新。
- 电脑端短暂断开后，手机仍可本地继续编辑。
- 电脑端恢复后重新接管，最终状态一致。

## 验收边界

第一版完成时必须满足：

- 仓库中没有 `apps/relay`。
- 电脑端是唯一同步主机入口。
- 手机通过 mDNS/Bonjour 自动发现电脑端。
- 电脑端能管理多个场景。
- 电脑端能管理模型资产库，并向手机分发模型文件。
- 手机通过 marker 对齐进入共享场景。
- 两部手机和一台电脑可以围绕同一个场景实时同步。
- 断线恢复遵循电脑端权威、手机离线 draft 重放的规则。

第一版明确不交付：

- 云锚点。
- 无 marker 对齐。
- 数据库或账号系统。
- 跨互联网连接。
- 多 marker 拼接。
- 复杂冲突合并算法。

## 决策记录

- 选择 `Desktop Host Monolith`，不采用独立 relay 或 host-core 包。
- 独立 `apps/relay` 必须删除，不能作为 deprecated 工具保留。
- 第一版使用 marker 对齐，预留未来替换为空间锚点方案的边界。
- 电脑端拥有最高控制权，移动端提交编辑但不持有权威状态。
- 模型资产由电脑端管理并分发给手机。
- 移动端通过 mDNS/Bonjour 自动发现电脑端。
