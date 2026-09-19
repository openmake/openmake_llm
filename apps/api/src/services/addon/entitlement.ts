/**
 * Add-on 사용권(entitlement) — "이 사용자가 이 add-on 을 쓸 수 있나" 의 단일 판정 (2026-09-19, S3).
 *
 * 두 축의 AND 다:
 *   ① 배포 차원 켜짐 — env override + `addon_installations.state`(`services/addon/addon-state`)
 *   ② 조직 사용권 — 조직 정책 `ADDON_ALLOWLIST`(빈 값/미설정 = 제한 없음)
 *
 * 유료 팩은 ②로 표현한다: 구매하지 않은 조직의 allowlist 에는 그 add-on id 가 없고, 그러면
 * 전용 라우트는 403, 팩 스킬은 주입에서 빠진다. **가격·결제는 이 계층 밖**이다(관리자가 allowlist 를 준다).
 *
 * 조회 실패는 fail-open(제한 없음) — 정책 조회 장애가 기본 기능을 막지 않는다.
 *
 * @module services/addon/entitlement
 */
import { createLogger } from '../../utils/logger';
import { resolveEffectivePolicy } from '../org/effective-policy';
import { isAddonEnabled } from './addon-state';

const logger = createLogger('AddonEntitlement');

export type EntitlementVerdict = 'ok' | 'disabled' | 'not-entitled';

/**
 * @param userId 요청 사용자 — 없으면(게스트·내부 호출) 조직 축은 보지 않는다.
 */
export async function checkAddonEntitlement(addonId: string, userId?: string): Promise<EntitlementVerdict> {
    if (!(await isAddonEnabled(addonId))) return 'disabled';
    if (!userId) return 'ok';
    try {
        const policy = await resolveEffectivePolicy(userId);
        if (policy.addonAllowlist && !policy.addonAllowlist.includes(addonId)) return 'not-entitled';
    } catch (e) {
        logger.warn(`사용권 조회 실패 (fail-open): ${e instanceof Error ? e.message : String(e)}`);
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
