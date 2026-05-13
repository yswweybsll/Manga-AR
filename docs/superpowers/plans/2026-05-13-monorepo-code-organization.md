# Monorepo Code Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前单 Expo app 仓库迁移为 pnpm workspace monorepo，形成 `apps/mobile`、`apps/relay`、`apps/studio-desktop` 和顶层 `shared` 的清晰边界。

**Architecture:** 根目录只负责 workspace、通用脚本、文档和结构检查。移动端、relay、桌面端各自拥有 package，三者通过 `@manga-ar/shared` 共享平台无关类型，`shared` 不依赖任何运行时框架。

**Tech Stack:** pnpm workspace、Expo SDK 54、React Native、@reactvision/react-viro、Node.js、ws、TypeScript、Electron、React、Vite、Three.js。

---

## 参考资料

- Expo monorepo 官方文档确认 SDK 52+ 会自动处理 monorepo Metro 配置，pnpm workspace 使用 `pnpm-workspace.yaml`，SDK 54 支持 pnpm isolated installs，但遇到 native resolution 问题可使用 `nodeLinker: hoisted`：https://docs.expo.dev/guides/monorepos/

## 文件结构总览

### 创建

- `pnpm-workspace.yaml`: workspace 包含 `apps/*` 和 `shared`，并使用 hoisted linker 降低 React Native native module 解析风险。
- `scripts/check-workspace-structure.mjs`: 检查 monorepo 目录、workspace 依赖方向和 shared 禁止依赖。
- `shared/package.json`: shared package 元数据和脚本。
- `shared/tsconfig.json`: shared TypeScript 配置。
- `shared/src/index.ts`: 初始 shared barrel export，后续任务填充具体类型。
- `apps/mobile/package.json`: Expo mobile package 脚本和依赖。
- `apps/mobile/tsconfig.json`: mobile TypeScript 配置。
- `apps/mobile/metro.config.js`: 使用 Expo 默认 Metro config。
- `apps/relay/package.json`: relay package 脚本和依赖。
- `apps/relay/tsconfig.json`: relay TypeScript 配置。
- `apps/relay/src/rooms.ts`: WebSocket 房间集合管理。
- `apps/relay/src/snapshotStore.ts`: session 最新快照缓存。
- `apps/relay/src/server.ts`: HTTP + WebSocket relay 入口。
- `apps/studio-desktop/package.json`: Electron desktop package 脚本和依赖。
- `apps/studio-desktop/tsconfig.json`: desktop renderer TypeScript 配置。
- `apps/studio-desktop/tsconfig.node.json`: Electron main/preload TypeScript 配置。
- `apps/studio-desktop/vite.config.ts`: Vite renderer 构建配置。
- `apps/studio-desktop/index.html`: renderer HTML 入口。
- `apps/studio-desktop/electron/main/index.ts`: Electron 主进程入口。
- `apps/studio-desktop/electron/preload/index.ts`: Electron preload 入口。
- `apps/studio-desktop/src/main/relay/index.ts`: desktop 内置 relay 生命周期边界。
- `apps/studio-desktop/src/main/window/index.ts`: desktop 窗口创建边界。
- `apps/studio-desktop/src/renderer/main.tsx`: renderer React 入口。
- `apps/studio-desktop/src/renderer/App.tsx`: renderer 最小 shell。
- `apps/studio-desktop/prototype/index.html`: 迁移后的旧 studio 原型。
- `shared/src/models/index.ts`: 平台无关模型引用类型。
- `shared/src/scene/index.ts`: 平台无关场景与 transform 类型。
- `shared/src/sync/index.ts`: 平台无关同步消息类型。

### 修改

- `package.json`: 转为 workspace root，保留根命令转发。
- `.gitignore`: 增加 `apps/mobile/android`、`apps/mobile/ios`、desktop/relay dist 输出。
- `README.md`: 更新 monorepo 安装、运行、relay、studio 原型说明。
- `AGENTS.md`: 更新项目结构、命令、验证说明。
- `pnpm-lock.yaml`: 由 `pnpm install --lockfile-only` 更新 importers。
- `apps/mobile/src/types/model.ts`: 改为扩展 `@manga-ar/shared` 的模型和场景类型。
- `apps/mobile/src/types/scene.ts`: 改为 re-export shared scene persistence 类型。
- `apps/mobile/src/types/sync.ts`: 改为 re-export shared sync 类型。
- `apps/mobile/src/services/syncService.ts`: 保持业务逻辑，确认 type import 仍编译通过。
- `apps/mobile/src/services/sceneStorage.ts`: 保持业务逻辑，确认 shared scene type 兼容。

### 移动

