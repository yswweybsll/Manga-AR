import type {
  AssetManifestResponse,
  HostInfoResponse,
  SceneListResponse,
  SceneResponse,
  SubmitSceneOpsRequest,
  SubmitSceneOpsResponse,
} from '@manga-ar/shared';

export type HostEndpoint = {
  address: string;
  port: number;
};

function baseUrl(endpoint: HostEndpoint): string {
  return `http://${endpoint.address}:${endpoint.port}`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`请求失败 ${response.status}: ${url}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchHostInfo(endpoint: HostEndpoint): Promise<HostInfoResponse> {
  return getJson<HostInfoResponse>(`${baseUrl(endpoint)}/host/info`);
}

export async function fetchScenes(endpoint: HostEndpoint): Promise<SceneListResponse> {
  return getJson<SceneListResponse>(`${baseUrl(endpoint)}/scenes`);
}

export async function fetchScene(endpoint: HostEndpoint, sceneId: string): Promise<SceneResponse> {
  return getJson<SceneResponse>(`${baseUrl(endpoint)}/scenes/${encodeURIComponent(sceneId)}`);
}

export async function fetchSceneAssets(endpoint: HostEndpoint, sceneId: string): Promise<AssetManifestResponse> {
  return getJson<AssetManifestResponse>(`${baseUrl(endpoint)}/scenes/${encodeURIComponent(sceneId)}/assets`);
}

export async function submitSceneOps(
  endpoint: HostEndpoint,
  sceneId: string,
  request: SubmitSceneOpsRequest
): Promise<SubmitSceneOpsResponse> {
  const response = await fetch(`${baseUrl(endpoint)}/scenes/${encodeURIComponent(sceneId)}/ops`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`提交场景操作失败 ${response.status}`);
  }

  return response.json() as Promise<SubmitSceneOpsResponse>;
}

export function assetFileUrl(endpoint: HostEndpoint, assetId: string): string {
  return `${baseUrl(endpoint)}/assets/${encodeURIComponent(assetId)}/file`;
}

export function syncWebSocketUrl(endpoint: HostEndpoint, sceneId: string): string {
  return `ws://${endpoint.address}:${endpoint.port}/sync?sceneId=${encodeURIComponent(sceneId)}`;
}
