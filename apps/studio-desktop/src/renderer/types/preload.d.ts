type RendererHostServerState = {
  running: boolean;
  hostInfo: {
    hostId: string;
    hostName: string;
    protocolVersion: '2026-05-16';
    httpPort: number;
    wsPath: '/sync';
  };
  addresses: string[];
};

declare global {
  interface Window {
    mangaArStudio: {
      appName: string;
      host: {
        getState: () => Promise<RendererHostServerState | null>;
      };
    };
  }
}

export {};