- `App.tsx` -> `apps/mobile/App.tsx`
- `index.ts` -> `apps/mobile/index.ts`
- `app.json` -> `apps/mobile/app.json`
- `src/` -> `apps/mobile/src/`
- `assets/` -> `apps/mobile/assets/`
- `tsconfig.json` -> `apps/mobile/tsconfig.json`
- `relay-server/index.js` -> `apps/relay/src/server.ts`
- `manga-ar-studio/index.html` -> `apps/studio-desktop/prototype/index.html`

---

### Task 1: 建立 workspace 外壳和结构检查

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `scripts/check-workspace-structure.mjs`
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/index.ts`
- Modify: `package.json`
- Test: `pnpm run check:structure`

- [ ] **Step 1: 写结构检查脚本**

Create `scripts/check-workspace-structure.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const requiredPaths = [
  'apps/mobile/package.json',
  'apps/relay/package.json',
  'apps/studio-desktop/package.json',
  'shared/package.json',
  'shared/src/index.ts',
];

const forbiddenSharedDeps = [
  '@reactvision/react-viro',
  'expo',
  'expo-file-system',
  'expo-media-library',
  'expo-status-bar',
  'expo-system-ui',
  'react',
  'react-native',
  'electron',
  'three',
  'ws',
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function assertPathExists(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    throw new Error(`Missing required path: ${relativePath}`);
  }
}

function assertDependency(packageJsonPath, dependencyName) {
  const pkg = readJson(packageJsonPath);
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  };
  if (!deps[dependencyName]) {
    throw new Error(`${packageJsonPath} must depend on ${dependencyName}`);
  }
}

for (const relativePath of requiredPaths) {
  assertPathExists(relativePath);
}

assertDependency('apps/mobile/package.json', '@manga-ar/shared');
assertDependency('apps/relay/package.json', '@manga-ar/shared');
assertDependency('apps/studio-desktop/package.json', '@manga-ar/shared');

const sharedPkg = readJson('shared/package.json');
const sharedDeps = {
  ...sharedPkg.dependencies,
  ...sharedPkg.devDependencies,
  ...sharedPkg.peerDependencies,
};

for (const dep of forbiddenSharedDeps) {
  if (sharedDeps[dep]) {
    throw new Error(`shared/package.json must not depend on ${dep}`);
  }
}

console.log('Workspace structure check passed.');
```

- [ ] **Step 2: 运行结构检查，确认当前失败**

Run:

```powershell
pnpm run check:structure
```

Expected: FAIL with `Missing script: check:structure` because root script has not been added yet.

- [ ] **Step 3: 创建 pnpm workspace 配置**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'shared'

nodeLinker: hoisted
```

- [ ] **Step 4: 创建初始 shared package**

Create `shared/package.json`:

```json
{
  "name": "@manga-ar/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "~5.9.2"
  }
}
```

- [ ] **Step 5: 创建初始 shared tsconfig**

