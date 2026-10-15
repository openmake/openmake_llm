/**
 * 채팅 통합(add-on 기능 훅)의 실행 게이트 — "이 add-on 의 기능 훅을 지금 실행해도 되나" (2026-10-16, 설계 문서 8.3·8.4).
 *
 * 라우트 게이트(`addon-host/routes.ts`)와 같은 strict 판정을 쓴다: 관리자가 DB 에서 끈 add-on 은 재시작 없이 기능 훅이
 * 멈추고, 상태를 확인할 수 없으면(DB 장애) 실행하지 않는다. 종전에는 채팅 통합을 env 로만 모아 DB 토글이 채팅에
 * 반영되지 않았다(라우트는 404 인데 Space 검색은 계속 돌았다). 부팅 실패(`state=failed`)는 `reason: 'failed'` 로 구분한다.
 * **보호 훅**(`isMemoryIsolatedSession`·`listHiddenSessionIds`)은 이 게이트의 대상이 아니다 — 꺼도 유지된다.
 *
 * @module services/addon/integration-gate
 */
import { readAddonEnabledStrict } from './addon-state';

export type IntegrationGateVerdict =
    | { allowed: true }
    | { allowed: false; reason: 'disabled' | 'state_unknown' | 'failed'; detail?: string };

export async function integrationGate(addonId: string): Promise<IntegrationGateVerdict> {
    const v = await readAddonEnabledStrict(addonId);
    if (!v.known) return { allowed: false, reason: 'state_unknown', detail: v.reason };
    if (v.enabled) return { allowed: true };
    return { allowed: false, reason: v.state === 'failed' ? 'failed' : 'disabled' };
}
