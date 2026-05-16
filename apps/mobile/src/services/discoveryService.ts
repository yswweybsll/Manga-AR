import type { DiscoveredHost } from '@manga-ar/shared';

import { fetchHostInfo, type HostEndpoint } from './hostApi';

export type DiscoveryService = {
  discover: () => Promise<DiscoveredHost[]>;
  rememberManualHost: (endpoint: HostEndpoint) => Promise<DiscoveredHost>;
};

export function createDiscoveryService(): DiscoveryService {
  return {
    async discover() {
      // 当前未接入 React Native mDNS/Bonjour native module，自动发现暂返回空列表，保留手动连接入口。
      return [];
    },

    async rememberManualHost(endpoint) {
      const response = await fetchHostInfo(endpoint);
      return {
        ...response.host,
        address: endpoint.address,
        lastSeenAt: Date.now(),
      };
    },
  };
}