Create `shared/tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "declaration": true,
    "emitDeclarationOnly": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 6: 创建初始 shared 入口**

Create `shared/src/index.ts`:

```ts
export {};
```

- [ ] **Step 7: 将根 package.json 改为 workspace root**

Replace root `package.json` with:

```json
{
  "name": "manga-ar-workspace",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "pnpm --filter @manga-ar/mobile start",
    "android": "pnpm --filter @manga-ar/mobile android",
    "android:release": "pnpm --filter @manga-ar/mobile android:release",
    "android:install-release": "pnpm --filter @manga-ar/mobile android:install-release",
    "ios": "pnpm --filter @manga-ar/mobile ios",
    "web": "pnpm --filter @manga-ar/mobile web",
    "prebuild": "pnpm --filter @manga-ar/mobile prebuild",
    "prebuild:android": "pnpm --filter @manga-ar/mobile prebuild:android",
    "relay": "pnpm --filter @manga-ar/relay start",
    "studio": "pnpm --filter @manga-ar/studio-desktop dev",
    "typecheck": "pnpm --filter @manga-ar/shared typecheck && pnpm --filter @manga-ar/mobile typecheck && pnpm --filter @manga-ar/relay typecheck && pnpm --filter @manga-ar/studio-desktop typecheck",
    "check:structure": "node scripts/check-workspace-structure.mjs"
  },
  "pnpm": {
    "overrides": {
      "react": "19.1.0"
    }
  }
}
```

- [ ] **Step 8: 运行结构检查，确认失败点进入缺失 workspace 文件**

Run:

```powershell
pnpm run check:structure
```

Expected: FAIL with `Missing required path: apps/mobile/package.json`.

- [ ] **Step 9: 更新 lockfile importer**

Run:

```powershell
pnpm install --lockfile-only
```

Expected: PASS and `pnpm-lock.yaml` contains root and `shared` importers.

- [ ] **Step 10: 提交 workspace 外壳**

Run:

```powershell
git add package.json pnpm-workspace.yaml scripts/check-workspace-structure.mjs shared pnpm-lock.yaml
git commit -m "build: 建立 pnpm workspace 外壳"
```

Expected: commit succeeds.

---

### Task 2: 迁移 Expo mobile 到 apps/mobile

**Files:**
- Create: `apps/mobile/package.json`
- Create: `apps/mobile/metro.config.js`
- Modify: `.gitignore`
- Move: `App.tsx`, `index.ts`, `app.json`, `src/`, `assets/`, `tsconfig.json`
- Test: `pnpm --filter @manga-ar/mobile typecheck`

- [ ] **Step 1: 移动 mobile 文件**

Run:

```powershell
New-Item -ItemType Directory -Force -Path apps\mobile
git mv App.tsx apps\mobile\App.tsx
git mv index.ts apps\mobile\index.ts
git mv app.json apps\mobile\app.json
git mv src apps\mobile\src
git mv assets apps\mobile\assets
git mv tsconfig.json apps\mobile\tsconfig.json
```

Expected: files move without content changes.

- [ ] **Step 2: 创建 mobile package.json**

Create `apps/mobile/package.json`:

```json
{
  "name": "@manga-ar/mobile",
  "version": "1.0.0",
  "private": true,
  "main": "index.ts",
  "scripts": {
    "start": "expo start --dev-client",
    "android": "expo run:android",
    "android:release": "cd android && gradlew.bat assembleRelease",
    "android:install-release": "cd android && gradlew.bat installRelease",
    "ios": "expo run:ios",
    "web": "expo start --web",
    "prebuild": "expo prebuild --clean",
    "prebuild:android": "expo prebuild --clean -p android",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@manga-ar/shared": "workspace:*",
    "@reactvision/react-viro": "^2.53.1",
    "expo": "~54.0.10",
    "expo-file-system": "~19.0.21",
    "expo-media-library": "~18.2.1",
    "expo-status-bar": "~3.0.9",
    "expo-system-ui": "~6.0.9",
    "react": "19.1.0",
    "react-native": "0.81.5"
  },
  "devDependencies": {
    "@types/react": "~19.1.10",
    "typescript": "~5.9.2"
  }
}
```

- [ ] **Step 3: 确认 mobile tsconfig 内容**

Ensure `apps/mobile/tsconfig.json` contains:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true
  }
}
```

- [ ] **Step 4: 创建 Expo Metro 配置**

Create `apps/mobile/metro.config.js`:

```js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
```

- [ ] **Step 5: 更新 .gitignore 的 native 输出路径**

Modify `.gitignore` native section to include both old root paths and new mobile paths:

```gitignore
# generated native folders
/ios
/android
/apps/mobile/ios
/apps/mobile/android

# build outputs
/apps/studio-desktop/dist
/apps/studio-desktop/dist-electron
/apps/relay/dist
/shared/dist
```

- [ ] **Step 6: 更新 lockfile**

Run:

```powershell
pnpm install --lockfile-only
```

Expected: PASS and `pnpm-lock.yaml` contains importer `apps/mobile`.

- [ ] **Step 7: 运行 mobile typecheck**

Run:

```powershell
pnpm --filter @manga-ar/mobile typecheck
```

Expected: PASS. At this point mobile still imports its local `src/types/*`; `@manga-ar/shared` is declared for the later extraction task.

- [ ] **Step 8: 提交 mobile 迁移**

Run:

```powershell
git add .gitignore apps\mobile package.json pnpm-lock.yaml
git commit -m "refactor(mobile): 迁移 Expo 应用到 workspace"
```

Expected: commit succeeds.

---

### Task 3: 迁移 relay 和旧 studio 原型

**Files:**
- Create: `apps/relay/package.json`
- Move: `relay-server/index.js` -> `apps/relay/src/server.js`
- Move: `manga-ar-studio/index.html` -> `apps/studio-desktop/prototype/index.html`
- Test: `pnpm --filter @manga-ar/relay start`

- [ ] **Step 1: 移动 relay 和 prototype 文件**

Run:

```powershell
New-Item -ItemType Directory -Force -Path apps\relay\src
New-Item -ItemType Directory -Force -Path apps\studio-desktop\prototype
git mv relay-server\index.js apps\relay\src\server.js
git mv manga-ar-studio\index.html apps\studio-desktop\prototype\index.html
```

Expected: existing source files move successfully.

