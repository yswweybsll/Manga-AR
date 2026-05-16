import type { HostInfo } from '@manga-ar/shared';
import { Bonjour, type Service } from 'bonjour-service';

type BonjourLike = {
  publish: (options: {
    name: string;
    type: string;
    port: number;
    txt: {
      hostId: string;
      protocolVersion: string;
      wsPath: string;
    };
  }) => ServiceLike;
  destroy: () => void;
};

type ServiceLike = Pick<Service, 'stop'>;

export class DiscoveryService {
  private readonly createBonjour: () => BonjourLike;
  private bonjour: BonjourLike | null = null;
  private service: ServiceLike | null = null;

  constructor(createBonjour: () => BonjourLike = () => new Bonjour()) {
    this.createBonjour = createBonjour;
  }

  start(hostInfo: HostInfo): void {
    this.stop();
    this.bonjour = this.createBonjour();
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
