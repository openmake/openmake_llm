/**
 * 모델 배정 UI 상수 — 역할·기능을 합친 슬롯 단위 배정 화면(사용자 설정·관리자 전역 공용).
 * 서버 계약은 packages/shared-types/src/model-assignments.ts, 슬롯 정의는 apps/api/src/config/model-slots.ts.
 */
import type { ModelSlotGroup } from "@openmake/shared-types";

/** 배정 미지정 select 값 — 전역/기본값으로 자동 해석됨 */
export const DEFAULT_VALUE = "";

/** 그룹 렌더 순서(서버 slots 는 이미 화면 순서지만 그룹 묶음 순서는 이 배열로 고정) */
export const GROUP_ORDER: readonly ModelSlotGroup[] = ["agents", "quality", "multimodal"];

/** 배정 params 값 1개의 최대 길이 — 백엔드 PARAM_VALUE_MAX_CHARS 와 동일하게 유지 */
export const PARAM_VALUE_MAX_CHARS = 64;

/** 드롭다운 최소 폭 — 다른 설정 select 와 맞춘다 */
export const SELECT_MIN_WIDTH_CLASS = "min-w-52";
