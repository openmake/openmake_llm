/**
 * Add-on 사용권(entitlement) — "이 사용자가 이 add-on 을 쓸 수 있나" 의 단일 판정 (2026-09-19, S3).
 *
 * 두 축의 AND 다:
 *   ① 배포 차원 켜짐 — env override + `addon_installations.state`(`services/addon/addon-state`)
 *   ② 조직 사용권 — 조직 정책 `ADDON_ALLOWLIST`(빈 값/미설정 = 제한 없음)
 *
 * ②는 **조직 관리자의 통제 수단**이다 — 조직이 allowlist 를 두면 목록 밖 add-on 은 그 조직에서
 * 전용 라우트 403, 팩 스킬 주입 제외가 된다(예: "우리 조직은 Discord 연동을 쓰지 않는다").
 * ⚠️ OpenMake 의 add-on 은 **전부 무료**다(2026-09-20 방침) — 이 계층은 과금이 아니라 거버넌스다.
 * allowlist 를 두지 않으면(기본) 모든 add-on 이 모든 사용자에게 열려 있다.
 *
 * 조회 실패는 `state-unknown` — 라우트 게이트가 503 으로 알린다(꺼짐 404 와 구분). 조직 축도 엄격 조회(`resolveEffectivePolicyStrict`)라
 * 활성 조직·멤버십·조직 정책 중 하나라도 못 읽으면 허용으로 읽지 않는다(종전엔 하위 조회가 실패를 "조직 없음"으로 삼켜 allowlist 가 풀렸다).
 * 팩 스킬 주입 필터(`entitledAddonIds`)만 종전 fail-open 을 유지한다(선언형 콘텐츠).
 *
 * @module services/addon/entitlement
 */
import { createLogger } from '../../utils/logger';
import { resolveEffectivePolicy, resolveEffectivePolicyStrict } from '../org/effective-policy';
import { isAddonEnabled, readAddonEnabledStrict } from './addon-state';

const logger = createLogger('AddonEntitlement');

/**
 * 'state-unknown' = 상태·정책을 확인하지 못함(DB 장애) — 라우트는 503 으로 알린다(설계 문서 8.3). 꺼짐과 섞지 않는다.
 * 'failed' = 부팅에 실패함(`state=failed`) — 관리자 조치가 필요하다. 라우트는 503 `ADDON_FAILED`(재시도 안내 없음).
 */
export type EntitlementVerdict = 'ok' | 'disabled' | 'failed' | 'not-entitled' | 'state-unknown';

/**
 * @param userId 요청 사용자 — 없으면(게스트·내부 호출) 조직 축은 보지 않는다.
 */
export async function checkAddonEntitlement(addonId: string, userId?: string): Promise<EntitlementVerdict> {
    const enabled = await readAddonEnabledStrict(addonId);
    if (!enabled.known) {
        logger.warn(`add-on '${addonId}' 상태 확인 불가: ${enabled.reason}`);
        return 'state-unknown';
    }
    if (enabled.state === 'failed') return 'failed';
    if (!enabled.enabled) return 'disabled';
    if (!userId) return 'ok';
    try {
        const policy = await resolveEffectivePolicyStrict(userId);
        if (policy.addonAllowlist && !policy.addonAllowlist.includes(addonId)) return 'not-entitled';
    } catch (e) {
        logger.warn(`add-on '${addonId}' 조직 사용권 조회 실패(확인 불가): ${e instanceof Error ? e.message : String(e)}`);
        return 'state-unknown';
    }
    return 'ok';
}

export async function isAddonEntitled(addonId: string, userId?: string): Promise<boolean> {
    return (await checkAddonEntitlement(addonId, userId)) === 'ok';
}

/** 여러 add-on 을 한 번에 — 팩 스킬 주입 필터가 쓴다(정책 조회 1회). */
export async function entitledAddonIds(addonIds: readonly string[], userId?: string): Promise<Set<string>> {
    const out = new Set<string>();
    if (addonIds.length === 0) return out;
    let allowlist: string[] | undefined;
    if (userId) {
        try {
            allowlist = (await resolveEffectivePolicy(userId)).addonAllowlist;
        } catch (e) {
            logger.warn(`사용권 조회 실패 (fail-open): ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    for (const id of addonIds) {
        if (!(await isAddonEnabled(id))) continue;
        if (allowlist && !allowlist.includes(id)) continue;
        out.add(id);
    }
    return out;
}
