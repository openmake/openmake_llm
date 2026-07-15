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
  /** 이미지 생성 모델 (IMAGE_GEN_MODEL). 채팅 모델 아님 — generate_image 도구 전용. 미설정 시 null. */
  imageModel?: string | null;
}

/**
 * GET /api/models — 로컬 vLLM 모델 + 인증 사용자가 등록한 외부 LLM(OpenRouter 등 openai-compatible)
 * provider 의 모델을 합산한 통합 목록. (legacy models-api.js 대응)
 */
export async function fetchModels(opts?: { usableOnly?: boolean }): Promise<ModelsPayload> {
  // usableOnly: 서버가 채팅 불가(임베딩/이미지)·20B 이하 모델을 제외한 목록을 반환.
  // 기본 모델 선택·역할/에이전트 모델 배정 드롭다운에서 사용.
  const qs = opts?.usableOnly ? "?usableOnly=1" : "";
  const res = await ApiClient.get<{ success: boolean; data: ModelsPayload }>(
    `/api/models${qs}`,
  );
  return res?.data ?? { defaultModel: "", models: [] };
}