- [ ] **Step 2: 删除 relay-server 包元数据**

Run:

```powershell
git rm relay-server\package.json relay-server\package-lock.json
```

Expected: old nested npm package metadata is removed.

- [ ] **Step 3: 创建 relay package.json**

Create `apps/relay/package.json`:

```json
{
  "name": "@manga-ar/relay",
  "version": "1.0.0",
  "private": true,
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "typecheck": "node --check src/server.js"
  },
  "dependencies": {
    "@manga-ar/shared": "workspace:*",
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 4: 修正 relay 中 studio HTML 路径**

In `apps/relay/src/server.js`, replace:

```js
const STUDIO_HTML_PATH = path.resolve(__dirname, '../manga-ar-studio/index.html');
```

with:

```js
const STUDIO_HTML_PATH = path.resolve(__dirname, '../../studio-desktop/prototype/index.html');
```

- [ ] **Step 5: 更新 lockfile**

Run:

```powershell
pnpm install --lockfile-only
```

Expected: PASS and `pnpm-lock.yaml` contains importer `apps/relay`.

- [ ] **Step 6: 运行 relay 语法检查**

Run:

```powershell
pnpm --filter @manga-ar/relay typecheck
```

Expected: PASS with no output from `node --check`.

- [ ] **Step 7: 启动 relay 做手动冒烟**

Run:

```powershell
pnpm --filter @manga-ar/relay start
```

Expected: console prints:

```text
[Relay] 正在启动 WebSocket 中继服务器，端口: 3001...
[Relay] 服务器已就绪！监听地址: 0.0.0.0:3001
```

Stop the process with `Ctrl+C` after confirming output.

- [ ] **Step 8: 提交 relay 和 prototype 迁移**

Run:

```powershell
git add apps\relay apps\studio-desktop\prototype pnpm-lock.yaml
git commit -m "refactor(relay): 迁移中继服务到 workspace"
```

Expected: commit succeeds.

---

### Task 4: 填充 shared package 并抽取平台无关类型

**Files:**
- Modify: `shared/package.json`
- Modify: `shared/tsconfig.json`
- Create: `shared/src/models/index.ts`
- Create: `shared/src/scene/index.ts`
- Create: `shared/src/sync/index.ts`
- Modify: `shared/src/index.ts`
- Modify: `apps/mobile/src/types/model.ts`
- Modify: `apps/mobile/src/types/scene.ts`
- Modify: `apps/mobile/src/types/sync.ts`
- Test: `pnpm --filter @manga-ar/shared typecheck`
- Test: `pnpm --filter @manga-ar/mobile typecheck`

- [ ] **Step 1: 确认 shared package.json**

Ensure `shared/package.json` contains:

```json
{
  "name": "@manga-ar/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "~5.9.2"
  }
}
```

- [ ] **Step 2: 确认 shared tsconfig**

Ensure `shared/tsconfig.json` contains:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "declaration": true,
    "emitDeclarationOnly": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: 创建模型类型**

Create `shared/src/models/index.ts`:

```ts
export type ModelFormat = 'GLB' | 'GLTF' | 'OBJ' | 'VRX';

