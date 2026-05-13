# Monorepo 代码组织设计

## 背景

Manga AR 当前主要是一个 Expo React Native 移动端应用，仓库中同时包含一个静态 `manga-ar-studio/index.html` 原型和一个 Node WebSocket relay。后续产品会拆成两个主要客户端：

- 手机端：调用 AR 能力，在真实空间中摆放模型，并把空间状态同步出去。
- 电脑端：作为 Electron 桌面客户端，重建同一个空间，对模型进行精调，并把结果同步回手机端。

二者 UI 差异明显，内部逻辑也会分化。仓库需要先建立清晰的 app/package 边界，避免继续把桌面端、relay 和共享协议叠在移动端根目录上。

本设计只覆盖代码组织、依赖方向、迁移顺序和验收边界，不展开具体同步协议字段、锁语义或桌面端 UI 设计。

## 目标

- 将仓库调整为 pnpm workspace monorepo。
- 明确 mobile、studio-desktop、relay、shared 的职责边界。
- 让移动端和桌面端共享同一份平台无关 contract，但保留各自 UI、渲染、缓存和运行时逻辑。
- 为 Electron 桌面端内置 relay 做目录和依赖预留。
- 迁移期间保留常用根命令转发，降低日常开发中断。

## 非目标

- 不在本阶段设计完整 Scene Document schema。
- 不在本阶段重写同步冲突、锁、版本合并策略。
- 不在本阶段实现 Electron 桌面端功能。
- 不在本阶段替换或上线云同步服务。

## 目标目录结构

```text
apps/
  mobile/
    App.tsx
    index.ts
    app.json
    src/
      screens/
      scenes/
      services/
      api/
      mock/
    assets/

  studio-desktop/
    package.json
    electron/
      main/
      preload/
    src/
      renderer/
        app/
        scenes/
        panels/
        sync/
      main/
        relay/
        window/
    public/

  relay/
    package.json
    src/
      server.ts
      rooms.ts
      snapshotStore.ts

packages/
  shared/
    package.json
    src/
      scene/
      sync/
      models/
      index.ts

docs/
  dev/
  superpowers/
```

顶层只承载 workspace 管理、通用配置、文档和仓库级脚本。具体运行时代码放进 `apps/` 或 `packages/`。

## 依赖方向

依赖必须保持单向：

```text
apps/mobile          -> packages/shared
apps/studio-desktop  -> packages/shared
apps/relay           -> packages/shared
packages/shared      -> 无平台依赖
```

`packages/shared` 不依赖 React Native、Expo、Electron、Three.js、Node WebSocket 或任何平台运行时。它只放平台无关的类型、纯函数、常量和 schema。

## 模块职责

### apps/mobile

`apps/mobile` 是 AR 采集和现场摆放端。它负责：

- 模型库浏览。
- 模型资源缓存。
- AR 平面识别和模型初始摆放。
- 手机端粗调、拍照、录像。
- 手机端本地保存和恢复。
- 将当前 AR 空间投影成共享 Scene Document。
- 消费桌面端回传的精调结果。

它不关心桌面端 UI、Three.js 控件或 Electron 进程生命周期。

### apps/studio-desktop

`apps/studio-desktop` 是 Electron 桌面精调端。它负责：

- Electron 主进程、preload 和 renderer。
- 窗口管理。
- 内置 relay 生命周期。
- 桌面端 3D viewport。
- 属性面板、模型列表、选择、锁定和精调操作。
- 将桌面端编辑结果同步回手机端。

Three.js 场景对象、TransformControls、桌面 UI 状态都留在此包内，不进入 `packages/shared`。

### apps/relay

`apps/relay` 是同步中继服务。它负责：

- WebSocket 连接管理。
- 房间管理。
- 消息广播。
- 最新快照缓存。
- 提供可被 Electron 内置启动或开发期独立运行的 relay API。

它不负责模型渲染，不内置手机端或桌面端业务 UI。

### packages/shared

`packages/shared` 是双端 contract。它负责定义：

- 平台无关的场景文档类型。
- 平台无关的模型引用类型。
- 平台无关的 transform 类型。
- 同步消息类型。
- 必要的纯函数，例如版本比较、消息校验、Scene Document normalize。

它不保存数据、不发 WebSocket、不读文件、不做 UI。

## 类型拆分原则

从当前 `src/types/*` 抽取 shared 时采用保守策略：

- 只迁移明确平台无关的类型和纯逻辑。
- `RemoteModel`、`SceneModelInstance` 需要拆成共享层基础类型和平台扩展类型。
- `CachedModelAsset.localUri` 留在 mobile，因为它是 Expo/mobile 缓存路径概念。
- 桌面端未来可使用 file path、app resource path 或缓存 URL 扩展共享模型引用。

示例方向：

