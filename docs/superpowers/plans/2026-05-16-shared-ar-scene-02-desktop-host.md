# Desktop Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `apps/studio-desktop` 的 Electron main process 内建立唯一同步 host，提供场景库、资产库、HTTP API、WebSocket 同步和发现服务边界。

**Architecture:** Electron main process 组合 focused host modules；renderer 通过 preload IPC 查询 host 状态和提交场景操作。第一版 discovery 先实现可替换接口与本机 HTTP/WebSocket host，mDNS 真实广播作为独立 task 接入。

**Tech Stack:** Electron、TypeScript NodeNext、Node `http`、`ws`、本地 JSON 文件、shadcn/ui renderer。

---

## Precondition

先完成 `2026-05-16-shared-ar-scene-01-contract-and-repo-cleanup.md`。本阶段默认：

- `apps/relay` 已删除。
- `@manga-ar/shared` 已导出 `SceneRecord`、`SceneDocument`、`SceneOp`、`AssetRecord`、`HostInfo`、`SyncMessage`。
- 根 `typecheck` 不再引用 `@manga-ar/relay`。

## Task 1: 安装 desktop host 运行时依赖

**Files:**
- Modify: `apps/studio-desktop/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: 添加依赖**

Run:

```bash
pnpm --filter @manga-ar/studio-desktop add ws bonjour-service
pnpm --filter @manga-ar/studio-desktop add -D @types/ws
```

Expected: `apps/studio-desktop/package.json` 增加 `ws`、`bonjour-service` 和 `@types/ws`。

- [ ] **Step 2: 运行 typecheck**

Run:

```bash
pnpm --filter @manga-ar/studio-desktop typecheck
```

Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/studio-desktop/package.json pnpm-lock.yaml
git commit -m "build(studio): 添加内置 host 运行时依赖"
```

## Task 2: 创建 sceneRepository

**Files:**
- Create: `apps/studio-desktop/electron/main/host/sceneRepository.ts`

- [ ] **Step 1: 创建文件**

新增 `apps/studio-desktop/electron/main/host/sceneRepository.ts`：

