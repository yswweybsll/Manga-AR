import type { HostInfo } from '@manga-ar/shared';
import { Bonjour, type Service } from 'bonjour-service';

export class DiscoveryService {
  private bonjour: Bonjour | null = null;
  private service: Service | null = null;

  start(hostInfo: HostInfo): void {
    this.stop();
    this.bonjour = new Bonjour();
    this.service = this.bonjour.publish({
      name: hostInfo.hostName,
      type: 'manga-ar-studio',
      port: hostInfo.httpPort,
      txt: {
        hostId: hostInfo.hostId,
        protocolVersion: hostInfo.protocolVersion,
        wsPath: hostInfo.wsPath,
      },
    });
  }

  stop(): void {
    this.service?.stop?.();
    this.service = null;
    this.bonjour?.destroy();
    this.bonjour = null;
  }
}