export type ModelAssetRef = {
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
```

- [ ] **Step 4: 创建场景类型**

Create `shared/src/scene/index.ts`:

```ts
import type { ModelAssetRef } from '../models';

export type SceneTransform = {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scaleValue: number;
};

export type SceneInstance = SceneTransform & {
  instanceId: string;
  asset: ModelAssetRef;
};

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

- [ ] **Step 5: 创建同步类型**

Create `shared/src/sync/index.ts`:

```ts
import type { SceneInstance } from '../scene';

export type SyncLockOwner = 'phone' | 'desktop';

export type SyncModelInstance = SceneInstance & {
  lockedBy?: SyncLockOwner;
  syncVersion: number;
};

export type SyncMessageType =
  | 'scene_snapshot'
  | 'instance_update'
  | 'instance_delete'
  | 'lock_acquire'
  | 'lock_release'
  | 'ping'
  | 'pong';

export type SceneSnapshotMessage = {
  type: 'scene_snapshot';
  sessionId: string;
  timestamp: number;
  instances: SyncModelInstance[];
  selectedInstanceId: string | null;
};

export type InstanceUpdateMessage = {
  type: 'instance_update';
  sessionId: string;
  timestamp: number;
  instance: SyncModelInstance;
};

export type InstanceDeleteMessage = {
  type: 'instance_delete';
  sessionId: string;
  timestamp: number;
  instanceId: string;
};

export type LockMessage = {
  type: 'lock_acquire' | 'lock_release';
  sessionId: string;
  timestamp: number;
  instanceId: string;
  owner: SyncLockOwner;
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
  | SceneSnapshotMessage
  | InstanceUpdateMessage
  | InstanceDeleteMessage
  | LockMessage
  | PingMessage
  | PongMessage;

export type SyncConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export type SyncServiceConfig = {
  serverUrl: string;
  sessionId: string;
  reconnectIntervalMs?: number;
  pingIntervalMs?: number;
  snapshotThrottleMs?: number;
};
```

- [ ] **Step 6: 更新 shared barrel export**

Replace `shared/src/index.ts` with:

```ts
export type {
  ModelAssetRef,
  ModelFormat,
} from './models';

export type {
  SavedSceneDocument,
  SavedSceneModelInstance,
  SceneInstance,
  SceneTransform,
} from './scene';

export type {
  InstanceDeleteMessage,
  InstanceUpdateMessage,
  LockMessage,
  PingMessage,
  PongMessage,
  SceneSnapshotMessage,
  SyncConnectionStatus,
  SyncLockOwner,
  SyncMessage,
  SyncMessageType,
  SyncModelInstance,
  SyncServiceConfig,
} from './sync';
```

- [ ] **Step 7: 更新 mobile model 类型**

Replace `apps/mobile/src/types/model.ts` with:

```ts
import type { ModelAssetRef, ModelFormat, SceneInstance } from '@manga-ar/shared';

export type { ModelAssetRef, ModelFormat };

export type RemoteModel = ModelAssetRef;

export type CachedModelAsset = ModelAssetRef & {
  localUri: string;
};

export type SceneModelInstance = Omit<SceneInstance, 'asset'> & {
  asset: CachedModelAsset;
};
```

- [ ] **Step 8: 更新 mobile scene 类型**

Replace `apps/mobile/src/types/scene.ts` with:

```ts
export type {
  SavedSceneDocument,
  SavedSceneModelInstance,
} from '@manga-ar/shared';
```

- [ ] **Step 9: 更新 mobile sync 类型**

Replace `apps/mobile/src/types/sync.ts` with:

```ts
export type {
  InstanceDeleteMessage,
  InstanceUpdateMessage,
  LockMessage,
  PingMessage,
  PongMessage,
  SceneSnapshotMessage,
  SyncConnectionStatus,
  SyncLockOwner,
  SyncMessage,
  SyncMessageType,
  SyncModelInstance,
  SyncServiceConfig,
} from '@manga-ar/shared';
```

- [ ] **Step 10: 更新 lockfile**

Run:

```powershell
pnpm install --lockfile-only
```

Expected: PASS and `pnpm-lock.yaml` contains importer `shared`.

- [ ] **Step 11: 运行 shared typecheck**

Run:

```powershell
pnpm --filter @manga-ar/shared typecheck
```

Expected: PASS.

- [ ] **Step 12: 运行 mobile typecheck**

Run:

```powershell
pnpm --filter @manga-ar/mobile typecheck
```

Expected: PASS.

- [ ] **Step 13: 运行结构检查**

Run:

```powershell
pnpm run check:structure
```

Expected:

```text
Workspace structure check passed.
```

- [ ] **Step 14: 提交 shared 抽取**

Run:

```powershell
git add apps\mobile\src\types shared package.json pnpm-lock.yaml
git commit -m "refactor(shared): 抽取平台无关类型"
```

Expected: commit succeeds.

---

### Task 5: 将 relay 拆为可内置的 TypeScript 服务边界

**Files:**
- Create: `apps/relay/tsconfig.json`
- Create: `apps/relay/src/rooms.ts`
- Create: `apps/relay/src/snapshotStore.ts`
- Modify: `apps/relay/package.json`
- Modify: `apps/relay/src/server.js` -> `apps/relay/src/server.ts`
- Test: `pnpm --filter @manga-ar/relay typecheck`
- Test: `pnpm --filter @manga-ar/relay start`

- [ ] **Step 1: 更新 relay package.json**

Replace `apps/relay/package.json` with:

```json
{
  "name": "@manga-ar/relay",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "src/server.ts",
  "scripts": {
    "start": "tsx src/server.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@manga-ar/shared": "workspace:*",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.2",
    "typescript": "~5.9.2"
  }
}
```

- [ ] **Step 2: 创建 relay tsconfig**

Create `apps/relay/tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: 创建房间管理模块**

Create `apps/relay/src/rooms.ts`:

```ts
import type { WebSocket } from 'ws';

const rooms = new Map<string, Set<WebSocket>>();

export function joinRoom(sessionId: string, ws: WebSocket): Set<WebSocket> {
  const existing = rooms.get(sessionId);
  if (existing) {
    existing.add(ws);
    return existing;
  }

  const clients = new Set<WebSocket>();
  clients.add(ws);
  rooms.set(sessionId, clients);
  return clients;
}

export function leaveRoom(sessionId: string, ws: WebSocket): void {
  const clients = rooms.get(sessionId);
  if (!clients) {
    return;
  }

  clients.delete(ws);
  if (clients.size === 0) {
    rooms.delete(sessionId);
  }
}
```

- [ ] **Step 4: 创建快照缓存模块**

Create `apps/relay/src/snapshotStore.ts`:

```ts
import type { SceneSnapshotMessage } from '@manga-ar/shared';

const snapshots = new Map<string, SceneSnapshotMessage>();

export function getSnapshot(sessionId: string): SceneSnapshotMessage | undefined {
  return snapshots.get(sessionId);
}

export function rememberSnapshot(sessionId: string, message: SceneSnapshotMessage): void {
  snapshots.set(sessionId, message);
}
```

- [ ] **Step 5: 将 server.js 重命名为 server.ts**

Run:

```powershell
git mv apps\relay\src\server.js apps\relay\src\server.ts
```

Expected: file is renamed.

- [ ] **Step 6: 替换 relay server imports 和房间逻辑**

Replace the CommonJS imports and in-file room/snapshot maps in `apps/relay/src/server.ts` with these TypeScript imports and helper calls:

```ts
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { SceneSnapshotMessage, SyncMessage } from '@manga-ar/shared';

import { joinRoom, leaveRoom } from './rooms.js';
import { getSnapshot, rememberSnapshot } from './snapshotStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3001);
const STUDIO_HTML_PATH = path.resolve(__dirname, '../../studio-desktop/prototype/index.html');
```

Inside the `connection` handler, use:

```ts
const clients = joinRoom(sessionId, ws);
const lastSnapshot = getSnapshot(sessionId);

if (lastSnapshot) {
  ws.send(JSON.stringify(lastSnapshot));
}

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString()) as SyncMessage;

    if (message.type === 'scene_snapshot') {
      rememberSnapshot(sessionId, message as SceneSnapshotMessage);
    }

    const payload = JSON.stringify(message);
    clients.forEach((client: WebSocket) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  } catch {
    // 非 JSON 消息忽略
  }
});

