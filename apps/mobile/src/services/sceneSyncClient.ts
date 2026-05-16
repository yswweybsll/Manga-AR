import type {
  ClientOpsMessage,
  HostEventMessage,
  HostSnapshotMessage,
  SceneDocument,
  SceneOp,
  SyncConnectionStatus,
} from '@manga-ar/shared';
import { syncWebSocketUrl, type HostEndpoint } from './hostApi';
import { loadSceneDraft, saveSceneDraft } from './sceneDraftStore';

export type SceneSyncClientOptions = {
  endpoint: HostEndpoint;
  sceneId: string;
  clientId: string;
  initialDocument: SceneDocument;
};

export type SceneSyncClient = {
  connect: () => void;
  disconnect: () => void;
  submitOps: (ops: SceneOp[]) => void;
  onSnapshot: (handler: (message: HostSnapshotMessage) => void) => () => void;
  onEvents: (handler: (message: HostEventMessage) => void) => () => void;
  onStatusChange: (handler: (status: SyncConnectionStatus) => void) => () => void;
  getPendingOps: () => SceneOp[];
};

type SceneSyncWebSocket = WebSocket & {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: string | ArrayBuffer | Blob }) => void) | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneSceneOps(ops: SceneOp[]): SceneOp[] {
  return JSON.parse(JSON.stringify(ops)) as SceneOp[];
}

function isSceneDocumentForScene(value: unknown, sceneId: string): value is SceneDocument {
  return (
    isRecord(value) &&
    value.sceneId === sceneId &&
    Number.isFinite(value.revision) &&
    (typeof value.selectedInstanceId === 'string' || value.selectedInstanceId === null) &&
    Array.isArray(value.instances)
  );
}

function isAcceptedEvent(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === 'op_accepted' &&
    typeof value.opId === 'string' &&
    Number.isFinite(value.revision)
  );
}

function isRejectedReason(value: unknown): boolean {
  return (
    value === 'stale_revision' ||
    value === 'missing_instance' ||
    value === 'missing_asset' ||
    value === 'invalid_op'
  );
}

function isRejectedEvent(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === 'op_rejected' &&
    typeof value.opId === 'string' &&
    isRejectedReason(value.reason) &&
    Number.isFinite(value.authoritativeRevision)
  );
}

function isSceneChangedEvent(value: unknown, sceneId: string): boolean {
  return (
    isRecord(value) &&
    value.type === 'scene_changed' &&
    value.sceneId === sceneId &&
    Number.isFinite(value.revision) &&
    isSceneDocumentForScene(value.document, sceneId)
  );
}

function isHostSnapshotMessage(value: unknown, sceneId: string): value is HostSnapshotMessage {
  return (
    isRecord(value) &&
    value.type === 'host_snapshot' &&
    value.sceneId === sceneId &&
    isSceneDocumentForScene(value.document, sceneId)
  );
}

function isHostEventMessage(value: unknown, sceneId: string): value is HostEventMessage {
  if (
    !isRecord(value) ||
    value.type !== 'host_events' ||
    value.sceneId !== sceneId ||
    !Array.isArray(value.events)
  ) {
    return false;
  }

  return value.events.every(
    (event) => isAcceptedEvent(event) || isRejectedEvent(event) || isSceneChangedEvent(event, sceneId)
  );
}

function parseSyncMessage(data: string | ArrayBuffer | Blob, sceneId: string): HostSnapshotMessage | HostEventMessage | null {
  if (typeof data !== 'string') {
    return null;
  }

  try {
    const message = JSON.parse(data) as unknown;
    if (isHostSnapshotMessage(message, sceneId) || isHostEventMessage(message, sceneId)) {
      return message;
    }

    return null;
  } catch {
    return null;
  }
}

