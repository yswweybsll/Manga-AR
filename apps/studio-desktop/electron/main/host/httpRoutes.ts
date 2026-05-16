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