ws.on('close', () => {
  console.log(`[Relay] 连接关闭，Session: ${sessionId}`);
  leaveRoom(sessionId, ws);
});
```

- [ ] **Step 7: 更新 lockfile**

Run:

```powershell
pnpm install --lockfile-only
```

Expected: PASS and relay devDependencies are represented in `pnpm-lock.yaml`.

- [ ] **Step 8: 运行 relay typecheck**

Run:

```powershell
pnpm --filter @manga-ar/relay typecheck
```

Expected: PASS.

- [ ] **Step 9: 启动 relay 做冒烟验证**

Run:

```powershell
pnpm --filter @manga-ar/relay start
```

Expected: console prints the relay startup lines and `/studio` path is served from `apps/studio-desktop/prototype/index.html`. Stop with `Ctrl+C`.

- [ ] **Step 10: 提交 relay 拆分**

Run:

```powershell
git add apps\relay pnpm-lock.yaml
git commit -m "refactor(relay): 拆分中继服务边界"
```

Expected: commit succeeds.

---

### Task 6: 创建 studio-desktop Electron 骨架

**Files:**
- Create: `apps/studio-desktop/package.json`
- Create: `apps/studio-desktop/tsconfig.json`
- Create: `apps/studio-desktop/tsconfig.node.json`
- Create: `apps/studio-desktop/vite.config.ts`
- Create: `apps/studio-desktop/index.html`
- Create: `apps/studio-desktop/electron/main/index.ts`
- Create: `apps/studio-desktop/electron/preload/index.ts`
- Create: `apps/studio-desktop/src/main/relay/index.ts`
- Create: `apps/studio-desktop/src/main/window/index.ts`
- Create: `apps/studio-desktop/src/renderer/main.tsx`
- Create: `apps/studio-desktop/src/renderer/App.tsx`
- Test: `pnpm --filter @manga-ar/studio-desktop typecheck`

- [ ] **Step 1: 创建 desktop package.json**

Create `apps/studio-desktop/package.json`:

```json
{
  "name": "@manga-ar/studio-desktop",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "dist-electron/main/index.js",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
    "build": "vite build"
  },
  "dependencies": {
    "@manga-ar/shared": "workspace:*",
    "@vitejs/plugin-react": "^5.0.0",
    "electron": "^38.0.0",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "three": "^0.180.0",
    "vite": "^7.0.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/react": "~19.1.10",
    "@types/react-dom": "^19.1.0",
    "typescript": "~5.9.2"
  }
}
```

- [ ] **Step 2: 创建 renderer tsconfig**

Create `apps/studio-desktop/tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src/renderer/**/*.ts", "src/renderer/**/*.tsx", "vite.config.ts"]
}
```

- [ ] **Step 3: 创建 main/preload tsconfig**

Create `apps/studio-desktop/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["electron/**/*.ts", "src/main/**/*.ts"]
}
```

- [ ] **Step 4: 创建 Vite 配置**

Create `apps/studio-desktop/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

