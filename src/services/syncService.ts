/**
 * syncService.ts
 * 手机端 WebSocket 推送服务
 *
 * 职责：
 * 1. 管理 WebSocket 连接（自动重连 + 心跳）
 * 2. 将 AR 场景状态（instances）节流推送给电脑端
 * 3. 接收电脑端的编辑锁 / 增量更新消息
 * 4. 暴露连接状态供 UI 显示
 *
 * 用法：
 *   const svc = createSyncService({ serverUrl: 'ws://192.168.1.x:3001', sessionId: 'room1' });
 *   svc.connect();
 *   svc.pushSnapshot(instances, selectedId);  // 每次 instances 变化时调用
 *   svc.onMessage((msg) => { ... });          // 接收电脑端消息
 *   svc.disconnect();
 */

import type { SceneModelInstance } from '../types/model';
import type {
  SyncConnectionStatus,
  SyncMessage,
  SyncModelInstance,
  SyncServiceConfig,
  SceneSnapshotMessage,
} from '../types/sync';

// ─────────────────────────────────────────────
// 内部工具：节流函数
// ─────────────────────────────────────────────
function throttle<T extends (...args: Parameters<T>) => void>(
  fn: T,
  intervalMs: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = intervalMs - (now - lastCall);

    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      lastCall = now;
      fn(...args);
    } else {
      if (timer) clearTimeout(timer);
      // 保证最后一次调用一定会被发出
      timer = setTimeout(() => {
        lastCall = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  };
}

// ─────────────────────────────────────────────
// 将 SceneModelInstance 转为 SyncModelInstance
// （补充 syncVersion，首次默认为 0）
// ─────────────────────────────────────────────
function toSyncInstance(
  instance: SceneModelInstance,
  versionMap: Map<string, number>
): SyncModelInstance {
  const version = versionMap.get(instance.instanceId) ?? 0;
  return {
    ...instance,
    syncVersion: version,
  };
}

// ─────────────────────────────────────────────
// SyncService 公开接口
// ─────────────────────────────────────────────
export type SyncService = {
  /** 建立 WebSocket 连接 */
  connect: () => void;
  /** 主动断开连接（不再自动重连） */
  disconnect: () => void;
  /** 推送场景快照（节流，内部自动控制频率） */
  pushSnapshot: (
    instances: SceneModelInstance[],
    selectedInstanceId: string | null
  ) => void;
  /** 注册消息监听器，返回取消函数 */
  onMessage: (handler: (msg: SyncMessage) => void) => () => void;
  /** 注册连接状态变化监听器，返回取消函数 */
  onStatusChange: (handler: (status: SyncConnectionStatus) => void) => () => void;
  /** 获取当前连接状态 */
  getStatus: () => SyncConnectionStatus;
};

// ─────────────────────────────────────────────
// 工厂函数
// ─────────────────────────────────────────────
export function createSyncService(config: SyncServiceConfig): SyncService {
  const {
    serverUrl,
    sessionId,
    reconnectIntervalMs = 3000,
    pingIntervalMs = 5000,
    snapshotThrottleMs = 100,
  } = config;

  let ws: WebSocket | null = null;
  let status: SyncConnectionStatus = 'disconnected';
  let shouldReconnect = true;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setTimeout> | null = null;

  // 版本号 map：instanceId → syncVersion
  const versionMap = new Map<string, number>();

  // 监听器集合
  const messageHandlers = new Set<(msg: SyncMessage) => void>();
  const statusHandlers = new Set<(status: SyncConnectionStatus) => void>();

  // ── 状态变更 ──────────────────────────────
  function setStatus(next: SyncConnectionStatus) {
    if (status === next) return;
    status = next;
    statusHandlers.forEach((h) => h(next));
  }

  // ── 发送 JSON 消息 ────────────────────────
  function send(msg: SyncMessage) {
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        // 发送失败静默忽略，下一次推送会重试
      }
    }
  }

  // ── 心跳 ──────────────────────────────────
  function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
      send({ type: 'ping', timestamp: Date.now() });
    }, pingIntervalMs) as unknown as ReturnType<typeof setTimeout>;
  }

  function stopPing() {
    if (pingTimer) {
      clearInterval(pingTimer as unknown as number);
      pingTimer = null;
    }
  }

  // ── 重连 ──────────────────────────────────
  function scheduleReconnect() {
    if (!shouldReconnect) return;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (shouldReconnect) {
        doConnect();
      }
    }, reconnectIntervalMs);
  }

  // ── 连接 ──────────────────────────────────
  function doConnect() {
    if (ws) {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      try { ws.close(); } catch { /* 忽略 */ }
      ws = null;
    }

    setStatus('connecting');

    try {
      // 把 sessionId 作为查询参数传给服务器，方便服务器区分房间
      ws = new WebSocket(`${serverUrl}?session=${encodeURIComponent(sessionId)}`);
    } catch {
      setStatus('error');
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      setStatus('connected');
      startPing();
    };

    ws.onclose = () => {
      stopPing();
      setStatus('disconnected');
      scheduleReconnect();
    };

    ws.onerror = () => {
      setStatus('error');
      // onclose 会紧随其后触发，由 onclose 负责重连
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as SyncMessage;
        messageHandlers.forEach((h) => h(msg));
      } catch {
        // 非 JSON 消息忽略
      }
    };
  }

  // ── 节流版 pushSnapshot ───────────────────
  const throttledPush = throttle(
    (instances: SceneModelInstance[], selectedInstanceId: string | null) => {
      // 每次推送前递增有变化的实例版本号
      instances.forEach((inst) => {
        versionMap.set(
          inst.instanceId,
          (versionMap.get(inst.instanceId) ?? 0) + 1
        );
      });

      const msg: SceneSnapshotMessage = {
        type: 'scene_snapshot',
        sessionId,
        timestamp: Date.now(),
        instances: instances.map((inst) => toSyncInstance(inst, versionMap)),
        selectedInstanceId,
      };

      send(msg);
    },
    snapshotThrottleMs
  );

  // ─────────────────────────────────────────
  // 公开 API
  // ─────────────────────────────────────────
  return {
    connect() {
      shouldReconnect = true;
      doConnect();
    },

    disconnect() {
      shouldReconnect = false;
      stopPing();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        try { ws.close(); } catch { /* 忽略 */ }
        ws = null;
      }
      setStatus('disconnected');
    },

    pushSnapshot(instances, selectedInstanceId) {
      throttledPush(instances, selectedInstanceId);
    },

    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },

    onStatusChange(handler) {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    },

    getStatus() {
      return status;
    },
  };
}

// ─────────────────────────────────────────────
// 单例模式：整个 App 共享同一个 syncService 实例
// 未配置时为 null，在 ARPlacementScreen 里按需初始化
// ─────────────────────────────────────────────
let _sharedInstance: SyncService | null = null;

export function getSharedSyncService(): SyncService | null {
  return _sharedInstance;
}

export function initSharedSyncService(config: SyncServiceConfig): SyncService {
  if (_sharedInstance) {
    _sharedInstance.disconnect();
  }
  _sharedInstance = createSyncService(config);
  return _sharedInstance;
}

export function destroySharedSyncService(): void {
  if (_sharedInstance) {
    _sharedInstance.disconnect();
    _sharedInstance = null;
  }
}
