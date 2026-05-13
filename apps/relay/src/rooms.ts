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
