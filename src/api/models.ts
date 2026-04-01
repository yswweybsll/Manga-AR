import { mockModels } from '../mock/models';
import type { RemoteModel } from '../types/model';

// 有真实后端后，把这里替换成你的接口域名，例如 https://api.example.com
const MODEL_API_BASE_URL = '';

type ModelsResponse = {
  items?: RemoteModel[];
};

export async function fetchModels(): Promise<RemoteModel[]> {
  if (!MODEL_API_BASE_URL) {
    return mockModels;
  }

  const response = await fetch(`${MODEL_API_BASE_URL}/api/models`);
  if (!response.ok) {
    throw new Error(`模型列表请求失败: ${response.status}`);
  }

  const data = (await response.json()) as ModelsResponse;
  return data.items ?? [];
}
