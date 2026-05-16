import assert from 'node:assert/strict';
import test from 'node:test';

import { DiscoveryService } from '../../apps/studio-desktop/electron/main/host/discoveryService.js';

test('DiscoveryService publishes host metadata and tears down the active Bonjour service', () => {
  const stopped: string[] = [];
  let destroyed = 0;
  const published: unknown[] = [];

  const discoveryService = new DiscoveryService(() => ({
    publish(options: unknown) {
      published.push(options);
      return {
        stop() {
          stopped.push('service');
        },
      };
    },
    destroy() {
      destroyed += 1;
    },
  }));

  discoveryService.start({
    hostId: 'host-1',
    hostName: 'Studio Host',
    protocolVersion: '2026-05-16',
    httpPort: 4567,
    wsPath: '/sync',
  });
  discoveryService.stop();

  assert.deepEqual(published, [
    {
      name: 'Studio Host',
      type: 'manga-ar-studio',
      port: 4567,
      txt: {
        hostId: 'host-1',
        protocolVersion: '2026-05-16',
        wsPath: '/sync',
      },
    },
  ]);
  assert.deepEqual(stopped, ['service']);
  assert.equal(destroyed, 1);
});
