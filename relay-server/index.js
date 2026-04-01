/**
 * relay-server/index.js
 * AR + AI 同步中继服务器
 *
 * 职责：接收来自手机端的场景数据，并广播给所有连接的电脑端（或其它手机）。
 */

const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3001;
const server = http.createServer();
const wss = new WebSocketServer({ server });

// 房间管理：Map<sessionId, Set<WebSocket>>
const rooms = new Map();

// 场景快照缓存：Map<sessionId, lastSnapshot>
// 保证电脑端新接入时能立即看到当前场景，而不是等下一次推送
const snapshots = new Map();

console.log(`[Relay] 正在启动 WebSocket 中继服务器，端口: ${PORT}...`);

wss.on('connection', (ws, req) => {
  // 从 URL 参数获取 sessionId，例如 ws://localhost:3001?session=room123
  const params = new URLSearchParams(req.url.split('?')[1]);
  const sessionId = params.get('session') || 'default';

  console.log(`[Relay] 新连接接入，Session: ${sessionId}`);

  // 加入房间
  if (!rooms.has(sessionId)) {
    rooms.set(sessionId, new Set());
  }
  const clients = rooms.get(sessionId);
  clients.add(ws);

  // 如果有缓存的快照，立即发给新连接
  const lastSnapshot = snapshots.get(sessionId);
  if (lastSnapshot) {
    ws.send(JSON.stringify(lastSnapshot));
  }

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      // 如果是场景快照，存入缓存
      if (message.type === 'scene_snapshot') {
        snapshots.set(sessionId, message);
      }

      // 广播给房间内的其它所有人
      const payload = JSON.stringify(message);
      clients.forEach((client) => {
        if (client !== ws && client.readyState === 1 /* OPEN */) {
          client.send(payload);
        }
      });
    } catch (e) {
      // 忽略非 JSON 消息
    }
  });

  ws.on('close', () => {
    console.log(`[Relay] 连接关闭，Session: ${sessionId}`);
    clients.delete(ws);
    if (clients.size === 0) {
      rooms.delete(sessionId);
      // 可选：房间没人了是否清理快照？通常建议保留一段时间
    }
  });

  ws.on('error', (err) => {
    console.error(`[Relay] 连接错误:`, err);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Relay] 服务器已就绪！监听地址: 0.0.0.0:${PORT}`);
  console.log(`[Relay] 手机端连接配置建议: ws://你的局域网IP:${PORT}?session=你的房间号`);
});
