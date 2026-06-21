import { ApiClient } from "@/lib/api-client";

/** /api/models 의 모델 1건 (로컬 vLLM 또는 등록된 외부 LLM provider). */
export interface ModelEntry {
  name: string;
  modelId: string;
  description?: string;
  provider: string; // 'local-llm' | providerId(외부, 예: 'openrouter')
  isFree?: boolean;
  available?: boolean;
  capabilities?: Record<string, unknown>;
}

export interface ModelsPayload {
  defaultModel: string;
  models: ModelEntry[];
}

/**
 * GET /api/models — 로컬 vLLM 모델 + 인증 사용자가 등록한 외부 LLM(OpenRouter 등 openai-compatible)
 * provider 의 모델을 합산한 통합 목록. (legacy models-api.js 대응)
 */
export async function fetchModels(): Promise<ModelsPayload> {
  const res = await ApiClient.get<{ success: boolean; data: ModelsPayload }>(
    "/api/models",
  );
  return res?.data ?? { defaultModel: "", models: [] };
}
