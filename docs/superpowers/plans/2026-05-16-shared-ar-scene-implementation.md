# 多端共享 AR 场景 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Manga AR 重构为“电脑端 Studio 内置 host + 多手机 marker 对齐共享场景”的产品形态，并彻底移除独立 `apps/relay`。

**Architecture:** 电脑端 Electron main process 是唯一权威 host，负责场景库、资产库、mDNS/Bonjour 发现、HTTP API 和 WebSocket 同步。移动端通过发现主机、选择场景、同步资产、识别 marker 后进入共享 AR 场景；所有共享 transform 都以 marker space 存储。

**Tech Stack:** pnpm workspace、TypeScript、Expo React Native、react-native-paper、Electron、React、shadcn/ui、Node `http`、`ws`、mDNS/Bonjour、Viro AR、本地 JSON 文件存储。

---

## 文档拆分

本计划按子系统拆成 4 个可执行文档。实现时按顺序执行；不要跳过前置阶段，因为后续阶段依赖 shared contract 和 relay 删除后的新边界。

1. [shared contract 与仓库清理](./2026-05-16-shared-ar-scene-01-contract-and-repo-cleanup.md)
2. [desktop host](./2026-05-16-shared-ar-scene-02-desktop-host.md)
3. [mobile host client 与离线 draft](./2026-05-16-shared-ar-scene-03-mobile-client.md)
4. [AR marker 对齐与 UI 集成](./2026-05-16-shared-ar-scene-04-ar-and-ui.md)

## 执行规则

- 每个任务完成后单独提交，提交信息使用中文说明部分和 Conventional Commits。
- 子代理只能使用 `gpt-5.5`，推理强度按任务复杂度选择。
- 不要创建或保留 `apps/relay` 的替代入口。实现完成后仓库里必须没有 `apps/relay`。
- 最终验证前确认只保留任务相关 diff。
- 在 Windows 下优先直接调用 `pnpm`、本地 `.cmd` 二进制和 `git`，不要无必要包一层 PowerShell。
- 涉及 desktop React UI 时按 AGENTS.md 使用 shadcn/ui；涉及 mobile UI 时使用 react-native-paper。
- 若执行实现时希望使用 git worktree，需要先征求用户同意，并说明使用全局还是项目内 worktree。

## 阶段依赖

```text
01 shared contract + repo cleanup
  -> 02 desktop host
  -> 03 mobile host client
  -> 04 AR marker + UI integration
```

`01` 阶段必须先完成，因为它删除 `apps/relay` 并建立新的协议类型。`02` 阶段建立电脑端 host，`03` 阶段才能用真实 host API 接入移动端。`04` 阶段最后处理 AR 坐标换算和正式 UI 流程。

## 总体验收命令

完成全部阶段后运行：

```bash
pnpm run check:structure
pnpm run typecheck
pnpm --filter @manga-ar/studio-desktop build
pnpm run test:viro-android-plugin
```

如实现阶段新增了测试脚本，再运行对应包的本地测试命令，例如：

```bash
.\node_modules\.bin\vitest.cmd run
```

预期结果：

- `check:structure` 通过，且不再要求 `apps/relay`。
- 根 `typecheck` 不再引用 `@manga-ar/relay`。
- desktop build 通过。
- Viro Android config plugin 测试通过。

## 手动联调验收

- 电脑端 Studio 启动后能显示 host 状态。
- 手机能通过局域网发现电脑端。
- 手机能看到电脑端场景列表。
- 手机选择场景后能下载缺失资产。
- 两部手机识别同一个 marker 后看到一致模型摆放。
- 手机 A 新增或移动模型后，手机 B 和电脑端同步更新。
- 电脑端移动、删除或替换模型后，两部手机同步更新。
- 电脑端短暂断开后，手机保留本地 draft；电脑端恢复后重放 pending ops 并以 host snapshot 为准。

## 文件责任总览

### shared

- `shared/src/models/index.ts`：资产记录、资产引用、模型格式。
- `shared/src/scene/index.ts`：场景记录、场景文档、marker anchor、transform、scene op。
- `shared/src/host/index.ts`：host info、HTTP response contract、client role。
- `shared/src/sync/index.ts`：WebSocket 消息、host events、revision 规则。
- `shared/src/index.ts`：统一导出。

### desktop main

- `apps/studio-desktop/electron/main/host/hostServer.ts`：组合 HTTP、WebSocket、repository、discovery。
- `apps/studio-desktop/electron/main/host/sceneRepository.ts`：本地场景 JSON CRUD。
- `apps/studio-desktop/electron/main/host/assetRepository.ts`：资产导入、manifest、文件读取。
- `apps/studio-desktop/electron/main/host/httpRoutes.ts`：移动端 HTTP API。
- `apps/studio-desktop/electron/main/host/wsSessions.ts`：WebSocket 客户端集合和广播。
- `apps/studio-desktop/electron/main/host/discoveryService.ts`：mDNS/Bonjour 广播。
- `apps/studio-desktop/electron/preload/index.ts`：暴露 renderer 可用的 host IPC API。

### mobile

- `apps/mobile/src/services/discoveryService.ts`：发现 Studio host。
- `apps/mobile/src/services/hostApi.ts`：HTTP API client。
- `apps/mobile/src/services/assetSyncService.ts`：资产清单比对、下载、缓存。
- `apps/mobile/src/services/sceneSyncClient.ts`：snapshot + ops + pending queue。
- `apps/mobile/src/services/sceneDraftStore.ts`：按 sceneId 保存本地 draft。
- `apps/mobile/src/services/markerAlignmentService.ts`：marker space 与 AR world 换算。
- `apps/mobile/src/components/screens/HostDiscoveryScreen.tsx`：主机发现 UI。
- `apps/mobile/src/components/screens/ScenePickerScreen.tsx`：场景选择 UI。
- `apps/mobile/src/components/screens/AssetSyncScreen.tsx`：资产同步 UI。
- `apps/mobile/src/components/screens/ARSceneScreen.tsx`：共享 AR 场景 UI。

## Spec 覆盖检查

- 删除独立 relay：阶段 01 覆盖。
- shared host contract：阶段 01 覆盖。
- 电脑端最高控制权与场景/资产管理：阶段 02 覆盖。
- mDNS/Bonjour 自动发现：阶段 02 和 03 覆盖。
- 手机资产下载与缓存：阶段 03 覆盖。
- 离线 draft 与 pending ops：阶段 03 覆盖。
- marker 坐标系：阶段 04 覆盖。
- shadcn/ui 与 react-native-paper 约束：阶段 04 覆盖。