export function createSceneSyncClient(options: SceneSyncClientOptions): SceneSyncClient {
  let ws: SceneSyncWebSocket | null = null;
  let status: SyncConnectionStatus = 'disconnected';
  let currentDocument = options.initialDocument;
  let pendingOps: SceneOp[] = [];
  let connectionGeneration = 0;

  const snapshotHandlers = new Set<(message: HostSnapshotMessage) => void>();
  const eventHandlers = new Set<(message: HostEventMessage) => void>();
  const statusHandlers = new Set<(status: SyncConnectionStatus) => void>();

  function setStatus(nextStatus: SyncConnectionStatus): void {
    status = nextStatus;
    statusHandlers.forEach((handler) => handler(status));
  }

  function rememberDraft(): void {
    void saveSceneDraft({
      sceneId: options.sceneId,
      updatedAt: Date.now(),
      lastSnapshot: currentDocument,
      pendingOps: cloneSceneOps(pendingOps),
    }).catch(() => {
      setStatus('error');
    });
  }

  function sendOps(ops: SceneOp[]): void {
    if (!ws || ws.readyState !== WebSocket.OPEN || ops.length === 0) {
      return;
    }

    const message: ClientOpsMessage = {
      type: 'client_ops',
      sceneId: options.sceneId,
      timestamp: Date.now(),
      clientId: options.clientId,
      role: 'mobile',
      ops: cloneSceneOps(ops),
    };

    ws.send(JSON.stringify(message));
  }

  function flushPendingOps(): void {
    sendOps(pendingOps);
  }

  function handleSnapshot(message: HostSnapshotMessage): void {
    currentDocument = message.document;
    rememberDraft();
    snapshotHandlers.forEach((handler) => handler(message));
  }

  function handleEvents(message: HostEventMessage): void {
    const resolvedOpIds = new Set(
      message.events
        .filter((event) => event.type === 'op_accepted' || event.type === 'op_rejected')
        .map((event) => event.opId)
    );
    pendingOps = pendingOps.filter((operation) => !resolvedOpIds.has(operation.opId));

    const sceneChangedEvent = message.events.find((event) => event.type === 'scene_changed');
    if (sceneChangedEvent?.type === 'scene_changed') {
      currentDocument = sceneChangedEvent.document;
    }

    rememberDraft();
    eventHandlers.forEach((handler) => handler(message));
  }

  function handleMessage(event: { data: string | ArrayBuffer | Blob }): void {
    const message = parseSyncMessage(event.data, options.sceneId);
    if (!message) {
      setStatus('error');
      return;
    }

    if (message.type === 'host_snapshot') {
      handleSnapshot(message);
      return;
    }

    if (message.type === 'host_events') {
      handleEvents(message);
    }
  }

  function detachSocket(socket: SceneSyncWebSocket): void {
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
  }

  function createSocket(generation: number): void {
    if (generation !== connectionGeneration) {
      return;
    }

    if (ws) {
      const previousSocket = ws;
      detachSocket(previousSocket);
      previousSocket.close();
      ws = null;
    }

    const socket = new WebSocket(
      syncWebSocketUrl(options.endpoint, options.sceneId)
    ) as SceneSyncWebSocket;
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) {
        return;
      }

      setStatus('connected');
      flushPendingOps();
    };

    socket.onclose = () => {
      if (ws === socket) {
        ws = null;
      }
      setStatus('disconnected');
    };

    socket.onerror = () => {
      setStatus('error');
    };

    socket.onmessage = handleMessage;
  }

  async function openConnection(generation: number): Promise<void> {
    const draft = await loadSceneDraft(options.sceneId);
    if (generation !== connectionGeneration) {
      return;
    }

    if (draft) {
      currentDocument = draft.lastSnapshot;
      pendingOps = cloneSceneOps(draft.pendingOps);
    }

    createSocket(generation);
  }

  function connect(): void {
    connectionGeneration += 1;
    const generation = connectionGeneration;

    if (ws) {
      const previousSocket = ws;
      detachSocket(previousSocket);
      previousSocket.close();
      ws = null;
    }

    setStatus('connecting');
    void openConnection(generation).catch(() => {
      if (generation === connectionGeneration) {
        setStatus('error');
      }
    });
  }

  function disconnect(): void {
    connectionGeneration += 1;
    if (ws) {
      const socket = ws;
      ws = null;
      detachSocket(socket);
      socket.close();
    }
    setStatus('disconnected');
  }

  function submitOps(ops: SceneOp[]): void {
    if (ops.length === 0) {
      return;
    }

    const submittedOps = cloneSceneOps(ops);
    pendingOps = [...pendingOps, ...submittedOps];
    rememberDraft();
    sendOps(submittedOps);
  }

  return {
    connect,
    disconnect,
    submitOps,
    onSnapshot: (handler) => {
      snapshotHandlers.add(handler);
      return () => {
        snapshotHandlers.delete(handler);
      };
    },
    onEvents: (handler) => {
      eventHandlers.add(handler);
      return () => {
        eventHandlers.delete(handler);
      };
    },
    onStatusChange: (handler) => {
      statusHandlers.add(handler);
      return () => {
        statusHandlers.delete(handler);
      };
    },
    getPendingOps: () => cloneSceneOps(pendingOps),
  };
}
