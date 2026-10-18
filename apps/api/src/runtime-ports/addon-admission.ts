/**
 * Add-on 실행 판정 포트 — 백그라운드 소비자(작업 큐 worker)가 "지금 이 add-on 의 작업을 집어도 되는가"와
 * "이 사용자의 작업을 실행해도 되는가"를 묻는 단일 문 (2026-10-16, 3차 묶음 C4).
 *
 * add-on 은 `services/addon/*` 를 직접 import 하지 않고 이 포트만 쓴다(경계 lint 래칫). 판정 규칙은 라우트 게이트와 같다 —
 * strict 상태(조회 실패를 켜짐으로 읽지 않음) + 조직 사용권(`checkAddonEntitlement`). 이 포트는 add-on 이름을 모른다.
 *
 * @module runtime-ports/addon-admission
 */
import { ensureAddonStates, readAddonEnabledStrict, readAddonStateStrict } from '../services/addon/addon-state';
import { checkAddonEntitlement, type EntitlementScope, type EntitlementVerdict } from '../services/addon/entitlement';

export type { EntitlementScope, EntitlementVerdict };

/** add-on 단위 실행 판정 — stopped(꺼짐·실패·env 차단)와 unknown(상태 조회 실패)을 구분한다 */
export type AddonRunVerdict =
    | { run: true }
    | { run: false; reason: 'stopped' | 'unknown'; detail: string };

export async function readAddonRunVerdict(addonId: string): Promise<AddonRunVerdict> {
    const verdict = await readAddonEnabledStrict(addonId);
    if (!verdict.known) return { run: false, reason: 'unknown', detail: verdict.reason };
    if (!verdict.enabled) return { run: false, reason: 'stopped', detail: String(verdict.state) };
    return { run: true };
}

/**
 * 사용자 작업의 실행 재검사 — 상태 + 조직 사용권. 라우트 게이트와 같은 판정.
 * 조직 자원 작업은 `scope.orgId`(접수 때 저장한 조직)로 판정한다 — 사용자의 지금 활성 조직이 아니라.
 */
export async function checkUserEntitlement(addonId: string, userId: string, scope?: EntitlementScope): Promise<EntitlementVerdict> {
    return checkAddonEntitlement(addonId, userId, scope);
}

/** 접수 시점의 add-on 상태 revision — 조회 실패면 null(접수는 막지 않는다 — 실행 판정은 claim 때 다시 한다) */
export async function readAddonStateRevision(addonId: string): Promise<number | null> {
    const state = await readAddonStateStrict(addonId);
    return state.known ? state.stateRevision : null;
}

/** 상태 캐시를 미리 채운다 — 별도 프로세스 기동 때 첫 판정이 DB 를 기다리지 않게. 실패는 삼킨다(fail-open 적재) */
export async function warmAddonStates(): Promise<void> {
    await ensureAddonStates();
}
