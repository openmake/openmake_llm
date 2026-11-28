/**
 * 사용자별 쿼터 한도 해석 (213, F25 잔여 — opt-in QUOTA_USER_OVERRIDES_ENABLED).
 *
 * 유효 한도 = 덮어쓰기 칸이 있으면 그 값(0 = 무제한), 없으면(NULL·행 없음) 전역 설정. 플래그 OFF 면 항상 전역(종전).
 * 60초 캐시(조직 컨텍스트와 같은 TTL), 변경 시 clearQuotaOverrideCache. 조회 실패는 전역 값으로 fail-open — 한도 표가
 * 깨졌다고 채팅이 막히면 안 되고, 전역 값은 종전에도 강제되던 값이라 "덜 막는" 쪽으로 새지 않는다.
 *
 * @module services/cost/quota-overrides
 */
import { createLogger } from '../../utils/logger';
import { getConfig } from '../../config';
import { getPool } from '../../data/models/unified-database';
import { ORG_CONTEXT } from '../../config/runtime-limits';
import { quotaUserOverridesEnabled } from '../../config/quota-extensions';
import type { UserQuotaOverrideRow } from '../../data/repositories/user-quota-override-repository';

const logger = createLogger('QuotaOverrides');

export interface EffectiveUserLimits {
    hourlyTokenLimit: number;
    weeklyTokenLimit: number;
    monthlyCostBudgetMicros: number;
    /** 덮어쓰기 행이 적용됐는지(표시용) */
    overridden: boolean;
}

interface Entry { at: number; value: UserQuotaOverrideRow | null }
const cache = new Map<string, Entry>();

export function clearQuotaOverrideCache(userId?: string): void {
    if (userId === undefined) cache.clear(); else cache.delete(userId);
}

/** PURE: 덮어쓰기 칸(NULL = 전역) → 숫자. */
export function pickLimit(override: string | number | null | undefined, global: number): number {
    if (override === null || override === undefined) return global;
    const n = Number(override);
    return Number.isFinite(n) && n >= 0 ? n : global;
}

/** PURE: 전역 설정 + 덮어쓰기 행 → 유효 한도. */
export function resolveEffectiveLimits(
    global: { hourlyTokenLimit: number; weeklyTokenLimit: number; monthlyCostBudgetMicros: number },
    row: Pick<UserQuotaOverrideRow, 'hourly_token_limit' | 'weekly_token_limit' | 'monthly_cost_budget_micros'> | null,
): EffectiveUserLimits {
    if (!row) return { ...global, overridden: false };
    return {
        hourlyTokenLimit: pickLimit(row.hourly_token_limit, global.hourlyTokenLimit),
        weeklyTokenLimit: pickLimit(row.weekly_token_limit, global.weeklyTokenLimit),
        monthlyCostBudgetMicros: pickLimit(row.monthly_cost_budget_micros, global.monthlyCostBudgetMicros),
        overridden: true,
    };
}

async function loadRow(userId: string, now: number): Promise<UserQuotaOverrideRow | null> {
    const hit = cache.get(userId);
    if (hit && now - hit.at < ORG_CONTEXT.CACHE_TTL_MS) return hit.value;
    const { UserQuotaOverrideRepository } = await import('../../data/repositories/user-quota-override-repository');
    const value = await new UserQuotaOverrideRepository(getPool()).get(userId);
    cache.set(userId, { at: now, value });
    return value;
}

/** 사용자의 유효 한도 — 플래그 OFF·조회 실패는 전역 값. */
export async function effectiveUserLimits(userId: string, now: number = Date.now()): Promise<EffectiveUserLimits> {
    const cfg = getConfig();
    const global = {
        hourlyTokenLimit: cfg.llmHourlyTokenLimit,
        weeklyTokenLimit: cfg.llmWeeklyTokenLimit,
        monthlyCostBudgetMicros: cfg.userMonthlyCostBudgetMicros,
    };
    if (!quotaUserOverridesEnabled()) return { ...global, overridden: false };
    try {
        return resolveEffectiveLimits(global, await loadRow(userId, now));
    } catch (e) {
        logger.warn('사용자 한도 덮어쓰기 조회 실패 (전역 한도로 처리):', e);
        return { ...global, overridden: false };
    }
}
