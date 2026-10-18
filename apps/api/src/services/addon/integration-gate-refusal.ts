/**
 * 실행 게이트(`integrationGate`)가 막은 기여 도구 호출의 안내 문구 — 채팅 오케스트레이션 도구와 에이전트 작업 기여 도구가
 * 같은 문구를 쓴다(설계 문서 8.3). 판정 모듈과 떼어 둔 것은 판정을 mock 하는 테스트에서도 실제 문구를 쓰게 하려는 것이다.
 *
 * @module services/addon/integration-gate-refusal
 */
import type { IntegrationGateVerdict } from './integration-gate';

export type GateRefusalReason = Extract<IntegrationGateVerdict, { allowed: false }>['reason'];

const REFUSAL_MESSAGES: Record<GateRefusalReason, (addonId: string) => string> = {
    not_entitled: (id) => `add-on '${id}' 은 이 조직에서 사용할 수 없습니다(허용 목록 밖)`,
    failed: (id) => `add-on '${id}' 이 부팅에 실패해 이 도구를 실행할 수 없습니다`,
    disabled: (id) => `add-on '${id}' 이 관리자에 의해 중지되어 이 도구를 실행할 수 없습니다`,
    state_unknown: (id) => `add-on '${id}' 상태를 확인할 수 없어 이 도구를 실행하지 않았습니다. 잠시 후 다시 시도하세요`,
};

/** 안내 문구 — 앞에 `Error: ` 는 붙이지 않는다(붙이는 것은 호출부) */
export function integrationGateRefusal(addonId: string, reason: GateRefusalReason): string {
    return REFUSAL_MESSAGES[reason](addonId);
}
