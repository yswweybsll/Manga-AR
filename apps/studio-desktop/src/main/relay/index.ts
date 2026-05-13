export type DesktopRelayState = {
  enabled: boolean;
  port: number;
};

export function createInitialRelayState(port = 3001): DesktopRelayState {
  return {
    enabled: false,
    port,
  };
}
