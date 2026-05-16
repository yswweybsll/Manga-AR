import assert from 'node:assert/strict';
import test from 'node:test';

import type { SceneDocument, SceneOp, SyncMessage } from '../../shared/src/index.js';
import { createSceneSyncClient } from '../../apps/mobile/src/services/sceneSyncClient.ts';

type DraftWrite = {
  path: string;
  text: string;
};

type WebSocketMessageEvent = {
  data: string;
};

type WebSocketCloseEvent = {
  code: number;
  reason: string;
};

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((event: WebSocketCloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: WebSocketMessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: 'closed' });
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(message: SyncMessage | string): void {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    this.onmessage?.({ data });
  }
}

function installFakeWebSocket(): void {
  FakeWebSocket.instances = [];
  (globalThis as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket;
}

function resetDraftWrites(): void {
  const globalState = globalThis as unknown as {
    __sceneDraftWrites: DraftWrite[];
    __sceneDraftWriteError: boolean;
    __expoFileSystemFiles: Map<string, Uint8Array>;
  };
  globalState.__sceneDraftWrites = [];
  globalState.__sceneDraftWriteError = false;
  globalState.__expoFileSystemFiles = new Map();
}

function draftWrites(): DraftWrite[] {
  return (globalThis as unknown as { __sceneDraftWrites: DraftWrite[] }).__sceneDraftWrites;
}

function latestDraft(): { sceneId: string; pendingOps: SceneOp[]; lastSnapshot: SceneDocument } {
  const writes = draftWrites();
  assert.ok(writes.length > 0);
  return JSON.parse(writes.at(-1)?.text ?? '{}') as {
    sceneId: string;
    pendingOps: SceneOp[];
    lastSnapshot: SceneDocument;
  };
}

function initialDocument(revision = 0): SceneDocument {
  return {
    sceneId: 'scene-1',
    revision,
    selectedInstanceId: null,
    instances: [],
  };
}

function selectOp(opId: string, baseRevision = 0): SceneOp {
  return {
    opId,
    type: 'select_instance',
    baseRevision,
    instanceId: null,
  };
}

function waitForMicrotask(): Promise<void> {
  return new Promise((resolve) => {
    queueMicrotask(resolve);
  });
}

async function waitForSocket(): Promise<FakeWebSocket> {
  await waitForMicrotask();
  await waitForMicrotask();
  const socket = FakeWebSocket.instances[0];
  assert.ok(socket);
  return socket;
}

function draftPath(sceneId: string): string {
  const encodedSceneId = encodeURIComponent(sceneId).replace(/[!'()*.-]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );

  return `memory://document/scene-drafts/${encodedSceneId || '%00'}.json`;
}

function seedDraft(draft: {
  sceneId: string;
  pendingOps: SceneOp[];
  lastSnapshot: SceneDocument;
}): void {
  const files = (globalThis as unknown as { __expoFileSystemFiles: Map<string, Uint8Array> })
    .__expoFileSystemFiles;
  files.set(
    draftPath(draft.sceneId),
    new TextEncoder().encode(
      JSON.stringify({
        ...draft,
        updatedAt: 123,
      }),
    ),
  );
}

test.beforeEach(() => {
  installFakeWebSocket();
  resetDraftWrites();
});

test('queues ops before connect and flushes them on open without exposing pending state', async () => {
  const client = createSceneSyncClient({
    endpoint: { address: '127.0.0.1', port: 19100 },
    sceneId: 'scene-1',
    clientId: 'mobile-a',
    initialDocument: initialDocument(),
  });

  const statusChanges: string[] = [];
  const unsubscribe = client.onStatusChange((status) => statusChanges.push(status));
  unsubscribe();

  client.submitOps([selectOp('op-1')]);
  const exposedPending = client.getPendingOps();
  exposedPending.length = 0;

  client.connect();
  const ws = await waitForSocket();
  assert.equal(ws.url, 'ws://127.0.0.1:19100/sync?sceneId=scene-1');

  ws.open();

  assert.deepEqual(statusChanges, []);
  assert.equal(ws.sent.length, 1);
  const sentMessage = JSON.parse(ws.sent[0]) as SyncMessage;
  assert.equal(sentMessage.type, 'client_ops');
  assert.equal(sentMessage.clientId, 'mobile-a');
  assert.equal(sentMessage.role, 'mobile');
  assert.deepEqual(sentMessage.ops.map((op) => op.opId), ['op-1']);
  assert.deepEqual(client.getPendingOps().map((op) => op.opId), ['op-1']);
  assert.deepEqual(latestDraft().pendingOps.map((op) => op.opId), ['op-1']);
});

test('host_snapshot keeps pending ops until explicit accept or reject events resolve them', async () => {
  const client = createSceneSyncClient({
    endpoint: { address: '127.0.0.1', port: 19100 },
    sceneId: 'scene-1',
    clientId: 'mobile-a',
    initialDocument: initialDocument(),
  });
  const snapshots: SceneDocument[] = [];
  client.onSnapshot((message) => snapshots.push(message.document));

  client.submitOps([selectOp('op-1')]);
  client.connect();
  const ws = await waitForSocket();
  ws.open();

  const document = initialDocument(2);
  ws.receive({
    type: 'host_snapshot',
    sceneId: 'scene-1',
    timestamp: 10,
    document,
    assets: [],
  });

  assert.equal(ws.sent.length, 1);
  assert.deepEqual(client.getPendingOps().map((op) => op.opId), ['op-1']);
  assert.deepEqual(snapshots, [document]);
  assert.equal(latestDraft().lastSnapshot.revision, 2);
  assert.deepEqual(latestDraft().pendingOps.map((op) => op.opId), ['op-1']);

  ws.receive({
    type: 'host_events',
    sceneId: 'scene-1',
    timestamp: 20,
    events: [
      {
        type: 'op_accepted',
        opId: 'op-1',
        revision: 3,
      },
    ],
  });

  assert.deepEqual(client.getPendingOps(), []);
  assert.deepEqual(latestDraft().pendingOps, []);
});

test('connect restores saved draft before opening the socket and replays pending ops', async () => {
  seedDraft({
    sceneId: 'scene-1',
    lastSnapshot: initialDocument(5),
    pendingOps: [selectOp('op-draft', 5)],
  });
  const client = createSceneSyncClient({
    endpoint: { address: '127.0.0.1', port: 19100 },
    sceneId: 'scene-1',
    clientId: 'mobile-a',
    initialDocument: initialDocument(),
  });

  client.connect();
  assert.equal(FakeWebSocket.instances.length, 0);

  await waitForMicrotask();
  await waitForMicrotask();

  const ws = FakeWebSocket.instances[0];
  assert.deepEqual(client.getPendingOps().map((op) => op.opId), ['op-draft']);

  ws.open();

  assert.equal(ws.sent.length, 1);
  const sentMessage = JSON.parse(ws.sent[0]) as SyncMessage;
  assert.equal(sentMessage.type, 'client_ops');
  assert.deepEqual(sentMessage.ops.map((op) => op.opId), ['op-draft']);
  assert.equal(sentMessage.ops[0].baseRevision, 5);
});

test('host_events removes accepted pending ops, applies scene_changed, saves draft, and notifies handlers', async () => {
  const client = createSceneSyncClient({
    endpoint: { address: '127.0.0.1', port: 19100 },
    sceneId: 'scene-1',
    clientId: 'mobile-a',
    initialDocument: initialDocument(),
  });
  const events: string[][] = [];
  client.onEvents((message) => events.push(message.events.map((event) => event.type)));

  client.submitOps([selectOp('op-1'), selectOp('op-2')]);
  client.connect();
  const ws = await waitForSocket();
  ws.open();

  const document = initialDocument(3);
  ws.receive({
    type: 'host_events',
    sceneId: 'scene-1',
    timestamp: 20,
    events: [
      {
        type: 'op_accepted',
        opId: 'op-1',
        revision: 1,
      },
      {
        type: 'scene_changed',
        sceneId: 'scene-1',
        revision: 3,
        document,
      },
    ],
  });

  assert.deepEqual(client.getPendingOps().map((op) => op.opId), ['op-2']);
  assert.deepEqual(events, [['op_accepted', 'scene_changed']]);
  assert.equal(latestDraft().lastSnapshot.revision, 3);
  assert.deepEqual(latestDraft().pendingOps.map((op) => op.opId), ['op-2']);
});

test('host_events removes rejected pending ops so they are not replayed forever', async () => {
  const client = createSceneSyncClient({
    endpoint: { address: '127.0.0.1', port: 19100 },
    sceneId: 'scene-1',
    clientId: 'mobile-a',
    initialDocument: initialDocument(),
  });

  client.submitOps([selectOp('op-1'), selectOp('op-2')]);
  client.connect();
  const ws = await waitForSocket();
  ws.open();

  ws.receive({
    type: 'host_events',
    sceneId: 'scene-1',
    timestamp: 20,
    events: [
      {
        type: 'op_rejected',
        opId: 'op-1',
        reason: 'invalid_op',
        authoritativeRevision: 0,
      },
    ],
  });

  assert.deepEqual(client.getPendingOps().map((op) => op.opId), ['op-2']);
  assert.deepEqual(latestDraft().pendingOps.map((op) => op.opId), ['op-2']);
});

test('invalid inbound messages set error without mutating pending ops or draft', async () => {
  const client = createSceneSyncClient({
    endpoint: { address: '127.0.0.1', port: 19100 },
    sceneId: 'scene-1',
    clientId: 'mobile-a',
    initialDocument: initialDocument(),
  });
  const statusChanges: string[] = [];
  const snapshots: SceneDocument[] = [];
  client.onStatusChange((status) => statusChanges.push(status));
  client.onSnapshot((message) => snapshots.push(message.document));

  client.submitOps([selectOp('op-1')]);
  const draftCount = draftWrites().length;
  client.connect();
  const ws = await waitForSocket();
  ws.open();

  ws.receive({
    type: 'host_snapshot',
    sceneId: 'other-scene',
    timestamp: 10,
    document: {
      ...initialDocument(2),
      sceneId: 'other-scene',
    },
    assets: [],
  });
  ws.receive({
    type: 'host_events',
    sceneId: 'scene-1',
    timestamp: 20,
    events: 'not-an-array',
  } as unknown as SyncMessage);

  assert.deepEqual(client.getPendingOps().map((op) => op.opId), ['op-1']);
  assert.equal(draftWrites().length, draftCount);
  assert.deepEqual(snapshots, []);
  assert.deepEqual(statusChanges, ['connecting', 'connected', 'error', 'error']);
});

test('same-scene host_snapshot with malformed document is rejected without clearing pending or saving draft', async () => {
  const client = createSceneSyncClient({
    endpoint: { address: '127.0.0.1', port: 19100 },
    sceneId: 'scene-1',
    clientId: 'mobile-a',
    initialDocument: initialDocument(),
  });
  const statusChanges: string[] = [];
  const snapshots: SceneDocument[] = [];
  client.onStatusChange((status) => statusChanges.push(status));
  client.onSnapshot((message) => snapshots.push(message.document));

  client.submitOps([selectOp('op-1')]);
  const draftCount = draftWrites().length;
  client.connect();
  const ws = await waitForSocket();
  ws.open();

  ws.receive({
    type: 'host_snapshot',
    sceneId: 'scene-1',
    timestamp: 10,
    document: {
      sceneId: 'scene-1',
      selectedInstanceId: null,
      instances: [],
    },
    assets: [],
  } as unknown as SyncMessage);

  assert.deepEqual(client.getPendingOps().map((op) => op.opId), ['op-1']);
  assert.equal(draftWrites().length, draftCount);
  assert.deepEqual(snapshots, []);
  assert.deepEqual(statusChanges, ['connecting', 'connected', 'error']);
});

test('same-scene scene_changed with malformed document is rejected without clearing pending or saving draft', async () => {
  const client = createSceneSyncClient({
    endpoint: { address: '127.0.0.1', port: 19100 },
    sceneId: 'scene-1',
    clientId: 'mobile-a',
    initialDocument: initialDocument(),
  });
  const statusChanges: string[] = [];
  const events: string[][] = [];
  client.onStatusChange((status) => statusChanges.push(status));
  client.onEvents((message) => events.push(message.events.map((event) => event.type)));

  client.submitOps([selectOp('op-1')]);
  const draftCount = draftWrites().length;
  client.connect();
  const ws = await waitForSocket();
  ws.open();

  ws.receive({
    type: 'host_events',
    sceneId: 'scene-1',
    timestamp: 20,
    events: [
      {
        type: 'scene_changed',
        sceneId: 'scene-1',
        revision: 2,
        document: {
          sceneId: 'scene-1',
          revision: 2,
          selectedInstanceId: 42,
          instances: [],
        },
      },
    ],
  } as unknown as SyncMessage);

  assert.deepEqual(client.getPendingOps().map((op) => op.opId), ['op-1']);
  assert.equal(draftWrites().length, draftCount);
  assert.deepEqual(events, []);
  assert.deepEqual(statusChanges, ['connecting', 'connected', 'error']);
});

test('submitting ops while connected sends only the new ops', async () => {
  const client = createSceneSyncClient({
    endpoint: { address: '127.0.0.1', port: 19100 },
    sceneId: 'scene-1',
    clientId: 'mobile-a',
    initialDocument: initialDocument(),
  });

  client.connect();
  const ws = await waitForSocket();
  ws.open();

  client.submitOps([selectOp('op-1')]);
  client.submitOps([selectOp('op-2')]);

  assert.equal(ws.sent.length, 2);
  const firstMessage = JSON.parse(ws.sent[0]) as SyncMessage;
  const secondMessage = JSON.parse(ws.sent[1]) as SyncMessage;
  assert.equal(firstMessage.type, 'client_ops');
  assert.equal(secondMessage.type, 'client_ops');
  assert.deepEqual(firstMessage.ops.map((op) => op.opId), ['op-1']);
  assert.deepEqual(secondMessage.ops.map((op) => op.opId), ['op-2']);
});

test('getPendingOps and submitOps do not share op object references with callers', () => {
  const client = createSceneSyncClient({
    endpoint: { address: '127.0.0.1', port: 19100 },
    sceneId: 'scene-1',
    clientId: 'mobile-a',
    initialDocument: initialDocument(),
  });
  const operation = selectOp('op-1');

  client.submitOps([operation]);
  operation.baseRevision = 99;
  const exposedPending = client.getPendingOps();
  exposedPending[0].baseRevision = 123;

  assert.equal(client.getPendingOps()[0].baseRevision, 0);
  assert.equal(latestDraft().pendingOps[0].baseRevision, 0);
});

test('draft save failures set error status without creating unhandled rejection', async () => {
  const client = createSceneSyncClient({
    endpoint: { address: '127.0.0.1', port: 19100 },
    sceneId: 'scene-1',
    clientId: 'mobile-a',
    initialDocument: initialDocument(),
  });
  const statusChanges: string[] = [];
  client.onStatusChange((status) => statusChanges.push(status));
  (globalThis as unknown as { __sceneDraftWriteError: boolean }).__sceneDraftWriteError = true;

  client.submitOps([selectOp('op-1')]);
  await waitForMicrotask();

  assert.deepEqual(statusChanges, ['error']);
});

test('malformed WebSocket messages set error status without throwing', async () => {
  const client = createSceneSyncClient({
    endpoint: { address: '127.0.0.1', port: 19100 },
    sceneId: 'scene-1',
    clientId: 'mobile-a',
    initialDocument: initialDocument(),
  });
  const statusChanges: string[] = [];
  client.onStatusChange((status) => statusChanges.push(status));

  client.connect();
  const ws = await waitForSocket();

  assert.doesNotThrow(() => {
    ws.receive('{bad json');
  });

  assert.deepEqual(statusChanges, ['connecting', 'error']);
});
