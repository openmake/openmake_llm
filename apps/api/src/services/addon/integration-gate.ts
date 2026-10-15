/**
 * 채팅 통합(add-on 기능 훅)의 실행 게이트 — "이 사용자에게 이 add-on 의 기능 훅을 지금 실행해도 되나" (2026-10-16, 설계 문서 8.3·8.4).
 *
 * 라우트 게이트(`addon-host/routes.ts`)와 **같은 판정 함수**(`checkAddonEntitlement`)를 쓴다 — 상태 축 + 조직 사용권 축.
 *   - 상태 축: 관리자가 DB 에서 끈 add-on 은 재시작 없이 기능 훅이 멈추고, 부팅 실패(`state=failed`)는 `reason: 'failed'` 로 구분한다.
 *   - 조직 축: 조직 allowlist 밖 add-on 은 `reason: 'not_entitled'` — 라우트가 403 인 add-on 이 채팅에서 돌지 않게 한다.
 *     사용자가 없으면(게스트·내부 호출) 조직 축은 판정 함수가 건너뛴다.
 * 상태·정책을 확인할 수 없으면(DB 장애) 실행하지 않는다(fail-closed, `reason: 'state_unknown'`).
 * **보호 훅**(`isMemoryIsolatedSession`·`listHiddenSessionIds`)은 이 게이트의 대상이 아니다 — 꺼도 유지된다.
 *
 * @module services/addon/integration-gate
 */
import { checkAddonEntitlement } from './entitlement';

export type IntegrationGateVerdict =
    | { allowed: true }
    | { allowed: false; reason: 'disabled' | 'state_unknown' | 'failed' | 'not_entitled'; detail?: string };

export async function integrationGate(addonId: string, userId?: string): Promise<IntegrationGateVerdict> {
    const v = await checkAddonEntitlement(addonId, userId);
    switch (v) {
        case 'ok': return { allowed: true };
        case 'disabled': return { allowed: false, reason: 'disabled' };
        case 'failed': return { allowed: false, reason: 'failed' };
        case 'not-entitled': return { allowed: false, reason: 'not_entitled' };
        // 판정 결과는 원인을 싣지 않는다(원인은 판정 함수가 warn 로그로 남김)
        default: return { allowed: false, reason: 'state_unknown', detail: '상태·정책 조회 실패' };
    }
}