```ts
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  MarkerAnchorDefinition,
  SceneDocument,
  SceneOp,
  SceneRecord,
  SceneTransform,
} from '@manga-ar/shared';

type SceneBundle = {
  record: SceneRecord;
  document: SceneDocument;
};

type SceneRepositoryOptions = {
  rootDir: string;
};

function now(): number {
  return Date.now();
}

function createDefaultAnchor(sceneId: string): MarkerAnchorDefinition {
  return {
    anchorType: 'marker',
    markerId: `${sceneId}-marker`,
    physicalWidthMeters: 0.16,
    referenceImageChecksum: 'development-marker',
    displayName: 'Development Marker',
  };
}

function createEmptyBundle(name: string): SceneBundle {
  const timestamp = now();
  const sceneId = `scene-${timestamp}`;
  const record: SceneRecord = {
    sceneId,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
    anchorDefinition: createDefaultAnchor(sceneId),
    assetRefs: [],
  };

  return {
    record,
    document: {
      sceneId,
      revision: 0,
      selectedInstanceId: null,
      instances: [],
    },
  };
}

function sceneDir(rootDir: string, sceneId: string): string {
  return path.join(rootDir, sceneId);
}

function sceneFile(rootDir: string, sceneId: string): string {
  return path.join(sceneDir(rootDir, sceneId), 'scene.json');
}

function applyTransform(current: SceneTransform, next: SceneTransform): SceneTransform {
  return {
    x: next.x,
    y: next.y,
    z: next.z,
    rotationY: next.rotationY,
    scaleValue: next.scaleValue,
  };
}

export class SceneRepository {
  private readonly rootDir: string;

  constructor(options: SceneRepositoryOptions) {
    this.rootDir = options.rootDir;
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  async listScenes(): Promise<SceneRecord[]> {
    await this.ensureReady();
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
    const records: SceneRecord[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const bundle = await this.readScene(entry.name);
      if (bundle) {
        records.push(bundle.record);
      }
    }

    return records.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async createScene(name: string): Promise<SceneBundle> {
    await this.ensureReady();
    const bundle = createEmptyBundle(name);
    await this.writeBundle(bundle);
    return bundle;
  }

  async getScene(sceneId: string): Promise<SceneBundle | null> {
    return this.readScene(sceneId);
  }

  async applyOps(sceneId: string, ops: SceneOp[]): Promise<{
    acceptedOpIds: string[];
    rejected: Array<{ opId: string; reason: 'stale_revision' | 'missing_instance' | 'missing_asset' | 'invalid_op' }>;
    document: SceneDocument;
  }> {
    const bundle = await this.readScene(sceneId);
    if (!bundle) {
      throw new Error(`Scene not found: ${sceneId}`);
    }

    const acceptedOpIds: string[] = [];
    const rejected: Array<{ opId: string; reason: 'stale_revision' | 'missing_instance' | 'missing_asset' | 'invalid_op' }> = [];
    const document: SceneDocument = {
      ...bundle.document,
      instances: bundle.document.instances.map((instance) => ({ ...instance, transform: { ...instance.transform } })),
    };

    for (const op of ops) {
      if (op.baseRevision !== document.revision) {
        rejected.push({ opId: op.opId, reason: 'stale_revision' });
        continue;
      }

      if (op.type === 'add_instance') {
        if (document.instances.some((item) => item.instanceId === op.instance.instanceId)) {
          rejected.push({ opId: op.opId, reason: 'invalid_op' });
          continue;
        }
        document.revision += 1;
        document.instances.push({ ...op.instance, instanceRevision: document.revision });
        acceptedOpIds.push(op.opId);
        continue;
      }

      if (op.type === 'update_transform') {
        const target = document.instances.find((item) => item.instanceId === op.instanceId);
        if (!target) {
          rejected.push({ opId: op.opId, reason: 'missing_instance' });
          continue;
        }
        document.revision += 1;
        target.transform = applyTransform(target.transform, op.transform);
        target.instanceRevision = document.revision;
        acceptedOpIds.push(op.opId);
        continue;
      }

      if (op.type === 'delete_instance') {
        const before = document.instances.length;
        document.instances = document.instances.filter((item) => item.instanceId !== op.instanceId);
        if (document.instances.length === before) {
          rejected.push({ opId: op.opId, reason: 'missing_instance' });
          continue;
        }
        document.revision += 1;
        if (document.selectedInstanceId === op.instanceId) {
          document.selectedInstanceId = null;
        }
        acceptedOpIds.push(op.opId);
        continue;
      }

      if (op.type === 'replace_asset') {
        const target = document.instances.find((item) => item.instanceId === op.instanceId);
        if (!target) {
          rejected.push({ opId: op.opId, reason: 'missing_instance' });
          continue;
        }
        document.revision += 1;
        target.asset = op.asset;
        target.instanceRevision = document.revision;
        acceptedOpIds.push(op.opId);
        continue;
      }

      if (op.type === 'select_instance') {
        if (op.instanceId && !document.instances.some((item) => item.instanceId === op.instanceId)) {
          rejected.push({ opId: op.opId, reason: 'missing_instance' });
          continue;
        }
        document.revision += 1;
        document.selectedInstanceId = op.instanceId;
        acceptedOpIds.push(op.opId);
      }
    }

    const nextRecord: SceneRecord = {
      ...bundle.record,
      updatedAt: now(),
      revision: document.revision,
      assetRefs: Array.from(
        new Map(document.instances.map((instance) => [`${instance.asset.assetId}@${instance.asset.version}`, instance.asset])).values()
      ),
    };

    await this.writeBundle({ record: nextRecord, document });

    return { acceptedOpIds, rejected, document };
  }

  private async readScene(sceneId: string): Promise<SceneBundle | null> {
    try {
      const contents = await fs.readFile(sceneFile(this.rootDir, sceneId), 'utf8');
      return JSON.parse(contents) as SceneBundle;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async writeBundle(bundle: SceneBundle): Promise<void> {
    await fs.mkdir(sceneDir(this.rootDir, bundle.record.sceneId), { recursive: true });
    await fs.writeFile(sceneFile(this.rootDir, bundle.record.sceneId), JSON.stringify(bundle, null, 2), 'utf8');
  }
}
```

- [ ] **Step 2: 运行 desktop typecheck**

Run:

