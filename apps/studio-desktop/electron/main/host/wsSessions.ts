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
