import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import type { SceneSnapshotMessage, SyncMessage } from '@manga-ar/shared';

import { joinRoom, leaveRoom } from './rooms.js';
import { getSnapshot, rememberSnapshot } from './snapshotStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3001);
const STUDIO_HTML_PATH = path.resolve(__dirname, '../../studio-desktop/prototype/index.html');

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

function sendText(res: http.ServerResponse, statusCode: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.writeHead(statusCode, { 'Content-Type': contentType });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${PORT}`}`);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const host = req.headers.host ?? `localhost:${PORT}`;
    const studioUrl = `http://${host}/studio`;
    const wsUrl = `ws://${host}`;

    sendText(
      res,
      200,
      `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Manga AR Relay</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #09090b; color: #fafafa; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(720px, calc(100vw - 40px)); padding: 28px; border: 1px solid #27272a; border-radius: 20px; background: #18181b; box-shadow: 0 24px 80px rgba(0,0,0,.35); }
    h1 { margin: 0 0 10px; font-size: 28px; }
    p { color: #a1a1aa; line-height: 1.7; }
    a.button { display: inline-flex; margin-top: 16px; padding: 12px 18px; border-radius: 12px; background: #7c3aed; color: #fff; font-weight: 700; text-decoration: none; }
    code { color: #c4b5fd; background: #27272a; padding: 2px 6px; border-radius: 6px; }
  </style>
</head>
<body>
  <main>
    <h1>Manga AR Relay 已启动</h1>
    <p>PC 端工作台入口：<code>${studioUrl}</code></p>
    <p>WebSocket 地址：<code>${wsUrl}</code>，Session 默认可填 <code>room1</code>。</p>
    <a class="button" href="/studio">打开 PC 端 Studio</a>
  </main>
</body>
</html>`,
      'text/html; charset=utf-8'
    );
    return;
  }

  if (url.pathname === '/studio') {
    fs.readFile(STUDIO_HTML_PATH, 'utf8', (err, html) => {
      if (err) {
        sendText(res, 404, `PC Studio 文件不存在: ${STUDIO_HTML_PATH}`);
        return;
      }
      sendText(res, 200, html, 'text/html; charset=utf-8');
    });
    return;
  }

  sendText(res, 404, 'Not Found');
});

const wss = new WebSocketServer({ server });

console.log(`[Relay] 正在启动 WebSocket 中继服务器，端口: ${PORT}...`);

wss.on('connection', (ws, req) => {
  const params = new URLSearchParams(req.url?.split('?')[1]);
  const sessionId = params.get('session') || 'default';

  console.log(`[Relay] 新连接接入，Session: ${sessionId}`);

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
      // 忽略非 JSON 消息
    }
  });

  ws.on('close', () => {
    console.log(`[Relay] 连接关闭，Session: ${sessionId}`);
    leaveRoom(sessionId, ws);
  });

  ws.on('error', (err) => {
    console.error(`[Relay] 连接错误:`, err);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const localAddresses = getLocalIPv4Addresses();

  console.log(`[Relay] 服务器已就绪！监听地址: 0.0.0.0:${PORT}`);
  console.log(`[Relay] PC 端 Studio 本机入口: http://localhost:${PORT}/studio`);

  if (localAddresses.length > 0) {
    console.log('[Relay] 局域网可访问入口:');
    localAddresses.forEach((address) => {
      console.log(`  - Studio: http://${address}:${PORT}/studio`);
      console.log(`    WebSocket: ws://${address}:${PORT}`);
    });
  }

  console.log(`[Relay] 手机端连接配置建议: ws://你的局域网IP:${PORT}，session 使用 room1 或自定义房间号`);
});
