/**
 * 모델 배정 API 계약 (2026-09-24) — 역할별·기능별 모델을 합친 슬롯 단위 배정.
 * 사용자: GET/PUT/DELETE /api/users/me/model-assignments[/:slot] · 관리자 전역: /api/admin/model-assignments[/:slot].
 * 응답은 공통 `{ success, data }` 봉투 안의 data 모양이다.
 */

export type ModelSlotGroup = "agents" | "quality" | "multimodal";
export type ModelSlotKind = "text" | "modality";

export interface ModelSlotInfo {
  id: string;
  group: ModelSlotGroup;
  /** text = 채팅 가능 모델에서 고른다 · modality = 전체 모델 목록 */
  kind: ModelSlotKind;
  /** 이 슬롯을 읽는 기존 역할·기능(표시·안내용) */
  roles: string[];
  capabilities: string[];
  /** 저장 가능한 파라미터 키(예: temperature, dimensions) — 없으면 빈 배열 */
  paramKeys: string[];
  /** 실행 가능 여부 — 어댑터가 없는 기능이거나 소유 add-on 이 꺼져 있으면 false */
  available: boolean;
}

export interface ModelSlotAssignment {
  slot: string;
  fullId: string;
  params: Record<string, unknown>;
  updatedAt: string;
}

export interface ModelSlotEffective {
  slot: string;
  /** 지금 실제로 쓰이는 모델 — 해석 실패면 null */
  fullId: string | null;
  source: "user" | "global" | "default" | "none";
  error?: string;
  code?: string;
}

/** GET 응답 — slots 는 화면 순서 */
export interface ModelAssignmentsResponse {
  slots: ModelSlotInfo[];
  assignments: ModelSlotAssignment[];
  effective: ModelSlotEffective[];
}

/** PUT 입력 */
export interface ModelAssignmentInput {
  model: string;
  params?: Record<string, unknown>;
}

/** PUT 응답 */
export interface ModelAssignmentResponse { assignment: ModelSlotAssignment }