```text
packages/shared:
  ModelAssetRef
  SceneInstance
  SceneTransform
  SceneDocument
  SyncMessage

apps/mobile:
  CachedModelAsset = ModelAssetRef + mobile localUri

apps/studio-desktop:
  DesktopModelAsset = ModelAssetRef + desktop resource path/cache URL
```

## 迁移顺序

### 1. 建立 workspace 外壳

新增 `pnpm-workspace.yaml`。将根 `package.json` 调整为 workspace root，只保留通用脚本、workspace 转发脚本和 dev tooling。

目标：

- `pnpm install` 可正常安装 workspace。
- 根命令可转发到具体 app。
- 新增空的 `packages/shared`。

### 2. 移动现有 mobile 与 relay

将当前移动端文件迁到 `apps/mobile/`：

- `App.tsx`
- `index.ts`
- `app.json`
- `src/`
- `assets/`

将当前 `relay-server` 迁到 `apps/relay/`。relay 可先保持 JavaScript，后续再决定是否 TypeScript 化。

`manga-ar-studio/index.html` 不继续作为新架构主入口。它应移动到 `apps/studio-desktop/prototype/` 或 `docs/prototypes/`，作为迁移参考或原型归档。

### 3. 抽出 shared contract

从当前 `src/types/*` 中抽平台无关类型到 `packages/shared/src/`。mobile 改为从 `@manga-ar/shared` 引用共享类型。relay 也开始引用共享同步消息类型，减少协议漂移。

shared 抽取应小步进行，避免把 mobile-only 类型误放进共享层。

### 4. 创建 studio-desktop 骨架

新增 Electron + React + Three.js 包，建立主进程、preload 和 renderer 三层。先接入 shared 类型和 relay 启停边界，不急着复刻所有 HTML 原型功能。

原型中的 Three.js 逻辑后续按功能拆到：

- `renderer/scenes`
- `renderer/sync`
- `renderer/panels`

## 命令兼容策略

迁移后保留常用根命令别名：

```text
pnpm start                  -> pnpm --filter mobile start
pnpm run android            -> pnpm --filter mobile android
pnpm run ios                -> pnpm --filter mobile ios
pnpm run web                -> pnpm --filter mobile web
pnpm run relay              -> pnpm --filter relay start
```

新命令应鼓励使用 workspace filter：

```text
pnpm --filter mobile start
pnpm --filter relay start
pnpm --filter shared build
pnpm --filter studio-desktop dev
```

`README.md` 和 `AGENTS.md` 需要同步更新目录与命令说明。

## 验收边界

基础验收：

```text
pnpm install
pnpm start
pnpm --filter mobile start
pnpm --filter mobile exec tsc --noEmit
pnpm --filter relay start
```

如果 relay 或 shared 在迁移中 TypeScript 化，再补充：

```text
pnpm --filter relay build
pnpm --filter shared build
```

结构验收：

```text
mobile 可以依赖 shared
studio-desktop 可以依赖 shared
relay 可以依赖 shared
shared 不依赖 mobile/studio-desktop/relay
shared 不出现 expo、react-native、electron、three、ws
```

手动验证：

```text
手机端模型库能打开
ARPlacementScreen 能进入
现有模型缓存路径能工作
最近场景保存/恢复能工作
手机端能连接 relay
relay 能独立启动并输出可用访问地址
studio 原型仍能作为参考访问或已明确归档
```

## 风险与缓解

### Expo 子目录迁移

风险：Expo 移到 `apps/mobile` 后，asset 路径、Metro 解析和脚本 cwd 可能变化。

缓解：先迁移 mobile 并跑通现有命令，再抽 shared。不要同时改同步协议和 UI。

### Viro 与 workspace 解析

风险：`@reactvision/react-viro` 在 workspace 下可能暴露 Metro 解析问题。

缓解：保留 mobile 包内独立入口和配置，必要时为 Metro 增加 workspace watch/resolve 配置。

### shared 抽取过度

风险：把 `localUri`、Expo 文件系统路径、Three.js 对象或 WebSocket 实例放进 shared。

缓解：shared 只接受平台无关类型和纯函数。平台资源路径用 app 自己的扩展类型表示。

### relay 角色混淆

风险：relay 既要可独立运行，又要被 Electron 内置启动，容易把进程管理和业务逻辑耦合。

缓解：`apps/relay` 暴露纯 server 启停 API；Electron 只负责调用和生命周期管理。

## 决策记录

- 选择完整 pnpm workspace monorepo，而不是保留根目录 mobile。
- 桌面端选择 Electron + React + Three.js。
- relay 当前按桌面端内置优先设计，同时保留未来扩展云同步的空间。
- 共享状态以平台无关 Scene Document 为方向，但本阶段不展开字段细节。
- 本阶段只做代码组织设计，不做完整产品架构或同步协议实现。