- [ ] **Step 5: 创建 renderer HTML 入口**

Create `apps/studio-desktop/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Manga AR Studio</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: 创建 desktop main relay 边界**

Create `apps/studio-desktop/src/main/relay/index.ts`:

```ts
export type DesktopRelayState = {
  enabled: boolean;
  port: number;
};

export function createInitialRelayState(port = 3001): DesktopRelayState {
  return {
    enabled: false,
    port,
  };
}
```

- [ ] **Step 7: 创建 desktop window 边界**

Create `apps/studio-desktop/src/main/window/index.ts`:

```ts
export type StudioWindowOptions = {
  width: number;
  height: number;
  title: string;
};

export function getDefaultStudioWindowOptions(): StudioWindowOptions {
  return {
    width: 1280,
    height: 800,
    title: 'Manga AR Studio',
  };
}
```

- [ ] **Step 8: 创建 Electron main 入口**

Create `apps/studio-desktop/electron/main/index.ts`:

```ts
import { app, BrowserWindow } from 'electron';
import { getDefaultStudioWindowOptions } from '../../src/main/window/index.js';

function createWindow() {
  const options = getDefaultStudioWindowOptions();
  const win = new BrowserWindow({
    width: options.width,
    height: options.height,
    title: options.title,
    webPreferences: {
      preload: new URL('../preload/index.js', import.meta.url).pathname,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
    return;
  }

  void win.loadFile(new URL('../../dist/index.html', import.meta.url).pathname);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
```

- [ ] **Step 9: 创建 preload 入口**

Create `apps/studio-desktop/electron/preload/index.ts`:

```ts
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('mangaArStudio', {
  appName: 'Manga AR Studio',
});
```

- [ ] **Step 10: 创建 renderer 入口**

Create `apps/studio-desktop/src/renderer/main.tsx`:

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element #root was not found.');
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 11: 创建 renderer shell**

Create `apps/studio-desktop/src/renderer/App.tsx`:

```tsx
import type { SceneDocument } from '@manga-ar/shared';

const emptyScene: SceneDocument = {
  id: 'desktop-empty-scene',
  updatedAt: 0,
  selectedInstanceId: null,
  pendingModelId: null,
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
```

- [ ] **Step 12: 在 shared 中提供 SceneDocument alias**

Modify `shared/src/scene/index.ts` to export an alias after `SavedSceneDocument`:

```ts
export type SceneDocument = SavedSceneDocument;
```

Modify `shared/src/index.ts` scene export list to include:

```ts
SceneDocument,
```

- [ ] **Step 13: 更新 lockfile**

Run:

```powershell
pnpm install --lockfile-only
```

Expected: PASS and `pnpm-lock.yaml` contains importer `apps/studio-desktop`.

- [ ] **Step 14: 运行 desktop typecheck**

Run:

```powershell
pnpm --filter @manga-ar/studio-desktop typecheck
```

Expected: PASS.

- [ ] **Step 15: 运行 shared typecheck**

Run:

```powershell
pnpm --filter @manga-ar/shared typecheck
```

Expected: PASS.

- [ ] **Step 16: 提交 desktop 骨架**

Run:

```powershell
git add apps\studio-desktop shared pnpm-lock.yaml
git commit -m "feat(studio): 创建 Electron 桌面端骨架"
```

Expected: commit succeeds.

---

### Task 7: 更新文档并做最终验证

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Test: `pnpm run check:structure`
- Test: `pnpm run typecheck`

- [ ] **Step 1: 更新 README 项目结构说明**

Replace the README opening paragraph with:

```md
# Manga AR

Manga AR 是一个 pnpm workspace monorepo。当前包含 Expo React Native 手机端、Node WebSocket 中继服务、Electron 桌面端骨架，以及顶层 `shared` 共享类型包。
```

- [ ] **Step 2: 更新 README 安装命令**

Replace the install section with:

````md
## 安装依赖

在项目根目录安装全部 workspace 依赖：

```bash
pnpm install
```
````

- [ ] **Step 3: 更新 README 运行命令**

Replace the development command section with:

````md
## 开发运行

手机端：

```bash
pnpm start
# 或
pnpm --filter @manga-ar/mobile start
```

安装到设备 / 模拟器：

```bash
pnpm run android
pnpm run ios
```

中继服务：

```bash
pnpm run relay
# 或
pnpm --filter @manga-ar/relay start
```

桌面端骨架：

```bash
pnpm run studio
# 或
pnpm --filter @manga-ar/studio-desktop dev
```
````

- [ ] **Step 4: 更新 AGENTS.md 项目结构**

Replace the current structure paragraph with:

```md
Manga AR is a pnpm workspace monorepo. `apps/mobile` contains the Expo React Native app using TypeScript and `@reactvision/react-viro`; its entry points are `apps/mobile/index.ts` and `apps/mobile/App.tsx`. `apps/relay` contains the Node WebSocket relay. `apps/studio-desktop` contains the Electron desktop Studio skeleton and the migrated static prototype under `apps/studio-desktop/prototype`. `shared` contains platform-neutral TypeScript contracts consumed by mobile, relay, and desktop.
```

- [ ] **Step 5: 更新 AGENTS.md 命令说明**

Replace command bullets with:

```md
- `pnpm install`: installs all workspace dependencies from the repository root.
- `pnpm start`: starts the Expo mobile app through the root forwarding script.
- `pnpm --filter @manga-ar/mobile start`: starts Expo directly from the mobile workspace.
- `pnpm run android` / `pnpm run ios`: builds and runs the native mobile app on a device or simulator.
- `pnpm run relay`: starts the WebSocket relay on `PORT` or `3001`.
- `pnpm run studio`: starts the desktop Studio renderer dev server.
- `pnpm run typecheck`: runs TypeScript checks for shared, mobile, relay, and desktop.
- `pnpm run check:structure`: verifies the workspace dependency boundaries.
```

- [ ] **Step 6: 更新 AGENTS.md 验证说明**

Replace the testing paragraph with:

```md
Before submitting structural changes, run `pnpm run check:structure` and `pnpm run typecheck`. For mobile changes, also manually exercise the affected flow with `pnpm start` or the relevant native command. For relay changes, test `pnpm run relay` and verify `/studio` plus WebSocket session behavior.
```

- [ ] **Step 7: 更新 lockfile**

Run:

```powershell
pnpm install --lockfile-only
```

Expected: PASS.

- [ ] **Step 8: 运行结构检查**

Run:

```powershell
pnpm run check:structure
```

Expected:

```text
Workspace structure check passed.
```

- [ ] **Step 9: 运行全量 typecheck**

Run:

```powershell
pnpm run typecheck
```

Expected: PASS for shared, mobile, relay, and studio-desktop.

- [ ] **Step 10: 运行 relay 冒烟**

Run:

```powershell
pnpm run relay
```

Expected: relay prints startup lines and serves `/studio`. Stop with `Ctrl+C`.

- [ ] **Step 11: 查看最终 diff**

Run:

```powershell
git status --short
git diff --stat
```

Expected: only monorepo structure, docs, package metadata, lockfile, and type boundary changes remain.

- [ ] **Step 12: 提交文档和验证脚本结果**

Run:

```powershell
git add README.md AGENTS.md package.json pnpm-lock.yaml
git commit -m "docs: 更新 monorepo 开发说明"
```

Expected: commit succeeds.

---

## 最终验收清单

- [ ] `pnpm install` completes from repository root.
- [ ] `pnpm run check:structure` prints `Workspace structure check passed.`
- [ ] `pnpm run typecheck` passes.
- [ ] `pnpm start` starts the mobile Expo dev client command from `apps/mobile`.
- [ ] `pnpm run relay` starts relay and reports `http://localhost:3001/studio`.
- [ ] `shared/package.json` has no runtime dependencies on Expo, React Native, Electron, Three.js, or ws.
- [ ] `apps/mobile/package.json`, `apps/relay/package.json`, and `apps/studio-desktop/package.json` depend on `@manga-ar/shared` with `workspace:*`.
- [ ] `manga-ar-studio/` and `relay-server/` no longer exist at repository root.
- [ ] root `package.json` has no app runtime dependencies.

## Self-Review

- Spec coverage: tasks cover workspace shell, mobile migration, relay migration, shared extraction, desktop skeleton, docs, and validation.
- Placeholder scan: no unresolved placeholder markers or incomplete sections are intentionally present in this plan.
- Type consistency: shared exports `ModelAssetRef`, `SceneInstance`, `SavedSceneDocument`, `SceneDocument`, and sync message types before mobile, relay, and desktop consume them.
