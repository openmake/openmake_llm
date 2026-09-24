/**
 * 모델 배정 슬롯 — 역할별 모델(ModelRole)과 기능별 모델(Capability)을 하나로 합친 **유일한 배정 정의** (2026-09-24).
 *
 * 종전엔 같은 성격의 모델을 두 화면에서 따로 골랐다(코드 리뷰 역할 ↔ 코드 기능, 딥리서치 역할 ↔ 추론 기능).
 * 이제 배정의 단위는 슬롯이고, 역할·기능은 "어느 슬롯을 읽는지" 로만 남는다(소비 코드는 그대로 role/capability 로 부른다).
 * 저장은 `model_assignments`(scope, slot) 한 테이블(170). 이 표의 역할·기능 → 슬롯 대응은 170 마이그레이션의 CASE 와 짝이다
 * (`model-slots.test.ts` 가 고정).
 *
 * - kind: text = 대화형 텍스트 모델(채팅 가능 모델 목록에서 고른다) · modality = 미디어·특수 모델(전체 목록)
 * - group: 설정 화면의 묶음(agents 대화·에이전트 / quality 검증·요약·코드 / multimodal 계획·미디어)
 * - userAssignable=false 는 서버 기본값·관리자 전역 배정만 쓰는 내부 슬롯(화면에 내지 않는다)
 *
 * @module config/model-slots
 */
import type { Capability } from './capabilities';
import type { ModelRole } from './model-roles';

export type ModelSlotGroup = 'agents' | 'quality' | 'multimodal';
export type ModelSlotKind = 'text' | 'modality';

export interface ModelSlotDef {
    id: string;
    group: ModelSlotGroup | null;
    kind: ModelSlotKind;
    /** 이 슬롯을 읽는 역할 */
    roles: readonly ModelRole[];
    /** 이 슬롯을 읽는 기능 */
    capabilities: readonly Capability[];
    userAssignable: boolean;
}

export const MODEL_SLOTS: readonly ModelSlotDef[] = [
    // 대화·에이전트
    { id: 'agent', group: 'agents', kind: 'text', roles: ['agent'], capabilities: [], userAssignable: true },
    { id: 'spawn', group: 'agents', kind: 'text', roles: ['spawn'], capabilities: [], userAssignable: true },
    { id: 'reasoning', group: 'agents', kind: 'text', roles: ['research'], capabilities: ['text.reason'], userAssignable: true },
    // 검증·요약·코드
    { id: 'judge', group: 'quality', kind: 'text', roles: ['judge'], capabilities: [], userAssignable: true },
    { id: 'code', group: 'quality', kind: 'text', roles: ['review'], capabilities: ['text.code'], userAssignable: true },
    { id: 'summary', group: 'quality', kind: 'text', roles: ['summary'], capabilities: [], userAssignable: true },
    // 계획·미디어
    { id: 'planner', group: 'multimodal', kind: 'text', roles: ['planner'], capabilities: [], userAssignable: true },
    { id: 'vision.describe', group: 'multimodal', kind: 'modality', roles: [], capabilities: ['vision.describe'], userAssignable: true },
    { id: 'vision.ocr', group: 'multimodal', kind: 'modality', roles: [], capabilities: ['vision.ocr'], userAssignable: true },
    { id: 'image.generate', group: 'multimodal', kind: 'modality', roles: [], capabilities: ['image.generate'], userAssignable: true },
    { id: 'image.edit', group: 'multimodal', kind: 'modality', roles: [], capabilities: ['image.edit'], userAssignable: true },
    { id: 'audio.transcribe', group: 'multimodal', kind: 'modality', roles: [], capabilities: ['audio.transcribe'], userAssignable: true },
    { id: 'audio.speech', group: 'multimodal', kind: 'modality', roles: [], capabilities: ['audio.speech'], userAssignable: true },
    { id: 'audio.analyze', group: 'multimodal', kind: 'modality', roles: [], capabilities: ['audio.analyze'], userAssignable: true },
    { id: 'music.generate', group: 'multimodal', kind: 'modality', roles: [], capabilities: ['music.generate'], userAssignable: true },
    { id: 'music.analyze', group: 'multimodal', kind: 'modality', roles: [], capabilities: ['music.analyze'], userAssignable: true },
    { id: 'video.generate', group: 'multimodal', kind: 'modality', roles: [], capabilities: ['video.generate'], userAssignable: true },
    { id: 'video.analyze', group: 'multimodal', kind: 'modality', roles: [], capabilities: ['video.analyze'], userAssignable: true },
    { id: 'text.embed', group: 'multimodal', kind: 'modality', roles: [], capabilities: ['text.embed'], userAssignable: true },
    // 내부 — 화면에 내지 않는다(서버 기본값·전역 배정)
    { id: 'chat', group: null, kind: 'text', roles: ['chat'], capabilities: [], userAssignable: false },
    { id: 'router', group: null, kind: 'text', roles: ['router'], capabilities: [], userAssignable: false },
];

const BY_ID = new Map(MODEL_SLOTS.map((s) => [s.id, s]));

/** 역할 → 슬롯 */
export const ROLE_SLOT: Readonly<Record<ModelRole, string>> = Object.fromEntries(
    MODEL_SLOTS.flatMap((s) => s.roles.map((r) => [r, s.id])),
) as Record<ModelRole, string>;

/** 기능 → 슬롯 (배정이 없는 기능 text.synthesize·web.search 는 없다) */
export const CAPABILITY_SLOT: Readonly<Partial<Record<Capability, string>>> = Object.fromEntries(
    MODEL_SLOTS.flatMap((s) => s.capabilities.map((c) => [c, s.id])),
);

export function getModelSlot(id: string): ModelSlotDef | undefined {
    return BY_ID.get(id);
}

/** 사용자가 배정할 수 있는 슬롯(화면 순서) */
export const USER_ASSIGNABLE_SLOTS: readonly ModelSlotDef[] = MODEL_SLOTS.filter((s) => s.userAssignable);
