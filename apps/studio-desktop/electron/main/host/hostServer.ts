import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

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
    this.sceneRepository = new SceneRepository({ rootDir: path.join(options.dataDir, 'scenes') });
    this.assetRepository = new AssetRepository({ rootDir: path.join(options.dataDir, 'assets') });
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
