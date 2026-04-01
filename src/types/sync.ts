/**
 * sync.ts
 * 双端协作同步消息类型定义
 *
 * 手机端（AR摆pose）→ WebSocket → 电脑端（精细调整 / 渲染 / AI漫画化）
 */

import type { SceneModelInstance } from './model';

// ─────────────────────────────────────────────
// 编辑锁：标记哪一端正在精调某个模型
// ─────────────────────────────────────────────
export type SyncLockOwner = 'phone' | 'desktop';

// ─────────────────────────────────────────────
// 带锁信息的模型实例（同步用，不改原始类型）
// ─────────────────────────────────────────────
export type SyncModelInstance = SceneModelInstance & {
  /** 哪一端持有编辑锁；undefined 表示未锁定 */
  lockedBy?: SyncLockOwner;
  /** 乐观锁版本号，每次修改 +1，用于丢弃过期消息 */
  syncVersion: number;
};

// ─────────────────────────────────────────────
// WebSocket 消息类型枚举
// ─────────────────────────────────────────────
export type SyncMessageType =
  | 'scene_snapshot'   // 手机端推送完整场景快照
  | 'instance_update'  // 单个实例增量更新
  | 'instance_delete'  // 删除实例
  | 'lock_acquire'     // 申请编辑锁
  | 'lock_release'     // 释放编辑锁
  | 'ping'             // 心跳
  | 'pong';            // 心跳回应

// ─────────────────────────────────────────────
// 消息体定义
// ─────────────────────────────────────────────

/** 完整场景快照：手机每次 instances 变化时推送 */
export type SceneSnapshotMessage = {
  type: 'scene_snapshot';
  sessionId: string;
  timestamp: number;
  instances: SyncModelInstance[];
  selectedInstanceId: string | null;
};

/** 单实例增量更新 */
export type InstanceUpdateMessage = {
  type: 'instance_update';
  sessionId: string;
  timestamp: number;
  instance: SyncModelInstance;
};

/** 删除实例 */
export type InstanceDeleteMessage = {
  type: 'instance_delete';
  sessionId: string;
  timestamp: number;
  instanceId: string;
};

/** 申请 / 释放编辑锁 */
export type LockMessage = {
  type: 'lock_acquire' | 'lock_release';
  sessionId: string;
  timestamp: number;
  instanceId: string;
  owner: SyncLockOwner;
};

/** 心跳 */
export type PingMessage = { type: 'ping'; timestamp: number };
export type PongMessage = { type: 'pong'; timestamp: number };

/** 所有消息的联合类型 */
export type SyncMessage =
  | SceneSnapshotMessage
  | InstanceUpdateMessage
  | InstanceDeleteMessage
  | LockMessage
  | PingMessage
  | PongMessage;

// ─────────────────────────────────────────────
// syncService 连接状态
// ─────────────────────────────────────────────
export type SyncConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

// ─────────────────────────────────────────────
// syncService 配置
// ─────────────────────────────────────────────
export type SyncServiceConfig = {
  /** WebSocket 服务器地址，例如 ws://192.168.1.100:3001 */
  serverUrl: string;
  /** 当前会话 ID，同一局域网的手机和电脑用同一个 sessionId 接入同一房间 */
  sessionId: string;
  /** 连接断开后自动重连间隔（毫秒），默认 3000 */
  reconnectIntervalMs?: number;
  /** 心跳间隔（毫秒），默认 5000 */
  pingIntervalMs?: number;
  /** 场景快照节流间隔（毫秒），默认 100，避免高频推送 */
  snapshotThrottleMs?: number;
};