```bash
pnpm --filter @manga-ar/studio-desktop typecheck
```

Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/studio-desktop/electron/main/host/sceneRepository.ts
git commit -m "feat(studio): 添加场景仓库"
```

## Task 3: 创建 assetRepository

**Files:**
- Create: `apps/studio-desktop/electron/main/host/assetRepository.ts`

- [ ] **Step 1: 创建文件**

新增 `apps/studio-desktop/electron/main/host/assetRepository.ts`：

```ts
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { AssetRecord, ModelAssetRef, ModelFormat } from '@manga-ar/shared';

type AssetRepositoryOptions = {
  rootDir: string;
};

function detectFormat(fileName: string): ModelFormat {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.glb') return 'GLB';
  if (ext === '.gltf') return 'GLTF';
  if (ext === '.obj') return 'OBJ';
  if (ext === '.vrx') return 'VRX';
  return 'GLB';
}

function contentTypeFor(format: ModelFormat): string {
  if (format === 'GLB') return 'model/gltf-binary';
  if (format === 'GLTF') return 'model/gltf+json';
  if (format === 'OBJ') return 'text/plain';
  return 'application/octet-stream';
}

export class AssetRepository {
  private readonly rootDir: string;

  constructor(options: AssetRepositoryOptions) {
    this.rootDir = options.rootDir;
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  async listAssets(): Promise<AssetRecord[]> {
    await this.ensureReady();
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
    const assets: AssetRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const asset = await this.getAsset(entry.name);
      if (asset) assets.push(asset);
    }
    return assets.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getAsset(assetId: string): Promise<AssetRecord | null> {
    try {
      const contents = await fs.readFile(path.join(this.rootDir, assetId, 'manifest.json'), 'utf8');
      return JSON.parse(contents) as AssetRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async getAssets(refs: ModelAssetRef[]): Promise<AssetRecord[]> {
    const records: AssetRecord[] = [];
    for (const ref of refs) {
      const record = await this.getAsset(ref.assetId);
      if (record && record.version === ref.version) {
        records.push(record);
      }
    }
    return records;
  }

  async importAsset(sourcePath: string, name?: string): Promise<AssetRecord> {
    await this.ensureReady();
    const fileBuffer = await fs.readFile(sourcePath);
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const assetId = `asset-${checksum.slice(0, 16)}`;
    const fileName = path.basename(sourcePath);
    const format = detectFormat(fileName);
    const targetDir = path.join(this.rootDir, assetId);

    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, fileName), fileBuffer);

    const record: AssetRecord = {
      assetId,
      name: name ?? path.basename(fileName, path.extname(fileName)),
      version: 1,
      fileName,
      fileSize: fileBuffer.byteLength,
      checksum,
      contentType: contentTypeFor(format),
      format,
      defaultScale: 1,
    };

    await fs.writeFile(path.join(targetDir, 'manifest.json'), JSON.stringify(record, null, 2), 'utf8');
    return record;
  }

  async getAssetFile(assetId: string): Promise<{ record: AssetRecord; filePath: string } | null> {
    const record = await this.getAsset(assetId);
    if (!record) return null;
    return {
      record,
      filePath: path.join(this.rootDir, assetId, record.fileName),
    };
  }
}
```

- [ ] **Step 2: 运行 typecheck**

Run:

```bash
pnpm --filter @manga-ar/studio-desktop typecheck
```

Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/studio-desktop/electron/main/host/assetRepository.ts
git commit -m "feat(studio): 添加资产仓库"
```

## Task 4: 创建 HTTP routes 与 HostServer

**Files:**
- Create: `apps/studio-desktop/electron/main/host/httpRoutes.ts`
- Create: `apps/studio-desktop/electron/main/host/hostServer.ts`

- [ ] **Step 1: 创建 httpRoutes**

新增 `apps/studio-desktop/electron/main/host/httpRoutes.ts`：

```ts
import fs from 'node:fs';
import http from 'node:http';
import { URL } from 'node:url';

import type { HostInfo, SubmitSceneOpsRequest } from '@manga-ar/shared';

import { AssetRepository } from './assetRepository.js';
import { SceneRepository } from './sceneRepository.js';

export type RouteContext = {
  hostInfo: HostInfo;
  sceneRepository: SceneRepository;
  assetRepository: AssetRepository;
};

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendText(res: http.ServerResponse, statusCode: number, body: string): void {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function handleHostHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  context: RouteContext
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/host/info') {
    sendJson(res, 200, { host: context.hostInfo });
    return;
  }

  if (req.method === 'GET' && pathname === '/scenes') {
    const scenes = await context.sceneRepository.listScenes();
    sendJson(res, 200, { scenes });
    return;
  }

  const sceneMatch = pathname.match(/^\/scenes\/([^/]+)$/);
  if (req.method === 'GET' && sceneMatch) {
    const sceneId = decodeURIComponent(sceneMatch[1]);
    const bundle = await context.sceneRepository.getScene(sceneId);
    if (!bundle) {
      sendText(res, 404, 'Scene not found');
      return;
    }
    sendJson(res, 200, { scene: bundle.record, document: bundle.document });
    return;
  }

  const sceneAssetsMatch = pathname.match(/^\/scenes\/([^/]+)\/assets$/);
  if (req.method === 'GET' && sceneAssetsMatch) {
    const sceneId = decodeURIComponent(sceneAssetsMatch[1]);
    const bundle = await context.sceneRepository.getScene(sceneId);
    if (!bundle) {
      sendText(res, 404, 'Scene not found');
      return;
    }
    const assets = await context.assetRepository.getAssets(bundle.record.assetRefs);
    sendJson(res, 200, { assets });
    return;
  }

  const sceneOpsMatch = pathname.match(/^\/scenes\/([^/]+)\/ops$/);
  if (req.method === 'POST' && sceneOpsMatch) {
    const sceneId = decodeURIComponent(sceneOpsMatch[1]);
    const body = JSON.parse(await readBody(req)) as SubmitSceneOpsRequest;
    const result = await context.sceneRepository.applyOps(sceneId, body.ops);
    sendJson(res, 200, result);
    return;
  }

  const assetFileMatch = pathname.match(/^\/assets\/([^/]+)\/file$/);
  if (req.method === 'GET' && assetFileMatch) {
    const assetId = decodeURIComponent(assetFileMatch[1]);
    const file = await context.assetRepository.getAssetFile(assetId);
    if (!file) {
      sendText(res, 404, 'Asset not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': file.record.contentType,
      'Content-Length': file.record.fileSize,
    });
    fs.createReadStream(file.filePath).pipe(res);
    return;
  }

  sendText(res, 404, 'Not Found');
}
```

- [ ] **Step 2: 创建 hostServer**

新增 `apps/studio-desktop/electron/main/host/hostServer.ts`：

```ts
import http from 'node:http';
import os from 'node:os';

import type { HostInfo } from '@manga-ar/shared';

import { AssetRepository } from './assetRepository.js';
import { handleHostHttpRequest } from './httpRoutes.js';
import { SceneRepository } from './sceneRepository.js';

export type HostServerOptions = {
  hostId: string;
  hostName?: string;
  dataDir: string;
  preferredPort?: number;
};

export type HostServerState = {
  running: boolean;
  hostInfo: HostInfo;
  addresses: string[];
};

function getLocalIPv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  Object.values(interfaces).forEach((items) => {
    items?.forEach((item) => {
      if (item.family === 'IPv4' && !item.internal) {
        addresses.push(item.address);
      }
    });
  });
  return addresses;
}

export class HostServer {
  private readonly sceneRepository: SceneRepository;
  private readonly assetRepository: AssetRepository;
  private readonly hostId: string;
  private readonly hostName: string;
  private readonly preferredPort: number;
  private server: http.Server | null = null;
  private hostInfo: HostInfo;

  constructor(options: HostServerOptions) {
    this.hostId = options.hostId;
    this.hostName = options.hostName ?? os.hostname();
    this.preferredPort = options.preferredPort ?? 0;
    this.sceneRepository = new SceneRepository({ rootDir: `${options.dataDir}/scenes` });
    this.assetRepository = new AssetRepository({ rootDir: `${options.dataDir}/assets` });
    this.hostInfo = {
      hostId: this.hostId,
      hostName: this.hostName,
      protocolVersion: '2026-05-16',
      httpPort: 0,
      wsPath: '/sync',
    };
  }

  async start(): Promise<HostServerState> {
    if (this.server) {
      return this.getState();
    }

    await this.sceneRepository.ensureReady();
    await this.assetRepository.ensureReady();

    this.server = http.createServer((req, res) => {
      void handleHostHttpRequest(req, res, {
        hostInfo: this.hostInfo,
        sceneRepository: this.sceneRepository,
        assetRepository: this.assetRepository,
      }).catch((error) => {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(error instanceof Error ? error.message : 'Internal Server Error');
      });
    });

    await new Promise<void>((resolve) => {
      this.server?.listen(this.preferredPort, '0.0.0.0', resolve);
    });

    const address = this.server.address();
    const port = typeof address === 'object' && address ? address.port : this.preferredPort;
    this.hostInfo = { ...this.hostInfo, httpPort: port };

    const scenes = await this.sceneRepository.listScenes();
    if (scenes.length === 0) {
      await this.sceneRepository.createScene('默认共享场景');
    }

    return this.getState();
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  getState(): HostServerState {
    return {
      running: Boolean(this.server),
      hostInfo: this.hostInfo,
      addresses: getLocalIPv4Addresses(),
    };
  }

  getSceneRepository(): SceneRepository {
    return this.sceneRepository;
  }

  getAssetRepository(): AssetRepository {
    return this.assetRepository;
  }
}
```

- [ ] **Step 3: 运行 typecheck**

Run:

```bash
pnpm --filter @manga-ar/studio-desktop typecheck
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/studio-desktop/electron/main/host/httpRoutes.ts apps/studio-desktop/electron/main/host/hostServer.ts
git commit -m "feat(studio): 添加内置 host HTTP 服务"
```

## Task 5: 接入 WebSocket sessions

**Files:**
- Create: `apps/studio-desktop/electron/main/host/wsSessions.ts`
- Modify: `apps/studio-desktop/electron/main/host/hostServer.ts`
- Modify: `apps/studio-desktop/electron/main/host/httpRoutes.ts`

- [ ] **Step 1: 创建 wsSessions**

新增 `apps/studio-desktop/electron/main/host/wsSessions.ts`：

```ts
import http from 'node:http';

import type { ClientOpsMessage, HostSnapshotMessage, SyncMessage } from '@manga-ar/shared';
import { WebSocket, WebSocketServer } from 'ws';

import { AssetRepository } from './assetRepository.js';
import { SceneRepository } from './sceneRepository.js';

export class WsSessions {
  private readonly wss: WebSocketServer;
  private readonly sceneRepository: SceneRepository;
  private readonly assetRepository: AssetRepository;
  private readonly clientsByScene = new Map<string, Set<WebSocket>>();

  constructor(options: {
    server: http.Server;
    sceneRepository: SceneRepository;
    assetRepository: AssetRepository;
  }) {
    this.sceneRepository = options.sceneRepository;
    this.assetRepository = options.assetRepository;
    this.wss = new WebSocketServer({ noServer: true });

    options.server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/sync') {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
      });
    });

    this.wss.on('connection', (ws, req) => {
      void this.handleConnection(ws, req);
    });
  }

  close(): void {
    this.wss.close();
    this.clientsByScene.clear();
  }

  private async handleConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const sceneId = url.searchParams.get('sceneId');
    if (!sceneId) {
      ws.close(1008, 'sceneId is required');
      return;
    }

    let clients = this.clientsByScene.get(sceneId);
    if (!clients) {
      clients = new Set<WebSocket>();
      this.clientsByScene.set(sceneId, clients);
    }
    clients.add(ws);

    const snapshot = await this.buildSnapshot(sceneId);
    if (snapshot) {
      ws.send(JSON.stringify(snapshot));
    }

    ws.on('message', (data) => {
      void this.handleMessage(sceneId, ws, data.toString());
    });

    ws.on('close', () => {
      clients?.delete(ws);
      if (clients?.size === 0) {
        this.clientsByScene.delete(sceneId);
      }
    });
  }

  private async handleMessage(sceneId: string, sender: WebSocket, raw: string): Promise<void> {
    const message = JSON.parse(raw) as SyncMessage;
    if (message.type === 'ping') {
      sender.send(JSON.stringify({ type: 'pong', timestamp: Date.now() } satisfies SyncMessage));
      return;
    }

    if (message.type !== 'client_ops') {
      return;
    }

    const clientOps = message as ClientOpsMessage;
    const result = await this.sceneRepository.applyOps(sceneId, clientOps.ops);
    const event: SyncMessage = {
      type: 'host_events',
      sceneId,
      timestamp: Date.now(),
      events: [
        ...result.acceptedOpIds.map((opId) => ({
          type: 'op_accepted' as const,
          opId,
          revision: result.document.revision,
        })),
        ...result.rejected.map((item) => ({
          type: 'op_rejected' as const,
          opId: item.opId,
          reason: item.reason,
          authoritativeRevision: result.document.revision,
        })),
        {
          type: 'scene_changed',
          sceneId,
          revision: result.document.revision,
          document: result.document,
        },
      ],
    };
    this.broadcast(sceneId, event);
  }

  private async buildSnapshot(sceneId: string): Promise<HostSnapshotMessage | null> {
    const bundle = await this.sceneRepository.getScene(sceneId);
    if (!bundle) return null;
    const assets = await this.assetRepository.getAssets(bundle.record.assetRefs);
    return {
      type: 'host_snapshot',
      sceneId,
      timestamp: Date.now(),
      document: bundle.document,
      assets,
    };
  }

  private broadcast(sceneId: string, message: SyncMessage): void {
    const payload = JSON.stringify(message);
    const clients = this.clientsByScene.get(sceneId);
    clients?.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }
}
```

- [ ] **Step 2: 在 HostServer 中挂载 WsSessions**

在 `hostServer.ts` 中导入：

```ts
import { WsSessions } from './wsSessions.js';
```

增加字段：

```ts
private wsSessions: WsSessions | null = null;
```

在 `start()` 创建 `http.Server` 后、listen 前加入：

```ts
this.wsSessions = new WsSessions({
  server: this.server,
  sceneRepository: this.sceneRepository,
  assetRepository: this.assetRepository,
});
```

在 `stop()` 中 `server.close` 前加入：

```ts
this.wsSessions?.close();
this.wsSessions = null;
```

- [ ] **Step 3: 运行 typecheck**

Run:

```bash
pnpm --filter @manga-ar/studio-desktop typecheck
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/studio-desktop/electron/main/host/wsSessions.ts apps/studio-desktop/electron/main/host/hostServer.ts
git commit -m "feat(studio): 添加场景 WebSocket 同步会话"
```

## Task 6: 接入 discovery service

**Files:**
- Create: `apps/studio-desktop/electron/main/host/discoveryService.ts`
- Modify: `apps/studio-desktop/electron/main/host/hostServer.ts`

- [ ] **Step 1: 创建 discovery service**

新增 `apps/studio-desktop/electron/main/host/discoveryService.ts`：

```ts
import type { HostInfo } from '@manga-ar/shared';
import { Bonjour, type Service } from 'bonjour-service';

export class DiscoveryService {
  private bonjour: Bonjour | null = null;
  private service: Service | null = null;

  start(hostInfo: HostInfo): void {
    this.stop();
    this.bonjour = new Bonjour();
    this.service = this.bonjour.publish({
      name: hostInfo.hostName,
      type: 'manga-ar-studio',
      port: hostInfo.httpPort,
      txt: {
        hostId: hostInfo.hostId,
        protocolVersion: hostInfo.protocolVersion,
        wsPath: hostInfo.wsPath,
      },
    });
  }

  stop(): void {
    this.service?.stop();
    this.service = null;
    this.bonjour?.destroy();
    this.bonjour = null;
  }
}
```

- [ ] **Step 2: 在 HostServer 中启动 discovery**

在 `hostServer.ts` 导入：

```ts
import { DiscoveryService } from './discoveryService.js';
```

增加字段：

```ts
private readonly discoveryService = new DiscoveryService();
```

在 `start()` listen 后更新 `hostInfo` 后加入：

```ts
this.discoveryService.start(this.hostInfo);
```

在 `stop()` 开头加入：

```ts
this.discoveryService.stop();
```

- [ ] **Step 3: 运行 typecheck**

Run:

```bash
pnpm --filter @manga-ar/studio-desktop typecheck
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/studio-desktop/electron/main/host/discoveryService.ts apps/studio-desktop/electron/main/host/hostServer.ts
git commit -m "feat(studio): 广播局域网 host 发现服务"
```

## Task 7: Electron main 与 preload 接入 host

**Files:**
- Modify: `apps/studio-desktop/electron/main/index.ts`
- Modify: `apps/studio-desktop/electron/preload/index.ts`
- Create: `apps/studio-desktop/src/renderer/types/preload.d.ts`

- [ ] **Step 1: 在 main process 启动 HostServer**

在 `apps/studio-desktop/electron/main/index.ts` 添加：

```ts
import { ipcMain } from 'electron';
import { HostServer } from './host/hostServer.js';
```

在模块顶层添加：

```ts
let hostServer: HostServer | null = null;
```

在 `app.whenReady().then(createWindow);` 前添加：

```ts
ipcMain.handle('host:get-state', () => {
  return hostServer?.getState() ?? null;
});
```

把 `app.whenReady().then(createWindow);` 改为：

```ts
app.whenReady().then(async () => {
  hostServer = new HostServer({
    hostId: `studio-${Date.now()}`,
    dataDir: path.join(app.getPath('userData'), 'host'),
  });
  await hostServer.start();
  createWindow();
});
```

在 `window-all-closed` 退出前无需同步 await；新增：

```ts
app.on('before-quit', () => {
  void hostServer?.stop();
});
```

- [ ] **Step 2: 在 preload 暴露 host API**

把 `apps/studio-desktop/electron/preload/index.ts` 改为：

```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('mangaArStudio', {
  appName: 'Manga AR Studio',
  host: {
    getState: () => ipcRenderer.invoke('host:get-state'),
  },
});
```

- [ ] **Step 3: 添加 renderer 类型声明**

新增 `apps/studio-desktop/src/renderer/types/preload.d.ts`。不要从 `electron/main` 导入类型，避免 renderer build 解析 main process 文件：

```ts
type RendererHostServerState = {
  running: boolean;
  hostInfo: {
    hostId: string;
    hostName: string;
    protocolVersion: '2026-05-16';
    httpPort: number;
    wsPath: '/sync';
  };
  addresses: string[];
};

declare global {
  interface Window {
    mangaArStudio: {
      appName: string;
      host: {
        getState: () => Promise<RendererHostServerState | null>;
      };
    };
  }
}

export {};
```

- [ ] **Step 4: 运行 typecheck**

Run:

```bash
pnpm --filter @manga-ar/studio-desktop typecheck
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/studio-desktop/electron/main/index.ts apps/studio-desktop/electron/preload/index.ts apps/studio-desktop/src/renderer/types/preload.d.ts
git commit -m "feat(studio): 启动内置 host 服务"
```

## Task 8: Renderer 显示 host 状态

**Files:**
- Modify: `apps/studio-desktop/src/renderer/App.tsx`

- [ ] **Step 1: 使用 shadcn Button 与 host state**

把 `apps/studio-desktop/src/renderer/App.tsx` 改为：

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
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Manga AR Studio</h1>
            <p className="text-sm text-muted-foreground">电脑端 host 与场景管理工作台</p>
          </div>
          <Button onClick={() => void refreshHostState()}>刷新状态</Button>
        </div>

