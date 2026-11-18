/**
 * 저장된 기본 모델 판정 계약 (2026-11-18) — `GET /api/models` 응답의 `defaultModelSelection`.
 * 서버가 "저장한 기본 모델을 지금 쓸 수 있는가, 못 쓰면 무엇으로 답하는가" 를 판정하고 웹은 적용·표시만 한다.
 */

/** auto = 자동(서버 기본값) 선택 · ok = 저장한 모델 그대로 · 나머지 = 못 써서 자동으로 답한다(사유) */
export type DefaultModelStatus = "auto" | "ok" | "key_disabled" | "key_missing" | "unusable" | "not_listed";

export interface DefaultModelSelection {
  /** 선호 defaultModel 원문 — 저장한 적 없으면 null */
  saved: string | null;
  /** 지금 보낼 값 — saved 또는 'default' */
  effective: string;
  status: DefaultModelStatus;
}