        <div className="rounded-lg border bg-card p-4 text-card-foreground">
          <h2 className="text-base font-medium">Host 状态</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">运行状态</dt>
              <dd>{hostState?.running ? '运行中' : '未启动'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">端口</dt>
              <dd>{hostState?.hostInfo.httpPort ?? '-'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">局域网地址</dt>
              <dd>{hostState?.addresses.join(', ') || '-'}</dd>
            </div>
          </dl>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: 运行 typecheck 与 build**

Run:

```bash
pnpm --filter @manga-ar/studio-desktop typecheck
pnpm --filter @manga-ar/studio-desktop build
```

Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/studio-desktop/src/renderer/App.tsx
git commit -m "feat(studio): 显示内置 host 状态"
```

## Task 9: 阶段验收

**Files:**
- Verify only.

- [ ] **Step 1: 运行 desktop 验证**

Run:

```bash
pnpm --filter @manga-ar/studio-desktop typecheck
pnpm --filter @manga-ar/studio-desktop build
```

Expected: PASS。

- [ ] **Step 2: 运行仓库验证**

Run:

```bash
pnpm run check:structure
pnpm run typecheck
```

Expected: PASS。

- [ ] **Step 3: 手动启动 Studio**

Run:

```bash
pnpm run studio
```

Expected: Vite dev server 启动。当前 `pnpm run studio` 只启动 renderer dev server，不启动 Electron main process；本阶段验收以 `typecheck` 和 `build` 为准。若本阶段新增 Electron dev runner，必须在同一任务内更新 `apps/studio-desktop/package.json`、README 和本验收步骤。
